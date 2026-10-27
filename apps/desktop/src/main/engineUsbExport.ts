import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, posix, win32 } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import type {
  UsbExportEvent,
  UsbExportRequest,
  UsbFailure,
  UsbHolder,
  UsbPlan,
  UsbPlanResult,
  UsbPlanTrack,
  UsbStartResult,
  UsbVolume,
  UsbWarning,
} from '../shared/types'
import { artworkFileName, type EngineDb, engineDatabasePath, openEngineDb } from './enginePlaylists'
import {
  createEngineUsbDb,
  engineUsbTracksByOrigin,
  libraryUuid,
  putEngineUsbPlaylist,
  putEngineUsbTracks,
} from './engineUsbDb'
import {
  type EngineUsbSelection,
  type EngineUsbTrack,
  readEngineUsbSelection,
} from './engineUsbSource'
import { resolveTarget, sourceRoot, type Target } from './usbExport'
import { targetKey, type UsbMemory } from './usbExportMemory'

export const ENGINE_USB_FOLDER = 'Engine Library'
export const ENGINE_USB_QUIT_DETAIL = 'engineQuitDetailUsb' as const
const MARKER = '.surco-export.json'

export interface EngineUsbExporterDeps {
  platform: NodeJS.Platform
  libraryDir: () => string
  volumes: () => Promise<UsbVolume[]>
  idAt: (root: string) => Promise<string | null>
  devOf: (root: string) => Promise<number | null>
  realPath: (path: string) => Promise<string | null>
  freeBytes: (root: string) => Promise<number | null>
  engineRunning: () => Promise<boolean>
  ensureEngineClosed: () => Promise<boolean>
  memory: UsbMemory
  send: (e: UsbExportEvent) => void
  now: () => number
  log: (message: string) => void
  pollMs?: number
}

interface Artwork {
  source: string
  dest: string
  size: number
  present: boolean
}

interface Planned {
  track: EngineUsbTrack
  source: string
  size: number
  dest: string
  onStick: boolean
  art: Artwork | null
}

interface Prepared {
  target: Target
  lib: string
  existing: boolean
  sel: EngineUsbSelection
  planned: Planned[]
  missing: EngineUsbTrack[]
  streaming: EngineUsbTrack[]
  art: Artwork[]
  sources: string[]
  unreachable: { volume: string; tracks: number } | null
  empty: string[]
  needed: number
  free: number | null
}

const sizeOf = (path: string): Promise<number | null> =>
  stat(path).then(
    (s) => (s.isFile() ? s.size : null),
    () => null,
  )

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

