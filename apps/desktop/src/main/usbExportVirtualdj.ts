import { basename, extname } from 'node:path'
import { File as TagFile } from 'node-taglib-sharp'
import { rekordboxShiftOfFileIfKnown } from './rekordboxTimeline'
import {
  type ExportMarks,
  type ForeignCue,
  foreignExportTrack,
  foreignSelection,
  marksOnRekordboxClock,
} from './usbExportForeign'
import { type ExportSelection, selectedPlaylists } from './usbExportSource'
import { virtualdjTrackCuesOf } from './virtualdjCueSource'
import type { VirtualdjSong } from './virtualdjDatabase'
import { type VirtualdjLibrary, virtualdjTree } from './virtualdjLibrary'
import type { VirtualdjNode } from './virtualdjLists'

const DEFAULT_SAMPLE_RATE = 44100

export interface VirtualdjClock {
  sampleRate: number
  delta: number | null
}

function sampleRateOf(file: string): number | null {
  try {
    const f = TagFile.createFromPath(file)
    try {
      return f.properties?.audioSampleRate || DEFAULT_SAMPLE_RATE
    } finally {
      f.dispose()
    }
  } catch {
    return null
  }
}

export async function virtualdjExportClock(file: string): Promise<VirtualdjClock | null> {
  const sampleRate = sampleRateOf(file)
  if (sampleRate === null) return null
  return { sampleRate, delta: await rekordboxShiftOfFileIfKnown(file, sampleRate) }
}

function marksOf(song: VirtualdjSong, delta: number | null): ExportMarks & { cuesLeftOut?: true } {
  const read = virtualdjTrackCuesOf(`virtualdj:${song.path}`, song)
  const cues: ForeignCue[] = [
    ...read.cues.map((c) => ({ ms: c.ms, kind: c.kind, name: c.name ?? '' })),
    ...(read.loops ?? []).map((l) => ({
      ms: l.startMs,
      kind: 0,
      name: l.name ?? '',
      endMs: l.endMs,
    })),
  ]
  if (delta === null)
    return {
      cues: [],
      grid: [],
      ...(cues.length + read.grid.length > 0 && { cuesLeftOut: true as const }),
    }
  return marksOnRekordboxClock(cues, read.grid, delta)
}

function listOf(nodes: VirtualdjNode[], id: string): VirtualdjNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    const inside = listOf(n.children ?? [], id)
    if (inside) return inside
  }
  return undefined
}

function virtualdjDate(firstSeen: number | null): string {
  return firstSeen === null ? '' : new Date(firstSeen * 1000).toISOString().slice(0, 10)
}

export async function readVirtualdjExportSelection(
  library: VirtualdjLibrary,
  ids: string[],
  deps: { clockOf: (file: string) => Promise<VirtualdjClock | null> },
): Promise<ExportSelection> {
  const picked = selectedPlaylists(virtualdjTree(library), new Set(ids))
  const rows = picked.map(({ node }) => listOf(library.lists, node.id)?.paths ?? [])
  const known = new Map<string, VirtualdjSong>()
  for (const s of library.songs) {
    const key = s.path.normalize('NFC')
    if (!known.has(key)) known.set(key, s)
  }
  return foreignSelection(
    picked,
    rows,
    (file) => file,
    async (id, file) => {
      const song = known.get(file.normalize('NFC'))
      const path = song?.path ?? file
      const clock = await deps.clockOf(path)
      const marks = song && clock ? marksOf(song, clock.delta) : { cues: [], grid: [] }
      return foreignExportTrack(id, path, {
        title: song ? song.title : basename(path, extname(path)),
        artist: song?.artist ?? '',
        album: song?.album ?? '',
        genre: song?.genre ?? '',
        key: song?.key ?? '',
        year: Number(song?.year) || 0,
        bpm: song?.secondsPerBeat ? 60 / song.secondsPerBeat : 0,
        dateAdded: virtualdjDate(song?.firstSeen ?? null),
        lengthSec: Math.round(song?.lengthSeconds ?? 0),
        sampleRate: clock?.sampleRate ?? 0,
        ...marks,
      })
    },
  )
}
