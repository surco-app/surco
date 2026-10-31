import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statfsSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import Database from 'better-sqlite3-multiple-ciphers'
import ffmpegStatic from 'ffmpeg-static'
import { PictureType, File as TagFile } from 'node-taglib-sharp'
import { decodeQuickCues, decodeTrackData, inflateEngineBlob } from '../../main/engineBlobs'
import { engineDbPath } from '../../main/enginePlaylistsFixture'
import { toNmlLocation } from '../../main/ffmpeg'
import { openRekordboxDb } from '../../main/rekordboxDb'
import { findRekordboxCollection } from '../../main/rekordboxPath'
import { readTraktorCueStart, storedTree } from '../../main/traktor4Fixture'
import { bootVolumeName } from '../../main/traktorNmlLibrary'
import { detectTraktorNmlPaths } from '../../main/traktorNmlPath'
import type { Origin } from './cells'
import {
  bystanderRows,
  type EnginePerf,
  type LibrarySet,
  type SeededTrack,
  sha1Of,
  traktorEntryOf,
} from './libraries'
import { leadingTagsEnd, type TrickyTags } from './sources'

const FF = ffmpegStatic as unknown as string
const PROBE = ffprobeInstaller.path
const STREAMING = 25
const TWINS = 2
const NFD_NAMES = 2

export interface RealSources {
  rekordboxDb?: string
  engineDir?: string
  traktorNml?: string
}

export interface RealCopy {
  set: LibrarySet
  originals: { path: string; sha1: string; mtimeMs: number }[]
  rewrites: string[]
}

const listed = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export function realSourcesFromEnv(): RealSources {
  const home = homedir()
  const engineDefault = join(home, 'Music', 'Engine Library')
  const sources: RealSources = {
    rekordboxDb: process.env.SURCO_MATRIX_REKORDBOX_DB || findRekordboxCollection() || undefined,
    engineDir:
      process.env.SURCO_MATRIX_ENGINE_DIR ||
      (existsSync(engineDbPath(engineDefault)) ? engineDefault : undefined),
    traktorNml:
      process.env.SURCO_MATRIX_TRAKTOR_NML ||
      detectTraktorNmlPaths(home, listed).find((p) => existsSync(p)),
  }
  return Object.fromEntries(Object.entries(sources).filter(([, v]) => v)) as RealSources
}

const lexists = (path: string): boolean => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function onDisk(dir: string, name: string): string {
  const want = name.normalize('NFC')
  return listed(dir).find((n) => n.normalize('NFC') === want) ?? name
}

const mirrored = (mirror: string, path: string): string => `${mirror}${path}`

function mirrorDir(mirror: string, dir: string): void {
  mkdirSync(mirror, { recursive: true })
  let original = '/'
  let copy = mirror
  for (const part of dir.split('/').filter(Boolean)) {
    const name = onDisk(original, part)
    original = join(original, name)
    copy = join(copy, name)
    if (lexists(copy)) continue
    if (lstatSync(original).isSymbolicLink()) {
      const target = realpathSync(original)
      mirrorDir(mirror, target)
      symlinkSync(mirrored(mirror, target), copy)
    } else mkdirSync(copy)
  }
}

export interface Watched {
  path: string
  sha1: string
  mtimeMs: number
}

const fingerprint = (path: string): Watched => ({
  path,
  sha1: sha1Of(path),
  mtimeMs: statSync(path).mtimeMs,
})

const RUN_ROOT_PREFIX = 'surco-matriz-real-'
const SPACE_MARGIN = 1.2

export function createRunRoot(base: string): string {
  mkdirSync(base, { recursive: true })
  return mkdtempSync(join(base, RUN_ROOT_PREFIX))
}

export function removeRunRoot(root: string): void {
  if (!basename(root).startsWith(RUN_ROOT_PREFIX))
    throw new Error(`scenario: refusing to remove ${root}, it is not a folder this run created`)
  rmSync(root, { recursive: true, force: true })
}

