import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { SpectrumResult } from '../../../shared/types'
import { useSpectrumDuotone } from '../hooks/useSpectrumDuotone'
import { formatKHz } from '../lib/quality'

const FREQ_MARKS = [0, 5000, 10000, 15000, 20000]
const FILTER_ID = 'spectrum-duotone'

export function Spectrogram({ spectrum }: { spectrum: SpectrumResult }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const ramp = useSpectrumDuotone()
  const nyquist = spectrum.sampleRateHz / 2
  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-[var(--color-line)]">
      {/* sRGB interpolation keeps the table values mapping straight to the token colors;
          the default linearRGB would darken the mid-blue and wash the ramp. */}
      <svg aria-hidden className="absolute h-0 w-0">
        <title>spectrum duotone</title>
        <filter id={FILTER_ID} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues={ramp.r} />
            <feFuncG type="table" tableValues={ramp.g} />
            <feFuncB type="table" tableValues={ramp.b} />
          </feComponentTransfer>
        </filter>
      </svg>
      <img
        data-testid="spectrogram"
        // undefined, not '', when there's no rendered image yet: an empty src makes the
        // browser refetch the whole page.
        src={spectrum.image || undefined}
        alt={tr('editor.spectrumAlt')}
        style={{ filter: `url(#${FILTER_ID})` }}
        className="block h-80 w-full object-fill"
      />
      {nyquist > 0 &&
        FREQ_MARKS.filter((f) => f <= nyquist).map((f) => (
          <span
            key={f}
            style={{ top: `${(1 - f / nyquist) * 100}%` }}
            className="pointer-events-none absolute left-1 -translate-y-1/2 rounded border border-[var(--color-line)] bg-[var(--color-panel)]/80 px-1 text-[10px] tabular-nums text-[var(--color-fg)]"
          >
            {f / 1000}k
          </span>
        ))}
      {nyquist > 0 && spectrum.cutoffHz !== null && (
        <div
          style={{ top: `${(1 - spectrum.cutoffHz / nyquist) * 100}%` }}
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--color-fg-muted)]"
        >
          <span className="absolute right-1 top-0.5 rounded border border-[var(--color-line)] bg-[var(--color-panel)]/80 px-1 text-[10px] font-medium text-[var(--color-fg)]">
            {/* The line marks a codec wall only when a knee was actually found; a knee-free
                taper just shows how far the genuine highs reach, so calling it a "cutoff"
                there would contradict the "no codec cut" caption below and read as a fake. */}
            {tr(
              spectrum.hasKnee === false && !spectrum.processed
                ? 'editor.spectrumHighs'
                : 'editor.spectrumCutoff',
              { cutoff: formatKHz(spectrum.cutoffHz) },
            )}
          </span>
        </div>
      )}
    </div>
  )
}
