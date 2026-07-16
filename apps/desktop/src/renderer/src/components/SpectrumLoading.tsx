import type React from 'react'
import { useTranslation } from 'react-i18next'

// The frequency ticks the real Spectrogram draws down its left edge (0/5k/10k/15k/20k,
// positioned by 1 - f/22050). The placeholder repeats them so the axis is already in place
// when the image lands — no marks sliding in on the swap.
const FREQ_MARKS = [0, 5000, 10000, 15000, 20000]
const NYQUIST = 22050

// A stand-in for the spectrogram while ffmpeg decodes: the same h-80 framed box, its
// frequency axis already drawn, and a faint column field that fades from denser at the
// bottom (where a real spectrum's energy sits) to sparse up top — so it reads as "a
// spectrum is coming here", not an empty frame. Kept low-contrast and pulsing so it's a
// wait cue, not a fake reading.
export function SpectrumLoading(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      data-testid="spectrum-loading"
      className="relative h-80 w-full overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-field)]"
    >
      {/* The column field: vertical bars of varied height, brightest along the bottom,
          masked to fade out toward the top the way real spectral energy thins with pitch.
          Pure CSS gradients so it costs nothing and pulses as one. */}
      <div aria-hidden="true" className="spectrum-skeleton-field absolute inset-0 animate-pulse" />
      {/* The frequency ticks, matching the real spectrogram's placement and style. */}
      {FREQ_MARKS.map((f) => (
        <span
          key={f}
          style={{ top: `${(1 - f / NYQUIST) * 100}%` }}
          className="pointer-events-none absolute left-1 -translate-y-1/2 rounded border border-[var(--color-line)] bg-[var(--color-panel)]/80 px-1 text-[10px] tabular-nums text-fg-faint"
        >
          {f / 1000}k
        </span>
      ))}
      <span className="spectrum-scan pointer-events-none absolute inset-y-0 left-0 w-1/3" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="animate-pulse rounded bg-[var(--color-panel)]/70 px-2 py-0.5 text-xs text-fg-faint">
          {t('editor.analyzing')}
        </span>
      </span>
    </div>
  )
}
