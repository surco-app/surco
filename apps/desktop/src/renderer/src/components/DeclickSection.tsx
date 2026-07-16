import { ChevronRight, Loader2, Pause, Play, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DeclickMode, OutputFormat, TrimRange } from '../../../shared/types'
import { useClicks } from '../hooks/useClicks'
import { useDeclickAb } from '../hooks/useDeclickAb'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { useWaveform } from '../hooks/useWaveform'
import { clickMarks, nextClick } from '../lib/clickMarks'
import { claimKeys } from '../lib/spaceClaim'
import { DeclickControls } from './DeclickControls'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { SectionPill } from './SectionPill'
import { Tooltip } from './Tooltip'
import { AFTER_COLOR, Strip, ZOOM_MAX, zoomLabel } from './WaveformCompare'
import { ZoomStepper } from './ZoomStepper'

// The formats whose re-encode carries the Traktor cue/beatgrid frame over (see
// convertAudio's copyCueFrames): converting to these loses nothing, so the amber
// cue warning would be pure noise there.
const CUES_SURVIVE: OutputFormat[] = ['mp3', 'aiff']

interface Props {
  value: DeclickMode
  open: boolean
  onToggle: () => void
  onChange: (config: DeclickMode) => void
  // The track the wave and the preview render from; both hide in multi-select, where
  // the anchor track's clicks would misrepresent the rest of the selection.
  inputPath: string
  isMulti: boolean
  // The export format the convert button will use — the cue warning only shows for
  // the formats that actually drop the cues.
  format: OutputFormat
  // The silence trim staged in the trim section, dimmed over this wave so the
  // audio the export drops reads at a glance here too.
  trim?: TrimRange
}

