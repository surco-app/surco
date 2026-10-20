export const CUE_JUMP_BARS = [8, 16, 32, 64] as const

export type CueJumpBars = (typeof CUE_JUMP_BARS)[number]

export const DEFAULT_CUE_JUMP_BARS: CueJumpBars = 16

export function normalizeCueJumpBars(value: unknown): CueJumpBars {
  return CUE_JUMP_BARS.find((bars) => bars === value) ?? DEFAULT_CUE_JUMP_BARS
}
