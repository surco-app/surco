import { readFileSync, realpathSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { traktorKey } from '../shared/traktorContent'
import type { CueQueue, CueSource } from './cueSource'
import { keyOf } from './rekordboxPlaylistsIpc'
import { readTraktorTrackCues, traktorEntryBlock } from './traktorCues'
import { traktorDropInput } from './traktorDropInput'
import { traktorFileOf } from './traktorPlaylists'

export function traktorCueSource(
  traktor: {
    nml: () => string
    bootVolume: () => string
    queue: CueQueue
    applyQuietly: (win: BrowserWindow | null) => void
    words: (file: string) => Promise<Uint16Array | null>
  },
  collection: () => string,
): CueSource {
  const nmlOf = (): string => {
    const path = traktor.nml()
    return path ? readFileSync(path, 'utf8') : ''
  }
  const traktorFile = (contentId: string) => {
    const entry = traktorEntryBlock(nmlOf(), traktorKey(contentId) ?? '')
    return entry ? traktorFileOf(entry.block, traktor.bootVolume()) : null
  }
  return {
    trackCues: async (contentId) => readTraktorTrackCues(nmlOf(), contentId),
    waveDetail: async (contentId) => {
      const file = traktorFile(contentId)
      return file ? traktor.words(file) : null
    },
    dropInput: async (contentId) => {
      const path = collection()
      return traktorDropInput(contentId, {
        nml: nmlOf(),
        bootVolume: traktor.bootVolume(),
        collection: path,
        key: path ? await keyOf(path) : undefined,
        realPath: (p) => realpathSync(p),
        words: traktor.words,
      })
    },
    auditionLead: async () => 0,
    surcoGrid: async () => null,
    gridFit: async () => null,
    queuedWanted: async () => [],
    queue: traktor.queue,
    applyQuietly: traktor.applyQuietly,
  }
}
