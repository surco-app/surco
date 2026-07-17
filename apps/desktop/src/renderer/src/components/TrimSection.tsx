import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Scissors,
  Square,
  TriangleAlert,
  Volume2,
} from 'lucide-react'
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
import { SectionPill } from './SectionPill'
import { Tooltip } from './Tooltip'
import { ZoomStepper } from './ZoomStepper'
import { TrimSkeleton } from './TrimSkeleton'
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
  onSetTime,
  onApplySuggestion,
  onAudition,
  onClear,
  auditing,
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
  onSetTime: (sec: number) => void
  onApplySuggestion: (sec: number) => void
  onAudition: () => void
  onClear: () => void
  auditing: boolean
  onContextChange: (index: number) => void
  contextIndex: number
  contextSec: number
  contextCount: number
  fineStepSec: number
  overlayRef: React.RefObject<HTMLDivElement | null>
  tr: (key: string, opts?: Record<string, unknown>) => string
}): React.JSX.Element {
  const spanSec = Math.max(0.001, toSec - fromSec)
  // Edits as text and commits on blur/Enter, so a half-typed "40" never becomes a
  // 40-second cut mid-keystroke.
  const [timeText, setTimeText] = useState<string | null>(null)
  function commitTime(): void {
    const text = timeText
    setTimeText(null)
    if (text === null) return
    const sec = Number.parseFloat(text.replace(',', '.'))
    if (!Number.isFinite(sec)) return
    onSetTime(sec)
  }
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
      drawWaveform(canvas, win.peaks, { color: AFTER_COLOR, rms: win.rms })
      return
    }
    if (!wave || durationSec <= 0) return
    drawWaveform(canvas, wave.peaks, {
      color: AFTER_COLOR,
      rms: wave.rms,
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
      <div className="mb-1 flex flex-nowrap items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-wider text-fg-dim">
          {tr(side === 'start' ? 'trim.laneStart' : 'trim.laneEnd')}
        </span>
        {/* The cut's own time, and the place to set it: type the second you want,
            or step it a frame at a time with the arrows either side — the same nudge
            the field's arrow keys do, for the hand that stays on the mouse. */}
        <button
          type="button"
          data-testid={`trim-nudge-back-${side}`}
          aria-label={tr('trim.nudgeBack')}
          disabled={cutSec === undefined}
          onClick={() => onKeyStep(-fineStepSec)}
          className="press relative flex h-7 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <Tooltip label={tr('trim.nudgeBack')} />
        </button>
        <input
          data-testid={`trim-cut-time-${side}`}
          type="text"
          inputMode="decimal"
          aria-label={tr(side === 'start' ? 'trim.handleStart' : 'trim.handleEnd')}
          value={timeText ?? `${cut.toFixed(3)}`}
          onChange={(e) => setTimeText(e.target.value)}
          onBlur={commitTime}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitTime()
            }
            // The arrows nudge from the field, where the value is. Left/right move
            // the cut the way it reads on the wave — earlier is left, later is right
            // — and up/down do the same, so whichever pair the hand reaches for works.
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
              e.preventDefault()
              onKeyStep(e.shiftKey ? COARSE_STEP_SEC : fineStepSec)
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
              e.preventDefault()
              onKeyStep(e.shiftKey ? -COARSE_STEP_SEC : -fineStepSec)
            }
          }}
          className="h-7 w-16 shrink-0 rounded-md border border-[var(--color-line)] bg-transparent px-1.5 text-center text-[10px] tabular-nums text-fg-muted outline-none focus:border-accent focus:text-fg"
        />
        <button
          type="button"
          data-testid={`trim-nudge-forward-${side}`}
          aria-label={tr('trim.nudgeForward')}
          disabled={cutSec === undefined}
          onClick={() => onKeyStep(fineStepSec)}
          className="press relative flex h-7 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          <Tooltip label={tr('trim.nudgeForward')} />
        </button>
        {/* This cut's own actions: hear it, clear it. They used to sit in a row above
            BOTH lanes, so the "hear the end" button lived a panel away from the end
            it played. */}
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-testid={`trim-audition-${side}`}
            aria-label={tr(side === 'start' ? 'trim.auditionStart' : 'trim.auditionEnd')}
            disabled={cutSec === undefined}
            onClick={onAudition}
            className="press relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
          >
            {auditing ? (
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <Tooltip label={tr(side === 'start' ? 'trim.auditionStart' : 'trim.auditionEnd')} />
          </button>
          <button
            type="button"
            data-testid={`trim-clear-${side}`}
            aria-label={tr('trim.clearSide')}
            disabled={cutSec === undefined}
            onClick={onClear}
            className="press relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <Tooltip label={tr('trim.clearSide')} />
          </button>
        </span>
        {/* The one zoom control the whole app shares. Note the ORDER: less on the
            left, more on the right — the same as everywhere else, even though a
            tighter trim context makes the NUMBER smaller (±15 s → ±2 s). This lane
            used to order its buttons by that number, which put "closer" on the
            opposite side from the compare strip's. */}
        <ZoomStepper
          label={`±${contextSec < 1 ? contextSec : contextSec.toFixed(0)}s`}
          onOut={() => onContextChange(contextIndex + 1)}
          onIn={() => onContextChange(contextIndex - 1)}
          onReset={() => onContextChange(DEFAULT_CONTEXT_INDEX)}
          outDisabled={contextIndex >= contextCount - 1}
          inDisabled={contextIndex <= 0}
          resetDisabled={contextIndex === DEFAULT_CONTEXT_INDEX}
          labels={{
            out: tr('trim.contextWiden'),
            in: tr('trim.contextNarrow'),
            reset: tr('trim.contextReset'),
          }}
          testids={{
            out: `trim-zoom-out-${side}`,
            in: `trim-zoom-in-${side}`,
            reset: `trim-context-${side}`,
          }}
        />
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          data-testid={`trim-lane-${side}`}
          data-window={`${fromSec.toFixed(2)}-${toSec.toFixed(2)}`}
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
            // Keyboard focus lights the handle's own line and dot instead of drawing
            // a box around it: an outline on a strip this thin and tall read as a
            // stray rectangle, and the arrows (which need the handle focused) made it
            // a constant sight. The glow is the snap's, so focus and snap speak the
            // same visual language. outline-none alone leaves the global focus-visible
            // ring (a box-shadow, not an outline) boxing the 12px-wide strip, so the
            // shadow-none kills that too.
            className="group absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none outline-none focus-visible:shadow-none"
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
            {/* Focus SHARPENS the line rather than haloing it: the snap's wide, spread
                glow, worn as a persistent state, smeared across the wave until the line
                itself was lost in it. Focus instead widens the line a hair and gives it
                a tight, spreadless glow — the line stays a crisp line, just brighter. */}
            <span
              aria-hidden="true"
              data-testid={snapped ? `trim-snapped-${side}` : undefined}
              className={`absolute inset-y-0 left-1/2 w-px bg-accent group-focus-visible:shadow-[0_0_4px_var(--color-accent)] ${
                snapped ? 'shadow-[0_0_8px_2px_var(--color-accent)]' : ''
              }`}
            />
            <span
              aria-hidden="true"
              className={`absolute top-1/2 left-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-accent group-focus-visible:scale-125 group-focus-visible:shadow-[0_0_4px_var(--color-accent)] ${
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
  const { data: wave } = useWaveform(inputPath, open && settled)
  // Show the loading skeleton the instant the section opens, not only once the query is
  // fetching: the decode is gated behind a ~400ms settle, so `isFetching` stays false for
  // that window and the body used to render nothing — the section looked like it hadn't
  // opened at all. While it's open and the wave hasn't landed, it's loading.
  const loading = open && !wave
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
  // The window is a frame, but it must never lose what it frames. Nudging a cut far
  // enough (or zooming in around an older focus) used to push the handle clean out
  // of view — the lane showed 399.6–401.6 s while the cut sat at 408.3 s, pinned
  // uselessly against the edge. So the frame is placed, and then SLID (never
  // resized) the least amount that brings the cut back inside, with a margin so the
  // handle is never flush against the border.
  // The window is a rescue, not a follower. It moves ONLY when the cut has left the
  // frame outright — never merely because it came close to an edge. An earlier
  // version rescued on a 10% margin, and since an end cut naturally sits hard
  // against the right edge (that IS where the music stops), every commit nudged the
  // window: the wave slid and re-decoded each time the cut moved, which is the
  // "wave keeps changing" the user kept seeing. Recentring on the cut is the right
  // thing to do when it is genuinely off-screen, and nothing at all otherwise.
  function contain(
    lane: { from: number; to: number },
    cutSec: number,
  ): { from: number; to: number } {
    if (cutSec >= lane.from && cutSec <= lane.to) return lane
    const span = lane.to - lane.from
    let from = cutSec - span / 2
    let to = from + span
    if (from < 0) {
      from = 0
      to = Math.min(durationSec, span)
    } else if (to > durationSec) {
      to = durationSec
      from = Math.max(0, durationSec - span)
    }
    return { from, to }
  }
  // The window follows the COMMITTED cut, never the live draft. Feeding it the
  // draft made the lane re-frame on every pointermove — and a re-framed window is a
  // re-decoded window, so the wave rebuilt itself under the finger, which is the
  // lag and the flicker the user saw while dragging. The draft moves the handle;
  // the wave holds still. On release the commit lands and, if the cut ended up out
  // of frame, the window slides once to bring it back.
  const committedStart = value?.startSec ?? 0
  const committedEnd = value?.endSec ?? durationSec
  // biome-ignore lint/correctness/useExhaustiveDependencies: `contain` is a pure local helper over the values already listed.
  const startLane = useMemo(() => {
    const from = Math.max(0, startFocus - startContextSec)
    const lane = { from, to: Math.min(durationSec, from + startContextSec * 2) }
    return contain(lane, committedStart)
  }, [startFocus, startContextSec, durationSec, committedStart])
  // biome-ignore lint/correctness/useExhaustiveDependencies: `contain` is a pure local helper over the values already listed.
  const endLane = useMemo(() => {
    const to = Math.min(durationSec, endFocus + endContextSec)
    const lane = { from: Math.max(0, to - endContextSec * 2), to }
    return contain(lane, committedEnd)
  }, [endFocus, endContextSec, durationSec, committedEnd])

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

  // Reset is per side now: clearing "the trim" wholesale threw away the cut at the
  // other end of the track, which the user had just dialled in by hand.
  function clearSide(which: Side): void {
    if (!value) return
    const next: TrimRange = { ...value }
    if (which === 'start') delete next.startSec
    else delete next.endSec
    onChange(next.startSec === undefined && next.endSec === undefined ? undefined : next)
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
  // A typed second, clamped like any other placement: the field is just another way
  // to move the same handle.
  function setCut(which: Side, sec: number): void {
    if (durationSec === 0) return
    if (which === 'start') {
      commit({ ...shown, startSec: Math.min(Math.max(0, sec), endSec - MIN_KEEP_SEC) })
    } else {
      commit({ ...shown, endSec: Math.max(Math.min(durationSec, sec), startSec + MIN_KEEP_SEC) })
    }
  }

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
      onSetTime: (sec: number) => setCut(which, sec),
      onApplySuggestion: (sec: number) =>
        commit(which === 'start' ? { ...value, startSec: sec } : { ...value, endSec: sec }),
      onAudition: () => audition(which),
      onClear: () => clearSide(which),
      auditing: auditing === which,
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
        summaryMuted
        right={
          value ? (
            !open ? (
              <SectionPill tone="accent" testid="trim-active-badge">
                {`−${cutSeconds((value.startSec ?? 0) + (value.endSec !== undefined && durationSec > 0 ? durationSec - value.endSec : 0))}`}
              </SectionPill>
            ) : undefined
          ) : detected ? (
            <SectionPill tone="neutral" testid="trim-detected-pill">
              {detected}
            </SectionPill>
          ) : undefined
        }
      />
      {open && (
        <div className="mt-3">
          {(loading || wave) && (
            <>
              {/* Only the summary of what will be cut. The per-side actions (hear
                  this cut, clear this cut) moved INTO the lane they act on — up here
                  they were an "end" button sitting a panel away from the end. */}
              <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                {shown ? (
                  <span data-testid="trim-cuts" className="min-w-0 truncate text-[10px] tabular-nums text-fg-dim">
                    <span className="font-medium uppercase tracking-wider">
                      {tr('trim.cutsLabel')}
                    </span>
                    {` ${cuts.join(' · ')}`}
                  </span>
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
                // The two-lane placeholder: mirrors the START/END split with its control
                // rows and fixed-height waves, so the real lanes swap in without a jump.
                // Each wave sits in a positioned h-24 box (the skeleton is absolute
                // h-full; bare, it once resolved against the scroll pane and painted a
                // full-window wave behind the whole app).
                <TrimSkeleton />
              ) : (
                // The lanes are two DIFFERENT places in the track (second 0 and
                // second 400), not one continuous wave: pressed together the eye read
                // them as a single strip, so they get a proper gap between them.
                <div className="flex gap-8">
                  <Lane {...laneProps('start')} />
                  <Lane {...laneProps('end')} />
                </div>
              )}
              {/* The warning matters (a WAV or FLAC loses its cues on the re-encode),
                  but it was two lines of yellow prose under every trim. A short line
                  states the consequence; the full sentence rides its tooltip. */}
              {value && (
                <p
                  data-testid="trim-cue-warning"
                  className="relative mt-2 inline-flex items-center gap-1.5 text-[10px] text-warn"
                >
                  <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {tr('trim.cueWarningShort')}
                  <Tooltip label={tr('trim.cueWarning')} />
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
