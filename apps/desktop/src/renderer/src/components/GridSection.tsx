import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Redo2,
  SplitSquareHorizontal,
  Square,
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
import { mediaUrl } from '../../../shared/media'
import type { Beatgrid } from '../../../shared/types'
import { useBeatgrid } from '../hooks/useBeatgrid'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { useWaveform } from '../hooks/useWaveform'
import { beatgridNeedsReview, gridLines } from '../lib/beatgrid'
import { drawWaveform } from '../lib/waveform'
import { SectionHeader } from './SectionHeader'
import { AFTER_COLOR, OVERLAY_W, Strip, ZOOM_MAX, zoomLabel } from './WaveformCompare'

// The fine correction: about the detector's own resolution, so one press fixes
// the largest error a correct detection leaves behind.
const NUDGE_SEC = 0.01
// How close (px) a grab must land to a beat line to pick the grid up. Farther
// presses do nothing: a drag on empty wave used to shift the phase, so panning
// or a stray click while zooming moved the grid without the user noticing.
const GRAB_PX = 8
// A press must travel this far before it counts as a drag: trackpad clicks
// wobble a pixel or two, and committing that wobble nudged the grid by a few
// milliseconds on every click.
const DRAG_THRESHOLD_PX = 3
// How much the audition plays from the first visible beat: four bars at house
// tempo — enough to hear whether the clicks ride the transients, short enough
// to stay a check instead of a listen.
const AUDITION_SEC = 8
// Where the working lane opens: rekordbox-style, the overview lane above shows
// the whole track, so the lane grid work happens in starts at working depth —
// ~9 s of a typical track in view, transients and beat lines both readable —
// instead of asking for a zoom-in from ×1 on every single track.
const WORK_ZOOM = 32

interface Props {
  value: Beatgrid | undefined
  open: boolean
  onToggle: () => void
  onChange: (grid: Beatgrid | undefined) => void
  inputPath: string
}

