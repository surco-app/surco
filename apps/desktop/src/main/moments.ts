import type { CopyReason, DjProgram } from '../shared/types'
import type { SessionBackup } from './rekordboxSessionBackup'

const PROGRAMS: DjProgram[] = ['rekordbox', 'traktor', 'engine']

export function createMoments(sessions: Record<DjProgram, SessionBackup>): {
  begin: (reason: CopyReason, programs?: DjProgram[]) => void
  beginLoose: (collectionPath: string) => void
  duringRunFlush: <T>(task: () => Promise<T>) => Promise<T>
} {
  return {
    begin: (reason, programs = PROGRAMS) => {
      for (const program of programs) sessions[program].begin(reason)
    },
    beginLoose: (collectionPath) => {
      for (const program of PROGRAMS) sessions[program].beginLoose(collectionPath)
    },
    duringRunFlush: async (task) => {
      for (const program of PROGRAMS) sessions[program].inRunFlush(true)
      try {
        return await task()
      } finally {
        for (const program of PROGRAMS) sessions[program].inRunFlush(false)
      }
    },
  }
}
