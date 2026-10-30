import type { ProgramCopies } from '../../../shared/types'

export const COPIES_KEEP = 5

export type ProgramState = 'halted' | 'failed' | 'pending' | 'untouched' | 'ok'

export function programState(p: ProgramCopies): ProgramState {
  if (p.halted) return 'halted'
  if (p.copyFailed) return 'failed'
  if (p.pending > 0) return 'pending'
  if (p.untouched) return 'untouched'
  return 'ok'
}

export function railAlert(list: ProgramCopies[]): 'none' | 'warn' | 'danger' {
  const states = list.map(programState)
  if (states.some((s) => s === 'halted' || s === 'failed')) return 'danger'
  if (states.includes('pending')) return 'warn'
  return 'none'
}
