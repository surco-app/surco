import { realpathSync } from 'node:fs'
import { SAME_CLOCK_FILE } from '../shared/gridEdit'
import type { CueQueue, CueSource } from './cueSource'
import { engineDropInput } from './engineDropInput'
import { keyOf } from './rekordboxPlaylistsIpc'
import { type BeatGridOf, type GridAuditOf, sameClockAudit, sameClockFit } from './sameClockGrid'
import { readEngine } from './worker'

export function engineCueSource(
  engine: {
    libraryDir: () => string
    queue: CueQueue
    applyQuietly: () => void
    words: (file: string) => Promise<Uint16Array | null>
  },
  collection: () => string,
  beatGrid: BeatGridOf,
  gridAudit: GridAuditOf,
): CueSource {
  const engineFile = (contentId: string): Promise<string | null> =>
    readEngine(engine.libraryDir(), 'file', contentId)
  const leadOf = (file: string | null): number | null =>
    file && SAME_CLOCK_FILE.test(file) ? 0 : null
  return {
    trackCues: async (contentId) => {
      const read = await readEngine(engine.libraryDir(), 'trackCues', contentId)
      return read && { ...read, clockLeadMs: leadOf(await engineFile(contentId)) }
    },
    liveCues: (contentIds) => readEngine(engine.libraryDir(), 'liveCues', contentIds),
    waveDetail: async () => null,
    fineWave: async () => null,
    dropInput: async (contentId) => {
      const path = collection()
      return engineDropInput(contentId, {
        libraryDir: engine.libraryDir(),
        collection: path,
        key: await keyOf(path),
        realPath: (p) => realpathSync(p),
        words: engine.words,
      })
    },
    auditionLead: async () => 0,
    surcoGrid: async () => null,
    gridFit: async (contentId, priority) => {
      const file = await engineFile(contentId)
      return sameClockFit(file, beatGrid, priority, leadOf(file))
    },
    gridAudit: async (contentId, beats, priority) => {
      const file = await engineFile(contentId)
      return sameClockAudit(file, beats, gridAudit, priority, leadOf(file))
    },
    queuedWanted: async () => [],
    queue: engine.queue,
    applyQuietly: engine.applyQuietly,
  }
}
