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
  stage: (sel: ExportSelection, dir: string, targetRoot: string) => Promise<Stage>
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
}

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

async function prepare(
  deps: UsbExporterDeps,
  req: UsbExportRequest,
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
  return { target, sel, stage: await deps.stage(sel, await deps.makeStageDir(), target.root) }
}

function planTracks(p: Prepared, plan: BakenPlan | null): UsbPlanTrack[] {
  const byId = new Map(p.sel.tracks.map((t) => [t.id, t]))
  const rows = plan
    ? plan.tracks.map((b) => ({ id: String(b.id), size: b.size, onStick: b.onStick }))
    : p.stage.included.map((id) => ({ id, size: p.stage.sizes.get(id) ?? 0, onStick: false }))
  return rows.flatMap((r) => {
    const t = byId.get(r.id)
    if (!t) return []
    return [
      {
        id: r.id,
        title: t.title,
        artist: t.artist,
        size: r.size,
        onStick: r.onStick,
        separator: t.separator,
        cover: p.stage.covers.get(r.id) ?? null,
        wave: p.stage.waves.get(r.id) ?? null,
      },
    ]
  })
}

function warningsOf(
  deps: UsbExporterDeps,
  p: Prepared,
  plan: BakenPlan | null,
  noSpace: { neededBytes: number; freeBytes: number } | null,
): UsbWarning[] {
  const out: UsbWarning[] = []
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

type DryRun = { plan: BakenPlan | null; error: BakenError | null; started: boolean }

export function createUsbExporter(deps: UsbExporterDeps) {
  const run = deps.run ?? runBaken
  // Claimed synchronously at the top of start(), before any await: two quick presses must
  // never start two bakens on one stick.
  let running: {
    phase: 'starting' | 'tracks' | 'database'
    cancelling: boolean
    cancel: () => void
  } | null = null

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
    const p = await prepare(deps, req)
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
      return { ok: true, plan: summary(deps, p, req, tracks, warningsOf(deps, p, d.plan, short)) }
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

  async function start(req: UsbExportRequest): Promise<UsbStartResult> {
    if (running) return { ok: false, reason: 'busy' }
    const state: {
      phase: 'starting' | 'tracks' | 'database'
      cancelling: boolean
      cancel: () => void
    } = {
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
      running = null
      if (staged) await deps.removeDir(staged.stage.dir)
      return { ok: false, reason, ...extra }
    }
    try {
      const p = await prepare(deps, req)
      if (typeof p === 'string') return refuse(p)
      staged = p
      if (req.target.kind === 'volume' && (await deps.idAt(p.target.root)) !== req.target.uuid)
        return refuse('volume-changed')
      const dev = await deps.devOf(p.target.root)
      if (dev === null) return refuse('volume-gone')
      const d = await dryRun(p, req)
      if (d === 'refused') return refuse('refused')
      if (!d.started) return refuse('no-baken')
      const short = shortOf(d)
      if (short) return refuse('no-space', short)
      if (!d.plan) return refuse(await failureAfter(d.error, req))
      if (!d.plan.volumeRoot && p.target.kind === 'volume') return refuse('not-volume-root')
      const args = argsFor(p, req, false)
      if (!args) return refuse('refused')
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
    state: { phase: 'starting' | 'tracks' | 'database'; cancelling: boolean; cancel: () => void },
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
    // Another volume under the same mount point or drive letter changes the device number
    // (on Windows it is the volume serial): stop at the next track.
    const watch = setInterval(() => {
      void deps.devOf(p.target.root).then((now) => {
        if (now === dev || lostVolume) return
        lostVolume = true
        if (state.phase === 'tracks') handle.cancel()
      })
    }, deps.devPollMs ?? 1000)
    void handle.done.then(async ({ started }) => {
      stopPoll()
      clearInterval(watch)
      running = null
      try {
        const r = report as BakenReport | null
        if (r && !r.cancelled) {
          for (const f of r.failures) deps.log(`usb export failed ${f.name}: ${f.message}`)
          deps.memory.remember(targetKey(req.target), {
            playlistIds: req.playlistIds,
            trackIds: tracks.map((t) => t.id),
            at: deps.now(),
            pdb: await deps.pdbFacts(p.target.root),
            prune: req.prune,
            settings: req.settings,
          })
          const counted = tracks.filter((t, i) => !t.separator && written.has(i)).length
          deps.send({
            type: 'finished',
            outcome: 'done',
            tracks: counted,
            failed: r.failures.length,
            ms: deps.now() - startedAt,
          })
        } else if (lostVolume)
          deps.send({ type: 'finished', outcome: 'error', reason: 'volume-gone' })
        else if (r?.cancelled) deps.send({ type: 'finished', outcome: 'cancelled' })
        else
          deps.send({
            type: 'finished',
            outcome: 'error',
            reason: started ? await failureAfter(error, req) : 'no-baken',
          })
      } finally {
        await deps.removeDir(p.stage.dir)
      }
    })
    return { ok: true }
  }

  // Only while tracks are copying, and only as a request: baken finishes the track in
  // progress and reports. Once it writes the databases, stopping could leave export.pdb new
  // and exportLibrary.db old: two libraries on one stick.
  function cancel(): boolean {
    if (running?.phase !== 'tracks' || running.cancelling) return false
    running.cancelling = true
    running.cancel()
    deps.send({ type: 'cancelling' })
    return true
  }

  return { plan, start, cancel, busy: () => running !== null }
}