export function assertRoomFor(
  dir: string,
  bytes: number,
  freeBytes: (dir: string) => number = (d) => {
    const fs = statfsSync(d)
    return fs.bavail * fs.bsize
  },
): void {
  const needed = Math.ceil(bytes * SPACE_MARGIN)
  const free = freeBytes(dir)
  if (free < needed)
    throw new Error(`scenario: ${dir} has ${free} bytes free and the copies need ${needed}`)
}

const watch = (list: Watched[], path: string): void => {
  if (!list.some((w) => w.path === path)) list.push(fingerprint(path))
}

export function engineDatabases(engineDir: string): string[] {
  return listed(join(engineDir, 'Database2'))
    .filter((n) => n.endsWith('.db'))
    .map((n) => join(engineDir, 'Database2', n))
}

export function watchSources(src: RealSources, watched: Watched[]): void {
  if (src.rekordboxDb) watch(watched, src.rekordboxDb)
  if (src.engineDir) for (const db of engineDatabases(src.engineDir)) watch(watched, db)
  if (src.traktorNml) watch(watched, src.traktorNml)
}

const sizeOf = (paths: string[]): number => paths.reduce((sum, p) => sum + statSync(p).size, 0)

function writable(path: string): string {
  chmodSync(path, 0o644)
  return path
}

function copyRekordbox(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  const db = openRekordboxDb(from, { readonly: true })
  if (!db) throw new Error(`scenario: ${from} does not open as a rekordbox collection`)
  try {
    db.prepare('VACUUM INTO ?').run(to)
  } finally {
    db.close()
  }
  writable(to)
}

async function copyEngine(fromDir: string, toDir: string): Promise<string[]> {
  const from = join(fromDir, 'Database2')
  const to = join(toDir, 'Database2')
  mkdirSync(to, { recursive: true })
  const names = listed(from).filter((n) => n.endsWith('.db'))
  for (const name of names) {
    const db = new Database(join(from, name), { readonly: true, fileMustExist: true })
    try {
      await db.backup(join(to, name))
    } finally {
      db.close()
    }
    writable(join(to, name))
  }
  return names.map((n) => join(from, n))
}

interface RekordboxRow {
  id: string
  path: string
  fileType: number
  cuesMs: number[]
  playlists: string[]
  analysisDataPath: string | null
  analysed: number | null
}

function readRekordbox(dbPath: string): { rows: RekordboxRow[]; ids: string[] } {
  const db = openRekordboxDb(dbPath, { readonly: true })
  if (!db) throw new Error(`scenario: the copy ${dbPath} does not open`)
  try {
    const rows = db
      .prepare(
        `SELECT ID, FolderPath, FileType, AnalysisDataPath, Analysed FROM djmdContent
         WHERE coalesce(rb_local_deleted, 0) = 0 ORDER BY ID`,
      )
      .all() as {
      ID: string
      FolderPath: string | null
      FileType: number
      AnalysisDataPath: string | null
      Analysed: number | null
    }[]
    const cues = new Map<string, number[]>()
    for (const c of db
      .prepare(`SELECT ContentID, InMsec FROM djmdCue WHERE coalesce(rb_local_deleted, 0) = 0`)
      .all() as { ContentID: string; InMsec: number }[])
      cues.set(c.ContentID, [...(cues.get(c.ContentID) ?? []), c.InMsec])
    const lists = new Map<string, string[]>()
    for (const s of db
      .prepare(
        `SELECT ContentID, PlaylistID FROM djmdSongPlaylist WHERE coalesce(rb_local_deleted, 0) = 0`,
      )
      .all() as { ContentID: string; PlaylistID: string }[])
      lists.set(s.ContentID, [...(lists.get(s.ContentID) ?? []), s.PlaylistID])
    return {
      ids: rows.map((r) => r.ID),
      rows: rows
        .filter((r) => r.FolderPath)
        .map((r) => ({
          id: r.ID,
          path: r.FolderPath as string,
          fileType: r.FileType,
          cuesMs: cues.get(r.ID) ?? [],
          playlists: lists.get(r.ID) ?? [],
          analysisDataPath: r.AnalysisDataPath,
          analysed: r.Analysed,
        })),
    }
  } finally {
    db.close()
  }
}

