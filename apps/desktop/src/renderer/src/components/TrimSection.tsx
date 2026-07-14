import { ChevronLeft, ChevronRight, Scissors, Square, Volume2, ZoomIn, ZoomOut } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mediaUrl } from '../../../shared/media'
import type { TrimRange, WaveformResult } from '../../../shared/types'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { useWaveform } from '../hooks/useWaveform'
import { useWaveformWindow } from '../hooks/useWaveformWindow'
import { drawWaveform } from '../lib/waveform'
import { detectOnsets, detectTrim, refineOnset } from '../lib/trim'
import { SectionHeader } from './SectionHeader'
import { WaveformSkeleton } from './WaveformSkeleton'
import { AFTER_COLOR } from './WaveformCompare'

// A handle can never cross to within a second of the other: a trim that eats the
// whole track is always a mistake, and the floor keeps the handles grabbable.
const MIN_KEEP_SEC = 1
// Dragging a handle back to within this of its own edge means "cut nothing here":
// the bound drops instead of persisting a hair's-width trim.
const EDGE_SNAP_SEC = 0.05
// How much of the track each cut audition plays: enough to judge the boundary by
// ear, short enough to stay a check instead of a listen.
const AUDITION_SEC = 4
// This section only ever asks one question — where does the music start, and where
// does it end — so it shows exactly those two places and nothing in between. Each
// lane is a window onto one edge of the track, and the control that used to be
// "zoom" is now how much of the track flanks the cut. A ten-minute track's silent
// head is a sliver at ×1: this is what made every user zoom and scrub their way to
// a spot the detector already knew.
// Down to a quarter-second because the cut itself needs judging, not just finding:
// at ±0.25 s the lane's 1200 px span half a second, so a pixel is under a
// millisecond and the exact edge of the music is something you can SEE.
const CONTEXT_SEC = [0.25, 0.5, 1, 2, 5, 15, 45] as const
const DEFAULT_CONTEXT_INDEX = 4
// The fine steps, on buttons rather than buried in arrow keys: a frame-ish nudge
// and a tenth. Same figures the arrows use (Shift takes the coarse one).
const FINE_STEP_SEC = 0.01
const COARSE_STEP_SEC = 0.1
// The lane's own raster: one window's worth of pixels, no scrolling.
const LANE_RASTER = 1200
const LANE_H = 96

interface Props {
  value: TrimRange | undefined
  open: boolean
  onToggle: () => void
  onChange: (trim: TrimRange | undefined) => void
  inputPath: string
}

function cutSeconds(seconds: number): string {
  return `${seconds.toFixed(1)} s`
}

type Side = 'start' | 'end'

