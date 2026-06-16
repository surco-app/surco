import type React from 'react'
import { useTranslation } from 'react-i18next'

// Ghost spectrum bars that pulse while ffmpeg computes the real spectrogram. They fill
// the exact frame the spectrogram will occupy (same height, border and radius) so the
// finished image swaps in without a layout jump, and the irregular, faded profile reads
// as a spectrum materializing rather than a generic spinner.
const BAR_COUNT = 56

// Deterministic pseudo-noise (never Math.random, so the bars don't reshuffle on every
// re-render): an irregular height/opacity profile instead of a uniform comb, with each
// bar on its own beat so the meter drifts out of phase like live levels.
const BARS = Array.from({ length: BAR_COUNT }, (_, i) => ({
  id: `bar-${i}`,
  height: 22 + Math.round(62 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.5))),
  opacity: 0.16 + Math.abs(Math.sin(i * 2.3)) * 0.28,
  duration: 0.7 + ((i * 7) % 11) / 10,
  delay: ((i * 5) % 13) / 10,
}))

export function SpectrumLoading(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      data-testid="spectrum-loading"
      className="relative flex h-60 w-full items-center justify-center overflow-hidden rounded-lg border border-[var(--color-line)]"
    >
      <div className="absolute inset-0 flex items-end gap-px px-1" aria-hidden="true">
        {BARS.map((bar) => (
          <span
            key={bar.id}
            style={{
              height: `${bar.height}%`,
              opacity: bar.opacity,
              animation: `wave ${bar.duration}s ease-in-out infinite`,
              animationDelay: `${bar.delay}s`,
            }}
            className="flex-1 origin-bottom rounded-sm bg-[var(--color-accent)]"
          />
        ))}
      </div>
      <span className="relative rounded-full bg-[var(--color-panel-2)]/85 px-2.5 py-1 text-xs text-fg-dim shadow-sm ring-1 ring-[var(--color-line)] backdrop-blur-sm">
        {t('editor.analyzing')}
      </span>
    </div>
  )
}
