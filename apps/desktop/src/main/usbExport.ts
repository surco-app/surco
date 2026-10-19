import { posix, win32 } from 'node:path'
import type {
  UsbExportEvent,
  UsbExportRequest,
  UsbFailure,
  UsbPlan,
  UsbPlanResult,
  UsbPlanTrack,
  UsbStartResult,
  UsbTarget,
  UsbTrackFailure,
  UsbVolume,
  UsbWarning,
} from '../shared/types'
import {
  type BakenError,
  type BakenEvent,
  type BakenPlan,
  type BakenReport,
  bakenArgs,
  runBaken,
} from './bakenRun'
import {
  type MasterIdentity,
  nodeTimestamps,
  STALE_STICK_FILES,
  type StickNode,
  SYNC_FILES,
  stickDeviceIds,
  syncFileText,
} from './rekordboxStickSync'
import { targetKey, type UsbMemory } from './usbExportMemory'
import type { ExportSelection } from './usbExportSource'
import type { Stage } from './usbExportStage'
import { volumeContaining } from './usbVolumes'

// One USB export at a time: a dry run of baken for the summary; for an export, the claim,
// the identity check, a dry run for the root and the space, then the real run while the
// volume's device number is watched. Everything that touches the disk, the collection or a
// process comes in through deps, so the rules here are tested without any.

export interface UsbExporterDeps {
  platform: NodeJS.Platform
  collection: () => string
  readSelection: (dbPath: string, ids: string[]) => ExportSelection | 'unreadable'
  volumes: () => Promise<UsbVolume[]>
  idAt: (root: string) => Promise<string | null>
  devOf: (root: string) => Promise<number | null>
  realPath: (path: string) => Promise<string | null>
  baken: () => { file: string; prefixArgs: string[] } | null
  // targetRoot is where baken writes PIONEER/: a DEVSETTING.DAT already there is the
  // stick's own and the staged My Settings must not carry one over it.
  stage: (
    sel: ExportSelection,
    dir: string,
    targetRoot: string,
    stick: { identity: MasterIdentity; deviceIds: ReadonlyMap<string, number> },
  ) => Promise<Stage>
  makeStageDir: () => Promise<string>
  removeDir: (dir: string) => Promise<void>
  memory: UsbMemory
  home: string
  pioneerDir: string
  systemRoot: string
  send: (e: UsbExportEvent) => void
  now: () => number
  fileSize: (path: string) => Promise<number | null>
  pdbFacts: (root: string) => Promise<{ size: number; mtimeMs: number } | null>
  log: (message: string) => void
  rekordboxRunning: () => Promise<boolean>
  // The close dialog: true once rekordbox is gone, false when the user kept it open.
  ensureRekordboxClosed: () => Promise<boolean>
  exists: (path: string) => Promise<boolean>
  readText: (path: string) => Promise<string | null>
  // Written beside and renamed over, so rekordbox never reads half a file.
  writeAtomic: (path: string, text: string) => Promise<void>
  // A missing file is fine.
  removeFile: (path: string) => Promise<void>
  identity: (dbPath: string, trackIds: string[]) => MasterIdentity | 'unreadable'
  masterPlaylistsXml: () => Promise<string | null>
  pollMs?: number
  devPollMs?: number
  run?: typeof runBaken
}

interface Target {
  root: string
  name: string
  volume: UsbVolume | null
  kind: 'volume' | 'folder'
}

interface Prepared {
  target: Target
  sel: ExportSelection
  stage: Stage
  identity: MasterIdentity
  nodes: StickNode[]
  deviceIds: Map<string, number>
  // The roots of the volumes holding the selected music, all mounted when it was prepared.
  sources: string[]
  unreachable: { volume: string; tracks: number } | null
  // Names of the selected playlists left with no exportable track.
  empty: string[]
}

// The close dialog's wording for an export: rekordbox can come back once the USB is done,
// not right away while baken writes it.
export const USB_QUIT_DETAIL = 'rekordboxQuitDetailUsb' as const

const CDJ2000_FLAC = 5

