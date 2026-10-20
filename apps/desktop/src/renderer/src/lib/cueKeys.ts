import { HOT_KINDS } from '../../../shared/cueRules'

export type CueKey =
  | { type: 'play' }
  | { type: 'jump'; dir: 1 | -1 }
  | { type: 'beat'; dir: 1 | -1 }
  | { type: 'centre' }
  | { type: 'memory' }
  | { type: 'hot'; kind: number }
  | { type: 'remove' }
  | { type: 'undo' }
  | { type: 'zoom'; dir: 'in' | 'out' }
  | { type: 'swallow' }

const LIST_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']

export function cueKeyAction(e: {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}): CueKey | null {
  if (e.metaKey || e.ctrlKey)
    return !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z' ? { type: 'undo' } : null
  if (e.altKey) return null
  if (e.key === ' ') return { type: 'play' }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const dir = e.key === 'ArrowRight' ? 1 : -1
    return e.shiftKey ? { type: 'beat', dir } : { type: 'jump', dir }
  }
  if (e.key === 'Backspace' || e.key === 'Delete') return { type: 'remove' }
  if (e.key === '+' || e.key === '=') return { type: 'zoom', dir: 'in' }
  if (e.key === '-') return { type: 'zoom', dir: 'out' }
  const lower = e.key.toLowerCase()
  if (lower === 'c') return { type: 'centre' }
  if (lower === 'm') return { type: 'memory' }
  if (/^[1-8]$/.test(e.key)) return { type: 'hot', kind: HOT_KINDS[Number(e.key) - 1] }
  if (e.key.length === 1 || LIST_KEYS.includes(e.key)) return { type: 'swallow' }
  return null
}
