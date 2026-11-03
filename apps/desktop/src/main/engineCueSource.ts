import { realpathSync } from 'node:fs'
import type { CueQueue, CueSource } from './cueSource'
import { readEngineTrackCues } from './engineCues'
import { engineDropInput } from './engineDropInput'
import { withEngineLibrary } from './enginePlaylistsIpc'
import { keyOf } from './rekordboxPlaylistsIpc'

export function engineCueSource(
  engine: {
    libraryDir: () => string
    queue: CueQueue
    applyQuietly: () => void
    words: (file: string) => Promise<Uint16Array | null>
  },
  collection: () => string,
): CueSource {
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
    gridFit: async () => null,
    gridVerdict: async () => null,
    queuedWanted: async () => [],
    queue: engine.queue,
    applyQuietly: engine.applyQuietly,
  }
}