// baken's per-track failure texts are English and for a terminal; the UI gets a code.
export function failureReason(message: string): UsbTrackFailure {
  const m = message.toLowerCase()
  if (/no such file|not found|cannot find|os error 2\b/.test(m)) return 'missing-file'
  if (/stick|device|disappeared|read-only|no space|os error 28\b/.test(m)) return 'device'
  return 'unreadable'
}

async function resolveTarget(deps: UsbExporterDeps, t: UsbTarget): Promise<Target | UsbFailure> {
  const volumes = await deps.volumes()
  if (t.kind === 'volume') {
    const v = volumes.find((x) => x.uuid === t.uuid)
    return v ? { root: v.mountPoint, name: v.name, volume: v, kind: 'volume' } : 'volume-gone'
  }
  const real = await deps.realPath(t.path)
  if (!real) return 'volume-gone'
  const on = volumeContaining(volumes, real, deps.platform)
  if (!on) return 'not-removable'
  const name = (deps.platform === 'win32' ? win32 : posix).basename(real)
  return {
    root: real,
    name,
    volume: volumes.find((v) => v.uuid === on.uuid) ?? null,
    kind: 'folder',
  }
}

// The root of the volume a track is on, the one that has to be mounted for it to be read:
// /Volumes/<name> on macOS (anything else is the system disk, always there), the drive root
// or the \\server\share\ of a UNC path on Windows.
export function sourceRoot(path: string, platform: NodeJS.Platform): string | null {
  if (platform === 'win32') {
    const unc = /^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)/.exec(path)
    if (unc) return `\\\\${unc[1]}\\${unc[2]}\\`
    const drive = /^([A-Za-z]):/.exec(path)
    return drive ? `${drive[1].toUpperCase()}:\\` : null
  }
  const mount = /^\/Volumes\/([^/]+)/.exec(path)
  return mount ? `/Volumes/${mount[1]}` : null
}

const volumeName = (root: string, platform: NodeJS.Platform): string =>
  platform === 'win32' ? root.replace(/\\$/, '') : posix.basename(root)

// The tracks counted per root leave separators out, as every count the user sees does.
function sourcesOf(sel: ExportSelection, platform: NodeJS.Platform): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of sel.tracks) {
    if (t.streaming) continue
    const root = sourceRoot(t.path, platform)
    if (root) out.set(root, (out.get(root) ?? 0) + (t.separator ? 0 : 1))
  }
  return out
}

// Folders before the playlists inside them, in tree order, each once: the order new
// stick ids are handed out and the sync file lists them.
function stickNodes(sel: ExportSelection): StickNode[] {
  const out: StickNode[] = []
  const seen = new Set<string>()
  const add = (n: StickNode): void => {
    if (seen.has(n.id)) return
    seen.add(n.id)
    out.push(n)
  }
  for (const p of sel.playlists) {
    p.folderIds.forEach((id, i) => {
      add({ id, parentId: p.folderIds[i - 1] ?? 'root', folder: true })
    })
    add({ id: p.id, parentId: p.folderIds.at(-1) ?? 'root', folder: false })
  }
  return out
}

// A playlist with tracks of which none reaches the stick. A playlist empty in rekordbox
// too loses nothing and is left alone; separators alone are no music.
function emptyPlaylists(sel: ExportSelection, stage: Stage): string[] {
  const included = new Set(stage.included)
  const separators = new Set(sel.tracks.filter((t) => t.separator).map((t) => t.id))
  return sel.playlists
    .filter((p) => {
      const music = p.trackIds.filter((id) => !separators.has(id))
      return music.length > 0 && !music.some((id) => included.has(id))
    })
    .map((p) => p.name)
}

const joinFor = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix).join

