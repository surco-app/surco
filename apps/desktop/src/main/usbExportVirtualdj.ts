import { existsSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { File as TagFile } from 'node-taglib-sharp'
import { rekordboxShiftOfFileIfKnown } from './rekordboxTimeline'
import { foreignExportTrack, foreignMarks, foreignSelection, unixDate } from './usbExportForeign'
import { type ExportSelection, selectedPlaylists } from './usbExportSource'
import { virtualdjTrackCuesOf } from './virtualdjCueSource'
import {
  type VirtualdjLibrary,
  virtualdjListOf,
  virtualdjSongsByPath,
  virtualdjTree,
} from './virtualdjLibrary'
import { virtualdjPathKey } from './virtualdjPaths'

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
  if (!existsSync(file)) return null
  const sampleRate = sampleRateOf(file)
  if (sampleRate === null) return { sampleRate: 0, delta: null }
  return { sampleRate, delta: await rekordboxShiftOfFileIfKnown(file, sampleRate) }
}

export async function readVirtualdjExportSelection(
  library: VirtualdjLibrary,
  ids: string[],
  deps: { clockOf: (file: string) => Promise<VirtualdjClock | null> },
): Promise<ExportSelection> {
  const picked = selectedPlaylists(virtualdjTree(library), new Set(ids))
  const rows = picked.map(({ node }) => virtualdjListOf(library, node.id)?.paths ?? [])
  const known = virtualdjSongsByPath(library.songs)
  return foreignSelection(
    picked,
    rows,
    (file) => file,
    async (id, file) => {
      const song = known.get(virtualdjPathKey(file))
      const path = song?.path ?? file
      const clock = await deps.clockOf(path)
      const marks =
        song && clock
          ? foreignMarks(virtualdjTrackCuesOf(`virtualdj:${song.path}`, song), clock.delta)
          : { cues: [], grid: [] }
      return foreignExportTrack(id, path, {
        title: song ? song.title : basename(path, extname(path)),
        artist: song?.artist ?? '',
        album: song?.album ?? '',
        genre: song?.genre ?? '',
        key: song?.key ?? '',
        year: Number(song?.year) || 0,
        trackNo: Number.parseInt(song?.trackNumber ?? '', 10) || 0,
        bpm: song?.secondsPerBeat ? 60 / song.secondsPerBeat : 0,
        dateAdded: unixDate(song?.firstSeen ?? null),
        lengthSec: Math.round(song?.lengthSeconds ?? 0),
        sampleRate: clock?.sampleRate ?? 0,
        ...marks,
      })
    },
  )
}
