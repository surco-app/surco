export const SPEED_COUNT_MS = 1200

export const SPEED_FIGURES = [
  {
    key: 'open',
    value: 44,
    decimals: 0,
    unit: 'ms',
    source: 'responsiveness v1.37.1, rekordbox, 14835 tracks',
  },
  {
    key: 'select',
    value: 25000,
    decimals: 0,
    unit: '',
    source: 'surco-gate-traktor-25000, 17/11/2026, no main thread blocks',
  },
  {
    key: 'clear',
    value: 5.3,
    decimals: 1,
    unit: 's',
    source: 'surco-gate-engine-13280, 17/11/2026',
  },
] as const

export function speedFrame(t: number, language: string): string[] {
  const clamped = Math.min(1, Math.max(0, t))
  const eased = 1 - (1 - clamped) ** 4
  return SPEED_FIGURES.map(({ value, decimals }) =>
    new Intl.NumberFormat(language, {
      useGrouping: 'always',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    } as unknown as Intl.NumberFormatOptions).format(value * eased),
  )
}
