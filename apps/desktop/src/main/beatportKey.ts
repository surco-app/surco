import type { KeyNotation } from '../shared/types'
import { MAJOR_CAMELOT, MAJOR_NAMES, MINOR_CAMELOT, MINOR_NAMES } from './musicalKey'

const PITCH: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
}

export function beatportKey(name: string | undefined, notation: KeyNotation): string {
  const m = name?.trim().match(/^([A-G][#b]?)\s+(Major|Minor)$/)
  const pc = m ? PITCH[m[1]] : undefined
  if (!m || pc === undefined) return ''
  const minor = m[2] === 'Minor'
  if (notation === 'camelot') return (minor ? MINOR_CAMELOT : MAJOR_CAMELOT)[pc]
  return (minor ? MINOR_NAMES : MAJOR_NAMES)[pc]
}
