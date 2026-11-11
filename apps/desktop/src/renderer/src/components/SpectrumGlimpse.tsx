import type React from 'react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpectrumResult } from '../../../shared/types'
import { useSpectrogram } from '../hooks/useSpectrogram'
import { useSpectrumDuotone } from '../hooks/useSpectrumDuotone'
import { cutoffLabel, formatKHz } from '../lib/quality'
import { spectrumTopHz } from '../lib/spectrumAxis'

type Side = 'here' | 'library'

const STRIP_PX = 96
const FREQ_MARKS = [5000, 10000, 15000, 20000]
const MARK_CLEARANCE_HZ = 1500

function Strip({
  side,
  spectrum,
  label,
  topHz,
  lost,
  filterId,
  hoverPct,
  onHover,
}: {
  side: Side
  spectrum: SpectrumResult
  label: string
  topHz: number
  lost: boolean
  filterId: string
  hoverPct: number | null
  onHover: (pct: number | null) => void
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const ownTop = spectrumTopHz(spectrum.sampleRateHz, spectrum.imageTopHz)
  const at = (hz: number): number => (1 - hz / topHz) * 100
  const cutoff = spectrum.cutoffHz
  const chip =
    cutoff !== null ? cutoffLabel({ ...spectrum, cutoffHz: cutoff }, i18n.language) : null
  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.height <= 0) return
    onHover(Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)))
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only crosshair over a decorative picture, the same reading aid as the main spectrogram's
    <div
      data-testid={`spectrum-glimpse-${side}`}
      className="relative overflow-hidden rounded-md border border-[var(--color-line)]"
      style={{ height: STRIP_PX }}
      onMouseMove={onMove}
      onMouseLeave={() => onHover(null)}
    >
      <img
        data-testid="spectrum-glimpse-image"
        src={spectrum.image || undefined}
        alt=""
        style={{
          height: `${(ownTop / topHz) * 100}%`,
          filter: `url(#${filterId}) saturate(0.7)`,
        }}
        className="absolute inset-x-0 bottom-0 block w-full object-fill"
      />
      {FREQ_MARKS.filter(
        (f) => f <= topHz && (cutoff === null || Math.abs(f - cutoff) >= MARK_CLEARANCE_HZ),
      ).map((f) => (
        <span
          key={f}
          aria-hidden="true"
          style={{ top: `${at(f)}%` }}
          className="pointer-events-none absolute left-1 -translate-y-1/2 text-[10px] tabular-nums text-[var(--color-fg-faint)]"
        >
          {f / 1000}k
        </span>
      ))}
      {lost && cutoff !== null && (
        <div
          data-testid="spectrum-glimpse-lost"
          aria-hidden="true"
          style={{ height: `${at(cutoff)}%` }}
          className="pointer-events-none absolute inset-x-0 top-0 bg-warn/15"
        />
      )}
      {cutoff !== null && chip && (
        <div
          data-testid="spectrum-glimpse-cutoff"
          style={{ top: `${at(cutoff)}%` }}
          className={`pointer-events-none absolute inset-x-0 border-t border-dashed ${lost ? 'border-warn' : 'border-[var(--color-fg-muted)]'}`}
        >
          <span
            className={`absolute right-1 rounded border bg-[var(--color-panel)]/80 px-1 text-label font-medium ${at(cutoff) < 20 ? 'top-0.5' : 'bottom-0.5'} ${lost ? 'border-warn/40 text-warn' : 'border-[var(--color-line)] text-[var(--color-fg)]'}`}
          >
            {tr(chip.key, { cutoff: chip.cutoff })}
          </span>
        </div>
      )}
      <span className="pointer-events-none absolute left-7 top-1 rounded border border-[var(--color-line)] bg-[var(--color-panel)]/80 px-1 text-label font-medium text-[var(--color-fg)]">
        {label}
      </span>
      {hoverPct !== null && (
        <div
          data-testid="spectrum-glimpse-crosshair"
          style={{ top: `${hoverPct}%` }}
          className="pointer-events-none absolute inset-x-0 border-t border-[var(--color-fg)]/40"
        >
          <span className="absolute right-1 -top-2 rounded border border-[var(--color-line)] bg-[var(--color-panel)]/90 px-1 text-label font-medium tabular-nums text-[var(--color-fg)]">
            {formatKHz((1 - hoverPct / 100) * topHz, i18n.language)}
          </span>
        </div>
      )}
    </div>
  )
}

// The two copies' pictures, stacked on one frequency scale so each cutoff sits at the height
// it really has: the verdict's "cut at 16 kHz against 22" becomes something to see.
export function SpectrumGlimpse({
  herePath,
  libraryPath,
  hereLabel,
  libraryLabel,
  loser,
}: {
  herePath: string
  libraryPath: string
  hereLabel: string
  libraryLabel: string
  loser: Side
}): React.JSX.Element | null {
  const here = useSpectrogram(herePath, true)
  const library = useSpectrogram(libraryPath, true)
  const ramp = useSpectrumDuotone()
  const filterId = `glimpse-duotone-${useId().replace(/:/g, '')}`
  const [hoverPct, setHoverPct] = useState<number | null>(null)

  if (here.isPending || library.isPending) {
    return (
      <div
        data-testid="spectrum-glimpse-placeholder"
        className="mt-2 rounded-lg bg-[var(--color-field)]"
        style={{ height: STRIP_PX * 2 + 22 }}
      />
    )
  }
  if (!here.data || !library.data) return null
  const topHz = Math.max(
    spectrumTopHz(here.data.sampleRateHz, here.data.imageTopHz),
    spectrumTopHz(library.data.sampleRateHz, library.data.imageTopHz),
  )
  if (topHz <= 0) return null
  const strips: { side: Side; spectrum: SpectrumResult; label: string }[] = [
    { side: 'here', spectrum: here.data, label: hereLabel },
    { side: 'library', spectrum: library.data, label: libraryLabel },
  ]
  return (
    <div
      data-testid="spectrum-glimpse"
      className="mt-2 flex flex-col gap-1.5 rounded-lg bg-[var(--color-field)] p-2"
    >
      <svg aria-hidden className="absolute h-0 w-0">
        <title>spectrum duotone</title>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues={ramp.r} />
            <feFuncG type="table" tableValues={ramp.g} />
            <feFuncB type="table" tableValues={ramp.b} />
          </feComponentTransfer>
        </filter>
      </svg>
      {strips.map(({ side, spectrum, label }) => (
        <Strip
          key={side}
          side={side}
          spectrum={spectrum}
          label={label}
          topHz={topHz}
          lost={side === loser}
          filterId={filterId}
          hoverPct={hoverPct}
          onHover={setHoverPct}
        />
      ))}
    </div>
  )
}
