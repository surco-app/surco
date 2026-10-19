import { HOT_KINDS } from '../../../shared/cueRules'
import { HOT_LETTER } from './cueWave'

const LETTERS = 'ABCDEFGH'

export function cueLetter(kind: number): string {
  const i = HOT_KINDS.indexOf(kind)
  return i >= 0 ? LETTERS[i] : (HOT_LETTER[kind] ?? '')
}