// strict is the export: what the summary only warns about refuses it.
async function prepare(
  deps: UsbExporterDeps,
  req: UsbExportRequest,
  strict: boolean,
): Promise<Prepared | UsbFailure> {
  if (req.playlistIds.length === 0) return 'nothing-selected'
  const db = deps.collection()
  if (!db) return 'no-collection'
  if (!deps.baken()) return 'no-baken'
  const target = await resolveTarget(deps, req.target)
  if (typeof target === 'string') return target
  const sel = deps.readSelection(db, req.playlistIds)
  if (sel === 'unreadable') return 'unreadable'
  if (sel.tracks.length === 0) return 'nothing-selected'
  const identity = deps.identity(
    db,
    sel.tracks.map((t) => t.id),
  )
  if (identity === 'unreadable') return 'unreadable'
  // An unmounted NAS or disk would make every one of its tracks "missing" and the stick
  // would lose them all.
  const sources: string[] = []
  let unreachable: Prepared['unreachable'] = null
  for (const [root, tracks] of sourcesOf(sel, deps.platform)) {
    if (await deps.exists(root)) sources.push(root)
    else unreachable ??= { volume: volumeName(root, deps.platform), tracks }
  }
  if (unreachable && strict) return 'sources-unreachable'
  const join = joinFor(deps.platform)
  const nodes = stickNodes(sel)
  let deviceIds: Map<string, number>
  try {
    deviceIds = stickDeviceIds(
      nodes,
      await deps.readText(join(target.root, 'PIONEER', 'rekordbox', 'playlists3.sync')),
    )
  } catch (err) {
    deps.log(`usb export has no stick playlist id left: ${String(err)}`)
    return 'stick-ids-full'
  }
  const dir = await deps.makeStageDir()
  try {
    const stage = await deps.stage(sel, dir, target.root, { identity, deviceIds })
    const empty = emptyPlaylists(sel, stage)
    if (empty.length && strict) {
      await deps.removeDir(dir)
      return 'playlist-empty'
    }
    return { target, sel, stage, identity, nodes, deviceIds, sources, unreachable, empty }
  } catch (err) {
    await deps.removeDir(dir)
    throw err
  }
}

function planTracks(p: Prepared, plan: BakenPlan | null): UsbPlanTrack[] {
  const byId = new Map(p.sel.tracks.map((t) => [t.id, t]))
  const rows = plan
    ? plan.tracks.map((b) => ({ id: String(b.id), size: b.size, onStick: b.onStick }))
    : p.stage.included.map((id) => ({ id, size: p.stage.sizes.get(id) ?? 0, onStick: false }))
  // One row per plan track, known or not: baken's events carry the position in its plan,
  // and a dropped row would shift every later one onto the wrong track.
  return rows.map((r) => {
    const t = byId.get(r.id)
    return {
      id: r.id,
      title: t?.title ?? '',
      artist: t?.artist ?? '',
      size: r.size,
      onStick: r.onStick,
      separator: t?.separator ?? false,
      cover: p.stage.covers.get(r.id) ?? null,
      wave: p.stage.waves.get(r.id) ?? null,
    }
  })
}

function warningsOf(
  deps: UsbExporterDeps,
  p: Prepared,
  plan: BakenPlan | null,
  noSpace: { neededBytes: number; freeBytes: number } | null,
  rekordboxOpen: boolean,
): UsbWarning[] {
  const out: UsbWarning[] = []
  if (rekordboxOpen) out.push({ kind: 'rekordboxOpen' })
  if (p.unreachable) out.push({ kind: 'sourcesUnreachable', ...p.unreachable })
  if (p.empty.length) out.push({ kind: 'emptyPlaylist', names: p.empty })
  const v = p.target.volume
  if (v?.holder.by === 'rekordbox' && p.target.kind === 'volume')
    out.push({ kind: 'rekordboxExport' })
  if (v?.filesystem === 'exfat') out.push({ kind: 'exfat' })
  if (v?.filesystem === 'ntfs') out.push({ kind: 'ntfs' })
  if (v?.partitionScheme === 'gpt') out.push({ kind: 'gpt' })
  if (p.target.kind === 'folder' && plan && !plan.volumeRoot) out.push({ kind: 'notVolumeRoot' })
  const included = new Set(p.stage.included)
  const old = p.sel.tracks.filter(
    (t) =>
      included.has(t.id) &&
      (t.fileType === CDJ2000_FLAC || t.bitDepth > 24 || t.sampleRate > 48000),
  )
  if (old.length) out.push({ kind: 'cdj2000', titles: old.map((t) => t.title) })
  const missing = new Set(p.stage.missing)
  for (const s of plan?.skipped ?? []) deps.log(`baken skipped ${s.name}: ${s.reason}`)
  const unexportable = [
    ...p.sel.tracks
      .filter((t) => missing.has(t.id))
      .map((t) => ({ title: t.title, reason: 'missing-file' as const })),
    ...p.sel.tracks
      .filter((t) => t.streaming)
      .map((t) => ({ title: t.title, reason: 'streaming' as const })),
    ...(plan?.skipped ?? []).map((s) => ({ title: s.name, reason: 'skipped' as const })),
  ]
  if (unexportable.length) out.push({ kind: 'unexportable', tracks: unexportable })
  if (noSpace) out.push({ kind: 'noSpace', ...noSpace })
  return out
}

