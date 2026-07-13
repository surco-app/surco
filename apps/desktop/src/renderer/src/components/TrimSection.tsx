import { Scissors, ZoomIn, ZoomOut } from 'lucide-react'
import type React from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrimRange } from '../../../shared/types'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { useWaveform } from '../hooks/useWaveform'
import { detectTrim } from '../lib/trim'
import { SectionHeader } from './SectionHeader'
import { AFTER_COLOR, OVERLAY_W, Strip, ZOOM_MAX } from './WaveformCompare'

// A handle can never cross to within a second of the other: a trim that eats the
// whole track is always a mistake, and the floor keeps the handles grabbable.
const MIN_KEEP_SEC = 1
// Dragging a handle back to within this of its own edge means "cut nothing here":
// the bound drops instead of persisting a hair's-width trim.
const EDGE_SNAP_SEC = 0.05

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

  // The folded header states the cuts (or that there are none) exactly once, like
  // the click-repair header: dim summary when off, accent badge when active.
  const cuts = [
    cutStart ? tr('trim.cutStart', { seconds: cutSeconds(startSec) }) : undefined,
    cutEnd ? tr('trim.cutEnd', { seconds: cutSeconds(durationSec - endSec) }) : undefined,
  ].filter(Boolean)

  return (
    <div data-testid="editor-trim" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        title={tr('trim.title')}
        open={open}
        onToggle={onToggle}
        summary={value ? undefined : tr('trim.summaryNone')}
        summaryTestId="trim-summary"
        right={
          value && !open ? (
            <span
              data-testid="trim-active-badge"
              className="rounded-full bg-[var(--color-accent)]/15 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]"
            >
              {`−${cutSeconds((value.startSec ?? 0) + (value.endSec !== undefined && durationSec > 0 ? durationSec - value.endSec : 0))}`}
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
                  wave && (
                    <>
                      <span data-testid="trim-detected" className="min-w-0 truncate text-[10px] text-fg-dim">
                        {suggestion
                          ? tr('trim.detected', {
                              parts: [
                                suggestion.startSec !== undefined
                                  ? tr('trim.cutStart', { seconds: cutSeconds(suggestion.startSec) })
                                  : undefined,
                                suggestion.endSec !== undefined
                                  ? tr('trim.cutEnd', {
                                      seconds: cutSeconds(durationSec - suggestion.endSec),
                                    })
                                  : undefined,
                              ]
                                .filter(Boolean)
                                .join(' · '),
                            })
                          : tr('trim.nothing')}
                      </span>
                      {suggestion && (
                        <button
                          type="button"
                          data-testid="trim-apply"
                          onClick={() => onChange(suggestion)}
                          className="press inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-line-strong)] px-2 py-0.5 text-[10px] font-medium text-fg-muted transition-colors hover:text-fg"
                        >
                          <Scissors className="h-3 w-3" aria-hidden="true" />
                          {tr('trim.apply')}
                        </button>
                      )}
                    </>
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
                    {`×${zoom}`}
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
              >
                {wave && durationSec > 0 && (
                  <div ref={overlayRef} className="absolute inset-0">
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
