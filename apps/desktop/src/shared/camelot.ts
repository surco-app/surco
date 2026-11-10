import { MAJOR_CAMELOT, MAJOR_NAMES, MINOR_CAMELOT, MINOR_NAMES } from './keyNames'
import type { KeyNotation } from './types'

const CAMELOT = /^0?([1-9]|1[0-2])([AB])$/i

export function camelotOf(key: string | undefined): string | null {
  const text = (key ?? '').trim()
  if (text === '') return null
  const direct = text.match(CAMELOT)
  if (direct) return `${direct[1]}${direct[2].toUpperCase()}`
  const major = MAJOR_NAMES.indexOf(text)
  if (major >= 0) return MAJOR_CAMELOT[major]
  const minor = MINOR_NAMES.indexOf(text)
  if (minor >= 0) return MINOR_CAMELOT[minor]
  return null
}

export function keyIn(key: string, notation: KeyNotation): string {
  const camelot = camelotOf(key)
  if (camelot === null) return key.trim()
  if (notation === 'camelot') return camelot
  const major = MAJOR_CAMELOT.indexOf(camelot)
  return major >= 0 ? MAJOR_NAMES[major] : MINOR_NAMES[MINOR_CAMELOT.indexOf(camelot)]
}

function parts(key: string): { n: number; letter: string } {
  return { n: Number.parseInt(key, 10), letter: key.slice(-1) }
}

export function camelotDistance(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null
  const x = parts(a)
  const y = parts(b)
  const gap = Math.abs(x.n - y.n)
  const steps = Math.min(gap, 12 - gap)
  const switched = x.letter === y.letter ? 0 : 1
  if (steps === 0 && switched === 0) return 0
  if (steps === 0 || (steps === 1 && switched === 0)) return 1
  return 2 + steps + switched
}
