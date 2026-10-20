export const CUE_QUANTIZE = ['bar', 'beat'] as const

export type CueQuantize = (typeof CUE_QUANTIZE)[number]

export const DEFAULT_CUE_QUANTIZE: CueQuantize = 'bar'

export function normalizeCueQuantize(value: unknown): CueQuantize {
  return CUE_QUANTIZE.find((unit) => unit === value) ?? DEFAULT_CUE_QUANTIZE
}
