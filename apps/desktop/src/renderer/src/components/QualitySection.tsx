import { ImageDown, TriangleAlert } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { useSpectrogram } from '../hooks/useSpectrogram'
import { useTrackLoudness } from '../hooks/useTrackLoudness'
import {
  formatKHz,
  GOOD_CUTOFF_HZ,
  isTranscode,
  qualityVerdict,
  type Verdict,
} from '../lib/quality'
import { renderQualityReport } from '../lib/qualityReport'
import type { TrackItem } from '../types'
import { LoudnessReadout } from './LoudnessReadout'
import { SectionHeader } from './SectionHeader'
import { Spectrogram } from './Spectrogram'
import { SpectrumLoading } from './SpectrumLoading'
import { Tooltip } from './Tooltip'

const qualityBadge: Record<Verdict, { className: string; label: string }> = {
  good: { className: 'bg-good/15 text-good', label: 'editor.qualityGood' },
  warn: { className: 'bg-warn/15 text-warn', label: 'editor.qualitySuspect' },
  bad: { className: 'bg-danger/15 text-danger', label: 'editor.qualityBad' },
  // Regenerated highs are still a reject (red), but the spectrogram looks full,
  // so the badge names the manipulation rather than calling it dull.
  processed: { className: 'bg-danger/15 text-danger', label: 'editor.qualityProcessed' },
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
  open: boolean
  onToggle: () => void
  onShowLoudnessHelp: () => void
}

// The audio-quality section: spectrogram with its lossless-cutoff verdict, and the
// EBU R128 loudness pills. Owns both probes — the hover prefetch and the "analyze
// all" sweep warm the same cache keys, so an already-warmed track shows instantly.
// The editor only mounts this in single-track mode.
export function QualitySection({
  item,
  showSpectrum,
  showLoudness,
  open,
  onToggle,
  onShowLoudnessHelp,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // Gated on the feature setting AND the section being open: folding Quality away stops
  // the (heavy) decode until the user reopens it. A failed analysis surfaces as analyzeError.
  const spectrumQuery = useSpectrogram(item.inputPath, showSpectrum && open)
  const spectrum = spectrumQuery.data
  const analyzing = spectrumQuery.isFetching
  const analyzeFailed = spectrumQuery.isError
  // The raw ffmpeg failure (with its temp paths and full command) is no help to a
  // user and is already logged in the main process; keep it only as a hover title
  // so the inline state can be a friendly icon + message instead of a red wall.
  const analyzeErrorDetail = spectrumQuery.error instanceof Error ? spectrumQuery.error.message : ''
  // Keyed by input path, so it measures once per file and reads the right figures on
  // a track switch. The ffmpeg pass waits for the selection to rest (this section
  // remounts with the per-track editor). A failed measure resolves null and the
  // readout hides.
  const settled = useSettled(SELECTION_SETTLE_MS)
  const { data: loudness } = useTrackLoudness(item.inputPath, settled && showLoudness && open)
  // Resolve the verdict once and reuse it for the badge and the caption.
  const verdict =
    spectrum && spectrum.cutoffHz !== null
      ? qualityVerdict(
          spectrum.cutoffHz,
          spectrum.sampleRateHz,
          spectrum.processed,
          spectrum.hasKnee,
        )
      : null
  // A lossless container (.flac/.wav/.aiff) hiding a lossy source: a real codec knee can't
  // occur in genuine lossless, so it's the most damning verdict for a DJ. It outranks the
  // plain "Bad quality" badge/caption — the file lies about its format, which is the headline.
  const ext = item.inputPath.split('.').pop()?.toLowerCase() ?? ''
  const transcoded =
    spectrum?.cutoffHz != null &&
    isTranscode(ext, spectrum.cutoffHz, spectrum.hasKnee, spectrum.processed)
  // A knee-free taper graded good but stopping short of the full-quality line is a
  // genuine, gently rolled-off (dark) master, not a lossy cut — its own caption, so
  // "Good quality" doesn't sit over the "reaches the ~20 kHz line" text that a sub-20k
  // extent contradicts.
  const captionKey =
    verdict && spectrum
      ? transcoded
        ? 'editor.qualityCaptionTranscode'
        : spectrum.hasKnee === false &&
            !spectrum.processed &&
            spectrum.cutoffHz !== null &&
            spectrum.cutoffHz < GOOD_CUTOFF_HZ
          ? 'editor.qualityCaptionGenuine'
          : qualityCaption[verdict]
      : null
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
      // Composition reads the image already rendered on screen, so a failure is a bug,
      // not a user state; this section has no error surface, so at least say so loudly
      // where a bug report's console capture will carry it.
      console.error('quality report failed', err)
    } finally {
      setSavingReport(false)
    }
  }
  return (
    <div className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
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
              <span
                data-testid="quality-badge"
                data-transcode={transcoded || undefined}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${transcoded ? 'bg-danger/15 text-danger' : qualityBadge[verdict].className}`}
              >
                {tr(transcoded ? 'editor.qualityTranscode' : qualityBadge[verdict].label)}
              </span>
            )}
          </div>
        }
      />
      {open && (
        <div className="mt-3">
          {showSpectrum &&
            (analyzing ? (
              <SpectrumLoading />
            ) : analyzeFailed ? (
              <div
                data-testid="quality-error"
                className="relative flex h-28 flex-col items-center justify-center gap-2 text-xs text-fg-dim"
              >
                <TriangleAlert className="h-5 w-5 text-fg-faint" aria-hidden="true" />
                {tr('editor.analyzeError')}
                {analyzeErrorDetail && <Tooltip label={analyzeErrorDetail} />}
              </div>
            ) : spectrum ? (
              <>
                <Spectrogram spectrum={spectrum} />
                {/* Only when the verdict needs justifying: a full-band good file is
                    already said twice (green badge, cutoff chip), so its caption
                    would be the third telling of the same fact. */}
                {spectrum.cutoffHz !== null &&
                  captionKey &&
                  captionKey !== 'editor.qualityCaptionGood' && (
                    <p className="mt-2 text-xs text-fg-dim">
                      {tr(captionKey, { cutoff: formatKHz(spectrum.cutoffHz) })}
                    </p>
                  )}
                {/* Orthogonal to the codec verdict: the bandwidth claim, not the
                    fidelity. Shown amber so a green "good" badge over an upsampled
                    file doesn't read as a clean bill of hi-res. */}
                {spectrum.upsampled && (
                  <p data-testid="quality-upsampled" className="mt-2 text-xs text-warn">
                    {tr('editor.qualityUpsampled')}
                  </p>
                )}
              </>
            ) : null)}
          {showLoudness && loudness && (
            <LoudnessReadout loudness={loudness} onShowHelp={onShowLoudnessHelp} />
          )}
        </div>
      )}
    </div>
  )
}
