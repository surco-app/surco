import { recordedNmlPatch } from './nmlBatch'
import { recordedRekordboxRepoint } from './rekordboxBatch'
import type { VerifyEntry } from './verifyRegistry'

export function withRecordedRun(entry: VerifyEntry): VerifyEntry {
  const repoint = recordedRekordboxRepoint(entry.to)
  return {
    ...entry,
    traktorPatch: recordedNmlPatch(entry.source),
    cueShiftMs: repoint?.audio?.cueShiftMs,
    engineShift: repoint?.engineShift,
    fromBytes: repoint?.fromBytes,
    names: repoint?.names,
  }
}