interface EngineRow {
  id: number
  raw: string
  path: string
  cuesMs: number[]
  perf: EnginePerf
  playlists: number[]
  positions: Record<number, number>
}

function chainOf(entities: { id: number; trackId: number; nextEntityId: number }[]): number[] {
  const byId = new Map(entities.map((x) => [x.id, x]))
  const pointed = new Set(entities.map((x) => x.nextEntityId))
  const order: number[] = []
  for (
    let at = entities.find((x) => !pointed.has(x.id));
    at && order.length < entities.length;
    at = byId.get(at.nextEntityId)
  )
    order.push(at.trackId)
  return order
}

function engineCuesMs(perf: EnginePerf): number[] {
  if (!perf.trackData || !perf.quickCues) return []
  const rate = decodeTrackData(inflateEngineBlob(perf.trackData))?.sampleRate ?? 0
  if (rate <= 0) return []
  return (decodeQuickCues(inflateEngineBlob(perf.quickCues))?.slots ?? []).flatMap((s) =>
    s.cue ? [(s.cue.sample / rate) * 1000] : [],
  )
}

function readEngine(dbPath: string, originalDir: string): EngineRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const entities = db
      .prepare('SELECT id, listId, trackId, nextEntityId FROM PlaylistEntity')
      .all() as { id: number; listId: number; trackId: number; nextEntityId: number }[]
    const positions = new Map<number, Record<number, number>>()
    for (const listId of new Set(entities.map((x) => x.listId)))
      for (const [i, trackId] of chainOf(entities.filter((x) => x.listId === listId)).entries())
        positions.set(trackId, { ...positions.get(trackId), [listId]: i })
    const perf = db.prepare(
      'SELECT trackData, beatData, quickCues, overviewWaveFormData FROM PerformanceData WHERE trackId = ?',
    )
    return (
      db.prepare('SELECT id, path FROM Track ORDER BY id').all() as {
        id: number
        path: string | null
      }[]
    )
      .filter((t) => t.path)
      .map((t) => {
        const blobs = (perf.get(t.id) as EnginePerf | undefined) ?? {
          trackData: null,
          beatData: null,
          quickCues: null,
          overviewWaveFormData: null,
        }
        return {
          id: t.id,
          raw: t.path as string,
          path: resolve(originalDir, t.path as string),
          cuesMs: engineCuesMs(blobs),
          perf: blobs,
          playlists: [...new Set(entities.filter((x) => x.trackId === t.id).map((x) => x.listId))],
          positions: positions.get(t.id) ?? {},
        }
      })
  } finally {
    db.close()
  }
}

const NML_ENTITIES: Record<string, string> = { quot: '"', lt: '<', gt: '>', amp: '&', apos: "'" }
const unescaped = (value: string): string =>
  value.replace(/&([a-z]+);/g, (whole, ref: string) => NML_ENTITIES[ref] ?? whole)
const xmlAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rawAttr = (tag: string, name: string): string =>
  tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? ''

interface TraktorEntry {
  audioId: string
  location: string
  key: string
  path: string
  cuesMs: number[]
  playlists: string[]
}

function nmlFilePath(location: string, boot: string): string {
  const volume = unescaped(rawAttr(location, 'VOLUME'))
  const path = unescaped(`${rawAttr(location, 'DIR')}${rawAttr(location, 'FILE')}`).replace(
    /\/:/g,
    '/',
  )
  return !volume || volume === boot ? path : `/Volumes/${volume}${path}`
}

