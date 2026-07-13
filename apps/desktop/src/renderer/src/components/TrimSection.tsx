import { Scissors, Square, Volume2, ZoomIn, ZoomOut } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mediaUrl } from '../../../shared/media'
import type { TrimRange } from '../../../shared/types'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { useWaveform } from '../hooks/useWaveform'
import { detectTrim } from '../lib/trim'
import { SectionHeader } from './SectionHeader'
import { AFTER_COLOR, OVERLAY_W, Strip, ZOOM_MAX, zoomLabel } from './WaveformCompare'

// A handle can never cross to within a second of the other: a trim that eats the
// whole track is always a mistake, and the floor keeps the handles grabbable.
const MIN_KEEP_SEC = 1
// Dragging a handle back to within this of its own edge means "cut nothing here":
// the bound drops instead of persisting a hair's-width trim.
const EDGE_SNAP_SEC = 0.05
// How much of the track each cut audition plays: enough to judge the boundary by
// ear, short enough to stay a check instead of a listen.
const AUDITION_SEC = 4

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

// The per-track silence trim ("top and tail"): the source wave with the discarded
// head/tail shaded and a draggable handle on each cut, so what the conversion will
// drop is read straight off the strip. The detection only suggests — the cut is
// whatever seconds the user confirmed, which is what the track stores and the
// conversion applies verbatim.
export function TrimSection({ value, open, onToggle, onChange, inputPath }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The waveform decodes the full file, so it waits for the selection to rest and
  // for the section to actually be open — same gating as the loudness strip.
  const settled = useSettled(SELECTION_SETTLE_MS)
  const { data: wave, isFetching } = useWaveform(inputPath, open && settled)
  const loading = isFetching && !wave
  const durationSec = wave?.durationSec ?? 0
  const suggestion = useMemo(() => (wave ? detectTrim(wave) : undefined), [wave])
  const [zoom, setZoom] = useState(1)
  // The live range while a handle is dragged; committed to the track (onChange)
  // only on release, so a drag doesn't spray staleness/session updates per pixel.
  const [draft, setDraft] = useState<TrimRange | null>(null)
  const dragging = useRef<'start' | 'end' | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const shown = draft ?? value
  const startSec = shown?.startSec ?? 0
  const endSec = shown?.endSec ?? durationSec
  const cutStart = startSec > 0
  const cutEnd = durationSec > 0 && endSec < durationSec
  const pct = (sec: number): number => (durationSec === 0 ? 0 : (sec / durationSec) * 100)
  // The by-ear check of a cut: a local element playing the source right at the
  // boundary — from the cut-in (what the converted track will open with), or the
  // last seconds INTO the end cut (where the outro lands). Stopped when the trim
  // changes or the section unmounts, like the declick audition.
  const [auditing, setAuditing] = useState<'start' | 'end' | null>(null)
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
  function audition(which: 'start' | 'end'): void {
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
  const auditionButton = (which: 'start' | 'end'): React.JSX.Element => (
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

  function secondsAt(clientX: number): number {
    const el = overlayRef.current
    if (!el || durationSec === 0) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * durationSec
  }

  function dragTo(clientX: number): void {
    const which = dragging.current
    if (!which) return
    const sec = secondsAt(clientX)
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
    if (next.startSec !== undefined && next.startSec > EDGE_SNAP_SEC)
      cleaned.startSec = Number(next.startSec.toFixed(2))
    if (next.endSec !== undefined && next.endSec < durationSec - EDGE_SNAP_SEC)
      cleaned.endSec = Number(next.endSec.toFixed(2))
    onChange(cleaned.startSec === undefined && cleaned.endSec === undefined ? undefined : cleaned)
  }

  function release(): void {
    const committed = draft
    dragging.current = null
    if (!committed) return
    setDraft(null)
    commit(committed)
  }

  // Keyboard fine-adjustment for the focused handle: the arrows move it in tenths
  // of a second (a whole second with Shift), the precision the coarse strip can't
  // give with a drag alone.
  function nudge(which: 'start' | 'end', deltaSec: number): void {
    if (durationSec === 0) return
    if (which === 'start') {
      const sec = Math.min(Math.max(0, startSec + deltaSec), endSec - MIN_KEEP_SEC)
      commit({ ...shown, startSec: sec })
    } else {
      const sec = Math.max(Math.min(durationSec, endSec + deltaSec), startSec + MIN_KEEP_SEC)
      commit({ ...shown, endSec: sec })
    }
  }

  const handle = (which: 'start' | 'end', sec: number): React.JSX.Element => (
    <div
      data-testid={`trim-handle-${which}`}
      role="slider"
      aria-label={tr(which === 'start' ? 'trim.handleStart' : 'trim.handleEnd')}
      aria-valuemin={0}
      aria-valuemax={Number(durationSec.toFixed(2))}
      aria-valuenow={Number(sec.toFixed(2))}
      tabIndex={0}
      className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-1 focus-visible:outline-accent"
      style={{ left: `${pct(sec)}%` }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const step = e.shiftKey ? 1 : 0.1
        nudge(which, e.key === 'ArrowLeft' ? -step : step)
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        dragging.current = which
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }}
      onPointerMove={(e) => {
        e.stopPropagation()
        dragTo(e.clientX)
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-accent" />
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-accent"
      />
    </div>
  )

  // A suggested cut, drawn where it would land: a dashed line with a scissors
  // button ON the wave — the position says which side it is, so the button needs
  // no words (the amount rides the header pill and the aria-label). One click
  // stages that side alone; both markers stay independent, so "only the end" is
  // one click, not a drag. The line sits at the exact second, but the button's
  // center is clamped a half-button inside the strip: a suggestion hugging the
  // track edge used to render the scissors half-clipped under the edge handle,
  // leaving a sliver to click. z-20 keeps it above the handles' hit areas.
  const suggestionMarker = (which: 'start' | 'end', sec: number): React.JSX.Element => (
    <div key={`suggest-${which}`} className="pointer-events-none absolute inset-0">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 w-0 border-l border-dashed border-[var(--color-line-strong)]"
        style={{ left: `${pct(sec)}%` }}
      />
      <button
        type="button"
        data-testid={`trim-apply-${which}`}
        aria-label={tr(which === 'start' ? 'trim.applyStart' : 'trim.applyEnd', {
          seconds: cutSeconds(which === 'start' ? sec : durationSec - sec),
        })}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() =>
          commit(which === 'start' ? { ...value, startSec: sec } : { ...value, endSec: sec })
        }
        className="press pointer-events-auto absolute top-1 z-20 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] text-fg-muted hover:text-fg"
        style={{ left: `clamp(12px, ${pct(sec)}%, calc(100% - 12px))` }}
      >
        <Scissors className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  )

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

  return (
    <div data-testid="editor-trim" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        title={tr('trim.title')}
        open={open}
        onToggle={onToggle}
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
          <p className="mb-3 text-xs text-fg-dim">{tr('trim.hint')}</p>
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
                <span className="ml-auto flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    data-testid="waveform-zoom-out"
                    aria-label={tr('editor.waveformZoomOut')}
                    disabled={zoom <= 1}
                    onClick={() => setZoom((z) => Math.max(1, z / 2))}
                    className="press flex h-5 w-5 items-center justify-center rounded text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
                  >
                    <ZoomOut className="h-3 w-3" aria-hidden="true" />
                  </button>
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
                  <button
                    type="button"
                    data-testid="waveform-zoom-in"
                    aria-label={tr('editor.waveformZoomIn')}
                    disabled={zoom >= ZOOM_MAX}
                    onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * 2))}
                    className="press flex h-5 w-5 items-center justify-center rounded text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
                  >
                    <ZoomIn className="h-3 w-3" aria-hidden="true" />
                  </button>
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
              >
                {wave && durationSec > 0 && (
                  // Clicking the wave grabs the NEAREST handle and drops it there —
                  // placing a cut is one gesture (press, optionally drag to refine,
                  // release commits) instead of dragging a handle across the strip.
                  // The handles' own pointerdown stops propagation, so grabbing one
                  // directly never re-places it through this handler.
                  <div
                    ref={overlayRef}
                    data-testid="trim-overlay"
                    className="absolute inset-0"
                    onPointerDown={(e) => {
                      const sec = secondsAt(e.clientX)
                      dragging.current =
                        Math.abs(sec - startSec) <= Math.abs(sec - endSec) ? 'start' : 'end'
                      e.currentTarget.setPointerCapture?.(e.pointerId)
                      dragTo(e.clientX)
                    }}
                    onPointerMove={(e) => dragTo(e.clientX)}
                    onPointerUp={release}
                    onPointerCancel={release}
                  >
                    {/* The discarded regions, shaded like a dimmed room: the kept
                        audio stays lit, so the cut reads without a legend. */}
                    {cutStart && (
                      <div
                        data-testid="trim-shade-start"
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-[var(--color-panel)]/70"
                        style={{ width: `${pct(startSec)}%` }}
                      />
                    )}
                    {cutEnd && (
                      <div
                        data-testid="trim-shade-end"
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 right-0 rounded-r-lg bg-[var(--color-panel)]/70"
                        style={{ width: `${100 - pct(endSec)}%` }}
                      />
                    )}
                    {handle('start', startSec)}
                    {handle('end', endSec)}
                    {shown?.startSec === undefined &&
                      suggestion?.startSec !== undefined &&
                      suggestionMarker('start', suggestion.startSec)}
                    {shown?.endSec === undefined &&
                      suggestion?.endSec !== undefined &&
                      suggestionMarker('end', suggestion.endSec)}
                  </div>
                )}
              </Strip>
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
