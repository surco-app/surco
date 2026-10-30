import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import type { EngineQuickCue } from '../../main/engineBlobs'
import { analysedTrack } from '../../main/enginePerformanceFixture'
import { engineDbPath, writeEngineLibraryFixture } from '../../main/enginePlaylistsFixture'
import { toNmlLocation } from '../../main/ffmpeg'
import { openRekordboxDb } from '../../main/rekordboxDb'
import { bootVolumeName } from '../../main/traktorNmlLibrary'
import type { Settings } from '../../shared/types'
import { music } from '../fakeMusic'
import { makeRekordbox } from '../rekordboxFixture'
import type { Programs } from './cells'
import { makeSource, SEEDED_CUES_MS, type SourceTrack } from './sources'

export interface SeededTrack extends SourceTrack {
  rekordboxId: string
  engineId: number
  traktorAudioId: string
  musicPid?: string
  playlists: { rekordbox: string[]; engine: number[]; traktor: string[]; music: string[] }
}

export interface LibrarySet {
  root: string
  rekordboxDb?: string
  engineDir?: string
  traktorNml?: string
  music: boolean
  bystander: SeededTrack
  tracks: SeededTrack[]
  settings: Partial<Settings>
  sha1Before: Record<'rekordbox' | 'engine' | 'traktor', string | null>
}

export type Program = 'rekordbox' | 'engine' | 'traktor' | 'music'

export function syncedPrograms(programs: Programs): Program[] {
  if (programs === 'all') return ['rekordbox', 'engine', 'traktor']
  return [programs]
}

export const REKORDBOX_FILE_TYPE: Record<string, number> = {
  '.mp3': 1,
  '.m4a': 4,
  '.flac': 5,
  '.wav': 11,
  '.aif': 12,
  '.aiff': 12,
}

export const SEEDED_ANALYSED = 105
export const analysisDataPathOf = (rekordboxId: string): string =>
  `/PIONEER/USBANLZ/${rekordboxId.slice(-3)}/${rekordboxId}/ANLZ0000.DAT`
export const twinIdOf = (rekordboxId: string): string => `${rekordboxId}9`

const ENGINE_RATE = 44100
export const engineSeededCues = (): EngineQuickCue[] =>
  SEEDED_CUES_MS.map((ms, i) => ({
    label: i === 0 ? 'Marker' : 'Drop',
    sample: (ms / 1000) * ENGINE_RATE,
    argb: 0xffcc0000,
  }))

const REKORDBOX_PLAYLISTS = ['80001', '80002']
const ENGINE_PLAYLISTS = [1, 2]
const TRAKTOR_PLAYLISTS = ['pl-seleccion', 'pl-sabado']
const PLAYLIST_NAMES = ['Selección', 'Sábado']

export const sha1Of = (path: string): string =>
  createHash('sha1').update(readFileSync(path)).digest('hex')

function seedRekordbox(
  dir: string,
  tracks: SeededTrack[],
  bystander: SeededTrack,
  links: Map<string, string>,
  extra: { nfdRow?: boolean; twinRows?: boolean },
): string {
  const rows = [...tracks, bystander].flatMap((t) => {
    const nfd = extra.nfdRow && t !== bystander
    const row = {
      id: t.rekordboxId,
      path: t.path.normalize(nfd ? 'NFD' : 'NFC'),
      title: t.tags.title.normalize('NFC'),
      artist: t.tags.artist,
      fileType: REKORDBOX_FILE_TYPE[extname(t.path).toLowerCase()],
      fileSize: statSync(t.path).size,
      analysisDataPath: analysisDataPathOf(t.rekordboxId),
      analysed: SEEDED_ANALYSED,
      playlists: t.playlists.rekordbox,
      cuesMs: SEEDED_CUES_MS,
    }
    const link = links.get(dirname(t.path))
    if (!link || t === bystander) return [row]
    const twin = {
      ...row,
      id: twinIdOf(t.rekordboxId),
      path: join(link, basename(t.path)).normalize('NFC'),
      playlists: [],
      cuesMs: [],
    }
    return [row, twin]
  })
  const path = makeRekordbox(dir, rows)
  const db = openRekordboxDb(path)
  if (!db) throw new Error(`scenario: could not reopen ${path}`)
  try {
    for (const [i, id] of REKORDBOX_PLAYLISTS.entries())
      db.prepare(
        `INSERT INTO djmdPlaylist (ID, Seq, Name, Attribute, ParentID, rb_local_deleted)
         VALUES (?, ?, ?, 0, 'root', 0)`,
      ).run(id, i + 1, PLAYLIST_NAMES[i])
  } finally {
    db.close()
  }
  return path
}