// The per-track click-repair override: the clicks marked on the track's own wave, and
// an A/B of the repaired render against the original.
//
// This replaces the old "hear what gets removed" audition (the repair phase-inverted
// over the source, so only the excised clicks played). That answered an engineer's
// question — did the filter fire? — not the user's, which is "how does my record sound
// now, and is the repair eating my drums?". The removed-signal audition actively hid
// that failure: a chewed-up snare attack sounds like just one more click in it.
export function DeclickSection({
  value,
  open,
  onToggle,
  onChange,
  inputPath,
  isMulti,
  format,
  trim,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const settled = useSettled(SELECTION_SETTLE_MS)
  const solo = open && !isMulti && settled
  const { data: clicks } = useClicks(inputPath, solo)
  const { data: wave } = useWaveform(inputPath, solo)
  // The strip loads from the moment the section opens (single-track), not only once the
  // query is fetching: the decode is gated behind the ~400ms settle, so it shows its
  // skeleton through that window instead of a blank strip. Multi-select has no strip.
  const waveLoading = open && !isMulti && !wave
  // Off the wave the strip already loads, like the trim section — no extra probe.
  const durationSec = wave?.durationSec ?? 0
  // The staged trim as head/tail fractions, to dim the audio the export will drop.
  const trimShade =
    trim && durationSec > 0
      ? {
          startFrac: Math.max(0, (trim.startSec ?? 0) / durationSec),
          endFrac: Math.max(0, (durationSec - (trim.endSec ?? durationSec)) / durationSec),
        }
      : undefined
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState({ from: 0, to: 1 })

  const [preview, setPreview] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [progress, setProgress] = useState(0)
  const [failed, setFailed] = useState(false)
  const ab = useDeclickAb(inputPath, preview)

  useEffect(() => window.api.onDeclickPreviewProgress(setProgress), [])

  // A preset change (or a new track) invalidates the render: the audio no longer matches
  // the dials, and playing on would tell the user Gentle sounds exactly like Strong. Kills
  // an in-flight render too — nobody should wait on audio they no longer asked for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is deliberately the trigger — a mode change is what invalidates the render.
  useEffect(() => {
    return () => {
      void window.api.cancelDeclickPreview()
      setPreview(null)
      setRendering(false)
      setProgress(0)
      setFailed(false)
    }
  }, [value, inputPath])

  // On demand, never on open: this is a full-length encode (tens of seconds on a long
  // side), and most tracks are never auditioned at all.
  const render = useCallback(async (): Promise<void> => {
    setRendering(true)
    setFailed(false)
    setProgress(0)
    const out = await window.api.declickPreview(inputPath, value)
    setRendering(false)
    if (!out) {
      setFailed(true)
      return
    }
    setPreview(out.path)
  }, [inputPath, value])

  const cancel = useCallback((): void => {
    void window.api.cancelDeclickPreview()
    setRendering(false)
    setProgress(0)
  }, [])

  const marks = useMemo(
    () => clickMarks(clicks?.marks ?? [], durationSec, view),
    [clicks, durationSec, view],
  )
  const jump = useCallback(
    (sec: number) => {
      ab.seek(sec)
      if (!ab.playing) ab.play()
    },
    [ab],
  )
  const skip = useCallback(() => {
    const next = nextClick(clicks?.marks ?? [], ab.at)
    if (next !== null) jump(next)
  }, [clicks, ab.at, jump])

  // Space is play/pause everywhere in Surco, so it has to work on this transport too —
  // but the same press would ALSO start the mini-player, and the user would be judging
  // the A/B with the whole track blaring underneath it. Claiming the key (rather than
  // rebinding it) is the app's answer to exactly this, and the beatgrid already does it.
  //
  // Claimed for the WHOLE open section, not just once a preview exists: the user looking
  // at this wave means "play what I am looking at" by Space, and gating the claim on a
  // rendered preview is what let the press fall through and start the mini-player. With
  // nothing rendered the key does the render — the same thing the button does — so the
  // gesture always acts on the wave in front of them.
  //
  // The exception is Off: nothing is repaired, so there is no result to hear, and the key
  // rightly belongs to the mini-player again.
  const spaceRef = useRef<() => void>(() => {})
  spaceRef.current = () => {
    if (preview) return ab.playing ? ab.pause() : ab.play()
    // A render is tens of seconds; an impatient second press must not queue another.
    if (!rendering) void render()
  }
  useEffect(() => {
    if (!open || value === 'off') return
    return claimKeys({ play: () => spaceRef.current() })
  }, [open, value])

  // The overlay lives INSIDE the zoomed strip, so its own width is already the zoomed
  // width of the whole track — the ratio across it is the fraction of the track, at any
  // zoom, with no need to map through the visible window (the same reason the marks can
  // be positioned by plain percentage).
  const scrubFrom = useCallback(
    (clientX: number, el: HTMLElement): void => {
      if (durationSec <= 0) return
      const rect = el.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      ab.seek(ratio * durationSec)
    },
    [ab, durationSec],
  )

  const count = clicks?.count
  // The detector reads the first eight minutes (CLICK_SCAN_SECONDS). Past that nothing was
  // analysed, and a wave that simply stops marking would read as a clean tail — so the
  // unscanned tail says so rather than lying by omission.
  const unscanned = clicks && durationSec > clicks.scannedSec + 1

  return (
    <div data-testid="editor-declick" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        title={tr('declick.title')}
        open={open}
        onToggle={onToggle}
        summary={value === 'off' ? tr('declick.mode.off') : undefined}
        summaryTestId="declick-summary"
        summaryMuted
        right={
          <span className="flex shrink-0 items-center gap-1.5">
            {!isMulti && typeof count === 'number' && (
              <span
                data-testid="declick-estimate-pill"
                className="whitespace-nowrap rounded-full bg-[var(--color-panel-2)] px-2.5 py-1 text-xs font-medium tabular-nums text-fg-muted"
              >
                {count > 0 ? tr('declick.estimatePill', { count }) : tr('declick.estimateNonePill')}
              </span>
            )}
            {value !== 'off' && !open && (
              <SectionPill tone="accent" testid="declick-active-badge">
                {tr(`declick.mode.${value}`)}
              </SectionPill>
            )}
          </span>
        }
      />
      <SectionBody open={open}>
        <div className="mt-3">
          <DeclickControls value={value} onChange={onChange} />
          {!isMulti && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-fg-dim">
                  {tr('declick.waveTitle')}
                </span>
                <ZoomStepper
                  label={zoomLabel(zoom)}
                  onOut={() => setZoom((z) => Math.max(1, z / 2))}
                  onIn={() => setZoom((z) => Math.min(ZOOM_MAX, z * 2))}
                  onReset={() => setZoom(1)}
                  outDisabled={zoom <= 1}
                  inDisabled={zoom >= ZOOM_MAX}
                  resetDisabled={zoom <= 1}
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
              </div>
              <Strip
                wave={wave}
                loading={waveLoading}
                loudness={undefined}
                // A literal colour, never a CSS var: this is a canvas fillStyle, and a
                // canvas silently ignores `var(...)` — leaving whatever fillStyle was set
                // last, which is the clip red, so the whole wave painted red.
                color={AFTER_COLOR}
                inputPath={inputPath}
                zoom={zoom}
                onZoomChange={setZoom}
                onViewChange={setView}
                trimShade={trimShade}
              >
                {/* Scrubbable, like the player's own strip: without it the only reachable
                    points in the track are the click marks, so "how did this passage come
                    out?" — the actual question — has no answer. Placing the cursor does
                    NOT start playback: aiming and auditioning are different gestures, and
                    audio bursting out of a click meant to position would teach the user to
                    stop touching the wave. */}
                <div
                  data-testid="declick-marks"
                  className="absolute inset-0 cursor-pointer"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture?.(e.pointerId)
                    scrubFrom(e.clientX, e.currentTarget)
                  }}
                  onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
                      scrubFrom(e.clientX, e.currentTarget)
                  }}
                >
                  {marks.map((m) => (
                    <button
                      key={m.sec}
                      type="button"
                      data-testid="declick-mark"
                      aria-label={tr('declick.markLabel', { sec: m.sec.toFixed(2) })}
                      // A mark, unlike bare wave, DOES audition on click: a click lasts
                      // milliseconds, so "put the cursor near it" would be useless — the
                      // whole point of marking one is to hear that exact click.
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => jump(m.sec)}
                      // Deliberately narrow (3px, barely wider than the 1px line it
                      // wraps): a dusty side carries dozens of marks, and a fat hit box
                      // would carpet the wave — every attempt to place the cursor would
                      // land on a mark instead, making the track unscrubbable.
                      className="absolute inset-y-0 w-[3px] -translate-x-1/2 cursor-pointer"
                      style={{ left: `${m.pct}%` }}
                    >
                      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-warn" />
                    </button>
                  ))}
                  {/* Shown as soon as there is a wave, not only once a preview exists:
                      it is the cursor the user is aiming, so it has to be visible while
                      they aim it. */}
                  {durationSec > 0 && (
                    <span
                      data-testid="declick-playhead"
                      className="pointer-events-none absolute inset-y-0 w-px bg-fg"
                      style={{ left: `${(ab.at / durationSec) * 100}%` }}
                    />
                  )}
                </div>
              </Strip>
              {unscanned && (
                <p data-testid="declick-unscanned" className="mt-1 text-xs text-fg-dim">
                  {tr('declick.unscanned', { minutes: Math.floor(clicks.scannedSec / 60) })}
                </p>
              )}
            </div>
          )}
          {value !== 'off' && !isMulti && (
            <div className="mt-3">
              {!preview && !rendering && (
                <button
                  type="button"
                  data-testid="declick-render"
                  onClick={() => void render()}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  {tr('declick.preview')}
                  <Tooltip label={tr('declick.previewHint')} />
                </button>
              )}
              {rendering && (
                <div data-testid="declick-rendering" className="flex items-center gap-3">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-panel-2)]">
                    <div
                      data-testid="declick-progress"
                      className="h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-fg-muted">
                    {tr('declick.rendering', { percent: Math.round(progress * 100) })}
                  </span>
                  <button
                    type="button"
                    data-testid="declick-cancel"
                    onClick={cancel}
                    aria-label={tr('declick.cancel')}
                    className="shrink-0 rounded-lg border border-[var(--color-line-strong)] p-1 text-fg-muted transition-colors hover:text-fg"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}
              {preview && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="declick-play"
                    disabled={!ab.ready}
                    onClick={() => (ab.playing ? ab.pause() : ab.play())}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
                  >
                    {ab.playing ? (
                      <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : ab.ready ? (
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    )}
                    {tr(ab.playing ? 'declick.pause' : 'declick.play')}
                  </button>
                  {/* The A/B itself. One button, not two: the user is answering a single
                      question — "is the repaired one better?" — and the switch has to be
                      instant, because the difference that matters (a softened transient)
                      does not survive a gap in the audio. */}
                  <button
                    type="button"
                    data-testid="declick-ab"
                    onClick={ab.toggle}
                    aria-pressed={ab.side === 'repaired'}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-medium transition-colors hover:text-fg"
                  >
                    <span
                      data-testid="declick-ab-state"
                      className={ab.side === 'repaired' ? 'text-accent' : 'text-fg-dim'}
                    >
                      {tr(
                        ab.side === 'repaired'
                          ? 'declick.hearingRepaired'
                          : 'declick.hearingOriginal',
                      )}
                    </span>
                    <Tooltip label={tr('declick.abHint')} />
                  </button>
                  {(count ?? 0) > 0 && (
                    <button
                      type="button"
                      data-testid="declick-skip"
                      onClick={skip}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
                    >
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      {tr('declick.nextClick')}
                    </button>
                  )}
                </div>
              )}
              {failed && (
                <p data-testid="declick-failed" className="mt-2 text-xs text-warn">
                  {tr('declick.previewFailed')}
                </p>
              )}
            </div>
          )}
          {value !== 'off' && !CUES_SURVIVE.includes(format) && (
            <p data-testid="declick-cue-warning" className="mt-3 text-xs text-warn">
              {tr('normalize.cueWarning')}
            </p>
          )}
        </div>
      </SectionBody>
    </div>
  )
}
