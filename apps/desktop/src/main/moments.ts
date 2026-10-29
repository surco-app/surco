import type { CopyReason } from '../shared/types'
import type { SessionBackup } from './rekordboxSessionBackup'

export function createMoments(sessions: SessionBackup[]): {
  begin: (reason: CopyReason) => void
  beginLoose: (collectionPath: string) => void
} {
  return {
    begin: (reason) => {
      for (const s of sessions) s.begin(reason)
    },
    beginLoose: (collectionPath) => {
      for (const s of sessions) s.beginLoose(collectionPath)
    },
  }
}