function readTraktor(nml: string): TraktorEntry[] {
  const boot = bootVolumeName()
  const lists = new Map<string, string[]>()
  for (const [, head, body] of nml.matchAll(/<PLAYLIST\b([^>]*)>([\s\S]*?)<\/PLAYLIST>/g)) {
    const uuid = rawAttr(head, 'UUID')
    for (const [key] of body.matchAll(/<PRIMARYKEY\b[^>]*>/g)) {
      const raw = rawAttr(key, 'KEY')
      lists.set(raw, [...new Set([...(lists.get(raw) ?? []), uuid])])
    }
  }
  const collection = nml.match(/<COLLECTION\b[\s\S]*?<\/COLLECTION>/)?.[0] ?? ''
  const entries = [...collection.matchAll(/<ENTRY\b[^>]*>[\s\S]*?<\/ENTRY>/g)].map(([block]) => {
    const location = block.match(/<LOCATION\b[^>]*>/)?.[0] ?? ''
    const key = `${rawAttr(location, 'VOLUME')}${rawAttr(location, 'DIR')}${rawAttr(location, 'FILE')}`
    return {
      audioId: rawAttr(block.match(/<ENTRY\b[^>]*>/)?.[0] ?? '', 'AUDIO_ID'),
      location,
      key,
      path: nmlFilePath(location, boot),
      cuesMs: [...block.matchAll(/<CUE_V2\b[^>]*>/g)]
        .filter(([cue]) => rawAttr(cue, 'TYPE') !== '4')
        .map(([cue]) => Number(rawAttr(cue, 'START'))),
      playlists: lists.get(key) ?? [],
    }
  })
  const seen = new Map<string, number>()
  for (const e of entries) seen.set(e.audioId, (seen.get(e.audioId) ?? 0) + 1)
  return entries.map((e) => (seen.get(e.audioId) === 1 ? e : { ...e, audioId: '' }))
}

function hasXing(path: string): boolean {
  const bytes = readFileSync(path)
  let sync = leadingTagsEnd(bytes)
  while (sync + 4 <= bytes.length && !(bytes[sync] === 0xff && (bytes[sync + 1] & 0xe0) === 0xe0))
    sync++
  const mono = bytes[sync + 3] >> 6 === 3
  const at = sync + 4 + (mono ? 17 : 32)
  return ['Info', 'Xing'].includes(bytes.toString('latin1', at, at + 4))
}

function probeStream(path: string): { codec: string; bits: number; artist: string } {
  const out = JSON.parse(
    execFileSync(PROBE, [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name,bits_per_raw_sample,bits_per_sample:format_tags=artist',
      '-of',
      'json',
      path,
    ]).toString(),
  )
  const s = out.streams?.[0] ?? {}
  const tags: Record<string, string> = out.format?.tags ?? {}
  return {
    codec: s.codec_name ?? '',
    bits: Number(s.bits_per_raw_sample || s.bits_per_sample || 0),
    artist: Object.entries(tags).find(([k]) => k.toLowerCase() === 'artist')?.[1] ?? '',
  }
}

const BY_EXTENSION: Record<string, Origin[]> = {
  '.flac': ['flac'],
  '.aif': ['aif'],
  '.aiff': ['aiff'],
  '.wav': ['wav16', 'wav24'],
  '.m4a': ['alac', 'aac'],
  '.mp3': ['mp3x', 'mp3n'],
}

function originOf(path: string): Origin | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.mp3') return hasXing(path) ? 'mp3x' : 'mp3n'
  if (ext === '.wav') return probeStream(path).bits > 16 ? 'wav24' : 'wav16'
  if (ext === '.m4a') {
    const { codec } = probeStream(path)
    return codec === 'alac' ? 'alac' : codec === 'aac' ? 'aac' : null
  }
  return BY_EXTENSION[ext]?.[0] ?? null
}

