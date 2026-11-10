import { ENHARMONIC, MAJOR_CAMELOT, MAJOR_NAMES, MINOR_CAMELOT, MINOR_NAMES } from './keyNames'
import type { KeyNotation } from './types'

const CAMELOT = /^0?([1-9]|1[0-2])([AB])$/i

const BY_NAME = new Map<string, string>()
for (const [names, camelot, suffix] of [
  [MAJOR_NAMES, MAJOR_CAMELOT, ''],
  [MINOR_NAMES, MINOR_CAMELOT, 'm'],
] as const) {
  names.forEach((name, pitch) => {
    BY_NAME.set(name.toLowerCase(), camelot[pitch])
    for (const spelling of ENHARMONIC[pitch] ?? []) {
      BY_NAME.set(`${spelling}${suffix}`.toLowerCase(), camelot[pitch])
    }
  })
}

export function camelotOf(key: string | undefined): string | null {
  const text = (key ?? '').trim()
  if (text === '') return null
  const direct = text.match(CAMELOT)
  if (direct) return `${direct[1]}${direct[2].toUpperCase()}`
  return BY_NAME.get(text.toLowerCase()) ?? null
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
