import {
  Anchor,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Crosshair,
  FoldHorizontal,
  Redo2,
  SplitSquareHorizontal,
  Square,
  UnfoldHorizontal,
  Undo2,
  Volume2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { gridSegments, normalizeBeatgrid, snapAnchor } from '../../../shared/beatgrid'
import { claimKeys } from '../lib/spaceClaim'
import { mediaUrl } from '../../../shared/media'
import type { Beatgrid } from '../../../shared/types'
import { useBeatgrid } from '../hooks/useBeatgrid'
import { useMaximizedSection } from '../hooks/useEditorSections'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { useWaveform } from '../hooks/useWaveform'
import { beatgridNeedsReview, gridLines } from '../lib/beatgrid'
import { drawWaveform } from '../lib/waveform'
import { SectionHeader } from './SectionHeader'
import { Tooltip } from './Tooltip'
import { AFTER_COLOR, OVERLAY_W, Strip, ZOOM_MAX, zoomLabel } from './WaveformCompare'

// The fine correction: about the detector's own resolution, so one press fixes
// the largest error a correct detection leaves behind.
const NUDGE_SEC = 0.01
// How much the audition plays from the first visible beat: four bars at house
// tempo — enough to hear whether the clicks ride the transients, short enough
// to stay a check instead of a listen.
const AUDITION_SEC = 8
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

interface Props {
  value: Beatgrid | undefined
  open: boolean
  onToggle: () => void
  onChange: (grid: Beatgrid | undefined) => void
  inputPath: string
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
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The waveform decodes the full file and the detection its opening minutes,
  // so both wait for the selection to rest and the section to actually be open.
  const settled = useSettled(SELECTION_SETTLE_MS)
  const { data: wave, isFetching } = useWaveform(inputPath, open && settled)
  const { data: detected } = useBeatgrid(inputPath, open && settled)
  const loading = isFetching && !wave
  const durationSec = wave?.durationSec ?? 0
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
  useEffect(() => {
    const canvas = overviewCanvasRef.current
    if (!canvas || !wave) return
    drawWaveform(canvas, wave.peaks, { color: AFTER_COLOR })
  }, [wave])

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
  function commit(next: Beatgrid): void {
    const anchorSec = Number(
      (next.anchorSec < 0 ? snapAnchor(next.anchorSec, next.bpm) : next.anchorSec).toFixed(3),
    )
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
      queryClient.setQueryData(['beatgrid', inputPath], fresh)
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
  const [playheadSec, setPlayheadSec] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef(0)
  function stopAudition(): void {
    audioRef.current?.pause()
    audioRef.current = null
    cancelAnimationFrame(rafRef.current)
    setAuditing(false)
    setPlayheadSec(null)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is deliberately the trigger — a moved grid invalidates what the playhead is checking, so the cleanup must fire on it.
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
      cancelAnimationFrame(rafRef.current)
      setAuditing(false)
      setPlayheadSec(null)
    }
  }, [value])
  // Space plays/pauses this check while the section is open — and the claim
  // keeps the same press from ALSO starting the mini-player (see spaceClaim).
  // The handler is re-registered whenever what it closes over changes, so the
  // key always drives the live grid and position.
  const auditionRef = useRef<() => void>(() => {})
  const centreRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!open) return
    return claimKeys({
      play: () => auditionRef.current(),
      'centre-beat': () => centreRef.current(),
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
    const from = Math.max(0, Math.min(durationSec, viewCentreSec))
    const until = Math.min(durationSec, from + AUDITION_SEC)
    const audio = new Audio(mediaUrl(inputPath))
    audioRef.current = audio
    // Seek only once the element knows its duration — an immediate currentTime
    // on a still-loading element is dropped by the media pipeline.
    audio.onloadedmetadata = () => {
      audio.currentTime = from
      audio.play().catch(() => stopAudition())
    }
    audio.ontimeupdate = () => {
      if (audio.currentTime >= until) stopAudition()
    }
    audio.onended = () => stopAudition()
    const tick = (): void => {
      if (!audioRef.current) return
      const t = audioRef.current.currentTime
      setPlayheadSec(t)
      // Follow like a player: the wave scrolls along under the advancing
      // playhead instead of playing on past the window's right edge.
      if (durationSec > 0) centerOn(t / durationSec)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    setAuditing(true)
  }
  // The claim above fires through this ref, so Space always drives the live
  // closure (current grid, current centre) without re-registering per render.
  auditionRef.current = audition
  centreRef.current = centreNearestBeat

  const iconButton = (
    testid: string,
    label: string,
    onClick: () => void,
    icon: React.ReactNode,
    disabled = false,
  ): React.JSX.Element => (
    <button
      type="button"
      data-testid={testid}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="press flex h-5 w-5 items-center justify-center rounded text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
    >
      {icon}
      <Tooltip label={label} />
    </button>
  )

  // The bordered variant for the toolbar's verbs: icon-only, the name in the
  // tooltip (and aria) — full words made the row wrap to two lines in the
  // editor column.
  const toolButton = (
    testid: string,
    label: string,
    onClick: () => void,
    icon: React.ReactNode,
    disabled = false,
  ): React.JSX.Element => (
    <button
      type="button"
      data-testid={testid}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="press flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--color-line-strong)] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
    >
      {icon}
      <Tooltip label={label} />
    </button>
  )

  // Hairline between the toolbar's groups, so tempo / shift / line actions /
  // listen / history read as clusters instead of one long strip of glyphs.
  const divider = (
    <span aria-hidden="true" className="h-4 w-px shrink-0 bg-[var(--color-line)]" />
  )

  return (
    <div data-testid="editor-grid" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        sectionId="grid"
        title={tr('grid.title')}
        open={open}
        onToggle={onToggle}
        summary={value || detected ? undefined : tr('grid.summaryNone')}
        summaryTestId="grid-summary"
        right={
          value ? (
            !open ? (
              <span
                data-testid="grid-active-badge"
                className="rounded-full bg-[var(--color-accent)]/15 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]"
              >
                {`${value.bpm.toFixed(2)} BPM`}
              </span>
            ) : undefined
          ) : detected ? (
            // A coin-flip detection wears the warn tint: the same fact the
            // list's "grid to review" filter reads, visible in context here.
            <span
              data-testid={beatgridNeedsReview(detected) ? 'grid-review-pill' : 'grid-detected-pill'}
              className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
                beatgridNeedsReview(detected)
                  ? 'bg-[var(--color-warn)]/15 text-[var(--color-warn)]'
                  : 'bg-[var(--color-panel-2)] text-fg-muted'
              }`}
            >
              {beatgridNeedsReview(detected)
                ? tr('grid.review')
                : tr('grid.detected', { bpm: detected.bpm.toFixed(1) })}
            </span>
          ) : undefined
        }
      />
      {open && (
        <div className="mt-3">
          <p className="mb-3 text-xs text-fg-dim">{tr('grid.hint')}</p>
          {detected === null && !shown && (
            <p data-testid="grid-nothing" className="mb-3 text-[10px] text-fg-dim">
              {tr('grid.nothing')}
            </p>
          )}
          {(loading || wave) && (
            <>
              <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                {/* The toolbar reads as rekordbox's GRID EDIT: icon-only verbs in
                    small groups split by hairlines — tempo, shift, the line's
                    actions, listen, history. Labels live in the tooltips (and
                    aria), so the row stays one calm line instead of a sentence. */}
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
                    className="w-16 rounded border border-[var(--color-line-strong)] bg-transparent px-1.5 py-0.5 text-[11px] tabular-nums text-fg outline-none focus:border-accent"
                  />
                </label>
                {shown && activeSeg && (
                  <>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        data-testid="grid-tap"
                        aria-label={tr('grid.tapHint')}
                        onClick={tapTempo}
                        className="press shrink-0 rounded border border-[var(--color-line-strong)] px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-fg-dim transition-colors hover:text-fg"
                      >
                        TAP
                        <Tooltip label={tr('grid.tapHint')} />
                      </button>
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
                        className="press rounded px-1 text-[10px] tabular-nums text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
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
                        className="press rounded px-1 text-[10px] tabular-nums text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
                      >
                        ×2
                        <Tooltip label={tr('grid.double')} />
                      </button>
                      {iconButton(
                        'grid-expand',
                        tr('grid.expand'),
                        () => stepBpm(-0.01),
                        <UnfoldHorizontal className="h-3 w-3" aria-hidden="true" />,
                      )}
                      {iconButton(
                        'grid-shrink',
                        tr('grid.shrink'),
                        () => stepBpm(0.01),
                        <FoldHorizontal className="h-3 w-3" aria-hidden="true" />,
                      )}
                    </span>
                    {divider}
                    <span className="flex shrink-0 items-center gap-0.5">
                      {iconButton(
                        'grid-undo',
                        tr('grid.undo'),
                        undo,
                        <Undo2 className="h-3 w-3" aria-hidden="true" />,
                        history.undo === 0,
                      )}
                      {iconButton(
                        'grid-redo',
                        tr('grid.redo'),
                        redo,
                        <Redo2 className="h-3 w-3" aria-hidden="true" />,
                        history.redo === 0,
                      )}
                    </span>
                  </>
                )}
                <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
                  {shown && (
                    <span
                      data-testid="grid-anchor"
                      className="min-w-0 truncate text-[10px] tabular-nums text-fg-dim"
                    >
                      {`${shown.anchorSec.toFixed(2)} s`}
                      <Tooltip label={tr('grid.anchorAt', { seconds: shown.anchorSec.toFixed(2) })} />
                    </span>
                  )}
                  <span className="flex shrink-0 items-center gap-0.5">
                    {iconButton(
                      'waveform-zoom-out',
                      tr('editor.waveformZoomOut'),
                      () => setZoom((z) => Math.max(1, z / 2)),
                      <ZoomOut className="h-3 w-3" aria-hidden="true" />,
                      zoom <= 1,
                    )}
                    <button
                      type="button"
                      data-testid="waveform-zoom-reset"
                      aria-label={tr('editor.waveformZoomReset')}
                      disabled={zoom <= 1}
                      onClick={() => setZoom(1)}
                      className="press min-w-6 rounded px-1 text-center text-[10px] tabular-nums text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
                    >
                      {zoomLabel(zoom)}
                    </button>
                    {iconButton(
                      'waveform-zoom-in',
                      tr('editor.waveformZoomIn'),
                      () => setZoom((z) => Math.min(ZOOM_MAX, z * 2)),
                      <ZoomIn className="h-3 w-3" aria-hidden="true" />,
                      zoom >= ZOOM_MAX,
                    )}
                  </span>
                </span>
              </div>
              {/* relative wrapper: the centre reference below must pin to the
                  VIEWPORT's middle while the lane scrolls under it, so it lives
                  outside the Strip's scrolled content. */}
              <div className="relative">
              <Strip
                wave={wave}
                loading={loading}
                loudness={undefined}
                color={AFTER_COLOR}
                raster={OVERLAY_W}
                zoom={zoom}
                onZoomChange={setZoom}
                inputPath={inputPath}
                onViewChange={setView}
                scrollerRef={scrollerRef}
                tall={tall}
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
                    onPointerMove={(e) => dragTo(e.clientX)}
                    onPointerUp={release}
                    onPointerCancel={release}
                  >
                    {/* Amber, not the wave's accent blue: the lines sit ON the
                        wave, and same-hue lines disappeared into a busy mix.
                        Full opacity plus a faint halo — a bare 1px line at half
                        opacity still sank between the peaks of a busy wave. */}
                    {lines.map((line) => (
                      <span
                        key={line.sec}
                        data-testid={line.downbeat ? 'grid-line-downbeat' : 'grid-line'}
                        aria-hidden="true"
                        className={`pointer-events-none absolute -translate-x-1/2 ${
                          line.downbeat
                            ? 'inset-y-0 w-0.5 bg-[var(--color-warn)] shadow-[0_0_3px_var(--color-warn)]'
                            : 'inset-y-1.5 w-px bg-[var(--color-warn)]/80 shadow-[0_0_2px_rgba(0,0,0,0.6)]'
                        }`}
                        style={{ left: `${line.pct}%` }}
                      />
                    ))}
                    {playheadSec !== null && (
                      <span
                        data-testid="grid-playhead"
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 w-px bg-fg"
                        style={{ left: `${pct(playheadSec)}%` }}
                      />
                    )}
                    <div
                      data-testid="grid-anchor-handle"
                      role="slider"
                      aria-label={tr('grid.handleAnchor')}
                      aria-valuemin={0}
                      aria-valuemax={Number(durationSec.toFixed(2))}
                      aria-valuenow={Number(shown.anchorSec.toFixed(2))}
                      tabIndex={0}
                      className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-pointer touch-none focus-visible:outline-1 focus-visible:outline-accent"
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
                        className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-warn)]"
                      />
                      <span
                        aria-hidden="true"
                        className="absolute top-1/2 left-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-[var(--color-warn)]"
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
                        className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-pointer touch-none focus-visible:outline-1 focus-visible:outline-accent"
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
                          className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-warn)]"
                        />
                        <span
                          aria-hidden="true"
                          className="absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-[var(--color-warn)]"
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
                <>
                  <span
                    data-testid="grid-center-line"
                    data-snapped={centreSnapped || undefined}
                    aria-hidden="true"
                    // A crosshair, not a marker: it stays nailed to the middle of
                    // the viewport while the wave slides under it (rekordbox's
                    // reference). It must never move or grow mid-pan — chasing
                    // the magnetised beat made it smear into a fat streak while
                    // dragging. The magnet lives in the POSITION the controls
                    // act on, not in the line; the glow only says "caught".
                    className={`pointer-events-none absolute inset-y-0 left-1/2 z-20 w-0.5 -translate-x-1/2 bg-[var(--color-danger)] ${
                      centreSnapped && !panning ? 'shadow-[0_0_5px_var(--color-danger)]' : 'opacity-70'
                    }`}
                  />
                  {activeSeg && (
                    <span
                      data-testid="grid-center-bars"
                      className="pointer-events-none absolute top-1 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded border border-[var(--color-line)] bg-[var(--color-panel-2)]/90 px-1.5 py-0.5 text-[9px] leading-none tabular-nums text-fg-dim"
                    >
                      {tr('grid.centerBars', {
                        bars: `${viewCentreSec >= activeSeg.anchorSec ? '+' : '−'}${Math.abs(
                          (viewCentreSec - activeSeg.anchorSec) / ((240 / activeSeg.bpm) || 1),
                        ).toFixed(1)}`,
                      })}
                    </span>
                  )}
                </>
              )}
              </div>
              {/* The grid verbs live WITH the line: work happens at the centre
                  (pan, look, nudge), so the buttons sit right under the red
                  reference instead of up in a corner — hands stay where the
                  eyes are. The top row keeps only what isn't about the line
                  (tempo numbers, history, zoom). */}
              {wave && durationSec > 0 && shown && activeSeg && (
                <div className="mt-1.5 flex items-center justify-center gap-2">
                  <span className="flex shrink-0 items-center gap-0.5">
                    {iconButton(
                      'grid-beat-back',
                      tr('grid.beatBack'),
                      () => nudge(-60 / activeSeg.bpm),
                      <ChevronsLeft className="h-3 w-3" aria-hidden="true" />,
                    )}
                    {iconButton(
                      'grid-nudge-earlier',
                      tr('grid.nudgeEarlier'),
                      () => nudge(-NUDGE_SEC),
                      <ChevronLeft className="h-3 w-3" aria-hidden="true" />,
                    )}
                    {iconButton(
                      'grid-nudge-later',
                      tr('grid.nudgeLater'),
                      () => nudge(NUDGE_SEC),
                      <ChevronRight className="h-3 w-3" aria-hidden="true" />,
                    )}
                    {iconButton(
                      'grid-beat-forward',
                      tr('grid.beatForward'),
                      () => nudge(60 / activeSeg.bpm),
                      <ChevronsRight className="h-3 w-3" aria-hidden="true" />,
                    )}
                  </span>
                  {divider}
                  {/* The line's verbs: a beat here, a beat centred, a new
                      segment from here, or Auto's fresh listen (whole track on
                      the base, this stretch only on a change segment). */}
                  <span className="flex shrink-0 items-center gap-0.5">
                    {toolButton(
                      'grid-beat-here',
                      tr('grid.beatHere'),
                      beatHere,
                      <Anchor className="h-3 w-3" aria-hidden="true" />,
                    )}
                    {toolButton(
                      'grid-centre-beat',
                      tr('grid.centreBeat'),
                      centreNearestBeat,
                      <Crosshair className="h-3 w-3" aria-hidden="true" />,
                    )}
                    {toolButton(
                      'grid-from-here',
                      tr('grid.fromHere'),
                      addChangeFromHere,
                      <SplitSquareHorizontal className="h-3 w-3" aria-hidden="true" />,
                    )}
                    {toolButton(
                      'grid-reset',
                      tr('grid.resetHint'),
                      autoDetect,
                      <Wand2
                        className={`h-3 w-3 ${reprobing ? 'animate-pulse' : ''}`}
                        aria-hidden="true"
                      />,
                      reprobing,
                    )}
                  </span>
                  {divider}
                  {toolButton(
                    'grid-audition',
                    tr('grid.audition'),
                    audition,
                    auditing ? (
                      <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                    ) : (
                      <Volume2 className="h-3 w-3" aria-hidden="true" />
                    ),
                  )}
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
                  onPointerMove={(e) => {
                    if (scrubbing.current) navigate(overviewRatio(e.clientX))
                  }}
                  onPointerUp={() => {
                    scrubbing.current = false
                  }}
                  onPointerCancel={() => {
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
                    ref={overviewCanvasRef}
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
                  {playheadSec !== null && (
                    <span
                      data-testid="grid-overview-playhead"
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 w-px bg-fg"
                      style={{ left: `${pct(playheadSec)}%` }}
                    />
                  )}
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
            </>
          )}
        </div>
      )}
    </div>
  )
}