function tagsOf(path: string): { tags: TrickyTags; coverSha1: string | null } {
  const f = TagFile.createFromPath(path)
  try {
    const t = f.tag
    const pair = (n: number, total: number) => (n ? (total ? `${n}/${total}` : String(n)) : '')
    const front = t.pictures.find((p) => p.type === PictureType.FrontCover) ?? t.pictures[0]
    return {
      tags: {
        title: t.title ?? '',
        artist: probeStream(path).artist,
        album: t.album ?? '',
        genre: t.joinedGenres ?? '',
        grouping: t.grouping ?? '',
        trackNumber: pair(t.track, t.trackCount),
        discNumber: pair(t.disc, t.discCount),
        bpm: t.beatsPerMinute ? String(t.beatsPerMinute) : '',
        key: t.initialKey ?? '',
        publisher: t.publisher ?? '',
        catalogNumber: '',
        comment: t.comment ?? '',
      },
      coverSha1: front ? createHash('sha1').update(front.data.toByteArray()).digest('hex') : null,
    }
  } finally {
    f.dispose()
  }
}

function fileCuesMs(path: string): number[] {
  let tree: Uint8Array | null
  try {
    tree = storedTree(path)
  } catch {
    return []
  }
  if (!tree) return []
  const at = Buffer.from(tree).indexOf('PEUC', 0, 'latin1')
  if (at === -1) return []
  const count = new DataView(tree.buffer, tree.byteOffset).getUint32(at + 12, true)
  return Array.from({ length: count }, (_, i) => readTraktorCueStart(tree as Uint8Array, i))
}

const keyOf = (path: string): string | null => {
  try {
    return realpathSync(path).normalize('NFC')
  } catch {
    return null
  }
}

const nameOf = (path: string): string => basename(path).normalize('NFC').toLowerCase()

interface Sampled {
  key: string
  origin: Origin
  rekordbox: RekordboxRow[]
  engine: EngineRow[]
  traktor: TraktorEntry[]
}

function holders<T extends { path: string }>(rows: T[], key: string): T[] {
  const name = nameOf(key)
  return rows.filter((r) => nameOf(r.path) === name && keyOf(r.path) === key)
}

