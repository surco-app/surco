import { realpathSync } from 'node:fs'
import { HOT_KINDS } from '../shared/cueRules'
import { gridFingerprint } from '../shared/gridEdit'
import { nearestHotCueColor } from '../shared/rekordboxCueColors'
import type { TrackCueRow, TrackCues } from '../shared/types'
import { virtualdjFileOf } from '../shared/virtualdjContent'
import { provisionalGrid } from './beatGrid'
import type { CueQueue, CueSource } from './cueSource'
import { CUE_WAVE_FINE_PER_SECOND } from './cueWaveFine'
import { rekordboxInput } from './engineDropInput'
import { cueFingerprint } from './rekordboxCues'
import { keyOf } from './rekordboxPlaylistsIpc'
import type { BeatGridOf } from './sameClockGrid'
import { tempoGrid } from './seratoCueSource'
import type { VirtualdjSong } from './virtualdjDatabase'
import { readVirtualdjSongs, type VirtualdjRoot } from './virtualdjLibrary'
import { virtualdjPathKey } from './virtualdjPaths'

export function virtualdjCueRows(song: VirtualdjSong): TrackCueRow[] {
  return song.pois.flatMap((p) =>
    p.kind === 'cue' && p.num !== null && p.num >= 1 && p.num <= HOT_KINDS.length
      ? [
          {
            id: String(p.num),
            ms: p.seconds * 1000,
            kind: HOT_KINDS[p.num - 1],
            color: p.color === undefined ? null : nearestHotCueColor(p.color),
            ...(p.name && { name: p.name }),
          },
        ]
      : [],
  )
}

function loops(song: VirtualdjSong): NonNullable<TrackCues['loops']> {
  const secondsPerBeat = song.secondsPerBeat
  if (secondsPerBeat === null) return []
  return song.pois.flatMap((p, i) =>
    p.kind === 'loop' && p.sizeBeats !== undefined
      ? [
          {
            id: p.slot === undefined ? `i-${i}` : `slot-${p.slot}`,
            startMs: p.seconds * 1000,
            endMs: (p.seconds + p.sizeBeats * secondsPerBeat) * 1000,
            ...(p.name && { name: p.name }),
          },
        ]
      : [],
  )
}

export function virtualdjTrackCuesOf(contentId: string, song: VirtualdjSong): TrackCues {
  const durationMs = (song.lengthSeconds ?? 0) * 1000
  const { secondsPerBeat, phaseSeconds } = song
  const analysed = secondsPerBeat !== null && phaseSeconds !== null
  const grid = analysed
    ? tempoGrid({ firstBeatMs: phaseSeconds * 1000, bpm: 60 / secondsPerBeat }, 0, durationMs)
    : []
  const cues = virtualdjCueRows(song)
  return {
    contentId,
    analysed,
    grid,
    gridFingerprint: gridFingerprint(grid),
    strong: [],
    phrases: [],
    cues,
    loops: loops(song),
    wave: null,
    durationMs,
    fingerprint: cueFingerprint(cues),
  }
}

export function virtualdjCueSource(
  host: {
    roots: () => VirtualdjRoot[]
    words: (file: string) => Promise<Uint16Array | null>
    fine?: (file: string) => Promise<Uint8Array | null>
    beatGrid: BeatGridOf
    queue: CueQueue
    applyQuietly: CueSource['applyQuietly']
  },
  collection: () => string,
): CueSource {
  const byPath = new WeakMap<VirtualdjSong[], Map<string, VirtualdjSong>>()
  const songOf = (contentId: string) => {
    const songs = readVirtualdjSongs(host.roots())
    let paths = byPath.get(songs)
    if (!paths) {
      paths = new Map()
      for (const s of songs)
        if (!paths.has(virtualdjPathKey(s.path))) paths.set(virtualdjPathKey(s.path), s)
      byPath.set(songs, paths)
    }
    return paths.get(virtualdjPathKey(virtualdjFileOf(contentId)))
  }
  const source: CueSource = {
    trackCues: async (contentId) => {
      const song = songOf(contentId)
      return song ? virtualdjTrackCuesOf(contentId, song) : null
    },
    waveDetail: async (contentId) => host.words(virtualdjFileOf(contentId)),
    fineWave: async (contentId) => {
      const levels = host.fine ? await host.fine(virtualdjFileOf(contentId)) : null
      return levels ? { levels, perSecond: CUE_WAVE_FINE_PER_SECOND, startMs: 0 } : null
    },
    dropInput: async (contentId) => {
      const read = await source.trackCues(contentId)
      if (!read?.analysed) return null
      const file = virtualdjFileOf(contentId)
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
    surcoGrid: async (contentId) => {
      const song = songOf(contentId)
      if (!song) return null
      const file = virtualdjFileOf(contentId)
      const fit = await host.beatGrid(file)
      if (!fit) return null
      return {
        bpm: fit.bpm,
        grid: provisionalGrid(fit, 0, (song.lengthSeconds ?? 0) * 1000),
        words: await host.words(file),
      }
    },
    gridFit: async () => null,
    queuedWanted: async () => [],
    queue: host.queue,
    applyQuietly: host.applyQuietly,
  }
  return source
}
