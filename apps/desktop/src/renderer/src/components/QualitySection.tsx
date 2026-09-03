import { ImageDown, TriangleAlert } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizeConfig } from '../../../shared/types'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { useSpectrogram } from '../hooks/useSpectrogram'
import { useTrackLoudness } from '../hooks/useTrackLoudness'
import { cleanIpcError, errorKeyOf } from '../lib/ipcError'
import {
  formatKHz,
  GOOD_CUTOFF_HZ,
  isLossyContainer,
  isTranscode,
  qualityVerdict,
  type Verdict,
} from '../lib/quality'
import { renderQualityReport } from '../lib/qualityReport'
import { useToast } from '../lib/toastContext'
import type { TrackItem } from '../types'
import { LoudnessReadout } from './LoudnessReadout'
import { LoudnessSkeleton } from './LoudnessSkeleton'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { SectionPill } from './SectionPill'
import { Spectrogram } from './Spectrogram'
import { SpectrumLoading } from './SpectrumLoading'
import { Tooltip } from './Tooltip'

// The verdict pill's tone through the shared SectionPill grammar: a genuine go/no-go
// on the audio, so it earns real colour — good is the one place green means "clean",
// warn asks for a look, danger rejects. (Status facts like library membership stay
// neutral, so these colours never have to compete with a plain fact.)
const qualityBadge: Record<Verdict, { tone: 'good' | 'warn' | 'danger'; label: string }> = {
  good: { tone: 'good', label: 'editor.qualityGood' },
  warn: { tone: 'warn', label: 'editor.qualitySuspect' },
  bad: { tone: 'danger', label: 'editor.qualityBad' },
  // Regenerated highs are still a reject (red), but the spectrogram looks full,
  // so the badge names the manipulation rather than calling it dull.
  processed: { tone: 'danger', label: 'editor.qualityProcessed' },
}

// The caption under the spectrogram is where the verdict gets justified: each band
// explains what its cutoff means, so a red badge never stands alone.
const qualityCaption: Record<Verdict, string> = {
  good: 'editor.qualityCaptionGood',
  warn: 'editor.qualityCaptionWarn',
  bad: 'editor.qualityCaptionBad',
  processed: 'editor.qualityCaptionProcessed',
}

interface Props {
  item: TrackItem
  showSpectrum: boolean
  showLoudness: boolean
  // The pending conversion's settings, so the loudness table can show where each figure
  // will land. Owned by the Normalize section; read here because the figures it predicts
  // are the ones this table measures.
  normalize: NormalizeConfig
  open: boolean
  onToggle: () => void
  onShowLoudnessHelp: () => void
  showHints?: boolean
}