export async function copyRealLibraries(
  src: RealSources,
  root: string,
  perFormat = 3,
  originals: Watched[] = [],
): Promise<RealCopy> {
  const mirror = join(root, 'espejo')
  mkdirSync(root, { recursive: true })
  watchSources(src, originals)
  assertRoomFor(
    root,
    sizeOf([
      ...(src.rekordboxDb ? [src.rekordboxDb] : []),
      ...(src.engineDir ? engineDatabases(src.engineDir) : []),
      ...(src.traktorNml ? [src.traktorNml] : []),
    ]),
  )
  const rewrites: string[] = []
  const boot = bootVolumeName()

  const rekordboxDb = src.rekordboxDb && join(root, 'rekordbox', 'master.db')
  if (src.rekordboxDb && rekordboxDb) {
    copyRekordbox(src.rekordboxDb, rekordboxDb)
  }
  const engineDir = src.engineDir && mirrored(mirror, src.engineDir)
  if (src.engineDir && engineDir) {
    mirrorDir(mirror, src.engineDir)
    await copyEngine(src.engineDir, engineDir)
  }
  const traktorNml = src.traktorNml && join(root, 'Traktor', 'collection.nml')
  if (src.traktorNml && traktorNml) {
    mkdirSync(dirname(traktorNml), { recursive: true })
    copyFileSync(src.traktorNml, traktorNml)
    writable(traktorNml)
  }

  const rekordbox = rekordboxDb ? readRekordbox(rekordboxDb) : { rows: [], ids: [] }
  const engine =
    engineDir && src.engineDir ? readEngine(engineDbPath(engineDir), src.engineDir) : []
  const traktor = traktorNml ? readTraktor(readFileSync(traktorNml, 'utf8')) : []
  const music = rekordbox.rows.filter((r) => r.fileType !== STREAMING)

  const sampled = new Map<string, Sampled>()
  const buckets = new Map<Origin, number>()
  let bystander: Sampled | undefined
  const take = (key: string, origin: Origin): Sampled => {
    const s: Sampled = {
      key,
      origin,
      rekordbox: holders(music, key),
      engine: holders(engine, key),
      traktor: holders(traktor, key),
    }
    sampled.set(key, s)
    buckets.set(origin, (buckets.get(origin) ?? 0) + 1)
    return s
  }
  const full = (origin: Origin) => (buckets.get(origin) ?? 0) >= perFormat
  const candidates = [
    ...music.filter((r) => r.cuesMs.length > 0 && r.playlists.length > 0),
    ...engine.filter((r) => r.cuesMs.length > 0 && r.playlists.length > 0),
    ...traktor.filter((e) => e.audioId && e.cuesMs.length > 0 && e.playlists.length > 0),
  ]
  for (const c of candidates) {
    const choices = BY_EXTENSION[extname(c.path).toLowerCase()]
    if (!choices || (choices.every(full) && bystander)) continue
    const key = keyOf(c.path)
    if (!key || sampled.has(key) || bystander?.key === key) continue
    const origin = originOf(key)
    if (!origin) continue
    if (!full(origin)) take(key, origin)
    else if (!bystander) {
      bystander = take(key, origin)
      sampled.delete(key)
    }
  }
  const byName = new Map<string, RekordboxRow[]>()
  for (const r of music) byName.set(nameOf(r.path), [...(byName.get(nameOf(r.path)) ?? []), r])
  let twins = 0
  for (const rows of byName.values()) {
    if (twins >= TWINS || rows.length < 2) continue
    const keys = rows.map((r) => keyOf(r.path))
    const shared = keys.find((k, i) => k && keys.indexOf(k) !== i)
    if (!shared || sampled.has(shared)) continue
    const origin = originOf(shared)
    if (!origin) continue
    take(shared, origin)
    twins++
  }
  let nfd = 0
  for (const r of music) {
    if (nfd >= NFD_NAMES || basename(r.path) === basename(r.path).normalize('NFC')) continue
    const key = keyOf(r.path)
    if (!key || sampled.has(key)) continue
    const origin = originOf(key)
    if (!origin) continue
    take(key, origin)
    nfd++
  }
  if (!bystander) {
    const last = [...sampled.values()].at(-1)
    if (!last) throw new Error('scenario: no track in the collections meets the sample criteria')
    bystander = last
    sampled.delete(last.key)
  }

  const mirrorFile = (s: Sampled): void => {
    watch(originals, s.key)
    const dir = dirname(s.key)
    mirrorDir(mirror, dir)
    const stored = [
      ...s.rekordbox.map((r) => r.path),
      ...s.engine.map((r) => r.path),
      ...s.traktor.map((e) => e.path),
    ]
    for (const path of stored) mirrorDir(mirror, dirname(path))
    copyFileSync(
      s.key,
      join(mirrored(mirror, dir), onDisk(dir, basename(s.key))),
      constants.COPYFILE_EXCL,
    )
  }

  const everyone = [...sampled.values(), bystander]
  assertRoomFor(root, sizeOf(everyone.map((s) => s.key)))
  for (const s of everyone) mirrorFile(s)

  if (rekordboxDb) {
    const db = openRekordboxDb(rekordboxDb)
    if (!db) throw new Error(`scenario: the copy ${rekordboxDb} does not open for writing`)
    try {
      const update = db.prepare('UPDATE djmdContent SET FolderPath = ? WHERE ID = ?')
      for (const s of everyone)
        for (const r of s.rekordbox) {
          const to = mirrored(mirror, r.path)
          update.run(to, r.id)
          rewrites.push(`rekordbox ${r.id}: ${r.path} → ${to}`)
        }
    } finally {
      db.close()
    }
  }
  if (engineDir && src.engineDir) {
    const db = new Database(engineDbPath(engineDir), { fileMustExist: true })
    try {
      const update = db.prepare('UPDATE Track SET path = ? WHERE id = ?')
      for (const s of everyone)
        for (const r of s.engine) {
          const want = mirrored(mirror, r.path)
          if (resolve(engineDir, r.raw) === want) continue
          const to = isAbsolute(r.raw) ? mirrored(mirror, r.raw) : relative(engineDir, want)
          update.run(to, r.id)
          rewrites.push(`Engine ${r.id}: ${r.raw} → ${to}`)
        }
    } finally {
      db.close()
    }
  }
  if (traktorNml) {
    let nml = readFileSync(traktorNml, 'utf8')
    for (const s of everyone)
      for (const e of s.traktor) {
        const to = mirrored(mirror, e.path)
        const at = toNmlLocation(to.normalize('NFC'))
        const volume = xmlAttr(at.volume || boot)
        const location = e.location
          .replace(/(\sDIR=")[^"]*"/, (_m, head: string) => `${head}${xmlAttr(at.dir)}"`)
          .replace(/(\sFILE=")[^"]*"/, (_m, head: string) => `${head}${xmlAttr(at.file)}"`)
          .replace(/(\sVOLUME=")[^"]*"/, (_m, head: string) => `${head}${volume}"`)
          .replace(/(\sVOLUMEID=")[^"]*"/, (_m, head: string) => `${head}${volume}"`)
        nml = nml
          .replace(e.location, () => location)
          .split(`KEY="${e.key}"`)
          .join(`KEY="${volume}${xmlAttr(at.dir)}${xmlAttr(at.file)}"`)
        rewrites.push(`Traktor ${e.audioId || '(sin AUDIO_ID)'}: ${e.path} → ${to}`)
      }
    writeFileSync(traktorNml, nml)
  }

  const track = (s: Sampled): SeededTrack => {
    const stored = s.rekordbox[0]?.path ?? s.engine[0]?.path ?? s.traktor[0]?.path ?? s.key
    const path = mirrored(mirror, stored)
    const { tags, coverSha1 } = tagsOf(path)
    const rb = s.rekordbox[0]
    const en = s.engine[0]
    const tk = s.traktor.find((e) => e.audioId)
    return {
      origin: s.origin,
      path,
      tags,
      coverSha1,
      cuesMs: fileCuesMs(path),
      rekordboxId: rb?.id ?? '',
      engineId: en?.id ?? 0,
      traktorAudioId: tk?.audioId ?? '',
      playlists: {
        rekordbox: rb?.playlists ?? [],
        engine: en?.playlists ?? [],
        traktor: tk?.playlists ?? [],
        music: [],
      },
      baseline: {
        ...(rb && {
          rekordbox: {
            cuesMs: rb.cuesMs,
            analysisDataPath: rb.analysisDataPath,
            analysed: rb.analysed,
          },
        }),
        ...(en && { engine: { cuesMs: en.cuesMs, perf: en.perf, positions: en.positions } }),
        ...(tk && { traktor: { cuesMs: tk.cuesMs } }),
      },
    }
  }

  const tracks = [...sampled.values()].map(track)
  const other = track(bystander)
  const libraries = { rekordboxDb, engineDir, traktorNml }
  const nml = traktorNml ? readFileSync(traktorNml, 'utf8') : ''
  return {
    originals,
    rewrites,
    set: {
      root,
      ...libraries,
      music: false,
      bystander: other,
      tracks,
      settings: {
        syncRekordbox: !!rekordboxDb,
        rekordboxDbPath: rekordboxDb ?? '',
        syncEngineDj: !!engineDir,
        engineLibraryDir: engineDir ?? '',
        syncTraktor: !!traktorNml,
        traktorNmlPath: traktorNml ?? '',
        traktorCueOffsetMs: 0,
      },
      sha1Before: {
        rekordbox: rekordboxDb ? sha1Of(rekordboxDb) : null,
        engine: engineDir ? sha1Of(engineDbPath(engineDir)) : null,
        traktor: traktorNml ? sha1Of(traktorNml) : null,
      },
      bystanderRows: bystanderRows(libraries, other),
      traktorEntries: Object.fromEntries(
        tracks
          .filter((t) => t.traktorAudioId)
          .map((t) => [t.traktorAudioId, traktorEntryOf(nml, t.traktorAudioId)]),
      ),
      knownRekordboxIds: rekordbox.ids,
    },
  }
}

export function assertOriginalsUntouched(copy: Pick<RealCopy, 'originals'>): void {
  const changed = copy.originals.flatMap((o) => {
    if (!existsSync(o.path)) return [`${o.path}: ya no está`]
    const now = fingerprint(o.path)
    return [
      ...(now.sha1 !== o.sha1 ? [`${o.path}: su contenido cambió`] : []),
      ...(now.mtimeMs !== o.mtimeMs ? [`${o.path}: su fecha de modificación cambió`] : []),
    ]
  })
  if (changed.length > 0)
    throw new Error(`ORIGINALES TOCADOS, avisa al usuario ya\n${changed.join('\n')}`)
}

// Brings the copies back to how copyRealLibraries left them, so every batch of cells starts
// from the same libraries and the same files, whatever the batch before converted.
export function pristine(copy: RealCopy): () => void {
  const { set } = copy
  const keep = join(set.root, 'intacta')
  const libraries = [
    set.rekordboxDb,
    ...(set.engineDir
      ? listed(join(set.engineDir, 'Database2'))
          .filter((n) => n.endsWith('.db'))
          .map((n) => join(set.engineDir as string, 'Database2', n))
      : []),
    set.traktorNml,
  ].filter((p): p is string => !!p)
  const audio = [...set.tracks, set.bystander].map((t) => realpathSync(t.path))
  const files = [...libraries, ...audio]
  mkdirSync(keep, { recursive: true })
  for (const [i, file] of files.entries())
    copyFileSync(file, join(keep, String(i)), constants.COPYFILE_FICLONE)
  const kept = new Set(files)
  return () => {
    for (const dir of new Set(files.map(dirname)))
      for (const name of listed(dir)) {
        const path = join(dir, name)
        if (!kept.has(path) && !lstatSync(path).isDirectory()) rmSync(path, { force: true })
      }
    for (const [i, file] of files.entries())
      copyFileSync(join(keep, String(i)), file, constants.COPYFILE_FICLONE)
  }
}

function monoAt(path: string, rate: number): Float32Array {
  const pcm = execFileSync(
    FF,
    [
      '-v',
      'error',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      String(rate),
      '-f',
      'f32le',
      '-',
    ],
    { maxBuffer: 1 << 30 },
  )
  return new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4))
}

