import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { engineTrackId } from '../shared/engineContent'
import type { CueQueue, CueSource } from './cueSource'
import { readEngineTrackCues } from './engineCues'
import { engineDropInput } from './engineDropInput'
import { withEngineLibrary } from './enginePlaylistsIpc'
import { keyOf } from './rekordboxPlaylistsIpc'
import { type BeatGridOf, sameClockFit, sameClockVerdict } from './sameClockGrid'

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
  return {
    trackCues: async (contentId) =>
      withEngineLibrary(engine.libraryDir(), (db) => readEngineTrackCues(db, contentId), null),
    waveDetail: async () => null,
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
    gridFit: async (contentId) => sameClockFit(engineFile(contentId), beatGrid),
    gridVerdict: async (contentId) =>
      sameClockVerdict(
        withEngineLibrary(
          engine.libraryDir(),
          (db) => readEngineTrackCues(db, contentId, { wave: false }),
          null,
        )?.grid,
        await sameClockFit(engineFile(contentId), beatGrid, 'low'),
      ),
    queuedWanted: async () => [],
    queue: engine.queue,
    applyQuietly: engine.applyQuietly,
  }
}