// The audio-quality section: spectrogram with its lossless-cutoff verdict, and the
// EBU R128 loudness pills. Owns both probes — the hover prefetch and the "analyze
// all" sweep warm the same cache keys, so an already-warmed track shows instantly.
// The editor only mounts this in single-track mode.
export function QualitySection({
  item,
  showSpectrum,
  showLoudness,
  normalize,
  open,
  onToggle,
  onShowLoudnessHelp,
  showHints = true,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { reportError } = useToast()
  // Keyed by input path, so it measures once per file and reads the right figures on
  // a track switch. The ffmpeg pass waits for the selection to rest (this section
  // remounts with the per-track editor). A failed measure resolves null and the
  // readout hides.
  const settled = useSettled(SELECTION_SETTLE_MS)
  // Gated on the feature setting AND the section being open: folding Quality away stops
  // the (heavy) decode until the user reopens it. A failed analysis surfaces as analyzeError.
  // Also waits for the selection to rest, like every other heavy probe: this is the most
  // expensive one in the app (full decode + FFT), and arrowing down a crate with Quality
  // open used to queue a decode for every row merely passed through. A track already in
  // the cache still renders instantly — a disabled query keeps returning its cached data.
  const spectrumQuery = useSpectrogram(item.inputPath, settled && showSpectrum && open)
  const spectrum = spectrumQuery.data
  const analyzeFailed = spectrumQuery.isError
  // Show the scanning frame the instant the section opens, not only once the query reports
  // fetching: for the first tick after open the query hasn't started, so `isFetching` is
  // false and the body rendered nothing — an open chevron over an empty gap. Open with no
  // result and no error means it's still analyzing.
  const analyzing = open && showSpectrum && !spectrum && !analyzeFailed
  // The raw ffmpeg failure (with its temp paths and full command) is no help to a
  // user and is already logged in the main process; keep it only as a hover title
  // so the inline state can be a friendly icon + message instead of a red wall.
  const analyzeErrorDetail = spectrumQuery.error instanceof Error ? spectrumQuery.error.message : ''
  // "Could not analyse the audio" blames the music for what is usually a stale path:
  // the file was moved or renamed and is simply not there. The main process stamps
  // that case with a key, so name the real cause when it is the one that happened.
  const analyzeErrorKey =
    spectrumQuery.error instanceof Error
      ? errorKeyOf(cleanIpcError(spectrumQuery.error.message))
      : null
  const { data: loudness } = useTrackLoudness(item.inputPath, settled && showLoudness && open)
  // The container decides which scale the cutoff is read on, so it is resolved before the
  // verdict: lossy files are exempt (their lowpass is the format), lossless ones are graded.
  const ext = item.inputPath.split('.').pop()?.toLowerCase() ?? ''
  // Resolve the verdict once and reuse it for the badge and the caption.
  const verdict =
    spectrum && spectrum.cutoffHz !== null
      ? qualityVerdict(
          spectrum.cutoffHz,
          spectrum.sampleRateHz,
          spectrum.processed,
          spectrum.hasKnee,
          ext,
        )
      : null
  // A lossless container (.flac/.wav/.aiff) hiding a lossy source: a real codec knee can't
  // occur in genuine lossless, so it's the most damning verdict for a DJ. It outranks the
  // plain "Bad quality" badge/caption — the file lies about its format, which is the headline.
  const transcoded =
    spectrum?.cutoffHz != null &&
    isTranscode(ext, spectrum.cutoffHz, spectrum.hasKnee, spectrum.processed)
  // A lossy file always grades good, so the caption is the only place its ceiling gets
  // reported: silently passing a 128 kbps encode would hide the one fact the user might
  // act on. It states where the encoder cut without calling the file a fake.
  const lossyCut =
    isLossyContainer(ext) &&
    !spectrum?.processed &&
    spectrum?.hasKnee === true &&
    spectrum.cutoffHz !== null &&
    spectrum.cutoffHz < GOOD_CUTOFF_HZ
  const captionKey =
    verdict && spectrum
      ? transcoded
        ? 'editor.qualityCaptionTranscode'
        : lossyCut
          ? 'editor.qualityCaptionLossy'
          : // A knee-free taper graded good but stopping short of the full-quality line is a
            // genuine, gently rolled-off (dark) master, not a lossy cut — its own caption, so
            // "Good quality" doesn't sit over the "reaches the ~20 kHz line" text that a
            // sub-20k extent contradicts.
            spectrum.hasKnee === false &&
              !spectrum.processed &&
              spectrum.cutoffHz !== null &&
              spectrum.cutoffHz < GOOD_CUTOFF_HZ
            ? 'editor.qualityCaptionGenuine'
            : qualityCaption[verdict]
      : null
  // The same verdict, argued with the numbers the detectors decided on. Each
  // processed branch carries its own signature; the wall cases cite the measured
  // fine step. A cached analysis without the fields falls back to the
  // un-numbered captions below, and the didactic why-line obeys the same
  // inline-explanations toggle as the other sections' teaching text.
  const evidence = (() => {
    if (!spectrum || spectrum.cutoffHz === null) return null
    const cutoff = formatKHz(spectrum.cutoffHz)
    if (
      spectrum.teethCount !== undefined &&
      spectrum.teethFromHz !== undefined &&
      spectrum.teethToHz !== undefined
    )
      return {
        key: 'editor.qualityEvidenceTeeth',
        why: 'editor.qualityEvidenceTeethWhy',
        tone: 'danger' as const,
        params: {
          cutoff,
          teeth: spectrum.teethCount,
          from: formatKHz(spectrum.teethFromHz),
          to: formatKHz(spectrum.teethToHz),
        },
      }
    if (spectrum.humpPeakHz !== undefined)
      return {
        key: 'editor.qualityEvidenceHump',
        why: 'editor.qualityEvidenceHumpWhy',
        tone: 'danger' as const,
        params: { cutoff, peak: formatKHz(spectrum.humpPeakHz) },
      }
    if (spectrum.flatShelf)
      return {
        key: 'editor.qualityEvidenceShelf',
        why: 'editor.qualityEvidenceShelfWhy',
        tone: 'danger' as const,
        params: { cutoff },
      }
    if (spectrum.fineStepDb === undefined) return null
    const drop = Math.round(spectrum.fineStepDb)
    if (transcoded)
      return {
        key: 'editor.qualityEvidenceTranscode',
        why: 'editor.qualityEvidenceWallWhy',
        tone: 'danger' as const,
        params: { cutoff, drop },
      }
    if (lossyCut)
      return {
        key: 'editor.qualityEvidenceLossy',
        why: 'editor.qualityEvidenceWallWhy',
        tone: 'warn' as const,
        params: { cutoff, drop },
      }
    // The good verdict earns its badge only while hints are on: it is
    // reassurance, not a warning, and hints-off users already trust the badge.
    // A knee at or past the good line still reads good but its step is a wall,
    // so the fade claim would lie; only a knee-free spectrum gets the line.
    if (showHints && spectrum.hasKnee !== true && captionKey === 'editor.qualityCaptionGood')
      return {
        key: 'editor.qualityEvidenceGood',
        why: null,
        tone: 'good' as const,
        params: { cutoff, drop },
      }
    return null
  })()
  // Composes the shareable PNG (the verdict's proof for a "is this file fake?" thread)
  // and hands it to the save dialog. Guarded against double-clicks while composing.
  const [savingReport, setSavingReport] = useState(false)
  const saveReport = async (): Promise<void> => {
    if (!spectrum || !verdict || savingReport) return
    setSavingReport(true)
    try {
      const heading =
        [item.meta.artist, item.meta.title].filter(Boolean).join(' — ') || item.fileName
      const cutoff = spectrum.cutoffHz !== null ? formatKHz(spectrum.cutoffHz) : ''
      const png = await renderQualityReport({
        spectrum,
        heading,
        facts: `${ext.toUpperCase()} · ${spectrum.sampleRateHz / 1000} kHz`,
        verdict: transcoded ? 'bad' : verdict,
        verdictLabel: tr(transcoded ? 'editor.qualityTranscode' : qualityBadge[verdict].label),
        cutoffLabel:
          spectrum.cutoffHz !== null
            ? tr(
                spectrum.hasKnee === false && !spectrum.processed
                  ? 'editor.spectrumHighs'
                  : 'editor.spectrumCutoff',
                { cutoff },
              )
            : null,
        caption: captionKey ? tr(captionKey, { cutoff }) : '',
        upsampledNote: spectrum.upsampled ? tr('editor.qualityUpsampled') : undefined,
        footer: tr('editor.reportFooter'),
      })
      await window.api.exportQualityReport(png, `${item.fileName} — Surco`)
    } catch (err) {
      // Composition reads an image already on screen, so this is mostly a bug path — but it
      // also crosses IPC to write a file, which fails for ordinary reasons (permissions, a
      // full disk, a bad path). Either way the user pressed a button and watched the spinner
      // finish: staying silent leaves them staring at a folder with no report in it.
      console.error('quality report failed', err)
      reportError(tr('errors.qualityReport'))
    } finally {
      setSavingReport(false)
    }
  }
  return (
    <div className="mt-5 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        sectionId="quality"
        maximizable
        title={tr('editor.qualityTitle')}
        open={open}
        onToggle={onToggle}
        right={
          <div className="flex items-center gap-1.5">
            {/* A rare action as a quiet header icon: on its own bordered row it cost
                a full row of height under an already-tall spectrogram. */}
            {open && spectrum && verdict && (
              <button
                type="button"
                data-testid="quality-save-report"
                aria-label={tr('editor.saveQualityReport')}
                onClick={() => void saveReport()}
                disabled={savingReport}
                className="press group relative flex h-6 w-6 items-center justify-center rounded text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg disabled:opacity-60"
              >
                <ImageDown className="h-3.5 w-3.5" aria-hidden="true" />
                <Tooltip label={tr('editor.saveQualityReport')} align="end" />
              </button>
            )}
            {verdict && (
              <SectionPill
                tone={transcoded ? 'danger' : qualityBadge[verdict].tone}
                testid="quality-badge"
              >
                {tr(transcoded ? 'editor.qualityTranscode' : qualityBadge[verdict].label)}
              </SectionPill>
            )}
          </div>
        }
      />
      <SectionBody open={open}>
        <div className="mt-4">
          {showSpectrum &&
            (analyzing ? (
              <SpectrumLoading />
            ) : analyzeFailed ? (
              <div
                data-testid="quality-error"
                className="relative flex h-28 flex-col items-center justify-center gap-2 text-xs text-fg-dim"
              >
                <TriangleAlert className="h-5 w-5 text-fg-faint" aria-hidden="true" />
                {tr(analyzeErrorKey ? `errors.${analyzeErrorKey}` : 'editor.analyzeError')}
                {analyzeErrorDetail && <Tooltip label={analyzeErrorDetail} />}
              </div>
            ) : spectrum ? (
              <>
                <Spectrogram spectrum={spectrum} transcoded={transcoded} />
                {/* Only when the verdict needs justifying: a full-band good file is
                    already said twice (green badge, cutoff chip), so its caption
                    would be the third telling of the same fact. With measured
                    evidence available, the numbered claim replaces the caption
                    outright; saying "cut at 16 kHz" twice would be noise. */}
                {evidence ? (
                  <div
                    data-testid="quality-evidence"
                    className="mt-2 border-l-2 pl-2.5 text-xs"
                    style={{ borderColor: `var(--color-${evidence.tone})` }}
                  >
                    <p className="text-fg-dim">{tr(evidence.key, evidence.params)}</p>
                    {showHints && evidence.why && (
                      <p className="mt-1 text-fg-muted">{tr(evidence.why)}</p>
                    )}
                  </div>
                ) : (
                  spectrum.cutoffHz !== null &&
                  captionKey &&
                  captionKey !== 'editor.qualityCaptionGood' && (
                    <p className="mt-2 text-xs text-fg-dim">
                      {tr(captionKey, { cutoff: formatKHz(spectrum.cutoffHz) })}
                    </p>
                  )
                )}
                {/* Orthogonal to the codec verdict: the bandwidth claim, not the
                    fidelity. Shown amber so a green "good" badge over an upsampled
                    file doesn't read as a clean bill of hi-res. A file that declares a
                    high rate always gets an answer here — confirmed, denied, or an honest
                    "couldn't tell" — because saying nothing left a real hi-res file looking
                    exactly like one nobody analysed. A plain 44.1 kHz file makes no claim to
                    check, so it stays silent rather than gaining a line that says nothing. */}
                {spectrum.upsampled || spectrum.resolution === 'upsampled' ? (
                  <p data-testid="quality-upsampled" className="mt-2 text-xs text-warn">
                    {tr('editor.qualityUpsampled')}
                  </p>
                ) : spectrum.resolution === 'hires' ? (
                  <p data-testid="quality-hires" className="mt-2 text-xs text-fg-dim">
                    {tr('editor.qualityHiRes', {
                      rate: formatKHz(spectrum.sampleRateHz),
                    })}
                  </p>
                ) : spectrum.resolution === 'unknown' ? (
                  <p data-testid="quality-resolution-unknown" className="mt-2 text-xs text-fg-dim">
                    {tr('editor.qualityResolutionUnknown')}
                  </p>
                ) : null}
              </>
            ) : null)}
          {showLoudness &&
            (loudness ? (
              <LoudnessReadout
                loudness={loudness}
                normalize={normalize}
                onShowHelp={onShowLoudnessHelp}
              />
            ) : (
              // Measuring (undefined): show the pill placeholders so the figures don't pop
              // into empty space. A failed measure resolves null, and the skeleton hides —
              // the readout is simply absent, as before. Gated on the same conditions the
              // measure is, so a closed/multi section shows nothing.
              open && settled && loudness === undefined && <LoudnessSkeleton />
            ))}
        </div>
      </SectionBody>
    </div>
  )
}