const UNSAFE = /[<>:"/\\|?*]/g

function usbFileName(name: string): string {
  return (
    name
      .normalize('NFC')
      .replace(UNSAFE, '_')
      .replace(/[. ]+$/, '') || 'track'
  )
}

function allocate(name: string, taken: Set<string>): string {
  const { name: stem, ext } = posix.parse(usbFileName(name))
  for (let n = 1; ; n++) {
    const path = `Music/${n === 1 ? stem : `${stem} (${n})`}${ext}`
    if (taken.has(path.toLowerCase())) continue
    taken.add(path.toLowerCase())
    return path
  }
}

const onUsb = (lib: string, path: string): string => join(lib, ...path.split('/'))

async function artworkOf(
  desktopDir: string,
  lib: string,
  names: string[],
): Promise<Map<string, Artwork>> {
  const dir = join(desktopDir, 'Artwork')
  const files = new Map(
    (await readdir(dir).catch(() => [] as string[])).map((f) => [posix.parse(f).name, f]),
  )
  const out = new Map<string, Artwork>()
  for (const name of new Set(names)) {
    const file = files.get(name)
    const size = file ? await sizeOf(join(dir, file)) : null
    if (!file || size === null) continue
    const dest = join(lib, 'Artwork', file)
    out.set(name, { source: join(dir, file), dest, size, present: (await sizeOf(dest)) === size })
  }
  return out
}

interface LibraryInfo {
  uuid: string
  version: string
}

function libraryInfo(db: EngineDb): LibraryInfo {
  return db
    .prepare(
      `SELECT uuid, schemaVersionMajor || '.' || schemaVersionMinor || '.' || schemaVersionPatch
         AS version FROM Information ORDER BY id LIMIT 1`,
    )
    .get() as LibraryInfo
}

interface OnDrive {
  byOrigin: Map<number, { id: number; path: string }>
  paths: string[]
}

const readMarker = (lib: string): Promise<{ uuid?: unknown } | null> =>
  readFile(join(lib, MARKER), 'utf8').then(
    (text) => JSON.parse(text) as { uuid?: unknown },
    () => null,
  )

export async function engineLibraryHolder(root: string): Promise<UsbHolder> {
  const lib = join(root, ENGINE_USB_FOLDER)
  const facts = await stat(engineDatabasePath(lib)).catch(() => null)
  if (!facts) return { by: 'empty', at: null }
  const marker = await readMarker(lib)
  let db: EngineDb | null = null
  try {
    db = openEngineDb(lib)
    const ours = marker !== null && db !== null && libraryInfo(db).uuid === marker.uuid
    return { by: ours ? 'surco' : 'other', at: facts.mtimeMs }
  } catch {
    return { by: 'other', at: facts.mtimeMs }
  } finally {
    db?.close()
  }
}

async function libraryOnDrive(
  lib: string,
  desktop: LibraryInfo,
): Promise<OnDrive | null | UsbFailure> {
  if (!(await exists(engineDatabasePath(lib)))) return null
  const marker = await readMarker(lib)
  let db: EngineDb | null = null
  try {
    db = openEngineDb(lib)
    if (!db || !marker) return 'engine-foreign'
    const info = libraryInfo(db)
    if (marker.uuid !== info.uuid) return 'engine-foreign'
    if (info.version !== desktop.version) return 'engine-schema'
    return {
      byOrigin: engineUsbTracksByOrigin(db, desktop.uuid),
      paths: db.prepare('SELECT path FROM Track WHERE path IS NOT NULL').pluck().all() as string[],
    }
  } catch {
    return 'engine-foreign'
  } finally {
    db?.close()
  }
}

// A player writes to the drive's library through SQLite's WAL, and a drive pulled from a
// player can keep those writes only in the -wal file. The export swaps its own database in
// and clears the -wal and -shm beside it (a stale -wal would be replayed over the new file),
// so the writes are folded into m.db first: a drive pulled between the clear and the swap
// then still holds them. Refused rather than half done, since the clear would drop the rest.
async function foldDriveWal(lib: string): Promise<void> {
  const file = engineDatabasePath(lib)
  if (!(await exists(`${file}-wal`))) return
  const db = new Database(file, { fileMustExist: true })
  try {
    db.pragma('busy_timeout = 250')
    const [result] = db.pragma('wal_checkpoint(TRUNCATE)') as {
      busy: number
      log: number
      checkpointed: number
    }[]
    if (result.busy !== 0 || result.log !== result.checkpointed)
      throw new Error('the Engine Library on the drive could not fold its WAL')
  } finally {
    db.close()
  }
}

function loadLibrary(lib: string): Database.Database {
  const db = openEngineDb(lib)
  if (!db) throw new Error('the Engine Library on the drive is gone')
  try {
    const bytes = db.serialize()
    bytes[18] = 1
    bytes[19] = 1
    return new Database(bytes)
  } finally {
    db.close()
  }
}

async function coverOf(art: Artwork | null): Promise<string | null> {
  if (!art) return null
  const bytes = await readFile(art.source).catch(() => null)
  if (!bytes) return null
  return `data:image/${bytes[0] === 0x89 ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}`
}

async function prepare(
  deps: EngineUsbExporterDeps,
  req: UsbExportRequest,
  strict: boolean,
): Promise<Prepared | UsbFailure> {
  if (req.playlistIds.length === 0) return 'nothing-selected'
  const desktopDir = deps.libraryDir()
  if (!desktopDir || !(await exists(engineDatabasePath(desktopDir)))) return 'engine-missing'
  const target = await resolveTarget(deps, req.target)
  if (typeof target === 'string') return target
  let sel: EngineUsbSelection
  let desktop: LibraryInfo
  try {
    const db = openEngineDb(desktopDir)
    if (!db) return 'engine-missing'
    try {
      sel = readEngineUsbSelection(db, desktopDir, req.playlistIds)
      desktop = libraryInfo(db)
    } finally {
      db.close()
    }
  } catch (err) {
    deps.log(`engine usb export could not read the library: ${String(err)}`)
    return 'engine-unreadable'
  }
  if (sel.tracks.length === 0) return 'nothing-selected'
  const lib = join(target.root, ENGINE_USB_FOLDER)
  const onDrive = await libraryOnDrive(lib, desktop)
  if (typeof onDrive === 'string') return onDrive
  const rootOf = (t: EngineUsbTrack) => (t.path ? sourceRoot(t.path, deps.platform) : null)
  const counts = new Map<string, number>()
  for (const t of sel.tracks) {
    const root = rootOf(t)
    if (root) counts.set(root, (counts.get(root) ?? 0) + 1)
  }
  const sources: string[] = []
  let unreachable: Prepared['unreachable'] = null
  for (const [root, tracks] of counts) {
    if (await exists(root)) sources.push(root)
    else unreachable ??= { volume: posix.basename(root), tracks }
  }
  if (unreachable && strict) return 'sources-unreachable'
  const reachable = new Set(sources)
  const basename = (deps.platform === 'win32' ? win32 : posix).basename
  const taken = new Set((onDrive?.paths ?? []).map((p) => p.toLowerCase()))
  const missing: EngineUsbTrack[] = []
  const streaming: EngineUsbTrack[] = []
  const found: { track: EngineUsbTrack; source: string; size: number }[] = []
  for (const t of sel.tracks) {
    if (!t.path) {
      streaming.push(t)
      continue
    }
    const root = rootOf(t)
    if (root && !reachable.has(root)) continue
    const size = await sizeOf(t.path)
    if (size === null) missing.push(t)
    else found.push({ track: t, source: t.path, size })
  }
  const artwork = await artworkOf(
    desktopDir,
    lib,
    found.flatMap((f) => artworkFileName(f.track.artHash) ?? []),
  )
  const planned: Planned[] = []
  for (const f of found) {
    const dest = onDrive?.byOrigin.get(f.track.id)?.path ?? allocate(basename(f.source), taken)
    const name = artworkFileName(f.track.artHash)
    planned.push({
      ...f,
      dest,
      onStick: (await sizeOf(onUsb(lib, dest))) === f.size,
      art: name ? (artwork.get(name) ?? null) : null,
    })
  }
  const included = new Set(planned.map((p) => p.track.id))
  const empty = sel.playlists
    .filter((p) => p.trackIds.length > 0 && !p.trackIds.some((id) => included.has(id)))
    .map((p) => p.name)
  if (empty.length && strict) return 'playlist-empty'
  const art = [...artwork.values()]
  const needed =
    planned.reduce((sum, p) => sum + (p.onStick ? 0 : p.size), 0) +
    art.reduce((sum, a) => sum + (a.present ? 0 : a.size), 0)
  return {
    target,
    lib,
    existing: onDrive !== null,
    sel,
    planned,
    missing,
    streaming,
    art,
    sources,
    unreachable,
    empty,
    needed,
    free: await deps.freeBytes(target.root),
  }
}

const shortOf = (p: Prepared): { neededBytes: number; freeBytes: number } | null =>
  p.free !== null && p.needed > p.free ? { neededBytes: p.needed, freeBytes: p.free } : null

async function rowsOf(p: Prepared): Promise<UsbPlanTrack[]> {
  const rows: UsbPlanTrack[] = []
  for (const item of p.planned)
    rows.push({
      id: String(item.track.id),
      title: item.track.title,
      artist: item.track.artist,
      size: item.size,
      onStick: item.onStick,
      separator: false,
      cover: await coverOf(item.art),
      wave: null,
    })
  return rows
}

function warningsOf(p: Prepared, engineOpen: boolean): UsbWarning[] {
  const out: UsbWarning[] = []
  if (engineOpen) out.push({ kind: 'engineOpen' })
  if (p.unreachable) out.push({ kind: 'sourcesUnreachable', ...p.unreachable })
  if (p.empty.length) out.push({ kind: 'emptyPlaylist', names: p.empty })
  if (p.target.kind === 'folder' && p.target.root !== p.target.volume?.mountPoint)
    out.push({ kind: 'notVolumeRoot' })
  const unexportable = [
    ...p.missing.map((t) => ({ title: t.title, reason: 'missing-file' as const })),
    ...p.streaming.map((t) => ({ title: t.title, reason: 'streaming' as const })),
  ]
  if (unexportable.length) out.push({ kind: 'unexportable', tracks: unexportable })
  const short = shortOf(p)
  if (short) out.push({ kind: 'noSpace', ...short })
  return out
}

interface RunState {
  phase: 'starting' | 'tracks' | 'database'
  cancelling: boolean
}

export function createEngineUsbExporter(deps: EngineUsbExporterDeps) {
  let running: RunState | null = null
  let waiters: Array<() => void> = []
  let stopping = false
  const release = (): void => {
    running = null
    stopping = false
    for (const w of waiters) w()
    waiters = []
  }

  async function plan(req: UsbExportRequest): Promise<UsbPlanResult> {
    if (running) return { ok: false, reason: 'busy' }
    try {
      const engineOpen = await deps.engineRunning()
      const p = await prepare(deps, req, false)
      if (typeof p === 'string') return { ok: false, reason: p }
      const tracks = await rowsOf(p)
      const entry = deps.memory.get(targetKey(req.target))
      const ids = new Set(tracks.map((t) => t.id))
      const summary: UsbPlan = {
        tracks,
        trackCount: tracks.length,
        newCount: tracks.filter((t) => !t.onStick).length,
        newBytes: tracks.filter((t) => !t.onStick).reduce((sum, t) => sum + t.size, 0),
        keptCount: tracks.filter((t) => t.onStick).length,
        removedSinceLast:
          entry && p.existing ? entry.trackIds.filter((id) => !ids.has(id)).length : null,
        warnings: warningsOf(p, engineOpen),
      }
      return { ok: true, plan: summary }
    } catch (err) {
      deps.log(`engine usb export summary failed: ${String(err)}`)
      return { ok: false, reason: 'baken-failed' }
    }
  }

  async function volumeAt(
    p: Prepared,
    req: UsbExportRequest,
    dev: number | null,
  ): Promise<number | UsbFailure> {
    if (req.target.kind === 'volume' && (await deps.idAt(p.target.root)) !== req.target.uuid)
      return 'volume-changed'
    const now = await deps.devOf(p.target.root)
    if (now === null || (dev !== null && now !== dev)) return 'volume-gone'
    return now
  }

  async function copyTrack(item: Planned, index: number, lib: string): Promise<boolean> {
    const dest = onUsb(lib, item.dest)
    const temp = `${dest}.surco-tmp`
    let copying = true
    deps.send({ type: 'progress', index, bytes: 0 })
    const poll = setInterval(() => {
      void stat(temp).then(
        (s) => {
          if (copying) deps.send({ type: 'progress', index, bytes: s.size })
        },
        () => {},
      )
    }, deps.pollMs ?? 250)
    try {
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(item.source, temp)
      await rename(temp, dest)
      copying = false
      deps.send({ type: 'track', index, state: 'done' })
      return true
    } catch (err) {
      copying = false
      await rm(temp, { force: true }).catch(() => {})
      deps.log(`engine usb export could not copy ${item.source}: ${String(err)}`)
      deps.send({
        type: 'failed',
        index,
        reason: (await exists(item.source)) ? 'device' : 'missing-file',
      })
      return false
    } finally {
      clearInterval(poll)
    }
  }

  async function writeLibrary(p: Prepared, landed: Planned[]): Promise<void> {
    const desktop = openEngineDb(deps.libraryDir())
    if (!desktop) throw new Error('the Engine DJ library is gone')
    let bytes: Buffer
    let uuid: string
    try {
      if (p.existing) await foldDriveWal(p.lib)
      const usb = p.existing ? loadLibrary(p.lib) : createEngineUsbDb(desktop)
      try {
        uuid = libraryUuid(usb)
        const ids = putEngineUsbTracks(
          usb,
          desktop,
          landed.map((l) => ({ desktopId: l.track.id, path: l.dest, fileBytes: l.size })),
        )
        const now = new Date(deps.now())
        for (const pl of p.sel.playlists)
          putEngineUsbPlaylist(
            usb,
            [...pl.folders, pl.name],
            pl.trackIds.flatMap((id) => ids.get(id) ?? []),
            now,
          )
        bytes = usb.serialize()
      } finally {
        usb.close()
      }
    } finally {
      desktop.close()
    }
    const file = engineDatabasePath(p.lib)
    await mkdir(dirname(file), { recursive: true })
    if (!p.existing) await writeFile(join(p.lib, MARKER), JSON.stringify({ uuid }))
    const temp = `${file}.surco-tmp`
    try {
      await writeFile(temp, bytes)
      for (const stale of ['-journal', '-wal', '-shm']) await rm(`${file}${stale}`, { force: true })
      await rename(temp, file)
    } catch (err) {
      await rm(temp, { force: true }).catch(() => {})
      throw err
    }
  }

  async function copyArtwork(p: Prepared): Promise<void> {
    for (const a of p.art) {
      if (a.present) continue
      try {
        await mkdir(dirname(a.dest), { recursive: true })
        await copyFile(a.source, a.dest)
      } catch (err) {
        deps.log(`engine usb export could not copy the cover ${a.source}: ${String(err)}`)
      }
    }
  }

  async function run(
    p: Prepared,
    req: UsbExportRequest,
    dev: number,
    state: RunState,
  ): Promise<UsbExportEvent> {
    const startedAt = deps.now()
    deps.send({ type: 'started', tracks: await rowsOf(p), targetName: p.target.name, startedAt })
    state.phase = 'tracks'
    const landed: Planned[] = []
    let failed = 0
    for (const [index, item] of p.planned.entries()) {
      if (state.cancelling || stopping) return { type: 'finished', outcome: 'cancelled' }
      if ((await deps.devOf(p.target.root)) !== dev)
        return { type: 'finished', outcome: 'error', reason: 'volume-gone' }
      if (item.onStick) {
        landed.push(item)
        deps.send({ type: 'track', index, state: 'kept' })
        continue
      }
      const root = sourceRoot(item.source, deps.platform)
      if (root && !(await exists(root)))
        return { type: 'finished', outcome: 'error', reason: 'source-lost' }
      if (await copyTrack(item, index, p.lib)) landed.push(item)
      else failed++
    }
    if (state.cancelling || stopping) return { type: 'finished', outcome: 'cancelled' }
    await copyArtwork(p)
    state.phase = 'database'
    deps.send({ type: 'database' })
    const still = await volumeAt(p, req, dev)
    if (typeof still === 'string') return { type: 'finished', outcome: 'error', reason: still }
    try {
      await writeLibrary(p, landed)
    } catch (err) {
      deps.log(`engine usb export could not write the library: ${String(err)}`)
      return { type: 'finished', outcome: 'error', reason: 'device-write' }
    }
    try {
      deps.memory.remember(targetKey(req.target), {
        playlistIds: req.playlistIds,
        trackIds: landed.map((l) => String(l.track.id)),
        at: deps.now(),
        pdb: null,
        prune: false,
        settings: false,
      })
    } catch (err) {
      deps.log(`engine usb export could not remember the drive: ${String(err)}`)
    }
    return {
      type: 'finished',
      outcome: 'done',
      tracks: landed.length,
      failed,
      ms: deps.now() - startedAt,
      syncFiles: true,
    }
  }

  async function start(req: UsbExportRequest): Promise<UsbStartResult> {
    if (running) return { ok: false, reason: 'busy' }
    const state: RunState = { phase: 'starting', cancelling: false }
    running = state
    const refuse = (
      reason: UsbFailure,
      extra: { neededBytes?: number; freeBytes?: number } = {},
    ): UsbStartResult => {
      release()
      return { ok: false, reason, ...extra }
    }
    try {
      if ((await deps.engineRunning()) && !(await deps.ensureEngineClosed()))
        return refuse('engine-open')
      const p = await prepare(deps, req, true)
      if (typeof p === 'string') return refuse(p)
      const short = shortOf(p)
      if (short) return refuse('no-space', short)
      const dev = await volumeAt(p, req, null)
      if (typeof dev === 'string') return refuse(dev)
      void run(p, req, dev, state)
        .catch((err): UsbExportEvent => {
          deps.log(`engine usb export failed: ${String(err)}`)
          return { type: 'finished', outcome: 'error', reason: 'baken-failed' }
        })
        .then((e) => {
          deps.send(e)
          release()
        })
      return { ok: true }
    } catch (err) {
      deps.log(`engine usb export did not start: ${String(err)}`)
      return refuse('baken-failed')
    }
  }

  function requestCancel(state: RunState | null): boolean {
    if (state?.phase !== 'tracks' || state.cancelling) return false
    state.cancelling = true
    deps.send({ type: 'cancelling' })
    return true
  }

  function stop(): Promise<void> {
    if (!running) return Promise.resolve()
    stopping = true
    requestCancel(running)
    return new Promise((r) => waiters.push(r))
  }

  return {
    plan,
    start,
    cancel: () => requestCancel(running),
    stop,
    busy: () => running !== null,
  }
}
