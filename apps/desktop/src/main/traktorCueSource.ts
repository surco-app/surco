import { realpathSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
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
  let cached: { path: string; mtimeMs: number; size: number; text: string } | null = null
  const nmlOf = async (): Promise<string> => {
    const path = traktor.nml()
    if (!path) return ''
    const { mtimeMs, size } = await stat(path)
    if (cached?.path === path && cached.mtimeMs === mtimeMs && cached.size === size) {
      return cached.text
    }
    const text = await readFile(path, 'utf8')
    cached = { path, mtimeMs, size, text }
    return text
  }
  const traktorFileIn = (nml: string, contentId: string) => {
    const entry = traktorEntryBlock(nml, traktorKey(contentId) ?? '')
    return entry ? traktorFileOf(entry.block, traktor.bootVolume()) : null
  }
  const traktorFile = async (contentId: string) => traktorFileIn(await nmlOf(), contentId)
  const leadOf = async (file: string | null): Promise<number | null> =>
    file ? traktorLeadOfFile(file) : null
  const shiftedWordsOf = async (file: string): Promise<Uint16Array | null> => {
    const words = await traktor.words(file)
    const lead = await leadOf(file)
    return words && lead ? shiftedWords(words, lead) : words
  }
  return {
    trackCues: async (contentId) => {
      const nml = await nmlOf()
      const read = readTraktorTrackCues(nml, contentId)
      return read && { ...read, clockLeadMs: await leadOf(traktorFileIn(nml, contentId)) }
    },
    waveDetail: async (contentId) => {
      const file = await traktorFile(contentId)
      return file ? shiftedWordsOf(file) : null
    },
    dropInput: async (contentId) => {
      const path = collection()
      return traktorDropInput(contentId, {
        nml: await nmlOf(),
        bootVolume: traktor.bootVolume(),
        collection: path,
        key: path ? await keyOf(path) : undefined,
        realPath: (p) => realpathSync(p),
        words: shiftedWordsOf,
      })
    },
    auditionLead: async (contentId) => (await leadOf(await traktorFile(contentId))) ?? 0,
    surcoGrid: async () => null,
    gridFit: async (contentId) => {
      const file = await traktorFile(contentId)
      return sameClockFit(file, beatGrid, 'high', await leadOf(file))
    },
    gridVerdict: async (contentId) => {
      const nml = await nmlOf()
      const file = traktorFileIn(nml, contentId)
      return sameClockVerdict(
        readTraktorTrackCues(nml, contentId)?.grid,
        await sameClockFit(file, beatGrid, 'low', await leadOf(file)),
      )
    },
    queuedWanted: async () => [],
    queue: traktor.queue,
    applyQuietly: traktor.applyQuietly,
  }
}
