import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpectrumResult } from '../../../shared/types'
import { useSpectrumDuotone } from '../hooks/useSpectrumDuotone'
import { formatKHz } from '../lib/quality'
import { freqAtFraction } from '../lib/spectrumAxis'

const FREQ_MARKS = [0, 5000, 10000, 15000, 20000]
const FILTER_ID = 'spectrum-duotone'

export function Spectrogram({ spectrum }: { spectrum: SpectrumResult }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const ramp = useSpectrumDuotone()
  const nyquist = spectrum.sampleRateHz / 2
  // The hover crosshair: where the cursor sits as a percent from the top, and the frequency
  // that row maps to. Null while the cursor is outside, so the line shows only when reading.
  const [hover, setHover] = useState<{ topPct: number; hz: number } | null>(null)
  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = (e.clientY - rect.top) / rect.height
    const hz = freqAtFraction(fraction, spectrum.sampleRateHz)
    if (hz === null) return
    setHover({ topPct: Math.min(100, Math.max(0, fraction * 100)), hz })
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only crosshair that reads the frequency under the cursor on a decorative spectrogram — there is no keyboard analogue and it carries no semantics, the value is informational for the eye following the mouse
    <div
      className="relative w-full overflow-hidden rounded-lg border border-[var(--color-line)]"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
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
      {hover && (
        <div
          data-testid="spectrum-crosshair"
          style={{ top: `${hover.topPct}%` }}
          className="pointer-events-none absolute inset-x-0 border-t border-[var(--color-fg)]/40"
        >
          <span className="absolute right-1 -top-2 rounded border border-[var(--color-line)] bg-[var(--color-panel)]/90 px-1 text-[10px] font-medium tabular-nums text-[var(--color-fg)]">
            {formatKHz(hover.hz)}
          </span>
        </div>
      )}
    </div>
  )
}
