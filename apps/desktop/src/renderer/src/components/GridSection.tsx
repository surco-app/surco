import {
  Anchor,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Crosshair,
  FoldHorizontal,
  Redo2,
  RotateCcw,
  SplitSquareHorizontal,
  Square,
  StepBack,
  StepForward,
  UnfoldHorizontal,
  Undo2,
  Volume2,
  Wand2,
  X,
} from 'lucide-react'
import type React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { gridSegments, normalizeBeatgrid, snapAnchor } from '../../../shared/beatgrid'
import { claimKeys } from '../lib/spaceClaim'
import { mediaUrl } from '../../../shared/media'
import type { Beatgrid, TrimRange } from '../../../shared/types'
import { beatgridOptions, useBeatgrid } from '../hooks/useBeatgrid'
import { useMaximizedSection } from '../hooks/useEditorSections'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { useWaveform } from '../hooks/useWaveform'
import { beatgridNeedsReview, gridLines } from '../lib/beatgrid'
import { formatTime } from '../lib/duration'
import { drawWaveform } from '../lib/waveform'
import { SectionHeader } from './SectionHeader'
import { SectionPill } from './SectionPill'
import { Tooltip } from './Tooltip'
import { ZoomStepper } from './ZoomStepper'
import { AFTER_COLOR, OVERLAY_W, Strip, ZOOM_MAX, zoomLabel } from './WaveformCompare'

// The fine correction: about the detector's own resolution, so one press fixes
// the largest error a correct detection leaves behind.
const NUDGE_SEC = 0.01
// Where the working lane opens: rekordbox-style, the overview lane above shows
// the whole track, so the lane grid work happens in starts at working depth —
// ~9 s of a typical track in view, transients and beat lines both readable —
// instead of asking for a zoom-in from ×1 on every single track.
const WORK_ZOOM = 32
// The centre reference's magnet: a beat within this many panel pixels of the
// line pulls it in, so panning lands on a beat by feel instead of a hair off.
const SNAP_PX = 10
// The lane's nominal width in CSS px, for turning SNAP_PX into seconds without
// measuring on every render — the strip fills the editor pane, and the magnet's
// feel is forgiving enough that a panel a few hundred px off changes nothing.
const LANE_PX = 900
// The working lane's wave, at full strength. The shared AFTER_COLOR is 80% opaque,
// which reads as washed-out navy once the grid's amber sits on top of it — and the
// audio, not the grid, is what the eye is trying to read.
const LANE_WAVE_COLOR = 'rgb(96, 165, 250)'

// Press-and-hold repeats: aligning a grid is dozens of tiny steps, so the
// stepper buttons auto-repeat like rekordbox's — fire once on press, then keep
// stepping after a short beat until release. The action reads through a ref so
// every tick acts on the LATEST grid; captured directly, a 2-second hold would
// re-commit the grid from press time over and over instead of walking it.
const HOLD_DELAY_MS = 350
const HOLD_TICK_MS = 70
function ToolbarButton({
  testid,
  label,
  onAct,
  icon,
  disabled = false,
  repeat = false,
  size = 'sm',
}: {
  testid: string
  label: string
  onAct: () => void
  icon: React.ReactNode
  disabled?: boolean
  repeat?: boolean
  size?: 'sm' | 'lg'
}): React.JSX.Element {
  const actRef = useRef(onAct)
  actRef.current = onAct
  const timers = useRef<{
    delay?: ReturnType<typeof setTimeout>
    tick?: ReturnType<typeof setInterval>
  }>({})
  // A pointer press already fired on pointerdown; the click that follows on
  // release must not fire a second step. Keyboard activation has no pointer
  // phase, so its click still acts — Enter/Space keep working.
  const fromPointer = useRef(false)
  const stop = useCallback((): void => {
    if (timers.current.delay !== undefined) clearTimeout(timers.current.delay)
    if (timers.current.tick !== undefined) clearInterval(timers.current.tick)
    timers.current = {}
  }, [])
  useEffect(() => stop, [stop])
  return (
    <button
      type="button"
      data-testid={testid}
      aria-label={label}
      disabled={disabled}
      onPointerDown={
        repeat
          ? (e) => {
              if (disabled) return
              fromPointer.current = true
              e.currentTarget.setPointerCapture?.(e.pointerId)
              actRef.current()
              timers.current.delay = setTimeout(() => {
                timers.current.tick = setInterval(() => actRef.current(), HOLD_TICK_MS)
              }, HOLD_DELAY_MS)
            }
          : undefined
      }
      onPointerUp={repeat ? stop : undefined}
      onPointerCancel={repeat ? stop : undefined}
      onClick={() => {
        if (repeat && fromPointer.current) {
          fromPointer.current = false
          return
        }
        onAct()
      }}
      className={`press relative flex shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted ${
        size === 'lg' ? 'h-8 w-8' : 'h-7 w-7'
      }`}
    >
      {icon}
      <Tooltip label={label} />
    </button>
  )
}

interface Props {
  value: Beatgrid | undefined
  open: boolean
  onToggle: () => void
  onChange: (grid: Beatgrid | undefined) => void
  inputPath: string
  trim?: TrimRange
}

