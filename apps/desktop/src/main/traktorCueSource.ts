import { realpathSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'
import { traktorKey } from '../shared/traktorContent'
import type { CueQueue, CueSource } from './cueSource'
import { CUE_WAVE_FINE_PER_SECOND } from './cueWaveFine'
import { shiftedWords } from './cueWords'
import { cachedGridVerdict } from './gridVerdictCache'
import { keyOf } from './rekordboxPlaylistsIpc'
import { type BeatGridOf, sameClockFit } from './sameClockGrid'
import { traktorTrackCuesOf } from './traktorCues'
import { traktorDropInput } from './traktorDropInput'
import { findEntries } from './traktorNml'
import { traktorFileOf } from './traktorPlaylists'
import { traktorLeadOfFile } from './traktorTimeline'

export function traktorCueSource(
  traktor: {
    nml: () => string
    bootVolume: () => string
    queue: CueQueue
    applyQuietly: (win: BrowserWindow | null) => void
    words: (file: string) => Promise<Uint16Array | null>
    fine?: (file: string) => Promise<Uint8Array | null>
  },
  collection: () => string,
  beatGrid: BeatGridOf,
): CueSource {
  let cached: {
    path: string
    mtimeMs: number
    size: number
    text: string
    blocks?: Map<string, string>
  } | null = null
  const collectionOf = async () => {
    const path = traktor.nml()
    if (!path) return null
    const { mtimeMs, size } = await stat(path)
    if (cached?.path === path && cached.mtimeMs === mtimeMs && cached.size === size) return cached
    cached = { path, mtimeMs, size, text: await readFile(path, 'utf8') }
    return cached
  }
  const nmlOf = async (): Promise<string> => (await collectionOf())?.text ?? ''
  const blockOf = async (contentId: string): Promise<string | null> => {
    const current = await collectionOf()
    const key = traktorKey(contentId)
    if (!current || key === null) return null
    if (!current.blocks) {
      const blocks = new Map<string, string>()
      for (const e of findEntries(current.text)) {
        const entryKey = `${e.volume}${e.dir}${e.file}`
        if (!blocks.has(entryKey)) blocks.set(entryKey, current.text.slice(e.start, e.end))
      }
      current.blocks = blocks
    }
    return current.blocks.get(key) ?? null
  }
  const fileOfBlock = (block: string | null) =>
    block ? traktorFileOf(block, traktor.bootVolume()) : null
  const traktorFile = async (contentId: string) => fileOfBlock(await blockOf(contentId))
  const leadOf = async (file: string | null): Promise<number | null> =>
    file ? traktorLeadOfFile(file) : null
  const shiftedWordsOf = async (file: string): Promise<Uint16Array | null> => {
    const words = await traktor.words(file)
    const lead = await leadOf(file)
    return words && lead ? shiftedWords(words, lead) : words
  }
  return {
    trackCues: async (contentId) => {
      const block = await blockOf(contentId)
      if (!block) return null
      const read = traktorTrackCuesOf(block, contentId)
      return { ...read, clockLeadMs: await leadOf(fileOfBlock(block)) }
    },
    waveDetail: async (contentId) => {
      const file = await traktorFile(contentId)
      return file ? shiftedWordsOf(file) : null
    },
    fineWave: async (contentId) => {
      const file = await traktorFile(contentId)
      const levels = file && traktor.fine ? await traktor.fine(file) : null
      if (!file || !levels) return null
      return {
        levels,
        perSecond: CUE_WAVE_FINE_PER_SECOND,
        startMs: (await leadOf(file)) ?? 0,
      }
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
      const block = await blockOf(contentId)
      const file = fileOfBlock(block)
      return cachedGridVerdict(
        file,
        block ? traktorTrackCuesOf(block, contentId).grid : undefined,
        async () => sameClockFit(file, beatGrid, 'low', await leadOf(file)),
      )
    },
    queuedWanted: async () => [],
    queue: traktor.queue,
    applyQuietly: traktor.applyQuietly,
  }
}