function seedEngine(dir: string, seeded: SeededTrack[]): void {
  const db = writeEngineLibraryFixture(dir, {
    tracks: seeded.map((t) => ({
      id: t.engineId,
      path: relative(dir, t.path).normalize('NFC'),
      title: t.tags.title.normalize('NFC'),
      artist: t.tags.artist,
    })),
    playlists: ENGINE_PLAYLISTS.map((id, i) => ({
      id,
      title: PLAYLIST_NAMES[i],
      parentListId: 0,
      nextListId: ENGINE_PLAYLISTS[i + 1] ?? 0,
    })),
    entities: ENGINE_PLAYLISTS.flatMap((listId) =>
      seeded.map((t, i) => ({
        id: listId * 100 + i + 1,
        listId,
        trackId: t.engineId,
        nextEntityId: i + 1 < seeded.length ? listId * 100 + i + 2 : 0,
      })),
    ),
    performance: seeded.map((t) => analysedTrack(t.engineId, engineSeededCues())),
  })
  try {
    for (const t of seeded)
      db.prepare('UPDATE Track SET fileType = ?, fileBytes = ? WHERE id = ?').run(
        extname(t.path).slice(1).toLowerCase(),
        statSync(t.path).size,
        t.engineId,
      )
  } finally {
    db.close()
  }
}

const xmlAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function nmlLocation(path: string): { volume: string; dir: string; file: string } {
  const { volume, dir, file } = toNmlLocation(path.normalize('NFC'))
  return { volume: volume || bootVolumeName(), dir, file }
}

function seedTraktor(path: string, seeded: SeededTrack[]): void {
  const entries = seeded.map((t) => {
    const { volume, dir, file } = nmlLocation(t.path)
    const cues = SEEDED_CUES_MS.map(
      (ms, i) =>
        `<CUE_V2 NAME="${i === 0 ? 'Marker' : 'Drop'}" DISPL_ORDER="0" TYPE="0" START="${ms.toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="${i}"></CUE_V2>`,
    ).join('\n')
    return `<ENTRY MODIFIED_DATE="2026/10/30" AUDIO_ID="${t.traktorAudioId}" TITLE="${xmlAttr(t.tags.title.normalize('NFC'))}" ARTIST="${xmlAttr(t.tags.artist)}"><LOCATION DIR="${xmlAttr(dir)}" FILE="${xmlAttr(file)}" VOLUME="${xmlAttr(volume)}" VOLUMEID="${xmlAttr(volume)}"></LOCATION>
<TEMPO BPM="124.000000" BPM_QUALITY="100.000000"></TEMPO>
${cues}
</ENTRY>`
  })
  const keys = seeded.map((t) => {
    const { volume, dir, file } = nmlLocation(t.path)
    return `<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${xmlAttr(`${volume}${dir}${file}`)}"></PRIMARYKEY>\n</ENTRY>`
  })
  const playlists = TRAKTOR_PLAYLISTS.map(
    (
      uuid,
      i,
    ) => `<NODE TYPE="PLAYLIST" NAME="${PLAYLIST_NAMES[i]}"><PLAYLIST ENTRIES="${keys.length}" TYPE="LIST" UUID="${uuid}">
${keys.join('\n')}
</PLAYLIST>
</NODE>`,
  )
  writeFileSync(
    path,
    `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>
<COLLECTION ENTRIES="${entries.length}">
${entries.join('\n')}
</COLLECTION>
<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="${playlists.length}">
${playlists.join('\n')}
</SUBNODES>
</NODE>
</PLAYLISTS>
</NML>
`,
  )
}