const SEARCH_SEC = 0.2
const WINDOW_SEC = 0.25

// Real music has no click marker: the lag is where a window around the sharpest transient
// of the source correlates best with the output.
export function correlationLagMs(source: string, output: string): number {
  const rate = Number(
    execFileSync(PROBE, [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=sample_rate',
      '-of',
      'csv=p=0',
      source,
    ])
      .toString()
      .trim(),
  )
  const a = monoAt(source, rate)
  const b = monoAt(output, rate)
  const span = Math.round(SEARCH_SEC * rate)
  const half = Math.round((WINDOW_SEC / 2) * rate)
  let at = span + half
  let jump = 0
  for (let i = span + half; i < a.length - span - half; i++) {
    const d = Math.abs(a[i] - a[i - 1])
    if (d > jump) {
      jump = d
      at = i
    }
  }
  let best = 0
  let score = Number.NEGATIVE_INFINITY
  for (let lag = -span; lag <= span; lag++) {
    let dot = 0
    let energy = 0
    for (let i = at - half; i < at + half; i++) {
      const y = b[i + lag] ?? 0
      dot += a[i] * y
      energy += y * y
    }
    const s = energy > 0 ? dot / Math.sqrt(energy) : Number.NEGATIVE_INFINITY
    if (s > score) {
      score = s
      best = lag
    }
  }
  return (best / rate) * 1000
}
