import {
  access,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import log from 'electron-log/main'
import type { UsbExportRequest, UsbFolderPick, UsbVolumeList } from '../shared/types'
import { openRekordboxDb } from './rekordboxDb'
import { playlistXmlPath } from './rekordboxMasterXml'
import { isRekordboxRunning } from './rekordboxProcess'
import { readMasterIdentity } from './rekordboxStickSync'
import { createUsbExporter, USB_QUIT_DETAIL } from './usbExport'
import { createUsbMemory, targetKey } from './usbExportMemory'
import { readExportSelection } from './usbExportSource'
import { stageExport } from './usbExportStage'
import { readVolumes, systemVolumeSource, watchVolumes } from './usbVolumes'

// The USB export's IPC, macOS and Windows. Elsewhere every call answers "unsupported" and
// nothing is watched; the renderer does not offer the feature there at all.
export function registerUsbExportIpc(opts: {
  collection: () => string
  userData: string
  home: string
  // %APPDATA% on Windows (app.getPath('appData')); unused on macOS.
  appData: string
  baken: () => { file: string; prefixArgs: string[] } | null
  // The close dialog the playlist writer uses, with the export's wording; true once
  // rekordbox is gone.
  ensureRekordboxClosed: (
    win: BrowserWindow | null,
    detail: typeof USB_QUIT_DETAIL,
  ) => Promise<boolean>
}): void {
  const platform = process.platform
  const source = systemVolumeSource(platform)
  if (!source) {
    ipcMain.handle('usb:volumes', (): UsbVolumeList => ({ volumes: [], lastKey: null }))
    ipcMain.handle('usb:pickFolder', () => null)
    ipcMain.handle('usb:plan', () => ({ ok: false, reason: 'unsupported' }))
    ipcMain.handle('usb:export', () => ({ ok: false, reason: 'unsupported' }))
    ipcMain.handle('usb:cancel', () => false)
    return
  }
  const win = platform === 'win32'
  // rekordbox's own folders: never written, never handed to baken.
  const pioneerDir = win ? join(opts.appData, 'Pioneer') : join(opts.home, 'Library', 'Pioneer')
  const settingsSource = win
    ? join(opts.appData, 'Pioneer', 'rekordbox6')
    : join(opts.home, 'Library', 'Application Support', 'Pioneer', 'rekordbox6')
  const systemRoot = win ? `${process.env.SystemDrive ?? 'C:'}\\` : '/'
  const memory = createUsbMemory(join(opts.userData, 'usb-exports.json'))
  const broadcast = (channel: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }
  // The window that pressed Exportar, for the close dialog: one export at a time.
  let asking: BrowserWindow | null = null
  const list = async (): Promise<UsbVolumeList> => ({
    volumes: await readVolumes(source, memory),
    lastKey: memory.last(),
  })
  const exporter = createUsbExporter({
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
    ensureRekordboxClosed: () => opts.ensureRekordboxClosed(asking, USB_QUIT_DETAIL),
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
  ipcMain.handle('usb:pickFolder', async (e): Promise<UsbFolderPick | null> => {
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
    const entry = memory.get(targetKey({ kind: 'folder', path }))
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
  })
  ipcMain.handle('usb:plan', (_e, req: UsbExportRequest) => exporter.plan(req))
  ipcMain.handle('usb:export', (e, req: UsbExportRequest) => {
    asking = BrowserWindow.fromWebContents(e.sender)
    return exporter.start(req)
  })
  ipcMain.handle('usb:cancel', () => exporter.cancel())
}
