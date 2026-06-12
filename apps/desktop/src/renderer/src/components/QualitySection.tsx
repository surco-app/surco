import type React from 'react'
import { useTranslation } from 'react-i18next'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { useSpectrogram } from '../hooks/useSpectrogram'
import { useTrackLoudness } from '../hooks/useTrackLoudness'
import { formatKHz, qualityVerdict, type Verdict } from '../lib/quality'
import type { TrackItem } from '../types'
import { LoudnessReadout } from './LoudnessReadout'
import { SectionHeader } from './SectionHeader'
import { Spectrogram } from './Spectrogram'
import { WaveSpinner } from './WaveSpinner'

const qualityBadge: Record<Verdict, { className: string; label: string }> = {
  good: { className: 'bg-good/15 text-good', label: 'editor.qualityGood' },
  warn: { className: 'bg-warn/15 text-warn', label: 'editor.qualitySuspect' },
  bad: { className: 'bg-danger/15 text-danger', label: 'editor.qualityBad' },
}

// The caption under the spectrogram is where the verdict gets justified: each band
// explains what its cutoff means, so a red "Bad quality" badge never stands alone.
const qualityCaption: Record<Verdict, string> = {
  good: 'editor.qualityCaptionGood',
  warn: 'editor.qualityCaptionWarn',
  bad: 'editor.qualityCaptionBad',
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
  // Gated on the Quality toggle; a failed analysis surfaces as analyzeError.
  const spectrumQuery = useSpectrogram(item.inputPath, showSpectrum)
  const spectrum = spectrumQuery.data
  const analyzing = spectrumQuery.isFetching
  const analyzeError = spectrumQuery.isError
    ? spectrumQuery.error instanceof Error
      ? spectrumQuery.error.message
      : tr('editor.analyzeError')
    : ''
  // Keyed by input path, so it measures once per file and reads the right figures on
  // a track switch. The ffmpeg pass waits for the selection to rest (this section
  // remounts with the per-track editor). A failed measure resolves null and the
  // readout hides.
  const settled = useSettled(SELECTION_SETTLE_MS)
  const { data: loudness } = useTrackLoudness(item.inputPath, settled && showLoudness)
  return (
    <div className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        title={tr('editor.qualityTitle')}
        open={open}
        onToggle={onToggle}
        right={
          spectrum &&
          spectrum.cutoffHz !== null && (
            <span
              data-testid="quality-badge"
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                qualityBadge[
                  qualityVerdict(spectrum.cutoffHz, spectrum.sampleRateHz, spectrum.processed)
                ].className
              }`}
            >
              {tr(
                qualityBadge[
                  qualityVerdict(spectrum.cutoffHz, spectrum.sampleRateHz, spectrum.processed)
                ].label,
              )}
            </span>
          )
        }
      />
      {open && (
        <div className="mt-3">
          {showSpectrum &&
            (analyzing ? (
              <div className="flex h-28 items-center justify-center gap-3 text-xs text-fg-dim">
                <WaveSpinner />
                {tr('editor.analyzing')}
              </div>
            ) : analyzeError ? (
              <p className="text-xs text-danger">{analyzeError}</p>
            ) : spectrum ? (
              <>
                <Spectrogram spectrum={spectrum} />
                {spectrum.cutoffHz !== null && (
                  <p className="mt-2 text-xs text-fg-dim">
                    {tr(
                      spectrum.processed
                        ? 'editor.qualityCaptionProcessed'
                        : qualityCaption[qualityVerdict(spectrum.cutoffHz, spectrum.sampleRateHz)],
                      { cutoff: formatKHz(spectrum.cutoffHz) },
                    )}
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
