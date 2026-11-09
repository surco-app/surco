import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { engineTrackId } from '../shared/engineContent'
import { SAME_CLOCK_FILE } from '../shared/gridEdit'
import type { CueQueue, CueSource } from './cueSource'
import { readEngineTrackCues } from './engineCues'
import { engineDropInput } from './engineDropInput'
import { withEngineLibrary } from './enginePlaylistsIpc'
import { cachedGridVerdict } from './gridVerdictCache'
import { keyOf } from './rekordboxPlaylistsIpc'
import { type BeatGridOf, sameClockFit } from './sameClockGrid'

export function engineCueSource(
  engine: {
    libraryDir: () => string
    queue: CueQueue
    applyQuietly: () => void
    words: (file: string) => Promise<Uint16Array | null>
  },
  collection: () => string,
  beatGrid: BeatGridOf,
): CueSource {
  const engineFile = (contentId: string): string | null => {
    const id = engineTrackId(contentId)
    const dir = engine.libraryDir()
    if (id === null) return null
    const path = withEngineLibrary(
      dir,
      (db) =>
        (
          db.prepare('SELECT path FROM Track WHERE id = ?').get(id) as
            | { path: string | null }
            | undefined
        )?.path ?? null,
      null,
    )
    return path ? resolve(dir, path) : null
  }
  const leadOf = (file: string | null): number | null =>
    file && SAME_CLOCK_FILE.test(file) ? 0 : null
  return {
    trackCues: async (contentId) => {
      const read = withEngineLibrary(
        engine.libraryDir(),
        (db) => readEngineTrackCues(db, contentId),
        null,
      )
      return read && { ...read, clockLeadMs: leadOf(engineFile(contentId)) }
    },
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
    gridFit: async (contentId) => {
      const file = engineFile(contentId)
      return sameClockFit(file, beatGrid, 'high', leadOf(file))
    },
    gridVerdict: async (contentId) =>
      cachedGridVerdict(
        engineFile(contentId),
        withEngineLibrary(
          engine.libraryDir(),
          (db) => readEngineTrackCues(db, contentId, { wave: false }),
          null,
        )?.grid,
        () => sameClockFit(engineFile(contentId), beatGrid, 'low', leadOf(engineFile(contentId))),
      ),
    queuedWanted: async () => [],
    queue: engine.queue,
    applyQuietly: engine.applyQuietly,
  }
}
