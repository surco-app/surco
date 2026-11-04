import { basename, extname } from 'node:path'
import type { SourceNode } from '../shared/types'
import { rekordboxShiftOfFile } from './rekordboxTimeline'
import { seratoTrackCuesOf } from './seratoCueSource'
import { type SeratoLibrary, seratoTree } from './seratoLibrary'
import { readSeratoTrack } from './seratoTags'
import {
  type ExportMarks,
  exportTrackIds,
  foreignExportTrack,
  marksOnRekordboxClock,
} from './usbExportForeign'
import type { ExportPlaylist, ExportSelection, ExportTrack } from './usbExportSource'

export interface SeratoMarks extends ExportMarks {
  lengthSec: number
  sampleRate: number
}

export async function seratoExportMarks(file: string): Promise<SeratoMarks | null> {
  const track = readSeratoTrack(file)
  if (!track) return null
  const read = await seratoTrackCuesOf(`serato:${file}`, track)
  const cues = [
    ...read.cues.map((c) => ({ ms: c.ms, kind: c.kind, name: c.name ?? '' })),
    ...(read.loops ?? []).map((l) => ({
      ms: l.startMs,
      kind: 0,
      name: l.name ?? '',
      endMs: l.endMs,
    })),
  ]
  const delta = await rekordboxShiftOfFile(file, track.sampleRate)
  return {
    ...marksOnRekordboxClock(cues, read.grid, delta),
    lengthSec: Math.round(track.durationMs / 1000),
    sampleRate: track.sampleRate,
  }
}

interface PickedCrate {
  node: SourceNode
  folders: string[]
  folderIds: string[]
}

function pickedCrates(library: SeratoLibrary, ids: ReadonlySet<string>): PickedCrate[] {
  const out: PickedCrate[] = []
  const walk = (
    nodes: SourceNode[],
    folders: string[],
    folderIds: string[],
    inside: boolean,
  ): void => {
    for (const n of nodes) {
      const on = inside || ids.has(n.id)
      if (!n.children) {
        if (on) out.push({ node: n, folders, folderIds })
        continue
      }
      const within = [...folders, n.name]
      const withinIds = [...folderIds, n.id]
      if (n.kind === 'playlist' && on && (library.crates.get(n.id) ?? []).length > 0)
        out.push({ node: n, folders: within, folderIds: withinIds })
      walk(n.children, within, withinIds, n.kind === 'folder' ? on : inside)
    }
  }
  walk(seratoTree(library), [], [], false)
  return out
}

function dateOf(addedAt: number | null): string {
  return addedAt === null ? '' : new Date(addedAt * 1000).toISOString().slice(0, 10)
}

export async function readSeratoExportSelection(
  library: SeratoLibrary,
  ids: string[],
  deps: { marks: (file: string) => Promise<SeratoMarks | null> },
): Promise<ExportSelection> {
  const picked = pickedCrates(library, new Set(ids))
  const rows = picked.map((p) => library.crates.get(p.node.id) ?? [])
  const trackIds = exportTrackIds(rows.flat())
  const known = new Map(library.tracks.map((t) => [t.file.normalize('NFC'), t]))
  const tracks = new Map<string, ExportTrack>()
  for (const file of rows.flat()) {
    const key = file.normalize('NFC')
    if (tracks.has(key)) continue
    const row = known.get(key)
    const path = row?.file ?? file
    const marks = await deps.marks(path)
    tracks.set(
      key,
      foreignExportTrack(trackIds.get(key) ?? '', path, {
        title: row ? row.title : basename(path, extname(path)),
        artist: row?.artist ?? '',
        album: row?.album ?? '',
        genre: row?.genre ?? '',
        key: row?.key ?? '',
        bpm: Number(row?.bpm) || 0,
        dateAdded: dateOf(row?.addedAt ?? null),
        lengthSec: marks?.lengthSec ?? 0,
        sampleRate: marks?.sampleRate ?? 0,
        cues: marks?.cues ?? [],
        grid: marks?.grid ?? [],
      }),
    )
  }
  const playlists: ExportPlaylist[] = picked.map(({ node, folders, folderIds }, i) => ({
    id: node.id,
    name: node.name,
    folders,
    folderIds,
    updatedAt: 0,
    trackIds: rows[i].map((file) => trackIds.get(file.normalize('NFC')) ?? ''),
  }))
  return { playlists, tracks: [...tracks.values()] }
}