// One edge of the track, drawn as its own little strip: the window runs from
// `fromSec` to `toSec` of the source, so a second of audio is the same width in
// both lanes and the eye can compare them. Everything positional inside a lane is
// in lane-relative percent — the whole-track percentages the single strip used
// have no meaning here.
function Lane({
  side,
  wave,
  fromSec,
  toSec,
  durationSec,
  inputPath,
  enabled,
  cutSec,
  suggestionSec,
  snapped,
  onPointerDown,
  onPointerMove,
  onRelease,
  onKeyStep,
  onApplySuggestion,
  onContextChange,
  contextIndex,
  contextSec,
  contextCount,
  fineStepSec,
  overlayRef,
  tr,
}: {
  side: Side
  wave: WaveformResult | null | undefined
  fromSec: number
  toSec: number
  durationSec: number
  inputPath: string
  enabled: boolean
  cutSec: number | undefined
  suggestionSec: number | undefined
  snapped: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onRelease: () => void
  onKeyStep: (deltaSec: number) => void
  onApplySuggestion: (sec: number) => void
  onContextChange: (index: number) => void
  contextIndex: number
  contextSec: number
  contextCount: number
  fineStepSec: number
  overlayRef: React.RefObject<HTMLDivElement | null>
  tr: (key: string, opts?: Record<string, unknown>) => string
}): React.JSX.Element {
  const spanSec = Math.max(0.001, toSec - fromSec)
  // The lane re-decodes its own window at full fidelity — the same machinery the
  // deep zoom uses. Quantized to the tenth so a context change is one decode, not
  // one per render.
  const { data: win } = useWaveformWindow(
    inputPath,
    Number(fromSec.toFixed(1)),
    Number(spanSec.toFixed(1)),
    enabled,
  )
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // While the window decodes, the overview's peaks stand in for the same stretch
    // — coarse, but the lane is never blank and never lies about WHERE it is.
    if (win) {
      drawWaveform(canvas, win.peaks, { color: AFTER_COLOR })
      return
    }
    if (!wave || durationSec <= 0) return
    drawWaveform(canvas, wave.peaks, {
      color: AFTER_COLOR,
      window: { from: fromSec / durationSec, to: toSec / durationSec },
    })
  }, [win, wave, fromSec, toSec, durationSec])

  // Lane-relative: 0% is fromSec, 100% is toSec.
  const pct = (sec: number): number => ((sec - fromSec) / spanSec) * 100
  const cut = cutSec ?? (side === 'start' ? 0 : durationSec)
  // The dropped audio, shaded: for the head lane everything BEFORE the cut, for the
  // tail lane everything after — the kept audio stays lit.
  const shadeWidth =
    side === 'start' ? Math.max(0, Math.min(100, pct(cut))) : Math.max(0, Math.min(100, 100 - pct(cut)))

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-fg-dim">
          {tr(side === 'start' ? 'trim.laneStart' : 'trim.laneEnd')}
        </span>
        {/* The cut's own time, to the millisecond, with a step either side of it:
            reading the position off the wave is guesswork below a tenth, and the
            arrow keys that used to be the only fine control were invisible. */}
        <span className="flex min-w-0 items-center gap-0.5">
          <button
            type="button"
            data-testid={`trim-nudge-back-${side}`}
            aria-label={tr('trim.nudgeBack')}
            onClick={() => onKeyStep(-fineStepSec)}
            className="press flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-dim hover:text-fg"
          >
            <ChevronLeft className="h-3 w-3" aria-hidden="true" />
          </button>
          <span
            data-testid={`trim-cut-time-${side}`}
            className="min-w-0 truncate text-[10px] tabular-nums text-fg-muted"
          >
            {`${cut.toFixed(3)} s`}
          </span>
          <button
            type="button"
            data-testid={`trim-nudge-forward-${side}`}
            aria-label={tr('trim.nudgeForward')}
            onClick={() => onKeyStep(fineStepSec)}
            className="press flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-dim hover:text-fg"
          >
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
        {/* Each lane zooms on its own: the head can be dense music while the tail
            is flat silence, and one shared control forced a compromise that fit
            neither. */}
        <span className="flex shrink-0 items-center gap-0.5">
          <span
            data-testid={`trim-lane-range-${side}`}
            className="text-[10px] tabular-nums text-fg-dim"
          >
            {spanSec < 2 ? `${fromSec.toFixed(2)}–${toSec.toFixed(2)} s` : `${fromSec.toFixed(1)}–${toSec.toFixed(1)} s`}
          </span>
          <button
            type="button"
            data-testid={`trim-zoom-in-${side}`}
            aria-label={tr('trim.contextNarrow')}
            disabled={contextIndex <= 0}
            onClick={() => onContextChange(contextIndex - 1)}
            className="press flex h-4 w-4 items-center justify-center rounded text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
          >
            <ZoomIn className="h-3 w-3" aria-hidden="true" />
          </button>
          <span
            data-testid={`trim-context-${side}`}
            className="min-w-9 text-center text-[10px] tabular-nums text-fg-dim"
          >
            {`±${contextSec < 1 ? contextSec : contextSec.toFixed(0)}s`}
          </span>
          <button
            type="button"
            data-testid={`trim-zoom-out-${side}`}
            aria-label={tr('trim.contextWiden')}
            disabled={contextIndex >= contextCount - 1}
            onClick={() => onContextChange(contextIndex + 1)}
            className="press flex h-4 w-4 items-center justify-center rounded text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
          >
            <ZoomOut className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          data-testid={`trim-lane-${side}`}
          width={LANE_RASTER}
          height={LANE_H}
          className="block h-24 w-full rounded-lg bg-[var(--color-field)]"
        />
        <div
          ref={overlayRef}
          data-testid={`trim-overlay-${side}`}
          className="absolute inset-0 touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onRelease}
          onPointerCancel={onRelease}
        >
          {cutSec !== undefined && shadeWidth > 0 && (
            <div
              data-testid={`trim-shade-${side}`}
              aria-hidden="true"
              className={`pointer-events-none absolute inset-y-0 bg-[var(--color-panel)]/70 ${
                side === 'start' ? 'left-0 rounded-l-lg' : 'right-0 rounded-r-lg'
              }`}
              style={{ width: `${shadeWidth}%` }}
            />
          )}
          {/* The cut itself: a handle to drag, arrow keys to refine. The magnet's
              glow stands in for the trackpad click an Electron app cannot fire. */}
          <div
            data-testid={`trim-handle-${side}`}
            role="slider"
            aria-label={tr(side === 'start' ? 'trim.handleStart' : 'trim.handleEnd')}
            aria-valuemin={0}
            aria-valuemax={Number(durationSec.toFixed(2))}
            aria-valuenow={Number(cut.toFixed(2))}
            tabIndex={0}
            className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-1 focus-visible:outline-accent"
            style={{ left: `${Math.max(0, Math.min(100, pct(cut)))}%` }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              // Shift is the coarse step; bare arrows do the fine one, matching the
              // buttons either side of the readout.
              const step = e.shiftKey ? COARSE_STEP_SEC : fineStepSec
              onKeyStep(e.key === 'ArrowLeft' ? -step : step)
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture?.(e.pointerId)
              onPointerDown(e)
            }}
            onPointerMove={(e) => {
              e.stopPropagation()
              onPointerMove(e)
            }}
            onPointerUp={onRelease}
            onPointerCancel={onRelease}
          >
            <span
              aria-hidden="true"
              data-testid={snapped ? `trim-snapped-${side}` : undefined}
              className={`absolute inset-y-0 left-1/2 w-px bg-accent ${
                snapped ? 'shadow-[0_0_8px_2px_var(--color-accent)]' : ''
              }`}
            />
            <span
              aria-hidden="true"
              className={`absolute top-1/2 left-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-accent ${
                snapped ? 'scale-150 shadow-[0_0_8px_var(--color-accent)]' : ''
              }`}
            />
          </div>
          {/* The suggestion, where it would land: one click stages this side alone.
              The button is clamped inside the lane so a cut hugging the very edge
              never renders half-clipped. */}
          {cutSec === undefined && suggestionSec !== undefined && (
            <div className="pointer-events-none absolute inset-0">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 w-0 border-l border-dashed border-[var(--color-line-strong)]"
                style={{ left: `${Math.max(0, Math.min(100, pct(suggestionSec)))}%` }}
              />
              <button
                type="button"
                data-testid={`trim-apply-${side}`}
                aria-label={tr(side === 'start' ? 'trim.applyStart' : 'trim.applyEnd', {
                  seconds: cutSeconds(
                    side === 'start' ? suggestionSec : durationSec - suggestionSec,
                  ),
                })}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onApplySuggestion(suggestionSec)}
                className="press pointer-events-auto absolute top-1 z-20 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] text-fg-muted hover:text-fg"
                style={{
                  left: `clamp(12px, ${Math.max(0, Math.min(100, pct(suggestionSec)))}%, calc(100% - 12px))`,
                }}
              >
                <Scissors className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// The per-track silence trim ("top and tail"). Two lanes — the head of the track
// and its tail — because those are the only two places a trim ever happens; the
// minutes in between are not this section's business. The detection only suggests:
// the cut is whatever seconds the user confirmed, which is what the track stores
// and the conversion applies verbatim.
export function TrimSection({ value, open, onToggle, onChange, inputPath }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The waveform decodes the full file, so it waits for the selection to rest and
  // for the section to actually be open — same gating as the loudness strip.
  const settled = useSettled(SELECTION_SETTLE_MS)
  const { data: wave, isFetching } = useWaveform(inputPath, open && settled)
  const loading = isFetching && !wave
  const durationSec = wave?.durationSec ?? 0
  const suggestion = useMemo(() => (wave ? detectTrim(wave) : undefined), [wave])
  // The unpadded truth the drag magnet aims at: where the music actually starts/ends.
  const onsets = useMemo(() => (wave ? detectOnsets(wave) : undefined), [wave])
  // The coarse onsets come from the 8192-bucket overview — up to a bucket (tens of
  // milliseconds) off the audible wave, a gap the eye catches at this depth ("the
  // snapped line doesn't touch the music"). A one-second finely-bucketed window
  // around each onset (cached like the lanes' own) narrows the magnet's target to
  // the millisecond; while it loads, the coarse value stands.
  const startWinStart = Math.max(0, (onsets?.startSec ?? 0) - 0.5)
  const { data: startWin } = useWaveformWindow(
    inputPath,
    Number(startWinStart.toFixed(3)),
    1,
    open && settled && onsets?.startSec !== undefined,
  )
  const endWinStart = Math.max(0, (onsets?.endSec ?? 0) - 0.5)
  const { data: endWin } = useWaveformWindow(
    inputPath,
    Number(endWinStart.toFixed(3)),
    1,
    open && settled && onsets?.endSec !== undefined,
  )
  const snapTargets = useMemo(
    () => ({
      startSec: startWin
        ? (refineOnset(startWin.peaks, startWin.startSec, startWin.durSec, 'start') ??
          onsets?.startSec)
        : onsets?.startSec,
      endSec: endWin
        ? (refineOnset(endWin.peaks, endWin.startSec, endWin.durSec, 'end') ?? onsets?.endSec)
        : onsets?.endSec,
    }),
    [onsets, startWin, endWin],
  )
  // How much track flanks each cut. Replaces the old zoom: there is no scrolling
  // here, so the only question left is how wide a window each lane shows.
  const [contextIndex, setContextIndex] = useState<Record<Side, number>>({
    start: DEFAULT_CONTEXT_INDEX,
    end: DEFAULT_CONTEXT_INDEX,
  })
  const startContextSec = CONTEXT_SEC[contextIndex.start]
  const endContextSec = CONTEXT_SEC[contextIndex.end]
  function setContext(which: Side, next: number): void {
    setContextIndex((c) => ({
      ...c,
      [which]: Math.min(CONTEXT_SEC.length - 1, Math.max(0, next)),
    }))
  }
  // The live range while a handle is dragged; committed to the track (onChange)
  // only on release, so a drag doesn't spray staleness/session updates per pixel.
  const [draft, setDraft] = useState<TrimRange | null>(null)
  const dragging = useRef<Side | null>(null)
  const startOverlayRef = useRef<HTMLDivElement>(null)
  const endOverlayRef = useRef<HTMLDivElement>(null)
  const shown = draft ?? value
  const startSec = shown?.startSec ?? 0
  const endSec = shown?.endSec ?? durationSec
  const cutStart = startSec > 0
  const cutEnd = durationSec > 0 && endSec < durationSec

  // The lane's window is FRAMED, not tracked. It is placed once — around the cut the
  // section opens on (confirmed, else suggested, else the track's edge) — and then
  // holds still while the handle moves inside it. Deriving it from the cut re-framed
  // the lane on every commit, and re-framing means re-decoding: the wave jumped and
  // stalled the moment you let go of the handle. The frame is re-taken only when the
  // user asks for a different view (the zoom) or moves to another track.
  const focus = useRef<{ start: number; end: number } | null>(null)
  const suggestedStart = suggestion?.startSec
  const suggestedEnd = suggestion?.endSec
  if (focus.current === null && durationSec > 0) {
    focus.current = {
      start: value?.startSec ?? suggestedStart ?? 0,
      end: value?.endSec ?? suggestedEnd ?? durationSec,
    }
  }
  // The detection lands after the first render, so the initial frame (which had no
  // suggestion to aim at) is retaken once — before the user has touched anything.
  const framedOnDetection = useRef(false)
  useEffect(() => {
    if (framedOnDetection.current || durationSec <= 0) return
    if (suggestedStart === undefined && suggestedEnd === undefined) return
    framedOnDetection.current = true
    if (value) return
    focus.current = {
      start: suggestedStart ?? 0,
      end: suggestedEnd ?? durationSec,
    }
  }, [suggestedStart, suggestedEnd, durationSec, value])
  // Re-frame on a zoom: a tighter window around a cut the user has since moved must
  // land on where the cut IS, not where it was when the section opened.
  function reframe(which: Side): void {
    if (!focus.current) return
    focus.current = {
      ...focus.current,
      [which]: which === 'start' ? startSec : endSec,
    }
  }
  const startFocus = focus.current?.start ?? 0
  const endFocus = focus.current?.end ?? durationSec
  const startLane = useMemo(() => {
    const from = Math.max(0, startFocus - startContextSec)
    return { from, to: Math.min(durationSec, from + startContextSec * 2) }
  }, [startFocus, startContextSec, durationSec])
  const endLane = useMemo(() => {
    const to = Math.min(durationSec, endFocus + endContextSec)
    return { from: Math.max(0, to - endContextSec * 2), to }
  }, [endFocus, endContextSec, durationSec])

  // The by-ear check of a cut: a local element playing the source right at the
  // boundary — from the cut-in (what the converted track will open with), or the
  // last seconds INTO the end cut (where the outro lands). Stopped when the trim
  // changes or the section unmounts, like the declick audition.
  const [auditing, setAuditing] = useState<Side | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  function stopAudition(): void {
    audioRef.current?.pause()
    audioRef.current = null
    setAuditing(null)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is deliberately the trigger — a moved cut invalidates the playing boundary, so the cleanup must fire on it.
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
      setAuditing(null)
    }
  }, [value])
  function audition(which: Side): void {
    if (auditing === which) {
      stopAudition()
      return
    }
    stopAudition()
    const audio = new Audio(mediaUrl(inputPath))
    audioRef.current = audio
    const from = which === 'start' ? startSec : Math.max(0, endSec - AUDITION_SEC)
    const until = which === 'start' ? Math.min(durationSec, startSec + AUDITION_SEC) : endSec
    // Seek only once the element knows its duration — an immediate currentTime on
    // a still-loading element is dropped by the media pipeline.
    audio.onloadedmetadata = () => {
      audio.currentTime = from
      audio.play().catch(() => stopAudition())
    }
    audio.ontimeupdate = () => {
      if (audio.currentTime >= until) stopAudition()
    }
    audio.onended = () => stopAudition()
    setAuditing(which)
  }
  const auditionButton = (which: Side): React.JSX.Element => (
    <button
      type="button"
      data-testid={`trim-audition-${which}`}
      onClick={() => audition(which)}
      className="press inline-flex shrink-0 items-center gap-1 text-[10px] text-fg-dim hover:text-fg"
    >
      {auditing === which ? (
        <Square className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Volume2 className="h-3 w-3" aria-hidden="true" />
      )}
      {tr(which === 'start' ? 'trim.auditionStart' : 'trim.auditionEnd')}
    </button>
  )

  // A click lands in a LANE, so the second it means is read off that lane's window.
  // Dragging PAST the lane's outer edge means the track's own edge: with the window
  // framed around the cut, the head lane may well start at 4.7 s, and "cut nothing"
  // (drag the handle off the left) has to stay reachable — otherwise the only way
  // to undo a cut inside the lane would be the Reset button.
  function secondsAt(which: Side, clientX: number): number {
    const el = (which === 'start' ? startOverlayRef : endOverlayRef).current
    const lane = which === 'start' ? startLane : endLane
    if (!el || durationSec === 0) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return 0
    const raw = (clientX - rect.left) / rect.width
    if (which === 'start' && raw < 0) return 0
    if (which === 'end' && raw > 1) return durationSec
    const ratio = Math.min(1, Math.max(0, raw))
    return lane.from + ratio * (lane.to - lane.from)
  }

  // The magnet: dragging near where the music actually starts (or ends) pulls the
  // handle onto it — landing the cut exactly on the wave is the whole gesture, and
  // trackpads have no haptics an Electron app can fire, so the snap plus the
  // handle's glow stand in for the click under the finger. The catch window follows
  // the lane's span: the tighter the context, the more surgical the magnet.
  const [snapped, setSnapped] = useState(false)
  function withSnap(which: Side, sec: number): number {
    const target = which === 'start' ? snapTargets.startSec : snapTargets.endSec
    if (target === undefined || durationSec === 0) {
      setSnapped(false)
      return sec
    }
    const span = (which === 'start' ? startContextSec : endContextSec) * 2
    // Tight lanes want a surgical magnet: at ±0.25 s the catch is milliseconds, so
    // the snap helps place the cut instead of overriding a deliberate one.
    const catchSec = Math.min(0.3, Math.max(0.002, span * 0.015))
    const snap = Math.abs(sec - target) <= catchSec
    setSnapped(snap)
    return snap ? target : sec
  }

  function dragTo(which: Side, clientX: number): void {
    const sec = withSnap(which, secondsAt(which, clientX))
    if (which === 'start') {
      setDraft({ ...shown, startSec: Math.min(sec, endSec - MIN_KEEP_SEC) })
    } else {
      setDraft({ ...shown, endSec: Math.max(sec, startSec + MIN_KEEP_SEC) })
    }
  }

  // A handle parked back on its own edge cuts nothing: that bound drops, and
  // with both gone the track carries no trim at all.
  function commit(next: TrimRange): void {
    const cleaned: TrimRange = {}
    // To the millisecond: the tight lanes let the eye place a cut far finer than the
    // centisecond this used to round to, and the conversion's atrim takes it verbatim.
    if (next.startSec !== undefined && next.startSec > EDGE_SNAP_SEC)
      cleaned.startSec = Number(next.startSec.toFixed(3))
    if (next.endSec !== undefined && next.endSec < durationSec - EDGE_SNAP_SEC)
      cleaned.endSec = Number(next.endSec.toFixed(3))
    onChange(cleaned.startSec === undefined && cleaned.endSec === undefined ? undefined : cleaned)
  }

  function release(): void {
    const committed = draft
    dragging.current = null
    setSnapped(false)
    if (!committed) return
    setDraft(null)
    commit(committed)
  }

  // Keyboard fine-adjustment for the focused handle: the arrows move it in tenths
  // of a second (a whole second with Shift), the precision a drag alone can't give.
  function nudge(which: Side, deltaSec: number): void {
    if (durationSec === 0) return
    if (which === 'start') {
      const sec = Math.min(Math.max(0, startSec + deltaSec), endSec - MIN_KEEP_SEC)
      commit({ ...shown, startSec: sec })
    } else {
      const sec = Math.max(Math.min(durationSec, endSec + deltaSec), startSec + MIN_KEEP_SEC)
      commit({ ...shown, endSec: sec })
    }
  }

  // The folded header states the cuts (or that there are none) exactly once, like
  // the click-repair header: dim summary when off, accent badge when active.
  const cuts = [
    cutStart ? tr('trim.cutStart', { seconds: cutSeconds(startSec) }) : undefined,
    cutEnd ? tr('trim.cutEnd', { seconds: cutSeconds(durationSec - endSec) }) : undefined,
  ].filter(Boolean)
  // The detection's finding, worn on the header like the quality section's verdict
  // pill: the one convention for analysis results, readable without opening the
  // section (once the wave has been decoded) and without hunting through the body.
  const detected = suggestion
    ? [
        suggestion.startSec !== undefined
          ? tr('trim.cutStart', { seconds: cutSeconds(suggestion.startSec) })
          : undefined,
        suggestion.endSec !== undefined
          ? tr('trim.cutEnd', { seconds: cutSeconds(durationSec - suggestion.endSec) })
          : undefined,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined

  const laneProps = (which: Side): React.ComponentProps<typeof Lane> => {
    const lane = which === 'start' ? startLane : endLane
    return {
      side: which,
      wave,
      fromSec: lane.from,
      toSec: lane.to,
      durationSec,
      inputPath,
      enabled: open && settled && durationSec > 0,
      cutSec: which === 'start' ? shown?.startSec : shown?.endSec,
      suggestionSec: which === 'start' ? suggestion?.startSec : suggestion?.endSec,
      snapped: snapped && dragging.current === which,
      onPointerDown: (e: React.PointerEvent) => {
        dragging.current = which
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
        dragTo(which, e.clientX)
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (dragging.current !== which) return
        dragTo(which, e.clientX)
      },
      onRelease: release,
      onKeyStep: (delta: number) => nudge(which, delta),
      onApplySuggestion: (sec: number) =>
        commit(which === 'start' ? { ...value, startSec: sec } : { ...value, endSec: sec }),
      onContextChange: (index: number) => {
        reframe(which)
        setContext(which, index)
      },
      contextIndex: contextIndex[which],
      contextSec: which === 'start' ? startContextSec : endContextSec,
      contextCount: CONTEXT_SEC.length,
      fineStepSec: FINE_STEP_SEC,
      overlayRef: which === 'start' ? startOverlayRef : endOverlayRef,
      tr,
    }
  }

  return (
    <div data-testid="editor-trim" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        sectionId="trim"
        title={tr('trim.title')}
        open={open}
        onToggle={onToggle}
        help={tr('trim.hint')}
        summary={value ? undefined : tr('trim.summaryNone')}
        summaryTestId="trim-summary"
        right={
          value ? (
            !open ? (
              <span
                data-testid="trim-active-badge"
                className="rounded-full bg-[var(--color-accent)]/15 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]"
              >
                {`−${cutSeconds((value.startSec ?? 0) + (value.endSec !== undefined && durationSec > 0 ? durationSec - value.endSec : 0))}`}
              </span>
            ) : undefined
          ) : detected ? (
            <span
              data-testid="trim-detected-pill"
              className="whitespace-nowrap rounded-full bg-[var(--color-panel-2)] px-2.5 py-1 text-xs font-medium text-fg-muted"
            >
              {detected}
            </span>
          ) : undefined
        }
      />
      {open && (
        <div className="mt-3">
          {(loading || wave) && (
            <>
              {/* The action lives IN the detection row, not below the strip: the
                  message is what the user reads ("detected 2.1 s"), so the one-click
                  confirm must sit right next to it — parked under the wave it went
                  unseen in real use. Same for Reset beside the cuts readout. */}
              <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                {shown ? (
                  <>
                    <span data-testid="trim-cuts" className="min-w-0 truncate text-[10px] tabular-nums text-fg-dim">
                      <span className="font-medium uppercase tracking-wider">
                        {tr('trim.cutsLabel')}
                      </span>
                      {` ${cuts.join(' · ')}`}
                    </span>
                    {cutStart && auditionButton('start')}
                    {cutEnd && auditionButton('end')}
                    {value && (
                      <button
                        type="button"
                        data-testid="trim-clear"
                        onClick={() => onChange(undefined)}
                        className="press shrink-0 text-[10px] text-fg-dim underline-offset-2 hover:text-fg hover:underline"
                      >
                        {tr('trim.clear')}
                      </button>
                    )}
                  </>
                ) : (
                  wave &&
                  !suggestion && (
                    <span data-testid="trim-detected" className="min-w-0 truncate text-[10px] text-fg-dim">
                      {tr('trim.nothing')}
                    </span>
                  )
                )}
              </div>
              {loading || !wave || durationSec <= 0 ? (
                <WaveformSkeleton testid="trim-loading" />
              ) : (
                <div className="flex gap-3">
                  <Lane {...laneProps('start')} />
                  <Lane {...laneProps('end')} />
                </div>
              )}
              {value && (
                <p data-testid="trim-cue-warning" className="mt-3 text-xs text-warn">
                  {tr('trim.cueWarning')}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
