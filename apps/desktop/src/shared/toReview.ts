import type { DjProgram } from './djProgram'
import type { ReplaceShift } from './replaceShift'

export const TO_REVIEW_ID = 'surco:to-review'

export interface ReplacedEntry {
  newPath: string
  oldPath: string
  replacedAt: number
  shift: ReplaceShift
  pending: DjProgram[]
}