function seedMusic(seeded: SeededTrack[]): string[] {
  for (const t of seeded)
    t.musicPid = music.addEntry({
      location: realpathSync(t.path),
      title: t.tags.title.normalize('NFC'),
      artist: t.tags.artist,
      album: t.tags.album,
      genre: t.tags.genre,
      grouping: t.tags.grouping,
      comment: t.tags.comment,
      bpm: Number(t.tags.bpm),
      durationSec: 20,
    }).persistentId
  const pids = seeded.map((t) => t.musicPid as string)
  const lists = PLAYLIST_NAMES.map(
    (name) => music.addPlaylist({ name, entries: [...pids] }).persistentId,
  )
  music.addPlaylist({ name: 'Añadidas hace poco', smart: true, entries: [...pids] })
  return lists
}

function twinLinks(root: string, tracks: SourceTrack[]): Map<string, string> {
  const links = new Map<string, string>()
  for (const t of tracks) {
    const dir = dirname(t.path)
    if (links.has(dir)) continue
    const link = join(root, 'Music', links.size === 0 ? 'Music' : `Music ${links.size + 1}`)
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(dir, link)
    links.set(dir, link)
  }
  return links
}

export function buildLibraries(
  root: string,
  programs: Programs,
  sources: SourceTrack[],
  extra: { nfdRow?: boolean; twinRows?: boolean } = {},
): LibrarySet {
  mkdirSync(root, { recursive: true })
  const other = makeSource(join(root, 'Otra carpeta'), 'wav16', {
    fileName: 'Otra pista',
    tags: { title: 'Otra pista', artist: 'Nadie' },
  })
  const seeded: SeededTrack[] = [...sources, other].map((s, i) => ({
    ...s,
    rekordboxId: String(910001 + i),
    engineId: i + 1,
    traktorAudioId: `AQAAAAAAAAAAAAAAAAAAAA${String(i).padStart(4, '0')}`,
    playlists: {
      rekordbox: REKORDBOX_PLAYLISTS,
      engine: ENGINE_PLAYLISTS,
      traktor: TRAKTOR_PLAYLISTS,
      music: [],
    },
  }))
  const tracks = seeded.slice(0, -1)
  const bystander = seeded[seeded.length - 1]
  const links = extra.twinRows ? twinLinks(root, tracks) : new Map<string, string>()
  const rekordboxDb = seedRekordbox(join(root, 'rekordbox'), tracks, bystander, links, extra)
  const engineDir = join(root, 'Engine Library')
  seedEngine(engineDir, seeded)
  const traktorNml = join(root, 'Traktor', 'collection.nml')
  mkdirSync(dirname(traktorNml), { recursive: true })
  seedTraktor(traktorNml, seeded)
  const withMusic = programs === 'music'
  if (withMusic) {
    const lists = seedMusic(seeded)
    for (const t of seeded) t.playlists = { ...t.playlists, music: lists }
  }
  const synced = new Set(syncedPrograms(programs))
  return {
    root,
    rekordboxDb,
    engineDir,
    traktorNml,
    music: withMusic,
    bystander,
    tracks,
    settings: {
      syncRekordbox: synced.has('rekordbox'),
      rekordboxDbPath: rekordboxDb,
      syncEngineDj: synced.has('engine'),
      engineLibraryDir: engineDir,
      syncTraktor: synced.has('traktor'),
      traktorNmlPath: traktorNml,
      traktorCueOffsetMs: 0,
    },
    sha1Before: {
      rekordbox: sha1Of(rekordboxDb),
      engine: sha1Of(engineDbPath(engineDir)),
      traktor: sha1Of(traktorNml),
    },
  }
}
