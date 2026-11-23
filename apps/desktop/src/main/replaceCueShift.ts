import type { ReplaceShift } from '../shared/replaceShift'
import type { CueShift } from './tags'

// shiftCueStart subtracts the shift, so a replacement whose audio starts `moved` ms later
// needs the negative. A shift that could not be trusted records nothing: a doubtful
// measurement must leave the cues untouched.
export function traktorReplaceShift(shift: ReplaceShift, codecMs: number): CueShift {
  if ('unmoved' in shift) return { shiftMs: 0 }
  return { shiftMs: -Math.round(shift.moved) - codecMs }
}
