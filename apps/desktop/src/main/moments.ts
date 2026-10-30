import type { CopyReason, DjProgram } from '../shared/types'
import type { SessionBackup } from './rekordboxSessionBackup'

const PROGRAMS: DjProgram[] = ['rekordbox', 'traktor', 'engine']

type Serial = <T>(task: () => Promise<T>) => Promise<T>

export function createMoments(sessions: Record<DjProgram, SessionBackup>): {
  begin: (reason: CopyReason, programs?: DjProgram[]) => void
  beginLoose: (collectionPath: string) => void
  duringRunFlush: <T>(task: () => Promise<T>) => Promise<T>
  runFlush: <T>(
    serial: Serial,
    batchOpen: () => boolean,
    flush: (later: Serial) => Promise<T>,
  ) => Promise<T>
} {
  const duringRunFlush = async <T>(task: () => Promise<T>): Promise<T> => {
    for (const program of PROGRAMS) sessions[program].inRunFlush(true)
    try {
      return await task()
    } finally {
      for (const program of PROGRAMS) sessions[program].inRunFlush(false)
    }
  }
  return {
    begin: (reason, programs = PROGRAMS) => {
      for (const program of programs) sessions[program].begin(reason)
    },
    beginLoose: (collectionPath) => {
      for (const program of PROGRAMS) sessions[program].beginLoose(collectionPath)
    },
    duringRunFlush,
    runFlush: (serial, batchOpen, flush) =>
      serial(async () => {
        try {
          return await duringRunFlush(() => flush((task) => serial(() => duringRunFlush(task))))
        } finally {
          void serial(async () => {
            if (batchOpen()) return
            for (const program of PROGRAMS) sessions[program].endRun()
          })
        }
      }),
  }
}
