import { rekordboxShiftOfFile } from './rekordboxTimeline'
import { traktorCueElements, traktorGridOf, traktorHotKind } from './traktorCues'
import { attr, findEntries } from './traktorNml'
import { nodeById, parsePlaylists } from './traktorPlaylistModel'
import { readTraktorTree, traktorFileOf } from './traktorPlaylists'
import { traktorLeadOfFile } from './traktorTimeline'
import {
  exportTrackIds,
  type ForeignCue,
  foreignExportTrack,
  marksOnRekordboxClock,
} from './usbExportForeign'
import {
  type ExportPlaylist,
  type ExportSelection,
  type ExportTrack,
  selectedPlaylists,
} from './usbExportSource'

const GRID_TYPE = 4
const LOOP_TYPE = 5
const EMPTY_NAME = 'n.n.'
const RATING_STEP = 51
const UNSTORED_SAMPLE_RATE = 44100

export async function traktorExportDelta(file: string): Promise<number | null> {
  const lead = await traktorLeadOfFile(file)
  if (lead === null) return null
  return (await rekordboxShiftOfFile(file, UNSTORED_SAMPLE_RATE)) - lead
}

function cuesOf(block: string): ForeignCue[] {
  return traktorCueElements(block).flatMap(({ element }): ForeignCue[] => {
    const type = Number(attr(element, 'TYPE'))
    if (type === GRID_TYPE) return []
    const ms = Number(attr(element, 'START'))
    const len = Number(attr(element, 'LEN'))
    const name = attr(element, 'NAME')
    return [
      {
        ms,
        kind: traktorHotKind(Number(attr(element, 'HOTCUE') || '-1')) ?? 0,
        name: name === EMPTY_NAME ? '' : name,
        ...(type === LOOP_TYPE && len > 0 && { endMs: ms + len }),
      },
    ]
  })
}

function dateOf(imported: string): string {
  const [y, m, d] = imported.split('/')
  return y && m && d ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : ''
}

async function trackOf(
  id: string,
  path: string,
  block: string,
  deltaOf: (file: string) => Promise<number | null>,
): Promise<ExportTrack> {
  const head = block.match(/<ENTRY\b[^>]*>/)?.[0] ?? ''
  const info = block.match(/<INFO\b[^>]*>/)?.[0] ?? ''
  const album = block.match(/<ALBUM\b[^>]*>/)?.[0] ?? ''
  const tempo = block.match(/<TEMPO\b[^>]*>/)?.[0] ?? ''
  const durationMs = (Number(attr(info, 'PLAYTIME_FLOAT') || attr(info, 'PLAYTIME')) || 0) * 1000
  const cues = cuesOf(block)
  const grid = traktorGridOf(block, durationMs)
  const delta = await deltaOf(path)
  const marks = delta === null ? { cues: [], grid: [] } : marksOnRekordboxClock(cues, grid, delta)
  const leftOut = delta === null && (cues.length > 0 || grid.length > 0)
  return foreignExportTrack(id, path, {
    title: attr(head, 'TITLE'),
    artist: attr(head, 'ARTIST'),
    album: attr(album, 'TITLE'),
    trackNo: Number(attr(album, 'TRACK')) || 0,
    genre: attr(info, 'GENRE'),
    label: attr(info, 'LABEL'),
    comment: attr(info, 'COMMENT'),
    key: attr(info, 'KEY'),
    remixer: attr(info, 'REMIXER'),
    mix: attr(info, 'MIX'),
    playCount: Number(attr(info, 'PLAYCOUNT')) || 0,
    lengthSec: Number(attr(info, 'PLAYTIME')) || 0,
    bitRate: Math.round((Number(attr(info, 'BITRATE')) || 0) / 1000),
    rating: Math.round((Number(attr(info, 'RANKING')) || 0) / RATING_STEP),
    year: Number(attr(info, 'RELEASE_DATE').split('/')[0]) || 0,
    dateAdded: dateOf(attr(info, 'IMPORT_DATE')),
    bpm: Number(attr(tempo, 'BPM')) || 0,
    cues: marks.cues,
    grid: marks.grid,
    ...(leftOut && { cuesLeftOut: true }),
  })
}

export async function readTraktorExportSelection(
  nml: string,
  ids: string[],
  deps: { bootVolume: string; deltaOf: (file: string) => Promise<number | null> },
): Promise<ExportSelection> {
  const picked = selectedPlaylists(readTraktorTree(nml), new Set(ids))
  const model = parsePlaylists(nml)
  const entries = new Map<string, { path: string; block: string }>()
  for (const e of findEntries(nml)) {
    const block = nml.slice(e.start, e.end)
    entries.set(`${e.volume}${e.dir}${e.file}`, {
      path: traktorFileOf(block, deps.bootVolume),
      block,
    })
  }
  const rows = picked.map(({ node }) =>
    (nodeById(model, node.id)?.rows ?? []).flatMap((row) => entries.get(row.key) ?? []),
  )
  const trackIds = exportTrackIds(rows.flat().map((r) => r.path))
  const tracks = new Map<string, ExportTrack>()
  for (const { path, block } of rows.flat()) {
    const key = path.normalize('NFC')
    if (tracks.has(key)) continue
    tracks.set(key, await trackOf(trackIds.get(key) ?? '', path, block, deps.deltaOf))
  }
  const playlists: ExportPlaylist[] = picked.map(({ node, folders, folderIds }, i) => ({
    id: node.id,
    name: node.name,
    folders,
    folderIds,
    updatedAt: 0,
    trackIds: rows[i].map((r) => trackIds.get(r.path.normalize('NFC')) ?? ''),
  }))
  return { playlists, tracks: [...tracks.values()] }
}
