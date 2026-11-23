import type { DjProgram } from './djProgram'
import type { ReplaceShift } from './replaceShift'

export const TO_REVIEW_ID = 'surco:to-review'

export interface ReplacedEntry {
  newPath: string
  oldPath: string
  // Where the new file was before a later conversion moved it (see followReplaced): a
  // program whose repoint waits in its queue still shows one of these.
  formerPaths?: string[]
  replacedAt: number
  shift: ReplaceShift
  pending: DjProgram[]
}
