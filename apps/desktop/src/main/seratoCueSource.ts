import { realpathSync } from 'node:fs'
import { seratoFileOf } from '../shared/seratoContent'
import type { LiveCues, TrackCues } from '../shared/types'
import type { CueQueue, CueSource } from './cueSource'
import { CUE_WAVE_FINE_PER_SECOND } from './cueWaveFine'
import { rekordboxInput } from './engineDropInput'
import { keyOf } from './rekordboxPlaylistsIpc'
import { runInWorker } from './worker'

export { seratoCueRows, seratoTrackCuesOf, tempoGrid } from './seratoCues'

const LIVE_CUES_CHUNK = 50

const trackCuesOf = (contentIds: string[]): Promise<Record<string, TrackCues | null>> =>
  runInWorker<Record<string, TrackCues | null>>({ type: 'seratoTrackCues', contentIds })

export function seratoCueSource(
  host: {
    words: (file: string) => Promise<Uint16Array | null>
    fine?: (file: string) => Promise<Uint8Array | null>
    queue: CueQueue
    applyQuietly: () => void
  },
  collection: () => string,
): CueSource {
  const source: CueSource = {
    trackCues: async (contentId) => (await trackCuesOf([contentId]))[contentId] ?? null,
    liveCues: async (contentIds) => {
      const chunks: string[][] = []
      for (let i = 0; i < contentIds.length; i += LIVE_CUES_CHUNK)
        chunks.push(contentIds.slice(i, i + LIVE_CUES_CHUNK))
      const out: Record<string, LiveCues> = {}
      for (const reads of await Promise.all(chunks.map(trackCuesOf)))
        for (const [contentId, read] of Object.entries(reads))
          if (read) out[contentId] = { cues: read.cues, fingerprint: read.fingerprint }
      return out
    },
    waveDetail: async (contentId) => host.words(seratoFileOf(contentId)),
    fineWave: async (contentId) => {
      const levels = host.fine ? await host.fine(seratoFileOf(contentId)) : null
      return levels ? { levels, perSecond: CUE_WAVE_FINE_PER_SECOND, startMs: 0 } : null
    },
    dropInput: async (contentId) => {
      const read = await source.trackCues(contentId)
      if (!read?.analysed) return null
      const file = seratoFileOf(contentId)
      const path = collection()
      const fromRekordbox = rekordboxInput(file, {
        collection: path,
        key: path ? await keyOf(path) : undefined,
        realPath: (p) => realpathSync(p),
      })
      if (fromRekordbox) return fromRekordbox
      const words = await host.words(file)
      return words ? { grid: read.grid, phrases: [], words } : null
    },
    auditionLead: async () => 0,
    surcoGrid: async () => null,
    gridFit: async () => null,
    gridAudit: async () => null,
    queuedWanted: async () => [],
    queue: host.queue,
    applyQuietly: host.applyQuietly,
  }
  return source
}
