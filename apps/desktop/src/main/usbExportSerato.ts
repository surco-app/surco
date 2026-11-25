import { basename, extname } from 'node:path'
import type { SourceNode } from '../shared/types'
import { rekordboxShiftOfFileIfKnown } from './rekordboxTimeline'
import { seratoLeadOfFile } from './seratoClock'
import { seratoTrackCuesOf } from './seratoCueSource'
import { type SeratoLibrary, seratoTree } from './seratoLibrary'
import { readSeratoTrack } from './seratoTags'
import {
  type ExportMarks,
  foreignExportTrack,
  foreignMarks,
  foreignSelection,
  unixDate,
} from './usbExportForeign'
import type { ExportSelection } from './usbExportSource'

export interface SeratoMarks extends ExportMarks {
  lengthSec: number
  sampleRate: number
  trackNo: number
  cuesLeftOut?: boolean
}

export async function seratoExportMarks(file: string): Promise<SeratoMarks | null> {
  const track = readSeratoTrack(file)
  if (!track) return null
  const read = await seratoTrackCuesOf(`serato:${file}`, track)
  const lead = await seratoLeadOfFile(file, track.sampleRate)
  // The editor shows a cue Serato keeps inside the MP3 lead at 0, but rekordbox
  // adds a lead of its own on export, so the clamp would make it play late.
  const onSerato = new Map((track.markers?.cues ?? []).map((c) => [String(c.index), c.ms - lead]))
  const cues = read.cues.map((c) => ({ ...c, ms: onSerato.get(c.id) ?? c.ms }))
  const delta = await rekordboxShiftOfFileIfKnown(file, track.sampleRate)
  const facts = {
    lengthSec: Math.round(track.durationMs / 1000),
    sampleRate: track.sampleRate,
    trackNo: track.trackNo,
  }
  return { ...foreignMarks({ ...read, cues }, delta), ...facts }
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

export async function readSeratoExportSelection(
  library: SeratoLibrary,
  ids: string[],
  deps: { marks: (file: string) => Promise<SeratoMarks | null> },
): Promise<ExportSelection> {
  const picked = pickedCrates(library, new Set(ids))
  const rows = picked.map((p) => library.crates.get(p.node.id) ?? [])
  const known = new Map(library.tracks.map((t) => [t.file.normalize('NFC'), t]))
  return foreignSelection(
    picked,
    rows,
    (file) => file,
    async (id, file) => {
      const row = known.get(file.normalize('NFC'))
      const path = row?.file ?? file
      const marks = await deps.marks(path)
      return foreignExportTrack(id, path, {
        title: row ? row.title : basename(path, extname(path)),
        artist: row?.artist ?? '',
        album: row?.album ?? '',
        genre: row?.genre ?? '',
        key: row?.key ?? '',
        bpm: Number(row?.bpm) || 0,
        dateAdded: unixDate(row?.addedAt ?? null),
        lengthSec: marks?.lengthSec ?? 0,
        sampleRate: marks?.sampleRate ?? 0,
        trackNo: marks?.trackNo ?? 0,
        cues: marks?.cues ?? [],
        grid: marks?.grid ?? [],
        ...(marks?.cuesLeftOut && { cuesLeftOut: true }),
      })
    },
  )
}
