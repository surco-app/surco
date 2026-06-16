import type React from 'react'
import { useTranslation } from 'react-i18next'

// Each bar carries its own max height and beat so the meter bounces like a real
// audio level display instead of a single sine wave marching across in lockstep.
// The mismatched durations keep the bars drifting out of phase, the way levels
// jump around when reacting to live sound — that's what reads as "analyzing audio"
// rather than a generic spinner.
const BARS = [
  { h: 'h-3', duration: '0.9s', delay: '0s' },
  { h: 'h-6', duration: '1.3s', delay: '0.15s' },
  { h: 'h-4', duration: '0.7s', delay: '0.3s' },
  { h: 'h-5', duration: '1.1s', delay: '0.05s' },
  { h: 'h-3', duration: '0.8s', delay: '0.25s' },
]

export function WaveSpinner(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      role="img"
      // Fixed-height row aligned to the baseline so the shorter bars sit on the
      // floor and the layout never shifts as they pulse.
      className="flex h-6 items-end gap-1"
      data-testid="wave-spinner"
      aria-label={t('editor.analyzing')}
    >
      {BARS.map((bar) => (
        <span
          key={`${bar.h}-${bar.duration}-${bar.delay}`}
          style={{
            animation: `wave ${bar.duration} ease-in-out infinite`,
            animationDelay: bar.delay,
          }}
          className={`${bar.h} w-1 origin-bottom rounded-full bg-[var(--color-accent)]`}
        />
      ))}
    </div>
  )
}
