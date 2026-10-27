import { ChevronRight, Loader2, Pause, Play, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { declickFilter } from '../../../shared/declick'
import { losesTraktorCues } from '../../../shared/outputFormats'
import type { DeclickConfig, OutputFormat, TrimRange } from '../../../shared/types'
import { useClicks } from '../hooks/useClicks'
import { useDeclickAb } from '../hooks/useDeclickAb'
import { useDiskCacheSeed } from '../hooks/useDiskCacheSeed'
import { useWaveform } from '../hooks/useWaveform'
import { clickMarks, nextClick } from '../lib/clickMarks'
import { formatFixed } from '../lib/numberFormat'
import { claimKeys } from '../lib/spaceClaim'
import { DeclickControls, NoiseControls } from './DeclickControls'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { SectionPill } from './SectionPill'
import { SectionSubhead } from './SectionSubhead'
import { Tooltip } from './Tooltip'
import { Strip, useWaveColors, ZOOM_MAX, zoomLabel } from './WaveformCompare'
import { WaveOverview } from './WaveOverview'
import { ZoomStepper } from './ZoomStepper'

const PLAYHEAD_FINE_STEP_SEC = 0.01
const PLAYHEAD_COARSE_STEP_SEC = 0.25
// How far a press on the zoomed wave may wander and still count as a click that places
// the cursor; past it the press is a hand dragging the view.
const PAN_SLOP_PX = 4
// Where a playhead brought back into view lands, as a fraction of the view from its left
// edge: enough wave ahead of it to see what is coming.
const FOLLOW_LEAD = 0.15

interface Props {
  value: DeclickConfig
  open: boolean
  onToggle: () => void
  onChange: (config: DeclickConfig) => void
  // The track the wave and the preview render from; both hide in multi-select, where
  // the anchor track's clicks would misrepresent the rest of the selection.
  inputPath: string
  // How many tracks the mode below will apply to. The batch hands ONE declick override
  // to every selected track (see declickForJob), so with a selection open this is not
  // the anchor track's setting — it is all of them, and the section has to say so.
  selectedCount: number
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
  selectedCount,
  format,
  trim,
}: Props): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const waveColor = useWaveColors().after
  const isMulti = selectedCount > 1
  // Whether the setting changes the audio at all — a click mode, the noise reduction, or
  // both. Clicks off with the noise on still has a result to render and hear.
  const repairs = declickFilter(value) !== null
  const solo = open && !isMulti
  useDiskCacheSeed('clicks', inputPath, open && !isMulti)
  useDiskCacheSeed('waveform', inputPath, open && !isMulti)
  const { data: clicks } = useClicks(inputPath, solo)
  const { data: wave } = useWaveform(inputPath, solo)
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
  const scrollerRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<{ x: number; left: number; moved: boolean } | null>(null)

  const [preview, setPreview] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [progress, setProgress] = useState(0)
  const [failed, setFailed] = useState(false)
  // Off repairs nothing, so Space plays the original itself on this wave. Loaded only on
  // that first press, like the render: most tracks are never listened to here.
  const [hearOriginal, setHearOriginal] = useState(false)
  const playOnLoadRef = useRef(false)
  const ab = useDeclickAb(inputPath, preview ?? (hearOriginal ? inputPath : null))

  useEffect(() => {
    if (!ab.ready || !playOnLoadRef.current) return
    playOnLoadRef.current = false
    ab.play()
  }, [ab.ready, ab.play])

  useEffect(() => window.api.onDeclickPreviewProgress(setProgress), [])

  // Bumped by every render, cancel and preset change: an answer that comes back to an older
  // generation was cancelled or superseded, so it neither fails the section nor replaces
  // the audio of the preset now on screen.
  const renderGen = useRef(0)

  // A preset change (or a new track) invalidates the render: the audio no longer matches
  // the dials, and playing on would tell the user Gentle sounds exactly like Strong. Kills
  // an in-flight render too — nobody should wait on audio they no longer asked for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value`'s fields are deliberately the trigger — a mode change is what invalidates the render.
  useEffect(() => {
    return () => {
      renderGen.current++
      void window.api.cancelDeclickPreview()
      setPreview(null)
      setHearOriginal(false)
      playOnLoadRef.current = false
      setRendering(false)
      setProgress(0)
      setFailed(false)
    }
  }, [value.mode, value.noise, inputPath])

  // On demand, never on open: this is a full-length encode (tens of seconds on a long
  // side), and most tracks are never auditioned at all.
  const render = useCallback(async (): Promise<void> => {
    const gen = ++renderGen.current
    setRendering(true)
    setFailed(false)
    setProgress(0)
    const out = await window.api.declickPreview(inputPath, value)
    if (gen !== renderGen.current) return
    setRendering(false)
    if (!out) {
      setFailed(true)
      return
    }
    setPreview(out.path)
  }, [inputPath, value])

  const cancel = useCallback((): void => {
    renderGen.current++
    void window.api.cancelDeclickPreview()
    setRendering(false)
    setProgress(0)
  }, [])

  const marks = useMemo(
    () => clickMarks(clicks?.marks ?? [], durationSec, view),
    [clicks, durationSec, view],
  )
  const revealRef = useRef(false)
  const jump = useCallback(
    (sec: number) => {
      revealRef.current = true
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
  // rebinding it) is the app's answer to exactly this.
  //
  // Claimed for the WHOLE open section, not just once a preview exists: the user looking
  // at this wave means "play what I am looking at" by Space, and gating the claim on a
  // rendered preview is what let the press fall through and start the mini-player. With
  // nothing rendered the key does the render — the same thing the button does — so the
  // gesture always acts on the wave in front of them.
  //
  // Nothing to repair is no exception: there is still a wave and a cursor on it, so the
  // key plays the original from there. Only a selection, which shows no wave, leaves it to the
  // mini-player.
  const spaceRef = useRef<() => void>(() => {})
  spaceRef.current = () => {
    if (preview || hearOriginal) return ab.playing ? ab.pause() : ab.play()
    if (!repairs) {
      playOnLoadRef.current = true
      setHearOriginal(true)
      return
    }
    // A render is tens of seconds; an impatient second press must not queue another.
    if (!rendering) void render()
  }
  useEffect(() => {
    if (!open || (!repairs && isMulti)) return
    return claimKeys({ play: () => spaceRef.current() })
  }, [open, repairs, isMulti])

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

  const panTo = useCallback((from: number): void => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollLeft = Math.min(el.scrollWidth - el.clientWidth, Math.max(0, from * el.scrollWidth))
  }, [])

  // Zoomed in, the view keeps the playhead on screen: playback walking off the edge and
  // a jump to a click out of sight both bring it back. A playhead that was ALREADY out of
  // view is left there — the user dragged away to look at something else, and yanking
  // them back on every timeupdate would make the hand useless while it plays.
  const prevAtRef = useRef(ab.at)
  useEffect(() => {
    const prev = prevAtRef.current
    prevAtRef.current = ab.at
    const forced = revealRef.current
    revealRef.current = false
    const el = scrollerRef.current
    if (zoom <= 1 || !el || el.scrollWidth === 0 || durationSec <= 0) return
    const from = el.scrollLeft / el.scrollWidth
    const to = (el.scrollLeft + el.clientWidth) / el.scrollWidth
    const inView = (sec: number): boolean => sec / durationSec >= from && sec / durationSec <= to
    if (inView(ab.at) || (!forced && !inView(prev))) return
    panTo(ab.at / durationSec - (to - from) * FOLLOW_LEAD)
  }, [ab.at, zoom, durationSec, panTo])

  // Every fix that is on, in chain order after the clicks; the first part capitalised
  // for whichever one leads.
  const rowParts = [
    value.mode !== 'off' ? tr(`declick.row.${value.mode}`) : null,
    value.noise !== 'off' ? tr(`declick.rowNoise.${value.noise}`) : null,
  ].filter((p): p is string => p !== null)
  const rowSentence =
    rowParts.length === 0
      ? tr('declick.row.off')
      : rowParts.join(' · ').replace(/^./, (c) => c.toLocaleUpperCase(i18n.language))

  const count = clicks?.count
  // The detector reads the first eight minutes (CLICK_SCAN_SECONDS). Past that nothing was
  // analysed, and a wave that simply stops marking would read as a clean tail — so the
  // unscanned tail says so rather than lying by omission.
  const unscanned = clicks && durationSec > clicks.scannedSec + 1
  const estimate =
    !isMulti && typeof count === 'number'
      ? count > 0
        ? tr('declick.estimatePill', { count })
        : tr('declick.estimateNonePill')
      : undefined

  return (
    <div data-testid="editor-declick" className="mt-6 border-t border-[var(--color-line)] pt-6">
      <SectionHeader
        title={tr('declick.title')}
        open={open}
        onToggle={onToggle}
        // A wave-work section, so it earns the maximize toggle like Trim: the
        // clicks-found strip reads far better with the whole window to mark them in.
        sectionId="declick"
        maximizable
        summary={rowSentence}
        summaryTestId="declick-row-sentence"
        summaryMuted={!repairs}
        right={
          estimate ? (
            <SectionPill tone="neutral" testid="declick-estimate-pill" numeric>
              {estimate}
            </SectionPill>
          ) : undefined
        }
      />
      <SectionBody open={open}>
        <div className="mt-4">
          {/* Above the control, so it is read before the mode is picked rather than
              after. Hiding the waveform was the only thing multi-select changed, which
              left this looking exactly like the single-track case. */}
          {isMulti && (
            <p data-testid="declick-scope" className="mb-3 text-xs text-fg-dim">
              {tr('declick.appliesToSelection', { count: selectedCount })}
            </p>
          )}
          {/* Side by side when the panel has the room, one under the other when it does
              not: the two ladders are siblings, and stacking them pushed the wave and the
              result button a whole row further down for nothing. */}
          <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
            <div className="min-w-0">
              <DeclickControls
                value={value.mode}
                onChange={(mode) => onChange({ ...value, mode })}
              />
            </div>
            <div className="min-w-0">
              <NoiseControls
                value={value.noise}
                onChange={(noise) => onChange({ ...value, noise })}
              />
            </div>
          </div>
          {!isMulti && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <SectionSubhead>{tr('declick.waveTitle')}</SectionSubhead>
                <ZoomStepper
                  label={zoomLabel(zoom, i18n.language)}
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
                color={waveColor}
                inputPath={inputPath}
                zoom={zoom}
                onZoomChange={setZoom}
                onViewChange={setView}
                trimShade={trimShade}
                scrollerRef={scrollerRef}
              >
                {/* Scrubbable, like the player's own strip: without it the only reachable
                    points in the track are the click marks, so "how did this passage come
                    out?" — the actual question — has no answer. Placing the cursor does
                    NOT start playback: aiming and auditioning are different gestures, and
                    audio bursting out of a click meant to position would teach the user to
                    stop touching the wave. */}
                {/* Zoomed in, the wave is also the hand that moves the view: a press that
                    drags pans it, one that stays put still places the cursor. Unzoomed
                    there is nothing to pan, so a drag scrubs as it always has. */}
                <div
                  data-testid="declick-marks"
                  className={`absolute inset-0 ${
                    zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                  }`}
                  role="slider"
                  tabIndex={0}
                  aria-label={tr('declick.playheadLabel')}
                  aria-valuemin={0}
                  aria-valuemax={Number(durationSec.toFixed(2))}
                  aria-valuenow={Number(ab.at.toFixed(2))}
                  aria-valuetext={`${formatFixed(ab.at, 2, i18n.language)} s`}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture?.(e.pointerId)
                    const el = scrollerRef.current
                    if (zoom > 1 && el) {
                      panRef.current = { x: e.clientX, left: el.scrollLeft, moved: false }
                      return
                    }
                    scrubFrom(e.clientX, e.currentTarget)
                  }}
                  onPointerMove={(e) => {
                    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return
                    const pan = panRef.current
                    const el = scrollerRef.current
                    if (!pan || !el) return scrubFrom(e.clientX, e.currentTarget)
                    const dx = e.clientX - pan.x
                    if (!pan.moved && Math.abs(dx) < PAN_SLOP_PX) return
                    pan.moved = true
                    el.scrollLeft = Math.min(
                      el.scrollWidth - el.clientWidth,
                      Math.max(0, pan.left - dx),
                    )
                  }}
                  onPointerUp={(e) => {
                    const pan = panRef.current
                    panRef.current = null
                    if (pan && !pan.moved) scrubFrom(pan.x, e.currentTarget)
                  }}
                  onPointerCancel={() => {
                    panRef.current = null
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                    if (durationSec <= 0) return
                    e.preventDefault()
                    const step = e.shiftKey ? PLAYHEAD_COARSE_STEP_SEC : PLAYHEAD_FINE_STEP_SEC
                    const next = ab.at + (e.key === 'ArrowLeft' ? -step : step)
                    ab.seek(Math.min(durationSec, Math.max(0, next)))
                  }}
                />
                {/* The marks sit BESIDE the slider, not inside it: a slider's children are
                    presentational to assistive tech, so nested buttons dropped out of the
                    accessibility tree, and a control inside a control leaves a press
                    ambiguous. The layer lets bare wave through to the slider below; only
                    the marks themselves take the pointer. */}
                <div className="pointer-events-none absolute inset-0">
                  {marks.map((m) => (
                    <button
                      key={m.sec}
                      type="button"
                      data-testid="declick-mark"
                      aria-label={tr('declick.markLabel', {
                        sec: formatFixed(m.sec, 2, i18n.language),
                      })}
                      // A mark, unlike bare wave, DOES audition on click: a click lasts
                      // milliseconds, so "put the cursor near it" would be useless — the
                      // whole point of marking one is to hear that exact click.
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => jump(m.sec)}
                      // Deliberately narrow (3px, barely wider than the 1px line it
                      // wraps): a dusty side carries dozens of marks, and a fat hit box
                      // would carpet the wave — every attempt to place the cursor would
                      // land on a mark instead, making the track unscrubbable.
                      className="pointer-events-auto absolute inset-y-0 w-[3px] -translate-x-1/2 cursor-pointer"
                      style={{ left: `${m.pct}%` }}
                    >
                      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-warn" />
                    </button>
                  ))}
                </div>
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
              </Strip>
              {zoom > 1 && wave && (
                <WaveOverview
                  wave={wave}
                  color={waveColor}
                  view={view}
                  marks={clicks?.marks ?? []}
                  atSec={ab.at}
                  onPan={panTo}
                />
              )}
              {unscanned && (
                <p data-testid="declick-unscanned" className="mt-1 text-xs text-fg-dim">
                  {tr('declick.unscanned', { minutes: Math.floor(clicks.scannedSec / 60) })}
                </p>
              )}
            </div>
          )}
          {repairs && !isMulti && (
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
          {repairs && losesTraktorCues(format) && (
            <p data-testid="declick-cue-warning" className="mt-3 text-xs text-warn">
              {tr('declick.cueWarning')}
            </p>
          )}
        </div>
      </SectionBody>
    </div>
  )
}
