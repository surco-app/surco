import type React from 'react'
import type { SpectrumResult } from '../../../shared/types'
import { formatKHz } from '../lib/quality'

const FREQ_MARKS = [0, 5000, 10000, 15000, 20000]

export function Spectrogram({ spectrum }: { spectrum: SpectrumResult }): React.JSX.Element {
  const nyquist = spectrum.sampleRateHz / 2
  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-[var(--color-line)]">
      <img
        data-testid="spectrogram"
        src={spectrum.image}
        alt="Espectrograma"
        className="block h-60 w-full object-fill"
      />
      {nyquist > 0 &&
        FREQ_MARKS.filter((f) => f <= nyquist).map((f) => (
          <span
            key={f}
            style={{ top: `${(1 - f / nyquist) * 100}%` }}
            className="pointer-events-none absolute left-1 -translate-y-1/2 rounded bg-black/55 px-1 text-[10px] tabular-nums text-neutral-200"
          >
            {f / 1000}k
          </span>
        ))}
      {nyquist > 0 && (
        <div
          style={{ top: `${(1 - spectrum.cutoffHz / nyquist) * 100}%` }}
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/70"
        >
          <span className="absolute right-1 top-0.5 rounded bg-black/65 px-1 text-[10px] font-medium text-white">
            corte ~{formatKHz(spectrum.cutoffHz)}
          </span>
        </div>
      )}
    </div>
  )
}
