import { readFileSync } from 'node:fs'
import {
  access,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import log from 'electron-log/main'
import type { DjProgram } from '../shared/djProgram'
import type { UsbExportRequest, UsbFolderPick, UsbProgram, UsbVolumeList } from '../shared/types'
import type { DetailKeyOf } from './djProcesses'
import { isEngineDjRunning } from './engineProcess'
import {
  createEngineUsbExporter,
  ENGINE_USB_QUIT_DETAIL,
  engineLibraryHolder,
} from './engineUsbExport'
import { openRekordboxDb } from './rekordboxDb'
import { playlistXmlPath } from './rekordboxMasterXml'
import { isRekordboxRunning } from './rekordboxProcess'
import { readMasterIdentity } from './rekordboxStickSync'
import { readSeratoLibrary, type SeratoLibraryRoot } from './seratoLibrary'
import { createUsbExporter, USB_QUIT_DETAIL, type UsbExporterDeps } from './usbExport'
import { createUsbMemory, targetKey, type UsbMemory } from './usbExportMemory'
import { routeUsbExports, type UsbExporter } from './usbExportRoute'
import { readSeratoExportSelection, seratoExportMarks } from './usbExportSerato'
import { readExportSelection } from './usbExportSource'
import { stageExport } from './usbExportStage'
import { readTraktorExportSelection, traktorExportDelta } from './usbExportTraktor'
import { readVolumes, stickHolder, systemVolumeSource, watchVolumes } from './usbVolumes'

// The USB export's IPC, macOS and Windows. Elsewhere every call answers "unsupported" and
// nothing is watched; the renderer does not offer the feature there at all.
// Returns what the quit guard needs: whether an export runs, and how to stop it.
export function registerUsbExportIpc(opts: {
  collection: () => string
  userData: string
  home: string
  // %APPDATA% on Windows (app.getPath('appData')); unused on macOS.
  appData: string
  baken: () => { file: string; prefixArgs: string[] } | null
  // The close dialog the playlist writer uses, with the export's wording; true once
  // the program is gone.
  ensureClosed: <P extends UsbProgram>(
    program: P,
    win: BrowserWindow | null,
    detail: DetailKeyOf<P>,
  ) => Promise<boolean>
  engineLibrary: () => string
  serato?: { roots: () => SeratoLibraryRoot[] }
  traktor?: { nml: () => string; bootVolume: () => string }
}): { busy: () => boolean; stop: () => Promise<void> } | null {
  const platform = process.platform
  const source = systemVolumeSource(platform)
  if (!source) {
    ipcMain.handle('usb:volumes', (): UsbVolumeList => ({ volumes: [], lastKey: null }))
    ipcMain.handle('usb:pickFolder', () => null)
    ipcMain.handle('usb:plan', () => ({ ok: false, reason: 'unsupported' }))
    ipcMain.handle('usb:export', () => ({ ok: false, reason: 'unsupported' }))
    ipcMain.handle('usb:cancel', () => false)
    return null
  }
  const win = platform === 'win32'
  // rekordbox's own folders: never written, never handed to baken.
  const pioneerDir = win ? join(opts.appData, 'Pioneer') : join(opts.home, 'Library', 'Pioneer')
  const settingsSource = win
    ? join(opts.appData, 'Pioneer', 'rekordbox6')
    : join(opts.home, 'Library', 'Application Support', 'Pioneer', 'rekordbox6')
  const systemRoot = win ? `${process.env.SystemDrive ?? 'C:'}\\` : '/'
  const memory = createUsbMemory(join(opts.userData, 'usb-exports.json'))
  const engineMemory = createUsbMemory(join(opts.userData, 'usb-engine-exports.json'))
  const broadcast = (channel: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }
  // The window that pressed Exportar, for the close dialog: one export at a time.
  let asking: BrowserWindow | null = null
  const sourceMemories: Partial<Record<'serato' | 'traktor', UsbMemory>> = {
    ...(opts.serato && {
      serato: createUsbMemory(join(opts.userData, 'usb-serato-exports.json')),
    }),
    ...(opts.traktor && {
      traktor: createUsbMemory(join(opts.userData, 'usb-traktor-exports.json')),
    }),
  }
  const list = async (): Promise<UsbVolumeList> => ({
    volumes: await readVolumes(
      source,
      memory,
      stickHolder,
      undefined,
      {
        memory: engineMemory,
        holder: engineLibraryHolder,
      },
      sourceMemories,
    ),
    lastKey: memory.last(),
  })
  const rekordboxDeps: UsbExporterDeps = {
    platform,
    collection: opts.collection,
    readSelection: (path, ids) => {
      const db = openRekordboxDb(path, { readonly: true })
      if (!db) return 'unreadable'
      try {
        return readExportSelection(db, ids)
      } catch {
        return 'unreadable'
      } finally {
        db.close()
      }
    },
    volumes: () => readVolumes(source, memory),
    idAt: (root) => source.idAt(root),
    devOf: (root) =>
      stat(root)
        .then((s) => s.dev)
        .catch(() => null),
    realPath: (p) => realpath(p).catch(() => null),
    baken: opts.baken,
    // rekordbox keeps the analysis and artwork beside master.db, in share/.
    stage: async (sel, dir, targetRoot, stick) =>
      stageExport({
        sel,
        shareDir: join(dirname(opts.collection()), 'share'),
        settingsSource,
        dir,
        identity: stick.identity,
        deviceIds: stick.deviceIds,
        stickHas: await readdir(join(targetRoot, 'PIONEER')).catch(() => []),
      }),
    makeStageDir: () => mkdtemp(join(tmpdir(), 'surco-usb-')),
    removeDir: (dir) => rm(dir, { recursive: true, force: true }),
    memory,
    home: opts.home,
    pioneerDir,
    systemRoot,
    send: (e) => broadcast('usb:event', e),
    now: () => Date.now(),
    fileSize: (path) =>
      stat(path)
        .then((s) => s.size)
        .catch(() => null),
    pdbFacts: (root) =>
      stat(join(root, 'PIONEER', 'rekordbox', 'export.pdb'))
        .then((s) => ({ size: s.size, mtimeMs: s.mtimeMs }))
        .catch(() => null),
    log: (m) => log.info(m),
    rekordboxRunning: isRekordboxRunning,
    ensureRekordboxClosed: () => opts.ensureClosed('rekordbox', asking, USB_QUIT_DETAIL),
    exists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    readText: (path) => readFile(path, 'utf8').catch(() => null),
    // Beside and renamed over, so rekordbox never reads half a file; no chmod, which FAT
    // and exFAT do not keep.
    writeAtomic: async (path, text) => {
      const temp = `${path}.surco-tmp`
      try {
        await writeFile(temp, text, 'utf8')
        await rename(temp, path)
      } catch (err) {
        await rm(temp, { force: true })
        throw err
      }
    },
    removeFile: (path) => rm(path, { force: true }),
    // Read-only, which works with rekordbox open: the summary reads it then.
    identity: (path, trackIds) => {
      const db = openRekordboxDb(path, { readonly: true })
      if (!db) return 'unreadable'
      try {
        return readMasterIdentity(db, trackIds)
      } catch {
        return 'unreadable'
      } finally {
        db.close()
      }
    },
    masterPlaylistsXml: () =>
      readFile(playlistXmlPath(opts.collection()), 'utf8').catch(() => null),
  }
  const pioneerFrom = (
    sourceMemory: UsbMemory,
    collection: () => string,
    readSelection: UsbExporterDeps['readSelection'],
  ): UsbExporter =>
    createUsbExporter({
      ...rekordboxDeps,
      collection,
      readSelection,
      volumes: () => readVolumes(source, sourceMemory),
      stage: (sel, dir) =>
        stageExport({
          sel,
          shareDir: '',
          settingsSource: null,
          dir,
          identity: null,
          deviceIds: new Map(),
          stickHas: [],
        }),
      memory: sourceMemory,
      rekordboxRunning: async () => false,
      ensureRekordboxClosed: async () => true,
      identity: () => null,
      masterPlaylistsXml: async () => null,
    })
  const serato = opts.serato
  const seratoExporter =
    serato &&
    sourceMemories.serato &&
    pioneerFrom(
      sourceMemories.serato,
      () => serato.roots()[0]?.dir ?? '',
      (_path, ids) =>
        readSeratoExportSelection(readSeratoLibrary(serato.roots()), ids, {
          marks: seratoExportMarks,
        }),
    )
  const traktor = opts.traktor
  const traktorExporter =
    traktor &&
    sourceMemories.traktor &&
    pioneerFrom(sourceMemories.traktor, traktor.nml, (path, ids) =>
      readTraktorExportSelection(readFileSync(path, 'utf8'), ids, {
        bootVolume: traktor.bootVolume(),
        deltaOf: traktorExportDelta,
      }),
    )
  const exporter = createUsbExporter(rekordboxDeps)
  const engineExporter = createEngineUsbExporter({
    platform,
    libraryDir: opts.engineLibrary,
    volumes: () => readVolumes(source, memory),
    idAt: (root) => source.idAt(root),
    devOf: (root) =>
      stat(root)
        .then((s) => s.dev)
        .catch(() => null),
    realPath: (p) => realpath(p).catch(() => null),
    freeBytes: (root) =>
      statfs(root)
        .then((s) => s.bavail * s.bsize)
        .catch(() => null),
    engineRunning: isEngineDjRunning,
    ensureEngineClosed: () => opts.ensureClosed('engine', asking, ENGINE_USB_QUIT_DETAIL),
    memory: engineMemory,
    send: (e) => broadcast('usb:event', e),
    now: () => Date.now(),
    log: (m) => log.info(m),
  })
  const route = routeUsbExports({
    rekordbox: exporter,
    engine: engineExporter,
    ...(seratoExporter && { serato: seratoExporter }),
    ...(traktorExporter && { traktor: traktorExporter }),
  })
  // Watching starts with the first request for the list (the rail offers the export only
  // with a rekordbox collection), not at launch for every user.
  let watching = false
  ipcMain.handle('usb:volumes', () => {
    if (!watching) {
      watching = true
      watchVolumes(platform, () => void list().then((l) => broadcast('usb:volumesChanged', l)))
    }
    return list()
  })
  ipcMain.handle(
    'usb:pickFolder',
    async (e, from?: Exclude<DjProgram, 'rekordbox'>): Promise<UsbFolderPick | null> => {
      const w = BrowserWindow.fromWebContents(e.sender)
      const options = {
        properties: ['openDirectory', 'createDirectory'] as Array<
          'openDirectory' | 'createDirectory'
        >,
      }
      const { canceled, filePaths } = w
        ? await dialog.showOpenDialog(w, options)
        : await dialog.showOpenDialog(options)
      if (canceled || !filePaths[0]) return null
      // The real path: one folder reached through a symlink or directly is one memory.
      const path = await realpath(filePaths[0]).catch(() => filePaths[0])
      const entry =
        (from === 'engine' ? engineMemory : from ? sourceMemories[from] : memory)?.get(
          targetKey({ kind: 'folder', path }),
        ) ?? null
      return {
        path,
        remembered: entry
          ? {
              playlistIds: entry.playlistIds,
              prune: false,
              settings: entry.settings ?? false,
              at: entry.at,
            }
          : null,
      }
    },
  )
  ipcMain.handle('usb:plan', (_e, req: UsbExportRequest) => route.plan(req))
  ipcMain.handle('usb:export', (e, req: UsbExportRequest) => {
    asking = BrowserWindow.fromWebContents(e.sender)
    return route.start(req)
  })
  ipcMain.handle('usb:cancel', () => route.cancel())
  return { busy: route.busy, stop: route.stop }
}
