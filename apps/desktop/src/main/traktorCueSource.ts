import { readFileSync, realpathSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { traktorKey } from '../shared/traktorContent'
import type { CueQueue, CueSource } from './cueSource'
import { shiftedWords } from './cueWords'
import { keyOf } from './rekordboxPlaylistsIpc'
import { type BeatGridOf, sameClockFit, sameClockVerdict } from './sameClockGrid'
import { readTraktorTrackCues, traktorEntryBlock } from './traktorCues'
import { traktorDropInput } from './traktorDropInput'
import { traktorFileOf } from './traktorPlaylists'
import { traktorLeadOfFile } from './traktorTimeline'

export function traktorCueSource(
  traktor: {
    nml: () => string
    bootVolume: () => string
    queue: CueQueue
    applyQuietly: (win: BrowserWindow | null) => void
    words: (file: string) => Promise<Uint16Array | null>
  },
  collection: () => string,
  beatGrid: BeatGridOf,
): CueSource {
  const nmlOf = (): string => {
    const path = traktor.nml()
    return path ? readFileSync(path, 'utf8') : ''
  }
  const traktorFile = (contentId: string) => {
    const entry = traktorEntryBlock(nmlOf(), traktorKey(contentId) ?? '')
    return entry ? traktorFileOf(entry.block, traktor.bootVolume()) : null
  }
  const leadOf = async (file: string | null): Promise<number | null> =>
    file ? traktorLeadOfFile(file) : null
  const shiftedWordsOf = async (file: string): Promise<Uint16Array | null> => {
    const words = await traktor.words(file)
    const lead = await leadOf(file)
    return words && lead ? shiftedWords(words, lead) : words
  }
  return {
    trackCues: async (contentId) => {
      const read = readTraktorTrackCues(nmlOf(), contentId)
      return read && { ...read, clockLeadMs: await leadOf(traktorFile(contentId)) }
    },
    waveDetail: async (contentId) => {
      const file = traktorFile(contentId)
      return file ? shiftedWordsOf(file) : null
    },
    dropInput: async (contentId) => {
      const path = collection()
      return traktorDropInput(contentId, {
        nml: nmlOf(),
        bootVolume: traktor.bootVolume(),
        collection: path,
        key: path ? await keyOf(path) : undefined,
        realPath: (p) => realpathSync(p),
        words: shiftedWordsOf,
      })
    },
    auditionLead: async (contentId) => (await leadOf(traktorFile(contentId))) ?? 0,
    surcoGrid: async () => null,
    gridFit: async (contentId) => {
      const file = traktorFile(contentId)
      return sameClockFit(file, beatGrid, 'high', await leadOf(file))
    },
    gridVerdict: async (contentId) =>
      sameClockVerdict(
        readTraktorTrackCues(nmlOf(), contentId)?.grid,
        await sameClockFit(
          traktorFile(contentId),
          beatGrid,
          'low',
          await leadOf(traktorFile(contentId)),
        ),
      ),
    queuedWanted: async () => [],
    queue: traktor.queue,
    applyQuietly: traktor.applyQuietly,
  }
}
