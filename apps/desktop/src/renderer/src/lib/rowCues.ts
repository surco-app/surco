import { HOT_KINDS } from '../../../shared/cueRules'

const LETTERS = 'ABCDEFGH'

export function cueLetter(kind: number): string {
  const i = HOT_KINDS.indexOf(kind)
  return i >= 0 ? LETTERS[i] : ''
}