// The per-track beatgrid for the DJ exports: a constant-tempo grid drawn over
// the wave, lined up with the beats through the buttons and the keyboard alone
// (nudges, beat steps, typed BPM, halve/double, "adjust from here") — the
// cursor's one job on the lane is panning the wave. The detection only
// suggests — it shows as the live grid until the user touches anything, and
// what the exports carry is whatever grid the track stores.
export function GridSection({
  value,
  open,
  onToggle,
  onChange,
  inputPath,
  trim,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The waveform decodes the full file and the detection its opening minutes,
  // so both wait for the selection to rest and the section to actually be open.
  const settled = useSettled(SELECTION_SETTLE_MS)
  const { data: wave, isFetching } = useWaveform(inputPath, open && settled)
  const { data: detected } = useBeatgrid(inputPath, open && settled)
  const loading = isFetching && !wave
  const durationSec = wave?.durationSec ?? 0
  // The staged trim as head/tail fractions, for dimming the dropped audio over
  // the wave. The grid keeps drawing over the FULL file (its anchors are
  // original-file seconds), so this only shades — it never reshapes the lane.
  const trimShade =
    trim && durationSec > 0
      ? {
          startFrac: Math.max(0, (trim.startSec ?? 0) / durationSec),
          endFrac: Math.max(0, (durationSec - (trim.endSec ?? durationSec)) / durationSec),
        }
      : undefined
  const [zoom, setZoom] = useState(WORK_ZOOM)
  // Maximized (the header's own toggle drives the store), the lanes double in
  // height — the whole window is available, so the wave takes it.
  const { maximized } = useMaximizedSection()
  const tall = maximized === 'grid'
  const [view, setView] = useState({ from: 0, to: 1 })

  // The only pointer gesture left on the lane: panning. The grid itself moves
  // by buttons and keyboard alone (user call) — the cursor-drag needed an 8 px
  // grab hunt and never felt trustworthy next to the nudge buttons.
  const dragging = useRef<{ mode: 'pan'; fromClientX: number; fromScroll: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  // Grabbing-hand feedback while a pan drag scrolls the wave.
  const [panning, setPanning] = useState(false)
  // The Strip's horizontal scroller, two levels up from the overlay (overlay →
  // strip div → scroller) — what a pan drag actually moves.
  const scrollerOf = (): HTMLElement | null =>
    overlayRef.current?.parentElement?.parentElement ?? null
  // A BeatgridResult is a Beatgrid plus detection extras; typing shown as the
  // grid keeps the segment math (changes) available on every source.
  // Every edit commits straight through (buttons and keys only — no drag to
  // preview), so what's shown IS the staged grid, or the detection under it.
  const shown: Beatgrid | undefined = value ?? detected ?? undefined
  // A multi-segment grid states several tempos, and the folded header shows only
  // the base one — which on a vinyl rip that drifts is the tempo of the first
  // stretch, not of the record. Saying how many stretches there are is what
  // keeps the summary honest about what the grid actually holds.
  const segmentSuffix = (grid: Beatgrid): string => {
    const count = 1 + (grid.changes?.length ?? 0)
    return count > 1 ? ` · ${tr('grid.segments', { count })}` : ''
  }
  const pct = (sec: number): number => (durationSec === 0 ? 0 : (sec / durationSec) * 100)
  const lines = useMemo(
    () => (shown && durationSec > 0 ? gridLines(shown, durationSec, view) : []),
    [shown, durationSec, view],
  )

  // The grid as ordered segments (base first), and which one an instant of the
  // track falls under — every per-segment edit routes through these two.
  const segments = useMemo(() => (shown ? gridSegments(shown) : []), [shown])
  function segmentIndexAt(sec: number): number {
    let index = 0
    for (let i = 1; i < segments.length; i++) {
      // Tolerance, not equality: anchors are stored rounded to the millisecond
      // while the magnet parks the reference on the unrounded beat, which can
      // sit a few microseconds BEFORE the anchor it is visually on. Compared
      // exactly, that near-miss handed the controls the segment behind the line
      // — and a nudge then moved the grid the user had just pinned. One
      // millisecond is far below a pixel at any zoom, so nothing else can fall
      // inside the slack.
      if (segments[i].anchorSec <= sec + 1e-3) index = i
      else break
    }
    return index
  }
  // "Where you are" for the segment-scoped controls (BPM, nudges, From here):
  // the centre of the visible window — the overview press centres the window on
  // the spot being worked, so the centre IS the current position. Magnetic: with
  // a beat within SNAP_PX of it, the reference sticks to that beat, so panning
  // lands on a line by feel and "adjust from here" starts exactly on it instead
  // of a hair off. The raw centre stands when no beat is close.
  const rawCentreSec = ((view.from + view.to) / 2) * durationSec
  const snappedCentre = useMemo(() => {
    if (!shown || durationSec <= 0 || segments.length === 0) return null
    // The catch window in seconds: SNAP_PX of the panel, sized off the VISIBLE
    // span (the view is the source of truth — zoom alone lies while the lane is
    // still settling into its scroll position).
    const visibleSec = Math.max(1e-6, (view.to - view.from) * durationSec)
    const catchSec = visibleSec * (SNAP_PX / LANE_PX)
    // Anchors outrank plain beats inside the window: the anchor is the thing
    // being edited, and the previous segment keeps a beat right where an anchor
    // stood before a nudge moved it. Snapping to that leftover beat flipped the
    // controls back onto the segment BEHIND the line mid-edit — the "adjust from
    // here moves the left grid" bug. Near a diamond, the line grabs the diamond.
    let anchor: number | null = null
    for (const seg of segments) {
      const d = Math.abs(seg.anchorSec - rawCentreSec)
      if (d <= catchSec && (anchor === null || d < Math.abs(anchor - rawCentreSec)))
        anchor = seg.anchorSec
    }
    if (anchor !== null) return anchor
    const index = (() => {
      let i = 0
      for (let j = 1; j < segments.length; j++) {
        if (segments[j].anchorSec <= rawCentreSec) i = j
        else break
      }
      return i
    })()
    const seg = segments[index]
    const period = 60 / seg.bpm
    const beat = seg.anchorSec + Math.round((rawCentreSec - seg.anchorSec) / period) * period
    return Math.abs(beat - rawCentreSec) <= catchSec ? beat : null
  }, [shown, segments, rawCentreSec, durationSec, view])
  const viewCentreSec = snappedCentre ?? rawCentreSec
  const centreSnapped = snappedCentre !== null
  // Editing holds its target: nudging an anchor walks it away from the line,
  // and the moment it left the magnet's catch the controls used to fall back to
  // the segment BEHIND the line — mid-edit, the left grid started moving. So
  // the segment last edited through the toolbar stays the target until the view
  // itself moves (a deliberate pan releases the hold; the magnet takes over
  // again from wherever the user lands).
  const editHold = useRef<{ index: number; centreSec: number } | null>(null)
  const heldIndex = (() => {
    const hold = editHold.current
    if (!hold || !shown || hold.index >= segments.length) return null
    const visibleSec = Math.max(1e-6, (view.to - view.from) * durationSec)
    const catchSec = visibleSec * (SNAP_PX / LANE_PX)
    return Math.abs(rawCentreSec - hold.centreSec) <= catchSec ? hold.index : null
  })()
  const activeSegIndex = shown ? (heldIndex ?? segmentIndexAt(viewCentreSec)) : 0
  const activeSeg = segments[activeSegIndex]

  // Every toolbar edit routes through here so the hold and the commit can never
  // disagree about which segment was touched.
  function editSegment(
    index: number,
    patch: Partial<{ anchorSec: number; bpm: number }>,
  ): void {
    if (!shown) return
    commit(withSegment(shown, index, patch))
    editHold.current = { index, centreSec: rawCentreSec }
  }

  // A change may move only between its neighbours: segments never reorder by
  // dragging, they get removed instead.
  function clampChange(sec: number, segIndex: number): number {
    const prev = segments[segIndex - 1].anchorSec + 0.01
    const next = (segments[segIndex + 1]?.anchorSec ?? durationSec) - 0.01
    return Math.min(Math.max(sec, prev), next)
  }

  function withSegment(
    grid: Beatgrid,
    segIndex: number,
    patch: Partial<{ anchorSec: number; bpm: number }>,
  ): Beatgrid {
    if (segIndex === 0) return { ...grid, ...patch }
    const changes = [...(grid.changes ?? [])]
    changes[segIndex - 1] = { ...changes[segIndex - 1], ...patch }
    return { ...grid, changes }
  }

  // The first grid line AT or AFTER an instant — where "adjust from here"
  // starts a new segment: the change must begin on the beat to the RIGHT of the
  // centre reference (that's the stretch being fixed), never on the one behind
  // it, which would re-anchor music the user is leaving alone.
  function beatAtOrAfter(sec: number): number {
    const index = segmentIndexAt(sec)
    const seg = segments[index]
    const period = 60 / seg.bpm
    const k = Math.max(0, Math.ceil((sec - seg.anchorSec) / period - 1e-9))
    const beat = seg.anchorSec + k * period
    const next = segments[index + 1]
    // A later segment's own anchor is a line too: never step past it.
    return next && beat >= next.anchorSec ? next.anchorSec : beat
  }

  // rekordbox-style undo/redo over committed grid edits: each commit pushes the
  // PRE-commit value (possibly undefined — back to the bare detection), so
  // exploring never loses a state. Per-mount like the rest: a track flip starts
  // a fresh history.
  const past = useRef<(Beatgrid | undefined)[]>([])
  const future = useRef<(Beatgrid | undefined)[]>([])
  // The stacks live in refs (mutated mid-commit); the counts are state so the
  // buttons' disabled flags re-render when the stacks move.
  const [history, setHistory] = useState({ undo: 0, redo: 0 })
  const syncHistory = (): void =>
    setHistory({ undo: past.current.length, redo: future.current.length })
  function record(prev: Beatgrid | undefined): void {
    past.current.push(prev)
    future.current = []
    syncHistory()
  }
  function undo(): void {
    // Length-checked first: pop() on empty returns undefined, which is also a
    // legitimate entry (back to the bare detection).
    if (past.current.length === 0) return
    const prev = past.current.pop()
    future.current.push(value)
    onChange(prev)
    syncHistory()
  }
  function redo(): void {
    if (future.current.length === 0) return
    const next = future.current.pop()
    past.current.push(value)
    onChange(next)
    syncHistory()
  }

  // The overview lane: the whole track at 100% width, a slim strip below the
  // zoomed working lane. It never zooms; it navigates — press or scrub and the
  // working window above centers there — and it wears the visible-window block
  // (the rest dimmed), sparse bar ticks and the audition playhead so "where am
  // I" is always answered.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const overviewRef = useRef<HTMLDivElement>(null)
  const overviewCanvasRef = useRef<HTMLCanvasElement>(null)
  const scrubbing = useRef(false)
  const overviewLines = useMemo(
    () => (shown && durationSec > 0 ? gridLines(shown, durationSec, { from: 0, to: 1 }) : []),
    [shown, durationSec],
  )
  // The overview's wave is painted through a ref CALLBACK, not a plain effect on
  // `wave`. Two ways an effect left the lane empty — grid ticks over a blank field,
  // exactly what users reported: the canvas mounts when a cached wave is ALREADY in
  // hand (so nothing is left to trigger a draw), and writing the height attribute
  // (which `tall` flips on maximize) wipes the bitmap. A ref callback fires on every
  // mount and remount; the effect below covers a wave that lands later.
  const paintOverview = useCallback(
    (canvas: HTMLCanvasElement | null): void => {
      overviewCanvasRef.current = canvas
      if (!canvas || !wave) return
      drawWaveform(canvas, wave.peaks, { color: AFTER_COLOR })
    },
    [wave],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tall` feeds the canvas height attribute, and writing it wipes the bitmap — the redraw must re-run with it.
  useEffect(() => {
    const canvas = overviewCanvasRef.current
    if (!canvas || !wave) return
    drawWaveform(canvas, wave.peaks, { color: AFTER_COLOR })
  }, [wave, tall])

  function centerOn(ratio: number): void {
    const el = scrollerRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    if (max <= 0) return
    el.scrollLeft = Math.min(max, Math.max(0, ratio * el.scrollWidth - el.clientWidth / 2))
  }

  function overviewRatio(clientX: number): number {
    const rect = overviewRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  // At ×1 there is no window to move, so navigating first restores the working
  // depth; the scroll must then wait for the stretched width to exist, hence the
  // pending ratio applied by the layout effect below — which runs after the
  // strip's own zoom re-anchoring, so the pressed spot wins.
  const pendingCenter = useRef<number | null>(null)
  function navigate(ratio: number): void {
    if (zoom <= 1) {
      pendingCenter.current = ratio
      setZoom(WORK_ZOOM)
      return
    }
    centerOn(ratio)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: centerOn reads refs only — the zoom flip that staged the pending ratio is the one trigger this needs.
  useLayoutEffect(() => {
    const ratio = pendingCenter.current
    if (ratio === null) return
    pendingCenter.current = null
    centerOn(ratio)
  }, [zoom])

  // Open looking at the anchor (the first beat, or wherever the user last
  // anchored the grid), not at whatever scroll position ×32 happens to start on.
  const centeredOnce = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on the wave landing — re-centering on every grid edit (`shown`) would yank the view mid-work.
  useEffect(() => {
    if (!wave || durationSec <= 0 || centeredOnce.current) return
    centeredOnce.current = true
    centerOn((shown?.anchorSec ?? 0) / durationSec)
  }, [wave, durationSec])

  // Millisecond precision is all the exports write; committing float noise from
  // a drag would flip staleness on bits the user can't see.
  //
  // A negative anchor is kept as it is: the lattice simply starts before the
  // file does. Folding it by a beat here (as the exports do, where the formats
  // demand a non-negative first beat) describes the SAME grid but jumps every
  // line a beat to the RIGHT on screen — so nudging past zero snapped the grid
  // back to where it started instead of creeping it left.
  function commit(next: Beatgrid): void {
    const anchorSec = Number(next.anchorSec.toFixed(3))
    const changes = next.changes?.map((c) => ({
      anchorSec: Number(c.anchorSec.toFixed(3)),
      bpm: c.bpm,
    }))
    const grid = normalizeBeatgrid({
      bpm: next.bpm,
      anchorSec,
      ...(changes && changes.length > 0 ? { changes } : {}),
    })
    if (grid) {
      record(value)
      onChange(grid)
    }
  }

  function dragTo(clientX: number): void {
    const drag = dragging.current
    if (!drag) return
    const scroller = scrollerOf()
    // Content follows the finger: dragging the wave right moves the view left.
    if (scroller) scroller.scrollLeft = drag.fromScroll - (clientX - drag.fromClientX)
  }

  function release(): void {
    const wasPanning = dragging.current !== null
    dragging.current = null
    setPanning(false)
    // Settle onto the beat: with one caught in the magnet's range, the wave
    // eases the last few pixels so the beat sits exactly under the reference —
    // the "click" the magnet was missing while it only moved an invisible
    // position. A pan that ends far from any beat just stays put.
    if (wasPanning && snappedCentre !== null && durationSec > 0)
      centerOn(snappedCentre / durationSec)
  }

  // Jump the view to the previous/next segment anchor. A grid with changes in it
  // scatters its seams across minutes of track, and hunting for the next one by
  // dragging the overview was the tax on every multi-segment fix (Djotas: "botón
  // desplazarse en los beatgrids que creas"). Anchors are strictly increasing,
  // so the next seam is simply the first one past the line — and the base
  // segment's own anchor counts, so stepping back from the first change lands on
  // where the grid itself starts.
  function seamAt(dir: -1 | 1): number | undefined {
    if (!shown || durationSec <= 0) return undefined
    const anchors = segments.map((s) => s.anchorSec)
    return dir === 1
      ? anchors.find((a) => a > rawCentreSec + 1e-6)
      : [...anchors].reverse().find((a) => a < rawCentreSec - 1e-6)
  }
  function stepSegment(dir: -1 | 1): void {
    const target = seamAt(dir)
    if (target === undefined) return
    // navigate, not centerOn: zoomed all the way out there is no window to
    // scroll, and navigate is the one that drops back into working depth first
    // (the same path the overview's own press takes).
    navigate(Math.max(0, Math.min(durationSec, target)) / durationSec)
  }
  const hasPrevSegment = seamAt(-1) !== undefined
  const hasNextSegment = seamAt(1) !== undefined

  // rekordbox's C: bring the nearest beat under the reference, whatever the
  // magnet's range — the explicit version of the settle above, for when the eye
  // has already found the beat and just wants it centred.
  function centreNearestBeat(): void {
    if (!shown || durationSec <= 0 || segments.length === 0) return
    const index = segmentIndexAt(rawCentreSec)
    const seg = segments[index]
    const period = 60 / seg.bpm
    const beat = seg.anchorSec + Math.round((rawCentreSec - seg.anchorSec) / period) * period
    const next = segments[index + 1]
    const target = next && beat >= next.anchorSec ? next.anchorSec : Math.max(0, beat)
    centerOn(Math.min(durationSec, target) / durationSec)
  }

  function nudge(deltaSec: number): void {
    if (!shown || !activeSeg) return
    const moved = activeSeg.anchorSec + deltaSec
    editSegment(activeSegIndex, {
      anchorSec: activeSegIndex === 0 ? moved : clampChange(moved, activeSegIndex),
    })
  }

  // rekordbox's expand/shrink beat intervals, as a fine BPM step on the active
  // segment: expanding the gaps between beats IS lowering the tempo. The grid
  // pivots at the segment's anchor, so the beat under the anchor never moves.
  function stepBpm(deltaBpm: number): void {
    if (!shown || !activeSeg) return
    editSegment(activeSegIndex, { bpm: Number((activeSeg.bpm + deltaBpm).toFixed(2)) })
  }

  // rekordbox's TAP: the tempo, tapped in on the button. The mean interval over
  // the recent taps sets the active segment's BPM; a pause of over two seconds
  // starts a fresh take, so a missed beat costs nothing.
  const taps = useRef<number[]>([])
  function tapTempo(): void {
    if (!shown || !activeSeg) return
    const now = performance.now()
    const last = taps.current[taps.current.length - 1]
    if (last !== undefined && now - last > 2000) taps.current = []
    taps.current.push(now)
    if (taps.current.length < 2) return
    const recent = taps.current.slice(-9)
    const meanMs = (recent[recent.length - 1] - recent[0]) / (recent.length - 1)
    editSegment(activeSegIndex, { bpm: Number((60000 / meanMs).toFixed(2)) })
  }

  // rekordbox's "set the first beat to the current position": re-phase the
  // active segment so a beat lands exactly under the reference line. The RAW
  // centre on purpose — the magnet's snapped position is already a beat, and
  // re-phasing to it would change nothing; this button exists for when the
  // whole lattice is offset from the music and the line marks where a beat
  // SHOULD be. The base folds back to keep "first beat near the start".
  function beatHere(): void {
    if (!shown || !activeSeg || durationSec <= 0) return
    const anchor =
      activeSegIndex === 0
        ? snapAnchor(rawCentreSec, activeSeg.bpm)
        : clampChange(rawCentreSec, activeSegIndex)
    editSegment(activeSegIndex, { anchorSec: anchor })
  }

  // "Make an adjustment from the current position", rekordbox's most-used grid
  // tool: a new segment starts on the beat at the view's centre (same bpm — the
  // usual fix is phase drift), and from here on every edit leaves what's behind
  // pinned.
  function addChangeFromHere(): void {
    if (!shown || durationSec <= 0) return
    const sec = Number(beatAtOrAfter(viewCentreSec).toFixed(3))
    if (sec <= shown.anchorSec) return
    if (gridSegments(shown).some((s) => Math.abs(s.anchorSec - sec) < 1e-3)) return
    const bpm = segments[segmentIndexAt(sec)].bpm
    const changes = [...(shown.changes ?? []), { anchorSec: sec, bpm }].sort(
      (a, b) => a.anchorSec - b.anchorSec,
    )
    commit({ ...shown, changes })
    // The fresh change is what the next edits are for — hold it as the target
    // (segment index = position among the changes, plus the base at 0).
    editHold.current = {
      index: changes.findIndex((c) => c.anchorSec === sec) + 1,
      centreSec: sec,
    }
    // Land the reference ON the new change: the beat it starts at sits just
    // RIGHT of where the line was, so leaving the line put would keep the
    // controls pointing at the segment BEHIND it — and the nudges would move
    // the whole track instead of the stretch just carved out. Centring makes
    // the next edit hit the new segment, which is the whole point of the button.
    centerOn(sec / durationSec)
  }

  function removeChange(index: number): void {
    if (!shown) return
    editHold.current = null
    const changes = (shown.changes ?? []).filter((_c, i) => i !== index)
    commit({ ...shown, changes })
  }

  // "Start over": collapse whatever the detector (or the user) built into a
  // single constant-tempo grid at the base BPM, dropping every segment. When the
  // auto grid comes out as a tangle of stretches the ear disagrees with, redoing
  // the detection just hands back another tangle — the point is to get a clean
  // slate to lay the grid on by hand. Keeps the base bpm/anchor (a sane starting
  // point beats a blank one) and routes through commit, so a mis-click is one
  // undo away from the tangle it replaced.
  function resetGrid(): void {
    if (!shown) return
    editHold.current = null
    if (!shown.changes?.length) return
    commit({ bpm: shown.bpm, anchorSec: shown.anchorSec })
  }

  // "Auto": drop whatever was staged AND redo the analysis from scratch — the
  // cached detection is deliberately skipped, so a grid computed by an older
  // detector (or one the user distrusts) gets a genuinely fresh verdict rather
  // than the same cached answer back.
  const queryClient = useQueryClient()
  const [reprobing, setReprobing] = useState(false)
  // Auto is segment-scoped like every other control: on the base it redoes the
  // whole track (the classic reset); on a tempo-change segment it re-detects
  // only that stretch — from its anchor to the next segment — and leaves the
  // grid behind the line untouched. "Adjust from here, then let it listen."
  async function autoDetect(): Promise<void> {
    if (activeSegIndex > 0 && shown) {
      const from = segments[activeSegIndex].anchorSec
      const to = segments[activeSegIndex + 1]?.anchorSec ?? durationSec
      setReprobing(true)
      try {
        const fresh = await window.api.beatgridWindow(inputPath, from, to - from)
        if (fresh)
          editSegment(activeSegIndex, {
            bpm: fresh.bpm,
            anchorSec: clampChange(fresh.anchorSec, activeSegIndex),
          })
      } finally {
        setReprobing(false)
      }
      return
    }
    editHold.current = null
    if (value) {
      record(value)
      onChange(undefined)
    }
    setReprobing(true)
    try {
      const fresh = await window.api.beatgrid(inputPath, true)
      queryClient.setQueryData(beatgridOptions(inputPath).queryKey, fresh)
    } finally {
      setReprobing(false)
    }
  }

  // The BPM field edits as text and commits on blur/Enter, so a half-typed
  // "12" never becomes a staged 12 BPM grid mid-keystroke. With no grid at all
  // (beatless material) a typed BPM creates one anchored at zero — the manual
  // path detection can't offer.
  const [bpmText, setBpmText] = useState<string | null>(null)
  function commitBpm(): void {
    const text = bpmText
    setBpmText(null)
    if (text === null) return
    const bpm = Number.parseFloat(text.replace(',', '.'))
    if (!Number.isFinite(bpm)) return
    // The field edits the segment you're standing on; with no grid at all a
    // typed BPM creates one anchored at zero — the manual path detection
    // can't offer.
    if (!shown) {
      commit({ anchorSec: 0, bpm })
      return
    }
    editSegment(activeSegIndex, { bpm })
  }

  // The by-ear check: play from the first beat at or after the visible window's
  // start while a playhead rides the strip, so grid-vs-transient alignment is
  // judged by eye and ear together. Stopped when the grid changes or the
  // section unmounts, like the trim audition.
  const [auditing, setAuditing] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef(0)
  // The two playheads are moved by writing their style, not by re-rendering. Holding the
  // position in state meant every animation frame re-rendered this whole component —
  // recomputing the grid lines, the snapped centre and the active segment, and reconciling
  // dozens of line spans at ×32 zoom — and the follow-scroll below then made the Strip
  // report a new view, which re-rendered it a SECOND time per frame. The audition is
  // precisely when the user is judging alignment BY EYE, so dropped frames there defeat the
  // feature. Two elements move; nothing else has to.
  const playheadRef = useRef<HTMLSpanElement>(null)
  const overviewPlayheadRef = useRef<HTMLSpanElement>(null)
  const movePlayheads = (sec: number | null): void => {
    for (const el of [playheadRef.current, overviewPlayheadRef.current]) {
      if (!el) continue
      el.style.display = sec === null ? 'none' : ''
      if (sec !== null) el.style.left = `${pct(sec)}%`
    }
  }
  function stopAudition(): void {
    audioRef.current?.pause()
    audioRef.current = null
    cancelAnimationFrame(rafRef.current)
    setAuditing(false)
    movePlayheads(null)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is deliberately the trigger — a moved grid invalidates what the playhead is checking, so the cleanup must fire on it.
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
      cancelAnimationFrame(rafRef.current)
      setAuditing(false)
      movePlayheads(null)
    }
  }, [value])
  // Space plays/pauses this check while the section is open — and the claim
  // keeps the same press from ALSO starting the mini-player (see spaceClaim).
  // The handler is re-registered whenever what it closes over changes, so the
  // key always drives the live grid and position.
  const auditionRef = useRef<() => void>(() => {})
  const centreRef = useRef<() => void>(() => {})
  const addSegmentRef = useRef<() => void>(() => {})
  const stepSegmentRef = useRef<(dir: -1 | 1) => void>(() => {})
  useEffect(() => {
    if (!open) return
    return claimKeys({
      play: () => auditionRef.current(),
      'centre-beat': () => centreRef.current(),
      'add-segment': () => addSegmentRef.current(),
      'prev-segment': () => stepSegmentRef.current(-1),
      'next-segment': () => stepSegmentRef.current(1),
    })
  }, [open])

  function audition(): void {
    if (auditing) {
      stopAudition()
      return
    }
    if (!shown || durationSec === 0) return
    // From the centre reference — the red line IS the position, so the check
    // plays exactly the stretch being worked on (magnetised onto its beat, so
    // the first click lands on a transient).
    //
    // It runs until Space stops it, not for a fixed spell: checking a grid is
    // listening for the click DRIFTING off the beat, and drift needs bars to
    // show itself. A timed snippet kept cutting out mid-judgement and had to be
    // restarted over and over.
    const from = Math.max(0, Math.min(durationSec, viewCentreSec))
    const audio = new Audio(mediaUrl(inputPath))
    audioRef.current = audio
    // Seek only once the element knows its duration — an immediate currentTime
    // on a still-loading element is dropped by the media pipeline.
    audio.onloadedmetadata = () => {
      audio.currentTime = from
      audio.play().catch(() => stopAudition())
    }
    audio.onended = () => stopAudition()
    const tick = (): void => {
      if (!audioRef.current) return
      const t = audioRef.current.currentTime
      movePlayheads(t)
      // Follow like a player: the wave scrolls along under the advancing
      // playhead instead of playing on past the window's right edge.
      if (durationSec > 0) centerOn(t / durationSec)
      rafRef.current = requestAnimationFrame(tick)
    }
    movePlayheads(from)
    rafRef.current = requestAnimationFrame(tick)
    setAuditing(true)
  }
  // The claim above fires through these refs, so the keys always drive the live
  // closure (current grid, current centre) without re-registering per render.
  auditionRef.current = audition
  centreRef.current = centreNearestBeat
  addSegmentRef.current = addChangeFromHere
  stepSegmentRef.current = stepSegment

  const iconButton = (
    testid: string,
    label: string,
    onClick: () => void,
    icon: React.ReactNode,
    disabled = false,
    repeat = false,
    size: 'sm' | 'lg' = 'sm',
  ): React.JSX.Element => (
    <ToolbarButton
      testid={testid}
      label={label}
      onAct={onClick}
      icon={icon}
      disabled={disabled}
      repeat={repeat}
      size={size}
    />
  )
  // The glyph inside a button: bigger in the full-window view, where the lane is
  // twice as tall and the icons had no reason to stay 12 px.
  const glyph = tall ? 'h-4 w-4' : 'h-3.5 w-3.5'
  // The toolbar's one height. Applied to the BPM field and to every button, so the
  // baseline is shared and nothing floats a pixel proud of its neighbour.
  const controlH = tall ? 'h-8' : 'h-7'

  return (
    <div data-testid="editor-grid" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        sectionId="grid"
        title={tr('grid.title')}
        open={open}
        onToggle={onToggle}
        help={tr('grid.hint')}
        summary={value || detected ? undefined : tr('grid.summaryNone')}
        summaryTestId="grid-summary"
        right={
          value ? (
            !open ? (
              <SectionPill tone="accent" testid="grid-active-badge">
                {`${value.bpm.toFixed(2)} BPM${segmentSuffix(value)}`}
              </SectionPill>
            ) : undefined
          ) : detected ? (
            // A coin-flip detection wears the warn tint: the same fact the
            // list's "grid to review" filter reads, visible in context here.
            <SectionPill
              tone={beatgridNeedsReview(detected) ? 'warn' : 'neutral'}
              testid={beatgridNeedsReview(detected) ? 'grid-review-pill' : 'grid-detected-pill'}
            >
              {beatgridNeedsReview(detected)
                ? tr('grid.review')
                : `${tr('grid.detected', { bpm: detected.bpm.toFixed(1) })}${segmentSuffix(detected)}`}
            </SectionPill>
          ) : undefined
        }
      />
      {open && (
        <div className="mt-3">
          {detected === null && !shown && (
            <p data-testid="grid-nothing" className="mb-3 text-[10px] text-fg-dim">
              {tr('grid.nothing')}
            </p>
          )}
          {(loading || wave) && (
            <>
              <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
                {/* The toolbar reads as rekordbox's GRID EDIT: icon-only verbs in
                    small groups, ordered the way the work actually goes — set the
                    TEMPO, trim it FINE, place the PHASE, CHECK it by ear, UNDO.
                    Labels live in the tooltips (and aria), so the row stays one
                    calm line instead of a sentence.
                    Auto is the exception, and it leads: it's what most users
                    press first, it's the one control here that REBUILDS the grid
                    rather than nudging it, and buried among identical icons it
                    read as just another nudge. An accented, labelled button says
                    "start here" — and its own tint separates it from the fine
                    verbs without needing a divider. */}
                <button
                  type="button"
                  data-testid="grid-reset"
                  aria-label={tr('grid.resetHint')}
                  onClick={autoDetect}
                  disabled={reprobing}
                  className={`press relative flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-2.5 text-[11px] font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-60 ${controlH}`}
                >
                  <Wand2
                    className={`${glyph} ${reprobing ? 'animate-pulse' : ''}`}
                    aria-hidden="true"
                  />
                  {tr('grid.reset')}
                  <Tooltip label={tr('grid.resetHint')} />
                </button>
                <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-fg-dim">
                  <span className="font-medium uppercase tracking-wider">
                    {tr('grid.bpmLabel')}
                  </span>
                  <input
                    data-testid="grid-bpm-input"
                    type="number"
                    step="0.01"
                    min="20"
                    max="999"
                    value={bpmText ?? (activeSeg ? String(Number(activeSeg.bpm.toFixed(2))) : '')}
                    onChange={(e) => setBpmText(e.target.value)}
                    onBlur={commitBpm}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitBpm()
                      }
                    }}
                    // w-20, not w-16: a two-decimal tempo ("150.03") plus the
                    // number input's spinner well clipped the last digit.
                    className={`w-20 rounded-md border border-[var(--color-line)] bg-transparent px-2 text-[11px] tabular-nums text-fg outline-none focus:border-accent ${controlH}`}
                  />
                  {shown && activeSeg && (
                    <button
                      type="button"
                      data-testid="grid-tap"
                      aria-label={tr('grid.tapHint')}
                      onClick={tapTempo}
                      className={`press relative shrink-0 rounded-md border border-[var(--color-line)] px-2 text-[10px] font-medium tracking-wider text-fg-muted transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg ${
                        controlH
                      }`}
                    >
                      TAP
                      <Tooltip label={tr('grid.tapHint')} />
                    </button>
                  )}
                </label>
                {shown && activeSeg && (
                  <>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        data-testid="grid-bpm-half"
                        aria-label={tr('grid.half')}
                        disabled={
                          !normalizeBeatgrid(
                            withSegment(shown, activeSegIndex, { bpm: activeSeg.bpm / 2 }),
                          )
                        }
                        onClick={() => editSegment(activeSegIndex, { bpm: activeSeg.bpm / 2 })}
                        className={`press relative shrink-0 rounded-md border border-[var(--color-line)] px-2 text-[10px] tabular-nums text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted ${
                          controlH
                        }`}
                      >
                        ÷2
                        <Tooltip label={tr('grid.half')} />
                      </button>
                      <button
                        type="button"
                        data-testid="grid-bpm-double"
                        aria-label={tr('grid.double')}
                        disabled={
                          !normalizeBeatgrid(
                            withSegment(shown, activeSegIndex, { bpm: activeSeg.bpm * 2 }),
                          )
                        }
                        onClick={() => editSegment(activeSegIndex, { bpm: activeSeg.bpm * 2 })}
                        className={`press relative shrink-0 rounded-md border border-[var(--color-line)] px-2 text-[10px] tabular-nums text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted ${
                          controlH
                        }`}
                      >
                        ×2
                        <Tooltip label={tr('grid.double')} />
                      </button>
                      {iconButton(
                        'grid-expand',
                        tr('grid.expand'),
                        () => stepBpm(-0.01),
                        <UnfoldHorizontal className={glyph} aria-hidden="true" />,
                        false,
                        true,
                      )}
                      {iconButton(
                        'grid-shrink',
                        tr('grid.shrink'),
                        () => stepBpm(0.01),
                        <FoldHorizontal className={glyph} aria-hidden="true" />,
                        false,
                        true,
                      )}
                    </span>
                    {/* Where the beats SIT: a beat here, a beat centred, a new
                        segment from here. All three place the lattice against
                        the reference line by hand. */}
                    <span className="flex shrink-0 items-center gap-0.5">
                      {iconButton(
                        'grid-beat-here',
                        tr('grid.beatHereHint'),
                        beatHere,
                        <Anchor className={glyph} aria-hidden="true" />,
                      )}
                      {iconButton(
                        'grid-centre-beat',
                        tr('grid.centreBeat'),
                        centreNearestBeat,
                        <Crosshair className={glyph} aria-hidden="true" />,
                      )}
                      {iconButton(
                        'grid-from-here',
                        tr('grid.fromHereHint'),
                        addChangeFromHere,
                        <SplitSquareHorizontal className={glyph} aria-hidden="true" />,
                      )}
                      {/* Walk the seams a multi-segment grid leaves behind: they
                          sit minutes apart, and finding the next one by dragging
                          the overview was the tax on every fix. Dead while the
                          line has nothing to step to. */}
                      {iconButton(
                        'grid-prev-segment',
                        tr('grid.prevSegment'),
                        () => stepSegment(-1),
                        <StepBack className={glyph} aria-hidden="true" />,
                        !hasPrevSegment,
                      )}
                      {iconButton(
                        'grid-next-segment',
                        tr('grid.nextSegment'),
                        () => stepSegment(1),
                        <StepForward className={glyph} aria-hidden="true" />,
                        !hasNextSegment,
                      )}
                    </span>
                    {/* Check the grid by ear: the audition plays the stretch so
                        you can hear the beats land on it. Its own group — playing
                        audio is neither a nudge nor the machine's Auto (which now
                        leads the row), so it sits apart from both. */}
                    <span className="flex shrink-0 items-center gap-0.5">
                      {iconButton(
                        'grid-audition',
                        tr('grid.audition'),
                        audition,
                        auditing ? (
                          <Square className={`${glyph} fill-current`} aria-hidden="true" />
                        ) : (
                          <Volume2 className={glyph} aria-hidden="true" />
                        ),
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      {/* Start over: drop every segment back to one clean tempo.
                          Its own group next to undo — it destroys the segment
                          work, and undo is where that gets taken back. Dead when
                          there is already only one stretch. */}
                      {iconButton(
                        'grid-clear',
                        tr('grid.clearHint'),
                        resetGrid,
                        <RotateCcw className={glyph} aria-hidden="true" />,
                        !shown?.changes?.length,
                      )}
                      {iconButton(
                        'grid-undo',
                        tr('grid.undo'),
                        undo,
                        <Undo2 className={glyph} aria-hidden="true" />,
                        history.undo === 0,
                      )}
                      {iconButton(
                        'grid-redo',
                        tr('grid.redo'),
                        redo,
                        <Redo2 className={glyph} aria-hidden="true" />,
                        history.redo === 0,
                      )}
                    </span>
                  </>
                )}
              </div>
              {/* relative wrapper: the centre reference below must pin to the
                  VIEWPORT's middle while the lane scrolls under it, so it lives
                  outside the Strip's scrolled content. */}
              <div className="relative">
              <Strip
                wave={wave}
                loading={loading}
                loudness={undefined}
                color={LANE_WAVE_COLOR}
                raster={OVERLAY_W}
                zoom={zoom}
                onZoomChange={setZoom}
                inputPath={inputPath}
                onViewChange={setView}
                scrollerRef={scrollerRef}
                tall={tall}
                trimShade={trimShade}
                // No red clip marks: the eye is lining hairlines up with
                // transients, and on a hot master the flags paint half the
                // strip red — noise for this job.
                marks={false}
              >
                {wave && durationSec > 0 && shown && (
                  <div
                    ref={overlayRef}
                    data-testid="grid-overlay"
                    className="absolute inset-0 touch-none"
                    // The affordances the raw overlay hid: resize over a
                    // grabbable beat, a hand over open wave when there's
                    // somewhere to pan to, closed while panning.
                    style={{ cursor: panning ? 'grabbing' : zoom > 1 ? 'grab' : undefined }}
                    onPointerDown={(e) => {
                      // The lane's one gesture: grab the wave and pan it. The
                      // grid itself only ever moves through the buttons and the
                      // keyboard, so no press can shift the phase by accident —
                      // and at ×1 there is nowhere to pan, so it stays inert.
                      const scroller = scrollerOf()
                      if (!scroller || zoom <= 1) return
                      dragging.current = {
                        mode: 'pan',
                        fromClientX: e.clientX,
                        fromScroll: scroller.scrollLeft,
                      }
                      setPanning(true)
                      e.currentTarget.setPointerCapture?.(e.pointerId)
                    }}
                    // A move only pans while the button is actually down. The
                    // browser drops the capture (no pointerup follows) whenever
                    // the captured element is re-laid-out under the finger —
                    // maximizing the section does exactly that — and the pan
                    // used to stay armed, so the next bare move dragged the
                    // wave from a stale origin and threw the view across the
                    // track. Belt and braces: release on the lost capture, and
                    // refuse to pan from a move with no button held.
                    onPointerMove={(e) => {
                      if (e.buttons === 0) {
                        if (dragging.current) release()
                        return
                      }
                      dragTo(e.clientX)
                    }}
                    onPointerUp={release}
                    onPointerCancel={release}
                    onLostPointerCapture={release}
                  >
                    {/* Amber, not the wave's accent blue: the lines sit ON the
                        wave, and same-hue lines disappeared into a busy mix.
                        Full opacity plus a faint halo — a bare 1px line at half
                        opacity still sank between the peaks of a busy wave. */}
                    {/* Two ranks, not thirty equal lines. The DOWNBEAT (the 1 of the
                        bar) is the one the ear and the eye actually track, so it alone
                        gets a full-height amber rule. The three beats between it are
                        tick marks at the lane's edges — present when you need to count,
                        but they never cross the wave, so the audio stays the thing you
                        are looking at. Before this every beat was a full amber bar with
                        a halo: a picket fence over the music. */}
                    {/* Two ranks, told apart by WEIGHT, not by length. Both cross the
                        full lane and both sit ABOVE the wave (z-10) — an earlier version
                        clipped the beats to the lane's edges, and a loud passage simply
                        swallowed them: the beat lines vanished exactly where there was
                        music to line them up against. The downbeat (the 1 of the bar) is
                        opaque and the one the eye locks onto; the three beats between it
                        are the same amber at a third of the strength — legible over the
                        wave, quiet enough that they never become a fence. */}
                    {lines.map((line) => (
                      <span
                        key={line.sec}
                        data-testid={line.downbeat ? 'grid-line-downbeat' : 'grid-line'}
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-y-0 z-10 -translate-x-1/2 bg-[var(--color-warn)] ${
                          line.downbeat ? 'w-px' : 'w-px opacity-35'
                        }`}
                        style={{ left: `${line.pct}%` }}
                      />
                    ))}
                    {/* Always mounted, hidden until the audition moves it: the rAF writes
                        its style directly, so it must not depend on a render to exist. */}
                    <span
                      ref={playheadRef}
                      data-testid="grid-playhead"
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 w-px bg-fg"
                      style={{ display: 'none' }}
                    />
                    <div
                      data-testid="grid-anchor-handle"
                      role="slider"
                      aria-label={tr('grid.handleAnchor')}
                      aria-valuemin={0}
                      aria-valuemax={Number(durationSec.toFixed(2))}
                      aria-valuenow={Number(shown.anchorSec.toFixed(2))}
                      tabIndex={0}
                      // Focus sharpens the handle's own line and dot rather than
                      // boxing it: an outline on a strip this thin read as a stray
                      // rectangle. The tight, spreadless glow keeps the line a crisp
                      // line — the same treatment the trim handles use.
                      className="group absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-pointer touch-none outline-none"
                      style={{ left: `${pct(shown.anchorSec)}%` }}
                      onKeyDown={(e) => {
                        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                        e.preventDefault()
                        const step = e.shiftKey ? 0.1 : NUDGE_SEC
                        nudge(e.key === 'ArrowLeft' ? -step : step)
                      }}
                      // A click only focuses (then the arrows nudge): the grid
                      // moves by buttons and keyboard alone. stopPropagation so
                      // the press doesn't start a pan under the handle.
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-warn)] group-focus-visible:shadow-[0_0_4px_var(--color-warn)]"
                      />
                      <span
                        aria-hidden="true"
                        className="absolute top-1/2 left-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-[var(--color-warn)] group-focus-visible:scale-125 group-focus-visible:shadow-[0_0_4px_var(--color-warn)]"
                      />
                    </div>
                    {/* One handle per grid change, visually a diamond so it reads
                        apart from the base anchor's square: click focuses it,
                        the arrows nudge that segment alone (clamped between its
                        neighbours) and Delete removes it. */}
                    {(shown.changes ?? []).map((change, i) => (
                      <div
                        key={change.anchorSec}
                        data-testid="grid-change-handle"
                        role="slider"
                        aria-label={tr('grid.handleChange')}
                        aria-valuemin={0}
                        aria-valuemax={Number(durationSec.toFixed(2))}
                        aria-valuenow={Number(change.anchorSec.toFixed(2))}
                        tabIndex={0}
                        // Same sharpen-not-box focus as the anchor handle above.
                        className="group absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-pointer touch-none outline-none"
                        style={{ left: `${pct(change.anchorSec)}%` }}
                        onKeyDown={(e) => {
                          if (e.key === 'Delete' || e.key === 'Backspace') {
                            e.preventDefault()
                            removeChange(i)
                            return
                          }
                          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                          e.preventDefault()
                          const step = e.shiftKey ? 0.1 : NUDGE_SEC
                          const delta = e.key === 'ArrowLeft' ? -step : step
                          commit(
                            withSegment(shown, i + 1, {
                              anchorSec: clampChange(change.anchorSec + delta, i + 1),
                            }),
                          )
                        }}
                        // Click focuses (arrows nudge, Delete removes); the
                        // press must not fall through into a pan.
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-warn)] group-focus-visible:shadow-[0_0_4px_var(--color-warn)]"
                        />
                        <span
                          aria-hidden="true"
                          className="absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-[var(--color-warn)] group-focus-visible:scale-125 group-focus-visible:shadow-[0_0_4px_var(--color-warn)]"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Strip>
              {/* rekordbox's centre reference: the fixed line marks the exact
                  spot every segment-scoped control (BPM, nudges, From here)
                  already targets — the "current position" used to be invisible.
                  The chip reads the offset from the active segment's downbeat
                  in bars, so phase drift is a number, not a squint. */}
              {wave && durationSec > 0 && shown && (
                <span
                  data-testid="grid-center-line"
                  data-snapped={centreSnapped || undefined}
                  aria-hidden="true"
                  // A crosshair, not a marker: nailed to the middle of the viewport
                  // while the wave slides under it (rekordbox's reference). It must
                  // never move or grow mid-pan — chasing the magnetised beat made it
                  // smear into a fat streak while dragging. The magnet lives in the
                  // POSITION the controls act on, not in the line; the glow only
                  // says "caught". Bounded to the LANE's height (not the wrapper's,
                  // which includes the scrollbar) — it used to hang below the wave,
                  // spilling into the buttons.
                  className={`pointer-events-none absolute top-0 left-1/2 z-20 w-0.5 -translate-x-1/2 bg-[var(--color-danger)] ${
                    tall ? 'h-48' : 'h-24'
                  } ${
                    centreSnapped && !panning ? 'shadow-[0_0_5px_var(--color-danger)]' : 'opacity-80'
                  }`}
                />
              )}
              </div>
              {/* The offset in bars: BELOW the lane, not floating over the wave it
                  was there to measure. Centred under the reference it belongs to. */}
              {wave && durationSec > 0 && shown && activeSeg && (
                <p
                  data-testid="grid-center-bars"
                  className="mt-1 text-center text-[10px] leading-none tabular-nums text-fg-dim"
                >
                  {tr('grid.centerBars', {
                    bars: `${viewCentreSec >= activeSeg.anchorSec ? '+' : '−'}${Math.abs(
                      (viewCentreSec - activeSeg.anchorSec) / ((240 / activeSeg.bpm) || 1),
                    ).toFixed(1)}`,
                  })}
                </p>
              )}
              {wave && durationSec > 0 && shown && activeSeg && (
                <div
                  data-testid="grid-nudge-bar"
                  className={`flex items-center ${tall ? 'mt-2 gap-2' : 'mt-1.5 gap-1'}`}
                >
                  {/* The anchor readout sits with the view controls, not with the
                      grid's edit verbs: it reports where the grid IS, it does not
                      change it. */}
                  <span className="flex min-w-0 flex-1 items-center">
                    {shown && (
                      <span
                        data-testid="grid-anchor"
                        className="relative min-w-0 truncate text-[10px] tabular-nums text-fg-dim"
                      >
                        {`${shown.anchorSec.toFixed(2)} s`}
                        <Tooltip
                          label={tr('grid.anchorAt', { seconds: shown.anchorSec.toFixed(2) })}
                        />
                      </span>
                    )}
                  </span>
                  {iconButton(
                    'grid-beat-back',
                    tr('grid.beatBack'),
                    () => nudge(-60 / activeSeg.bpm),
                    <ChevronsLeft className={glyph} aria-hidden="true" />,
                    false,
                    true,
                    tall ? 'lg' : 'sm',
                  )}
                  {iconButton(
                    'grid-nudge-earlier',
                    tr('grid.nudgeEarlier'),
                    () => nudge(-NUDGE_SEC),
                    <ChevronLeft className={glyph} aria-hidden="true" />,
                    false,
                    true,
                    tall ? 'lg' : 'sm',
                  )}
                  {iconButton(
                    'grid-nudge-later',
                    tr('grid.nudgeLater'),
                    () => nudge(NUDGE_SEC),
                    <ChevronRight className={glyph} aria-hidden="true" />,
                    false,
                    true,
                    tall ? 'lg' : 'sm',
                  )}
                  {iconButton(
                    'grid-beat-forward',
                    tr('grid.beatForward'),
                    () => nudge(60 / activeSeg.bpm),
                    <ChevronsRight className={glyph} aria-hidden="true" />,
                    false,
                    true,
                    tall ? 'lg' : 'sm',
                  )}
                  {/* Zoom: how much of the track the working lane shows. A view
                      control, so it belongs to the view's own row. */}
                  <span className="flex min-w-0 flex-1 items-center justify-end">
                    <ZoomStepper
                      label={zoomLabel(zoom)}
                      onOut={() => setZoom((z) => Math.max(1, z / 2))}
                      onIn={() => setZoom((z) => Math.min(ZOOM_MAX, z * 2))}
                      onReset={() => setZoom(1)}
                      outDisabled={zoom <= 1}
                      inDisabled={zoom >= ZOOM_MAX}
                      resetDisabled={zoom <= 1}
                      size={tall ? 'lg' : 'sm'}
                      labels={{
                        out: tr('editor.waveformZoomOut'),
                        in: tr('editor.waveformZoomIn'),
                        reset: tr('editor.waveformZoomReset'),
                      }}
                      testids={{
                        out: 'waveform-zoom-out',
                        in: 'waveform-zoom-in',
                        reset: 'waveform-zoom-reset',
                      }}
                    />
                  </span>
                </div>
              )}
              {wave && durationSec > 0 && (
                <div
                  ref={overviewRef}
                  data-testid="grid-overview"
                  role="slider"
                  aria-label={tr('grid.overview')}
                  aria-valuemin={0}
                  aria-valuemax={Number(durationSec.toFixed(2))}
                  aria-valuenow={Number((((view.from + view.to) / 2) * durationSec).toFixed(2))}
                  tabIndex={0}
                  className={`relative mt-1.5 cursor-pointer touch-none overflow-hidden rounded-md focus-visible:outline-1 focus-visible:outline-accent ${tall ? 'h-10' : 'h-6'}`}
                  onPointerDown={(e) => {
                    scrubbing.current = true
                    e.currentTarget.setPointerCapture?.(e.pointerId)
                    navigate(overviewRatio(e.clientX))
                  }}
                  // Same stale-gesture guard as the lane above: a scrub only
                  // follows a held button, and a capture lost to a re-layout
                  // (maximizing) ends it — otherwise the overview kept scrubbing
                  // from every bare mouse move that crossed it.
                  onPointerMove={(e) => {
                    if (e.buttons === 0) {
                      scrubbing.current = false
                      return
                    }
                    if (scrubbing.current) navigate(overviewRatio(e.clientX))
                  }}
                  onPointerUp={() => {
                    scrubbing.current = false
                  }}
                  onPointerCancel={() => {
                    scrubbing.current = false
                  }}
                  onLostPointerCapture={() => {
                    scrubbing.current = false
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                    e.preventDefault()
                    const span = view.to - view.from
                    const centre =
                      (view.from + view.to) / 2 + (e.key === 'ArrowLeft' ? -span / 2 : span / 2)
                    navigate(Math.min(1, Math.max(0, centre)))
                  }}
                >
                  <canvas
                    ref={paintOverview}
                    width={OVERLAY_W}
                    height={tall ? 60 : 36}
                    className={`block w-full rounded-md bg-[var(--color-field)] ${tall ? 'h-10' : 'h-6'}`}
                  />
                  {/* The grid's bar ticks, dimmed: enough to see where the grid
                      sits across the whole track, quiet enough not to compete
                      with the working lane's lines. */}
                  {overviewLines.map((line) => (
                    <span
                      key={line.sec}
                      data-testid="grid-overview-tick"
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-1.5 w-px -translate-x-1/2 bg-[var(--color-warn)]/60"
                      style={{ left: `${line.pct}%` }}
                    />
                  ))}
                  {/* The seams themselves — where one segment hands over to the
                      next. The working lane only ever shows the handful of beats
                      in its window, so a grid's seams were invisible unless you
                      happened to scroll onto one; here the whole track is in
                      view, so this is the one place they can all be seen at
                      once. Accent and full height, so they read as structure
                      over the dim amber bar ticks rather than as another one. */}
                  {segments.slice(1).map((seg) => (
                    <span
                      key={seg.anchorSec}
                      data-testid="grid-overview-seam"
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-accent"
                      style={{ left: `${pct(seg.anchorSec)}%` }}
                    >
                      {/* A pip at the top. Over a long track the bar ticks pack
                          into a solid amber field, and a hairline — accent or
                          not — simply vanished into it; the pip breaks the
                          silhouette so the seam is found by shape, not by hue. */}
                      <span className="absolute -top-px left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-accent" />
                    </span>
                  ))}
                  <span
                    ref={overviewPlayheadRef}
                    data-testid="grid-overview-playhead"
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 w-px bg-fg"
                    style={{ display: 'none' }}
                  />
                  {/* The working window reads as the one clear block: everything
                      outside it dims (the trim shades' treatment), so the strip
                      above is visibly "this slice of the whole". */}
                  {zoom > 1 && (
                    <>
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 left-0 bg-[var(--color-panel)]/70"
                        style={{ width: `${view.from * 100}%` }}
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 right-0 bg-[var(--color-panel)]/70"
                        style={{ width: `${(1 - view.to) * 100}%` }}
                      />
                      <span
                        data-testid="grid-overview-window"
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 rounded-sm border border-fg/40"
                        style={{
                          left: `${view.from * 100}%`,
                          width: `${Math.max(0.4, (view.to - view.from) * 100)}%`,
                        }}
                      />
                    </>
                  )}
                </div>
              )}
              {/* The segments as stretches, under the overview they belong to:
                  the seams above say WHERE the grid changes, this says what each
                  stretch IS — how long it runs and at what tempo. Only worth a
                  row once the grid actually has more than one; a constant grid
                  would just draw one bar saying what the BPM field already says.
                  Each stretch jumps the view to its own start. */}
              {shown && durationSec > 0 && segments.length > 1 && (
                <div
                  data-testid="grid-segment-bar"
                  className={`relative mt-1 w-full ${tall ? 'h-5' : 'h-4'}`}
                >
                  {segments.map((seg, i) => {
                    const start = Math.max(0, seg.anchorSec)
                    const end = segments[i + 1]?.anchorSec ?? durationSec
                    const width = ((end - start) / durationSec) * 100
                    const active = i === activeSegIndex
                    // The base grid is not a "change" — there is nothing to
                    // remove it back to — so only the stretches past it can go.
                    const removable = i > 0
                    return (
                      <span
                        key={seg.anchorSec}
                        className={`group absolute inset-y-0 ${i === 0 ? 'rounded-l-md' : ''} ${
                          i === segments.length - 1 ? 'rounded-r-md' : ''
                        }`}
                        style={{ left: `${(start / durationSec) * 100}%`, width: `${width}%` }}
                      >
                        <button
                          type="button"
                          data-testid="grid-segment-chip"
                          aria-label={tr('grid.segmentAt', {
                            bpm: Number(seg.bpm.toFixed(2)),
                            time: formatTime(start),
                          })}
                          aria-current={active ? 'true' : undefined}
                          onClick={() => navigate(start / durationSec)}
                          className={`absolute inset-0 overflow-hidden rounded-[inherit] border-r border-[var(--color-panel)] text-[9px] tabular-nums ${
                            active
                              ? 'bg-accent/40 font-medium text-fg ring-1 ring-inset ring-accent'
                              : 'bg-[var(--color-panel-2)] text-fg-dim hover:bg-[var(--color-panel-2)]/70'
                          }`}
                        >
                          {/* Always the tempo, however narrow the stretch. It used
                              to be hidden below a width threshold, on the theory
                              that clipped digits read as a rendering fault — but
                              the tempo IS what the chip is for, and the stretch
                              that lost it was the base one, whose BPM the user had
                              then no way to see at all. Clipped beats absent. */}
                          <span className="px-1">{seg.bpm.toFixed(1)}</span>
                        </button>
                        {/* Removing a stretch is the counterpart of "Adjust from
                            here", and until now it only existed on the keyboard
                            (focus the diamond, press Delete) — which nothing on
                            screen said. It appears on hover rather than living on
                            the bar: a row of permanent ✕ buttons reads as clutter
                            on a control the user mostly just glances at. */}
                        {removable && width > 4 && (
                          <button
                            type="button"
                            data-testid="grid-segment-remove"
                            aria-label={tr('grid.removeSegment', { time: formatTime(start) })}
                            onClick={() => removeChange(i - 1)}
                            className="press absolute top-1/2 right-0.5 hidden -translate-y-1/2 rounded p-0.5 text-fg-dim hover:bg-[var(--color-panel)] hover:text-danger group-hover:block"
                          >
                            <X className="h-2.5 w-2.5" aria-hidden="true" />
                            <Tooltip label={tr('grid.removeSegment', { time: formatTime(start) })} />
                          </button>
                        )}
                      </span>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