function summary(
  deps: UsbExporterDeps,
  p: Prepared,
  req: UsbExportRequest,
  tracks: UsbPlanTrack[],
  warnings: UsbWarning[],
): UsbPlan {
  const real = tracks.filter((t) => !t.separator)
  const entry = deps.memory.get(targetKey(req.target))
  const ours = p.target.kind === 'folder' || p.target.volume?.holder.by === 'surco'
  const ids = new Set(tracks.map((t) => t.id))
  return {
    tracks,
    trackCount: real.length,
    newCount: real.filter((t) => !t.onStick).length,
    newBytes: tracks.filter((t) => !t.onStick).reduce((sum, t) => sum + t.size, 0),
    keptCount: real.filter((t) => t.onStick).length,
    removedSinceLast: entry && ours ? entry.trackIds.filter((id) => !ids.has(id)).length : null,
    warnings,
  }
}

interface RunState {
  phase: 'starting' | 'tracks' | 'database'
  cancelling: boolean
  cancel: () => void
}

type DryRun = { plan: BakenPlan | null; error: BakenError | null; started: boolean }

export function createUsbExporter(deps: UsbExporterDeps) {
  const run = deps.run ?? runBaken
  // Claimed synchronously at the top of start(), before any await: two quick presses must
  // never start two bakens on one stick.
  let running: RunState | null = null
  // Who waits for the run to end: a quit holds until finished is sent.
  let waiters: Array<() => void> = []
  let stopping = false
  const release = (): void => {
    running = null
    stopping = false
    for (const w of waiters) w()
    waiters = []
  }
  const stickFile = (p: Prepared, name: string): string =>
    joinFor(deps.platform)(p.target.root, 'PIONEER', 'rekordbox', name)

  // rekordbox reads these to know which of its playlists the stick holds and keeps them in
  // sync. They describe the library baken just wrote, so they come only after its success;
  // failing them leaves that library intact, which is not a failed export.
  async function writeSyncFiles(p: Prepared): Promise<boolean> {
    let file = 'masterPlaylists6.xml'
    try {
      const text = syncFileText(
        p.identity.dbId,
        p.nodes,
        p.deviceIds,
        nodeTimestamps((await deps.masterPlaylistsXml()) ?? ''),
        new Map(p.sel.playlists.map((pl) => [pl.id, pl.updatedAt])),
      )
      for (const name of SYNC_FILES) {
        file = stickFile(p, name)
        await deps.writeAtomic(file, text)
      }
      return true
    } catch (err) {
      deps.log(`usb export could not write ${file}: ${String(err)}`)
      return false
    }
  }

  const argsFor = (p: Prepared, req: UsbExportRequest, dryRun: boolean): string[] | null => {
    try {
      return bakenArgs({
        stage: p.stage,
        device: p.target.root,
        target: p.target.kind,
        prune: req.prune,
        settings: req.settings,
        dryRun,
        platform: deps.platform,
        home: deps.home,
        pioneerDir: deps.pioneerDir,
        systemRoot: deps.systemRoot,
      })
    } catch {
      return null
    }
  }

  async function dryRun(p: Prepared, req: UsbExportRequest): Promise<DryRun | 'refused'> {
    const args = argsFor(p, req, true)
    if (!args) return 'refused'
    let plan: BakenPlan | null = null
    let error: BakenError | null = null
    const { started } = await run(
      deps.baken() as { file: string; prefixArgs: string[] },
      args,
      (e) => {
        if (e.event === 'plan') plan = e
        if (e.event === 'error') error = e
      },
    ).done
    return { plan, error, started }
  }

  const shortOf = (d: DryRun): { neededBytes: number; freeBytes: number } | null => {
    if (d.error?.kind === 'not-enough-space')
      return { neededBytes: d.error.needed ?? 0, freeBytes: d.error.available ?? 0 }
    if (d.plan && d.plan.spaceAvailable !== null && d.plan.spaceNeeded > d.plan.spaceAvailable)
      return { neededBytes: d.plan.spaceNeeded, freeBytes: d.plan.spaceAvailable }
    return null
  }

  async function plan(req: UsbExportRequest): Promise<UsbPlanResult> {
    // A renderer reloaded mid-export reopens the chooser: no second baken on that stick.
    if (running) return { ok: false, reason: 'busy' }
    try {
      return await summarise(req)
    } catch (err) {
      deps.log(`usb export summary failed: ${String(err)}`)
      return { ok: false, reason: 'baken-failed' }
    }
  }

  // Only reads, so it works with rekordbox open and never asks to close it.
  async function summarise(req: UsbExportRequest): Promise<UsbPlanResult> {
    const rekordboxOpen = await deps.rekordboxRunning()
    const p = await prepare(deps, req, false)
    if (typeof p === 'string') return { ok: false, reason: p }
    try {
      const d = await dryRun(p, req)
      if (d === 'refused') return { ok: false, reason: 'refused' }
      if (!d.started) return { ok: false, reason: 'no-baken' }
      const short = shortOf(d)
      if (!d.plan && !short)
        return {
          ok: false,
          reason: d.error?.kind === 'device-write' ? 'device-write' : 'baken-failed',
        }
      if (d.plan && !d.plan.volumeRoot && p.target.kind === 'volume')
        return { ok: false, reason: 'not-volume-root' }
      const tracks = planTracks(p, d.plan)
      return {
        ok: true,
        plan: summary(deps, p, req, tracks, warningsOf(deps, p, d.plan, short, rekordboxOpen)),
      }
    } finally {
      await deps.removeDir(p.stage.dir)
    }
  }

  async function failureAfter(
    error: BakenError | null,
    req: UsbExportRequest,
  ): Promise<UsbFailure> {
    if (error?.kind === 'not-enough-space') return 'no-space'
    if (error?.kind === 'device-write' || error?.kind === 'device-not-found') {
      // A stick pulled out mid-copy reads as a write error; say what really happened.
      const t = req.target
      if (t.kind === 'volume' && !(await deps.volumes()).some((v) => v.uuid === t.uuid))
        return 'volume-gone'
      return 'device-write'
    }
    return 'baken-failed'
  }

  // What is mounted at the target's root now: the selected volume by its identifier, and
  // the device number, which must still be `dev` once one was recorded. Never by name.
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

  async function start(req: UsbExportRequest): Promise<UsbStartResult> {
    if (running) return { ok: false, reason: 'busy' }
    const state: RunState = {
      phase: 'starting',
      cancelling: false,
      cancel: () => {},
    }
    running = state
    let staged: Prepared | null = null
    const refuse = async (
      reason: UsbFailure,
      extra: { neededBytes?: number; freeBytes?: number } = {},
    ): Promise<UsbStartResult> => {
      release()
      if (staged) await deps.removeDir(staged.stage.dir)
      return { ok: false, reason, ...extra }
    }
    try {
      // rekordbox holds master.db and rewrites the stick's .sync files while it runs.
      if ((await deps.rekordboxRunning()) && !(await deps.ensureRekordboxClosed()))
        return refuse('rekordbox-open')
      const p = await prepare(deps, req, true)
      if (typeof p === 'string') return refuse(p)
      staged = p
      const dev = await volumeAt(p, req, null)
      if (typeof dev === 'string') return refuse(dev)
      const d = await dryRun(p, req)
      if (d === 'refused') return refuse('refused')
      if (!d.started) return refuse('no-baken')
      const short = shortOf(d)
      if (short) return refuse('no-space', short)
      if (!d.plan) return refuse(await failureAfter(d.error, req))
      if (!d.plan.volumeRoot && p.target.kind === 'volume') return refuse('not-volume-root')
      const args = argsFor(p, req, false)
      if (!args) return refuse('refused')
      // The dry run takes a while: a stick swapped meanwhile must not get the real run.
      const still = await volumeAt(p, req, dev)
      if (typeof still === 'string') return refuse(still)
      // Only now, on the stick just checked: a WAL left beside the new exportLibrary.db
      // would replay rekordbox's pages onto it. These four names and nothing else.
      for (const name of STALE_STICK_FILES) await deps.removeFile(stickFile(p, name))
      return launch(p, req, args, dev, state)
    } catch (err) {
      deps.log(`usb export did not start: ${String(err)}`)
      return refuse('baken-failed')
    }
  }

  function launch(
    p: Prepared,
    req: UsbExportRequest,
    args: string[],
    dev: number,
    state: RunState,
  ): UsbStartResult {
    const startedAt = deps.now()
    const join = (deps.platform === 'win32' ? win32 : posix).join
    let tracks: UsbPlanTrack[] = []
    const written = new Set<number>()
    let current = -1
    let poll: NodeJS.Timeout | null = null
    let report: BakenReport | null = null
    let error: BakenError | null = null
    let lostVolume = false
    let lostSource = false
    let checkingSources = false
    state.phase = 'tracks'
    const stopPoll = (): void => {
      if (poll) clearInterval(poll)
      poll = null
      current = -1
    }
    const onEvent = (e: BakenEvent): void => {
      switch (e.event) {
        case 'plan':
          tracks = planTracks(p, e)
          deps.send({ type: 'started', tracks, targetName: p.target.name, startedAt })
          break
        case 'start': {
          stopPoll()
          current = e.index
          deps.send({ type: 'progress', index: e.index, bytes: 0 })
          if (tracks[e.index]?.onStick) break
          const file = join(p.target.root, e.usbPath)
          const index = e.index
          poll = setInterval(() => {
            void deps.fileSize(file).then((bytes) => {
              if (bytes !== null && current === index) deps.send({ type: 'progress', index, bytes })
            })
          }, deps.pollMs ?? 250)
          break
        }
        case 'written':
          stopPoll()
          written.add(e.index)
          deps.send({ type: 'track', index: e.index, state: e.kept ? 'kept' : 'done' })
          break
        case 'failed':
          stopPoll()
          deps.log(`usb export track ${e.index} failed: ${e.message}`)
          deps.send({ type: 'failed', index: e.index, reason: failureReason(e.message) })
          break
        case 'database':
          stopPoll()
          state.phase = 'database'
          deps.send({ type: 'database' })
          break
        case 'report':
          report = e
          break
        case 'error':
          error = e
          break
      }
    }
    const handle = run(deps.baken() as { file: string; prefixArgs: string[] }, args, onEvent)
    state.cancel = handle.cancel
    if (stopping) requestCancel(state)
    // Another volume under the same mount point or drive letter changes the device number
    // (on Windows it is the volume serial): stop at the next track. So does a music volume
    // going away, which would fail every track left; one check of those at a time, as a
    // sleeping NAS can hold a stat for seconds.
    const watch = setInterval(() => {
      void deps.devOf(p.target.root).then((now) => {
        if (now === dev || lostVolume) return
        lostVolume = true
        requestCancel(state)
      })
      if (checkingSources || lostSource) return
      checkingSources = true
      void Promise.all(p.sources.map((root) => deps.exists(root))).then((up) => {
        checkingSources = false
        if (up.every(Boolean) || lostSource) return
        lostSource = true
        requestCancel(state)
      })
    }, deps.devPollMs ?? 1000)
    // The stick is not this export's once its identifier or device number moved; the poll
    // above may not have run since the last track, and the .sync files are the last write.
    const stillOurs = async (): Promise<boolean> => {
      const now = await volumeAt(p, req, dev)
      if (typeof now === 'number') return true
      deps.log(`usb export wrote no sync file: ${now} at ${p.target.root}`)
      return false
    }
    // What a whole export leaves besides baken's library. Neither failing makes the export
    // a failed one: the library on the stick is complete either way.
    const afterSuccess = async (r: BakenReport): Promise<boolean> => {
      for (const f of r.failures) deps.log(`usb export failed ${f.name}: ${f.message}`)
      if (!(await stillOurs())) return false
      const syncFiles = await writeSyncFiles(p)
      try {
        // After the .sync files, so export.pdb's remembered facts are the final ones.
        deps.memory.remember(targetKey(req.target), {
          playlistIds: req.playlistIds,
          trackIds: tracks.map((t) => t.id),
          at: deps.now(),
          pdb: await deps.pdbFacts(p.target.root),
          prune: req.prune,
          settings: req.settings,
        })
      } catch (err) {
        deps.log(`usb export could not remember the stick: ${String(err)}`)
      }
      return syncFiles
    }
    const outcome = async (started: boolean): Promise<UsbExportEvent> => {
      const r = report as BakenReport | null
      // Checked first: even a run baken finished may have written part of itself to
      // whatever took the stick's place, so it is never remembered as this stick's.
      if (lostVolume) return { type: 'finished', outcome: 'error', reason: 'volume-gone' }
      if (r && !r.cancelled) {
        const syncFiles = await afterSuccess(r)
        const counted = tracks.filter((t, i) => !t.separator && written.has(i)).length
        return {
          type: 'finished',
          outcome: 'done',
          tracks: counted,
          failed: r.failures.length,
          ms: deps.now() - startedAt,
          syncFiles,
        }
      }
      // A report that was not cancelled above is a whole export even if a source went
      // meanwhile; otherwise the lost source is why it stopped.
      if (lostSource) return { type: 'finished', outcome: 'error', reason: 'source-lost' }
      if (r?.cancelled) return { type: 'finished', outcome: 'cancelled' }
      return {
        type: 'finished',
        outcome: 'error',
        reason: started ? await failureAfter(error, req) : 'no-baken',
      }
    }
    void handle.done.then(async ({ started }) => {
      stopPoll()
      clearInterval(watch)
      // finished always goes out: the modal and the pill wait for it with no Cancel left.
      // The claim is released only once it is sent, so no second baken starts on the stick
      // while the .sync files are still being written.
      try {
        deps.send(await outcome(started))
      } catch (err) {
        deps.log(`usb export could not report its outcome: ${String(err)}`)
        deps.send({ type: 'finished', outcome: 'error', reason: 'baken-failed' })
      } finally {
        release()
      }
      await deps.removeDir(p.stage.dir)
    })
    return { ok: true }
  }

  // Only while tracks are copying, and only as a request: baken finishes the track in
  // progress and reports. Once it writes the databases, stopping could leave export.pdb new
  // and exportLibrary.db old: two libraries on one stick.
  // The device watch asks through here too, so the renderer shows the same "stopping".
  function requestCancel(state: RunState | null): boolean {
    if (state?.phase !== 'tracks' || state.cancelling) return false
    state.cancelling = true
    state.cancel()
    deps.send({ type: 'cancelling' })
    return true
  }

  function cancel(): boolean {
    return requestCancel(running)
  }

  // Quitting: stop at the next track as Cancel does, or let the databases finish, and
  // settle once finished is sent. An export still starting is cancelled as it launches.
  function stop(): Promise<void> {
    if (!running) return Promise.resolve()
    stopping = true
    requestCancel(running)
    return new Promise((r) => waiters.push(r))
  }

  return { plan, start, cancel, stop, busy: () => running !== null }
}