// The per-track beatgrid for the DJ exports: a constant-tempo grid drawn over
// the wave, lined up with the beats by grabbing a beat line (phase), dragging
// the anchor handle (absolute), nudging, or typing the BPM. The detection only
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
  const [view, setView] = useState({ from: 0, to: 1 })
  // The live grid while dragging; committed to the track (onChange) only on
  // release, so a drag doesn't spray staleness/session updates per pixel.
  const [draft, setDraft] = useState<Beatgrid | null>(null)
  const dragging = useRef<
    | { mode: 'anchor'; segIndex: number }
    | {
        mode: 'phase'
        segIndex: number
        fromSec: number
        fromAnchor: number
        fromClientX: number
        armed: boolean
      }
    | null
  >(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  // A BeatgridResult is a Beatgrid plus detection extras; typing shown as the
  // grid keeps the segment math (changes) available on every source.
  const shown: Beatgrid | undefined = draft ?? value ?? detected ?? undefined
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
      if (segments[i].anchorSec <= sec) index = i
      else break
    }
    return index
  }
  // "Where you are" for the segment-scoped controls (BPM, nudges, From here):
  // the centre of the visible window — the overview press centres the window on
  // the spot being worked, so the centre IS the current position.
  const viewCentreSec = ((view.from + view.to) / 2) * durationSec
  const activeSegIndex = shown ? segmentIndexAt(viewCentreSec) : 0
  const activeSeg = segments[activeSegIndex]

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

  // The nearest grid line to an instant — the governing segment's nearest beat,
  // or the next segment's anchor when that line is closer (it is a line too).
  function nearestBeatSec(sec: number): number {
    const index = segmentIndexAt(sec)
    const seg = segments[index]
    const period = 60 / seg.bpm
    let k = Math.round((sec - seg.anchorSec) / period)
    if (index > 0 && k < 0) k = 0
    let best = seg.anchorSec + k * period
    const next = segments[index + 1]
    if (next && (best >= next.anchorSec || Math.abs(next.anchorSec - sec) < Math.abs(best - sec)))
      best = next.anchorSec
    return best
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

  function secondsAt(clientX: number): number {
    const el = overlayRef.current
    if (!el || durationSec === 0) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * durationSec
  }

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
    if (!drag || !shown) return
    if (drag.mode === 'anchor') {
      const sec = secondsAt(clientX)
      setDraft(
        withSegment(shown, drag.segIndex, {
          anchorSec: drag.segIndex === 0 ? sec : clampChange(sec, drag.segIndex),
        }),
      )
      return
    }
    // Arm only past the wobble threshold; then the grabbed beat line follows
    // the finger — and only ITS segment's grid with it, folded back onto the
    // same grid if the base crosses zero, clamped between neighbours for a
    // change: what's behind the segment never moves.
    if (!drag.armed && Math.abs(clientX - drag.fromClientX) < DRAG_THRESHOLD_PX) return
    drag.armed = true
    const raw = drag.fromAnchor + (secondsAt(clientX) - drag.fromSec)
    setDraft(
      withSegment(shown, drag.segIndex, {
        anchorSec:
          drag.segIndex === 0
            ? raw < 0
              ? snapAnchor(raw, shown.bpm)
              : raw
            : clampChange(raw, drag.segIndex),
      }),
    )
  }

  // Distance (px) from a press to the nearest grid line — the pick-up test for
  // the phase drag, segment-aware like the lines themselves.
  function distToBeatPx(clientX: number): number {
    const el = overlayRef.current
    if (!el || !shown || durationSec === 0) return Number.POSITIVE_INFINITY
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return Number.POSITIVE_INFINITY
    const sec = secondsAt(clientX)
    return Math.abs(sec - nearestBeatSec(sec)) * (rect.width / durationSec)
  }

  function release(): void {
    const committed = draft
    dragging.current = null
    if (!committed) return
    setDraft(null)
    commit(committed)
  }

  function nudge(deltaSec: number): void {
    if (!shown || !activeSeg) return
    const moved = activeSeg.anchorSec + deltaSec
    commit(
      withSegment(shown, activeSegIndex, {
        anchorSec: activeSegIndex === 0 ? moved : clampChange(moved, activeSegIndex),
      }),
    )
  }

  // "Make an adjustment from the current position", rekordbox's most-used grid
  // tool: a new segment starts on the beat at the view's centre (same bpm — the
  // usual fix is phase drift), and from here on every edit leaves what's behind
  // pinned.
  function addChangeFromHere(): void {
    if (!shown || durationSec <= 0) return
    const sec = Number(nearestBeatSec(viewCentreSec).toFixed(3))
    if (sec <= shown.anchorSec) return
    if (gridSegments(shown).some((s) => Math.abs(s.anchorSec - sec) < 1e-3)) return
    const bpm = segments[segmentIndexAt(sec)].bpm
    const changes = [...(shown.changes ?? []), { anchorSec: sec, bpm }].sort(
      (a, b) => a.anchorSec - b.anchorSec,
    )
    commit({ ...shown, changes })
  }

  function removeChange(index: number): void {
    if (!shown) return
    const changes = (shown.changes ?? []).filter((_c, i) => i !== index)
    commit({ ...shown, changes })
  }

  // "Auto": drop whatever was staged AND redo the analysis from scratch — the
  // cached detection is deliberately skipped, so a grid computed by an older
  // detector (or one the user distrusts) gets a genuinely fresh verdict rather
  // than the same cached answer back.
  const queryClient = useQueryClient()
  const [reprobing, setReprobing] = useState(false)
  async function autoDetect(): Promise<void> {
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
    commit(withSegment(shown, activeSegIndex, { bpm }))
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
  function audition(): void {
    if (auditing) {
      stopAudition()
      return
    }
    if (!shown || durationSec === 0) return
    // The first grid line at or after the window start — under whichever
    // segment governs there.
    const viewStart = view.from * durationSec
    const seg = segments[segmentIndexAt(viewStart)]
    const period = 60 / seg.bpm
    const k = Math.ceil((viewStart - seg.anchorSec) / period - 1e-6)
    const from = Math.max(0, seg.anchorSec + k * period)
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
    </button>
  )

  return (
    <div data-testid="editor-grid" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
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
              <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
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
                        data-testid="grid-bpm-half"
                        aria-label={tr('grid.half')}
                        disabled={
                          !normalizeBeatgrid(
                            withSegment(shown, activeSegIndex, { bpm: activeSeg.bpm / 2 }),
                          )
                        }
                        onClick={() =>
                          commit(withSegment(shown, activeSegIndex, { bpm: activeSeg.bpm / 2 }))
                        }
                        className="press rounded px-1 text-[10px] tabular-nums text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
                      >
                        ÷2
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
                        onClick={() =>
                          commit(withSegment(shown, activeSegIndex, { bpm: activeSeg.bpm * 2 }))
                        }
                        className="press rounded px-1 text-[10px] tabular-nums text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
                      >
                        ×2
                      </button>
                    </span>
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
                    <span data-testid="grid-anchor" className="min-w-0 truncate text-[10px] tabular-nums text-fg-dim">
                      {tr('grid.anchorAt', { seconds: shown.anchorSec.toFixed(2) })}
                    </span>
                    {/* Bordered like the trim section's detect button: the bare
                        text form read as a caption, not something to press. */}
                    <button
                      type="button"
                      data-testid="grid-audition"
                      onClick={audition}
                      className="press inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-line-strong)] px-2 py-1 text-[10px] text-fg-muted transition-colors hover:text-fg"
                    >
                      {auditing ? (
                        // Filled: the hollow square read as a broken checkbox,
                        // not a stop control.
                        <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                      ) : (
                        <Volume2 className="h-3 w-3" aria-hidden="true" />
                      )}
                      {tr('grid.audition')}
                    </button>
                    {/* rekordbox's "make an adjustment from the current
                        position": a new segment on the beat at the view's
                        centre — from here forward, edits leave what's behind
                        pinned. */}
                    <button
                      type="button"
                      data-testid="grid-from-here"
                      onClick={addChangeFromHere}
                      className="press inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-line-strong)] px-2 py-1 text-[10px] text-fg-muted transition-colors hover:text-fg"
                    >
                      <SplitSquareHorizontal className="h-3 w-3" aria-hidden="true" />
                      {tr('grid.fromHere')}
                    </button>
                  </>
                )}
                {(value || shown) && (
                  <button
                    type="button"
                    data-testid="grid-reset"
                    aria-label={tr('grid.resetHint')}
                    disabled={reprobing}
                    onClick={autoDetect}
                    className="press inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-line-strong)] px-2 py-1 text-[10px] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
                  >
                    <Wand2 className={`h-3 w-3 ${reprobing ? 'animate-pulse' : ''}`} aria-hidden="true" />
                    {tr('grid.reset')}
                  </button>
                )}
                {(value || shown) && (
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
                )}
                <span className="ml-auto flex shrink-0 items-center gap-0.5">
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
              </div>
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
                    onPointerDown={(e) => {
                      // Only a press ON a beat line picks the grid up — empty
                      // wave stays inert, so a stray click or a pan gesture
                      // while zooming can't shift the phase by accident. The
                      // grabbed line's SEGMENT is what the drag moves.
                      if (distToBeatPx(e.clientX) > GRAB_PX) return
                      const sec = secondsAt(e.clientX)
                      const segIndex = segmentIndexAt(nearestBeatSec(sec))
                      dragging.current = {
                        mode: 'phase',
                        segIndex,
                        fromSec: sec,
                        fromAnchor: segments[segIndex].anchorSec,
                        fromClientX: e.clientX,
                        armed: false,
                      }
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
                      className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-1 focus-visible:outline-accent"
                      style={{ left: `${pct(shown.anchorSec)}%` }}
                      onKeyDown={(e) => {
                        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                        e.preventDefault()
                        const step = e.shiftKey ? 0.1 : NUDGE_SEC
                        nudge(e.key === 'ArrowLeft' ? -step : step)
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        dragging.current = { mode: 'anchor', segIndex: 0 }
                        e.currentTarget.setPointerCapture?.(e.pointerId)
                      }}
                      onPointerMove={(e) => {
                        e.stopPropagation()
                        dragTo(e.clientX)
                      }}
                      onPointerUp={release}
                      onPointerCancel={release}
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
                        apart from the base anchor's square: drag moves that
                        segment alone (clamped between its neighbours), arrows
                        nudge it, Delete removes the segment. */}
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
                        className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-1 focus-visible:outline-accent"
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
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          dragging.current = { mode: 'anchor', segIndex: i + 1 }
                          e.currentTarget.setPointerCapture?.(e.pointerId)
                        }}
                        onPointerMove={(e) => {
                          e.stopPropagation()
                          dragTo(e.clientX)
                        }}
                        onPointerUp={release}
                        onPointerCancel={release}
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
                  className="relative mt-1.5 h-6 cursor-pointer touch-none overflow-hidden rounded-md focus-visible:outline-1 focus-visible:outline-accent"
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
                    height={36}
                    className="block h-6 w-full rounded-md bg-[var(--color-field)]"
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
