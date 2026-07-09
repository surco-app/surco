import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, } from 'node:path'
import { Readable } from 'node:stream'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  type NativeImage,
  nativeImage,
  protocol,
  session,
  shell,
} from 'electron'
import log from 'electron-log/main'
import electronUpdater from 'electron-updater'
import { MEDIA_SCHEME, mediaMimeType, mediaPathFromUrl, parseRange } from '../shared/media'
import { resolveBindings } from '../shared/shortcutDefaults'
import { chordToAccelerator } from '../shared/shortcuts'
import type { CoverExportJob, ProcessJob, SessionEdit, Settings } from '../shared/types'
import { activity } from './activity'
import { analysisCacheStats, clearAnalysisCache, pruneAnalysisCache } from './analysisCache'
import { registerAppleMusicIpc } from './appleMusicIpc'
import { installCrashGuards, wireRendererRecovery } from './crashGuards'
import { parseDockFrames } from './dockFrames'
import {
  addToAppleMusic,
  appleMusicEntryLocation,
  appleMusicLimiter,
  deleteFromAppleMusic,
  updateInAppleMusic,
} from './applemusic'
import { addToEngineLibrary, dumpEngineLibrary } from './engineLibrary'
import { isEngineDjRunning, quitEngineDj } from './engineProcess'
import { registerAudioIpc } from './audioIpc'
import type { CoverSource } from './cover'
import { hasCoverSource, prepareProcessedCover } from './cover'
import { downloadCover, imageExt } from './coverDownload'
import { expandPaths } from './expand'
import { convertAudio } from './ffmpeg'
import { createMenuT } from './i18n'
import { isSameFile, removeRenamedOriginal } from './inplace'
import { createMediaAccess } from './mediaAccess'
import { createOutputReservations } from './outputReservations'
import { keymapMenuClick } from './menuCommand'
import { isInternalNavigation, isWebUrl } from './navigation'
import { cleanupPlaybackTemps, resolvePlayable } from './playback'
import { runProcessTrack } from './processTrack'
import { getProvider } from './providers'
import { registerExportIpc } from './exportIpc'
import { registerShellIpc } from './shellIpc'
import { loadLastSession, saveLastSession } from './session'
import {
  defaultConfigDir,
  getConfigDir,
  getSettings,
  recordConversion,
  recordStat,
  saveSettings,
  setConfigDir,
} from './settings'
import { wireUpdateDelivery } from './updateDelivery'
import { armUpdateRecheck } from './updateRecheck'
import { onWatchedFilesChanged } from './watchedFiles'
import { dirRoots, FolderWatcher } from './watcher'

// At module load so even a throw during startup leaves a trace in the log file.
installCrashGuards(process, log)

// Must run before app ready: a privileged scheme can stream and respond to fetch,
// which is what lets the renderer's <audio> element seek through a local file
// served by surco:// instead of buffering the whole thing across IPC.
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

// macOS hands over files opened from Finder ("Open With Surco"), dropped on the dock
// icon, or double-clicked through the open-file event — never argv. One event per file.
// On a cold launch it fires before the window (and renderer) exist, so buffer those
// paths for the renderer to drain on mount via files:pending; once a window is up, push
// live opens straight to it. Registered at module load so the early cold-launch events
// aren't missed.
const pendingFiles: string[] = []
// Tracks every path the renderer may legitimately stream through surco://; the
// protocol handler refuses anything not in here. Module-scoped because the
// open-file event below can fire before the window (and registerIpc) exist.
const mediaAccess = createMediaAccess()
// Closes the race a concurrent batch opens: module-scoped so every process:track
// call (each its own IPC invocation) shares one registry of output paths currently
// being written.
const outputReservations = createOutputReservations()
app.on('open-file', (event, path) => {
  event.preventDefault()
  mediaAccess.allow(path)
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send('open-files', [path])
  else pendingFiles.push(path)
})

// A single flat file name (the cover-export .jpg): slashes are illegal characters here
// and become dashes. Deliberately different from inplace.ts's sanitizeOutputName, where
// "/" is a real subfolder separator the file-name template supports — collapsing the two
// would either break subfolders there or let a "/" escape the save dialog's folder here.
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

// The pending "Engine DJ is open — close it?" prompt, shared so a bulk conversion's
// parallel tracks (each hitting the Engine add at once) raise ONE dialog and all wait
// on the same answer. Cleared once settled: the next conversion re-checks the process,
// which by then is either gone (proceed silently) or reopened (ask again).
let engineQuitPrompt: Promise<boolean> | null = null

// True when Engine DJ is not running (possibly because the user just accepted quitting
// it here); false when it is running and the user declined — the caller then refuses
// the library write, since Engine would not see it and could overwrite it on exit.
async function ensureEngineDjClosed(win: BrowserWindow | null): Promise<boolean> {
  if (!(await isEngineDjRunning())) return true
  engineQuitPrompt ??= (async () => {
    const t = createMenuT(app.getLocale())
    const opts = {
      type: 'warning' as const,
      message: t('engineQuitMessage'),
      detail: t('engineQuitDetail'),
      buttons: [t('engineQuitConfirm'), t('engineQuitCancel')],
      defaultId: 0,
      cancelId: 1,
    }
    const { response } = win
      ? await dialog.showMessageBox(win, opts)
      : await dialog.showMessageBox(opts)
    if (response !== 0) return false
    return quitEngineDj()
  })().finally(() => {
    engineQuitPrompt = null
  })
  return engineQuitPrompt
}

// Set while a user-triggered update check is in flight so the updater's result
// events surface a dialog; the silent startup check leaves it false and stays quiet.
let manualUpdateCheck = false

function checkForUpdates(win: BrowserWindow): void {
  const t = createMenuT(app.getLocale())
  if (!app.isPackaged) {
    dialog.showMessageBox(win, { type: 'info', message: t('updatesDevOnly') })
    return
  }
  manualUpdateCheck = true
  // checkForUpdates emits 'error' AND rejects with the same failure; the 'error'
  // handler already surfaces it, so the rejection is swallowed instead of tripping
  // the unhandledRejection guard on every offline check.
  void electronUpdater.autoUpdater.checkForUpdates().catch(() => {})
}

function buildAppMenu(win: BrowserWindow): void {
  const t = createMenuT(app.getLocale())
  // Every custom item triggers a command by id, the same registry the palette
  // and keyboard shortcuts use. Items whose accelerator is already owned by the
  // renderer keymap pass registerAccelerator:false so the shortcut shows in the
  // menu without firing twice — and use keymapMenuClick so the keyboard
  // accelerator is left to the keymap (preserving its "not while typing in a
  // field" guard; Space would otherwise start playback mid-search and ⌘⌫ would
  // delete a track mid-edit), while a mouse click of the item still runs it.
  const run = (id: string): void => win.webContents.send('menu:command', id)
  // Menu accelerators are display-only labels generated from the same bindings the
  // renderer keymap uses (registerAccelerator:false leaves the keystroke to it), so a
  // rebind in Settings shows here too. Undefined when the command was unbound.
  const bindings = resolveBindings(getSettings().shortcutOverrides)
  const accel = (id: string): string | undefined => {
    const chord = bindings.get(id)
    return chord?.length ? chordToAccelerator(chord) : undefined
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: t('checkUpdates'), click: () => checkForUpdates(win) },
        { type: 'separator' },
        {
          label: t('settings'),
          accelerator: accel('settings'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'settings'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: t('file'),
      submenu: [
        {
          label: t('add'),
          accelerator: accel('add'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'add'),
        },
        // Reveal is renderer-owned like the others now (it used to register ⌘R itself):
        // its chord is configurable, so the keystroke must reach the keymap, not the menu.
        {
          label: t('reveal'),
          accelerator: accel('reveal'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'reveal'),
        },
        {
          label: t('rename'),
          accelerator: accel('rename'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'rename'),
        },
        {
          label: t('findReplace'),
          accelerator: accel('find-replace'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'find-replace'),
        },
        {
          label: t('addAppleMusic'),
          accelerator: accel('add-apple-music'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'add-apple-music'),
        },
        { type: 'separator' },
        {
          label: t('processCurrent'),
          accelerator: accel('process-current'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'process-current'),
        },
        {
          label: t('processAll'),
          accelerator: accel('process-all'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'process-all'),
        },
        { type: 'separator' },
        {
          label: t('remove'),
          accelerator: accel('remove'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'remove'),
        },
        { label: t('removeAll'), click: () => run('remove-all') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: t('view'),
      submenu: [
        {
          label: t('palette'),
          accelerator: 'CmdOrCtrl+K',
          registerAccelerator: false,
          click: keymapMenuClick(run, 'palette'),
        },
        { type: 'separator' },
        {
          label: t('search'),
          accelerator: accel('search'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'search'),
        },
        {
          label: t('play'),
          accelerator: accel('play'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'play'),
        },
        {
          label: t('prev'),
          accelerator: accel('prev'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'prev'),
        },
        {
          label: t('next'),
          accelerator: accel('next'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'next'),
        },
        { type: 'separator' },
        { label: t('activity'), click: () => run('activity') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      label: t('help'),
      submenu: [
        { label: t('faq'), click: () => run('help') },
        { label: t('guide'), click: () => run('guide') },
        { type: 'separator' },
        { label: t('website'), click: () => run('website') },
        { label: t('feedback'), click: () => run('feedback') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 1080,
    minHeight: 620,
    show: false,
    titleBarStyle: 'hiddenInset',
    // Centre the macOS traffic lights in the 48px (h-12) toolbar: the default inset sits them
    // near the top of a standard-height title bar, so on the taller toolbar they float high.
    // y = (toolbar height − dot height) / 2; x keeps the platform's standard left inset.
    trafficLightPosition: { x: 19, y: 18 },
    backgroundColor: '#09090d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // The renderer runs untrusted-ish content (Discogs data, file tags); the OS
      // sandbox is defense-in-depth on top of contextIsolation. Requires the CJS
      // preload emitted by electron.vite.config.ts.
      sandbox: true,
    },
  })

  win.on('ready-to-show', () => win.show())
  wireRendererRecovery(win.webContents, log)
  // Stream background-work events (Discogs/Bandcamp searches, cover downloads,
  // conversions) to the renderer's activity panel. Detach on close so the emitter
  // never sends into a destroyed webContents.
  const offActivity = activity.subscribe((event) => {
    if (!win.isDestroyed()) win.webContents.send('activity:event', event)
  })
  win.on('closed', offActivity)
  // Let the renderer pause its background analyze sweep while the window is hidden,
  // so it stops spawning ffmpeg in the background, and resume it on focus.
  win.on('blur', () => win.webContents.send('window:focus', false))
  win.on('focus', () => win.webContents.send('window:focus', true))
  // The renderer dies with the window without sending a final pause, so a track
  // playing at close would otherwise leave the Dock animating forever.
  win.on('closed', stopDockAnimation)
  buildAppMenu(win)

  // Popups are always denied; a web link is handed to the browser, anything else
  // (file://, a custom scheme, javascript:) is dropped so it can't be launched
  // outside the sandbox.
  win.webContents.setWindowOpenHandler((details) => {
    if (isWebUrl(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const appUrl = process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL
    : `file://${join(__dirname, '../renderer/index.html')}`
  // The SPA never navigates its own top frame, so a navigation off the app origin
  // means a compromised renderer trying to load a remote page (escaping the local
  // CSP). Block it; a web link goes to the browser instead.
  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalNavigation(url, appUrl)) return
    event.preventDefault()
    if (isWebUrl(url)) shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// One folder watcher per window: it re-scans the folders a crate was loaded from and tells
// that window's renderer the folder's current audio list, which the renderer diffs to
// surface "N new tracks". Lazily created on the first folder load and torn down with the
// window so a closed crate stops holding OS watches.
const folderWatchers = new WeakMap<BrowserWindow, FolderWatcher>()

function watcherFor(win: BrowserWindow): FolderWatcher {
  let watcher = folderWatchers.get(win)
  if (!watcher) {
    watcher = new FolderWatcher((root, files) => {
      if (win.isDestroyed()) return
      // Grant the new tracks media access before announcing them, or the surco:// handler
      // would 403 a play on a watched track — it'd appear in the list and player but stay mute.
      onWatchedFilesChanged(
        mediaAccess,
        (r, f) => win.webContents.send('folders:changed', r, f),
        root,
        files,
      )
    })
    folderWatchers.set(win, watcher)
    win.on('closed', () => watcher?.close())
  }
  return watcher
}

// Dock playing animation (macOS): the renderer rasterizes the icon frames — main
// has no DOM to render the SVG — and reports the <audio> element's play/pause.
let dockFrames: NativeImage[] = []
let dockResting: NativeImage | null = null
let dockPlaying = false
let dockTimer: NodeJS.Timeout | null = null

function syncDockAnimation(): void {
  const wasAnimating = dockTimer !== null
  if (dockTimer) {
    clearInterval(dockTimer)
    dockTimer = null
  }
  if (dockPlaying && dockFrames.length > 0) {
    let frame = 0
    dockTimer = setInterval(() => {
      app.dock?.setIcon(dockFrames[frame])
      frame = (frame + 1) % dockFrames.length
    }, 100)
  } else if (wasAnimating && dockResting) {
    // Restore only after having animated, so the shipped .icns stays untouched
    // until the player is first used.
    app.dock?.setIcon(dockResting)
  }
}

function stopDockAnimation(): void {
  dockPlaying = false
  syncDockAnimation()
}

// Dragging a track row out needs an icon the instant the gesture starts: startDrag
// rejects an empty icon and can't await one mid-drag. The track's own art makes the
// drag legible, but only when it's at hand as a data: URL — createFromDataURL is
// synchronous, unlike fetching a Discogs http cover, which would have to await. A
// track with no usable cover falls back to the app icon, loaded once.
let trackDragIconCache: NativeImage | null = null
function genericDragIcon(): NativeImage {
  if (!trackDragIconCache)
    trackDragIconCache = nativeImage
      .createFromPath(join(app.getAppPath(), 'build', 'icon.png'))
      .resize({ width: 128, height: 128 })
  return trackDragIconCache
}
function trackDragIcon(coverUrl?: string): NativeImage {
  if (coverUrl?.startsWith('data:')) {
    const cover = nativeImage.createFromDataURL(coverUrl)
    if (!cover.isEmpty()) return cover.resize({ width: 128, height: 128 })
  }
  return genericDragIcon()
}

function registerIpc(): void {
  // Synchronous so the preload can expose api.version as a plain value.
  ipcMain.on('app:version', (e) => {
    e.returnValue = app.getVersion()
  })

  ipcMain.on('dock:frames', (_e, payload: unknown) => {
    const parsed = parseDockFrames(payload)
    if (!parsed) return
    dockResting = nativeImage.createFromDataURL(parsed.resting)
    dockFrames = parsed.frames.map((frame) => nativeImage.createFromDataURL(frame))
    // Frames can land after the first play already started (they rasterize async),
    // so apply the current state instead of waiting for the next play/pause.
    syncDockAnimation()
  })

  ipcMain.on('dock:playing', (_e, playing: boolean) => {
    // Re-sending the current state must not restart the cycle mid-loop (switching
    // tracks while playing re-fires 'play' without an intervening pause).
    if (playing === dockPlaying) return
    dockPlaying = playing
    syncDockAnimation()
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (e, patch: Partial<Settings>) => {
    const next = saveSettings(patch)
    // Rebinding a shortcut changes the menu accelerators, so rebuild the menu from the
    // freshly-saved overrides (buildAppMenu re-reads them via getSettings).
    if (patch.shortcutOverrides !== undefined) {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (win) buildAppMenu(win)
    }
    return next
  })

  // Fire-and-forget lifetime-tally bumps from the renderer (imports, listens, match
  // applies). The key is allowlisted here — this channel takes renderer input, so an
  // arbitrary string must not reach the settings file as a new property.
  ipcMain.on('stats:record', (_e, key: unknown, by?: unknown) => {
    const keys: readonly string[] = [
      'imported',
      'listened',
      'analyzed',
      'discogsMatches',
      'bandcampMatches',
    ] satisfies (keyof Settings['stats'])[]
    if (typeof key === 'string' && keys.includes(key)) {
      recordStat(key as keyof Settings['stats'], typeof by === 'number' ? by : 1)
    }
  })

  // Renderer crashes forwarded into the shared log file, so a "the app went blank"
  // report has something a user can attach. Validated like stats:record — this
  // channel takes renderer input.
  ipcMain.on('log:renderer', (_e, message: unknown, stack?: unknown) => {
    if (typeof message !== 'string') return
    log.error('[renderer]', message, typeof stack === 'string' ? stack : '')
  })

  // The reopen-last-session pair: the renderer saves the loaded paths and staged
  // edits as they change and asks for them back at launch to offer restoring the
  // previous crate — edits included, so a crash never loses unapplied metadata.
  ipcMain.handle('session:get', () => loadLastSession())
  ipcMain.handle('session:set', (_e, paths: string[], edits: Record<string, SessionEdit>) =>
    saveLastSession(paths, edits),
  )

  ipcMain.handle('settings:getConfigDir', () => getConfigDir())
  ipcMain.handle('settings:defaultConfigDir', () => defaultConfigDir())
  // Switching the settings folder takes effect immediately (no Save step): it moves
  // where settings.json lives, returning the settings now in effect from that folder.
  ipcMain.handle('settings:setConfigDir', (_e, dir: string | null) => setConfigDir(dir))

  ipcMain.handle('cache:stats', () => analysisCacheStats())
  ipcMain.handle('cache:clear', () => clearAnalysisCache())

  ipcMain.handle('dialog:pickConfigDir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Carpeta de configuración',
      properties: ['openDirectory', 'createDirectory'],
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle('dialog:pickFiles', async () => {
    // macOS lets one dialog select both files and folders; Windows and Linux force a
    // directory-only picker the moment 'openDirectory' is present, so only mac gets it.
    // The renderer expands whatever comes back, so a picked folder imports like a dropped one.
    const properties: Array<'openFile' | 'openDirectory' | 'multiSelections'> =
      process.platform === 'darwin'
        ? ['openFile', 'openDirectory', 'multiSelections']
        : ['openFile', 'multiSelections']
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Selecciona pistas',
      properties,
      filters: [
        {
          name: 'Audio',
          extensions: [
            'wav',
            'flac',
            'aif',
            'aiff',
            'mp3',
            'm4a',
            'mp4',
            'aac',
            'ogg',
            'oga',
            'opus',
          ],
        },
      ],
    })
    if (canceled) return []
    mediaAccess.allowAll(filePaths)
    return filePaths
  })

  ipcMain.handle('files:expand', async (e, paths: string[]) => {
    // One feed row per drop/pick: the folder walk is the import's visible unit of work
    // (per-file tag reads flow through the analyze rows already).
    const expanded = await activity.track('import', 'activity.import', () => expandPaths(paths), {
      summary: (files) => ({
        detailKey: 'activity.trackCount',
        detailParams: { count: files.length },
      }),
    })
    mediaAccess.allowAll(expanded)
    // Watch the folders the user dropped or picked so tracks copied in later surface as
    // "N new tracks"; a single dropped file has no folder to grow, so dirRoots drops it.
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) {
      const roots = await dirRoots(paths)
      if (roots.length) watcherFor(win).watch(roots)
    }
    return expanded
  })

  // The renderer calls this when the crate is cleared so a torn-down library stops
  // auto-detecting; the watcher is rebuilt on the next folder load.
  ipcMain.handle('folders:unwatch', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) folderWatchers.get(win)?.close()
  })

  // Drains the cold-launch open-file buffer; the renderer calls this once on mount so
  // files chosen via "Open With Surco" before it existed land in the list.
  ipcMain.handle('files:pending', () => pendingFiles.splice(0))

  ipcMain.handle('dialog:pickOutputDir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Carpeta de salida',
      properties: ['openDirectory', 'createDirectory'],
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle('dialog:pickEngineLibraryDir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Biblioteca de Engine DJ',
      properties: ['openDirectory', 'createDirectory'],
    })
    return canceled ? null : filePaths[0]
  })

  registerExportIpc()

  // The Engine-library counterpart of applemusic:library: the title/artist/duration
  // snapshot the renderer matches the crate against when Engine DJ is the destination.
  // Read-only, so it is safe while Engine DJ itself is open.
  ipcMain.handle('engine:library', () =>
    activity.track(
      'export',
      'activity.engineLibrary',
      () => dumpEngineLibrary(getSettings().engineLibraryDir),
      {
        summary: (lib) => ({
          detailKey: 'activity.trackCount',
          detailParams: { count: lib.length },
        }),
      },
    ),
  )

  ipcMain.handle('search:query', (_e, query: string, provider, priority, hints) =>
    getProvider(provider).search(query, priority, hints),
  )
  ipcMain.handle('search:release', (_e, ref: number | string, provider, priority) =>
    getProvider(provider).getRelease(ref, priority),
  )

  registerAppleMusicIpc()

  ipcMain.handle('process:track', (e, job: ProcessJob) =>
    runProcessTrack(job, {
      settings: getSettings(),
      platform: process.platform,
      sendProgress: (stage) => e.sender.send('process:progress', { id: job.id, stage }),
      hasCoverSource,
      prepareProcessedCover,
      isPathReserved: outputReservations.isReserved,
      reservePath: outputReservations.reserve,
      releasePath: outputReservations.release,
      convertAudio: (input, output, format, meta, coverPath, normalize, removeCover, force) => {
        const track = meta.artist && meta.title ? `${meta.artist} - ${meta.title}` : job.outputName
        // The quality knobs are global preferences, so they're read here (at job time)
        // rather than threaded through every renderer job.
        const s = getSettings()
        return activity.track(
          'convert',
          'activity.convert',
          () =>
            convertAudio(
              input,
              output,
              format,
              meta,
              coverPath,
              normalize,
              removeCover,
              {
                mp3Quality: s.mp3Quality,
                bitDepth: s.outputBitDepth,
                sampleRate: s.outputSampleRate,
                flacCompression: s.flacCompression,
              },
              force,
            ),
          { labelParams: { track } },
        )
      },
      recordConversion,
      removeRenamedOriginal,
      // Wrap the Apple Music add/update the same way convertAudio is wrapped above, so the
      // activity panel times them too. The osascript add waits out Music's import (up to
      // 60s on a big library), so this is the step users watch drag — surfacing its ms lets
      // them see whether it really is growing. labelParams.track mirrors the manual add row.
      //
      // appleMusicLimiter (concurrency 1) serializes the adds so parallel conversions don't
      // pile osascripts on Music; it wraps activity.track so the queue wait stays out of the
      // measured ms — the row times the real import work, not how long it waited for a slot.
      addToAppleMusic: (target, meta, coverPath) => {
        const track = meta.artist && meta.title ? `${meta.artist} - ${meta.title}` : job.outputName
        return appleMusicLimiter.run(() =>
          activity.track(
            'applemusic',
            'activity.appleMusicAdd',
            () => addToAppleMusic(target, meta, coverPath),
            { labelParams: { track } },
          ),
        )
      },
      updateInAppleMusic: (persistentId, meta, coverPath) => {
        const track = meta.artist && meta.title ? `${meta.artist} - ${meta.title}` : job.outputName
        return appleMusicLimiter.run(() =>
          activity.track(
            'applemusic',
            'activity.appleMusicUpdate',
            () => updateInAppleMusic(persistentId, meta, coverPath),
            { labelParams: { track } },
          ),
        )
      },
      // The library folder is read at add time (not captured with the job) so a queue of
      // conversions follows a mid-run settings change; addToEngineLibrary serializes the
      // database writes itself, so no limiter is needed here.
      addToEngineDj: async (target, meta, coverPath) => {
        const win = BrowserWindow.fromWebContents(e.sender)
        if (!(await ensureEngineDjClosed(win))) {
          throw new Error(createMenuT(app.getLocale())('engineOpenError'))
        }
        const track = meta.artist && meta.title ? `${meta.artist} - ${meta.title}` : job.outputName
        return activity.track(
          'export',
          'activity.engineAdd',
          () => {
            const s = getSettings()
            return addToEngineLibrary(s.engineLibraryDir, target, meta, s.engineDjPlaylist, coverPath)
          },
          { labelParams: { track } },
        )
      },
      allowMedia: (path) => mediaAccess.allow(path),
      existsSync,
      isSameFile,
      mkdir,
      mkdtemp,
      rm,
      // The conflict prompt is the one Electron-bound branch: build the same warning
      // box as before and map its buttons back to the decision runProcessTrack expects.
      confirmConflict: async (outputName) => {
        const t = createMenuT(app.getLocale())
        const win = BrowserWindow.fromWebContents(e.sender)
        const opts = {
          type: 'warning' as const,
          message: outputName,
          detail: t('conflictExists'),
          buttons: [t('conflictOverwrite'), t('conflictKeepBoth'), t('conflictSkip')],
          defaultId: 1,
          cancelId: 2,
        }
        const { response } = win
          ? await dialog.showMessageBox(win, opts)
          : await dialog.showMessageBox(opts)
        return response === 2 ? 'skip' : response === 1 ? 'keepBoth' : 'overwrite'
      },
      appleMusicEntryLocation,
      // The rollback for an "Apple Music only" add that must not stand. The label is
      // what the delete script verifies the live entry against — the tags the add
      // itself just wrote, so the match is by construction.
      deleteAppleMusic: (persistentId) =>
        deleteFromAppleMusic(persistentId, `${job.meta.artist} - ${job.meta.title}`),
    }),
  )

  // Saves the artwork the way it gets embedded — run through the same resize/square
  // pipeline — so what the user exports matches what lands in the output file.
  ipcMain.handle('cover:export', async (_e, job: CoverExportJob) => {
    const settings = getSettings()
    const prepared = await prepareProcessedCover(job, {
      maxSize: settings.coverMaxSize,
      square: settings.coverSquare,
      upscale: settings.coverUpscale,
    })
    if (!prepared) return null
    try {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Exporta la carátula',
        defaultPath: `${sanitizeFilename(job.name)}.jpg`,
        filters: [{ name: 'JPEG', extensions: ['jpg'] }],
      })
      if (canceled || !filePath) return null
      await copyFile(prepared.path, filePath)
      return filePath
    } finally {
      await prepared.cleanup()
    }
  })

  // startDrag must hand the OS a file that already exists, and it can't run after
  // an await inside dragstart, so the renderer prepares the processed cover ahead
  // of the gesture and hands back its path. The temp file is left for the OS to
  // reap — deleting it here would race the in-flight drag that copies from it.
  ipcMain.handle('cover:prepareDrag', async (_e, src: CoverSource) => {
    const settings = getSettings()
    const prepared = await prepareProcessedCover(src, {
      maxSize: settings.coverMaxSize,
      square: settings.coverSquare,
      upscale: settings.coverUpscale,
    })
    return prepared?.path ?? null
  })

  // An image dragged from a browser carries no file — only candidate URLs (the <img>'s
  // own src, plus the link it sat inside, which is often a page, not a picture). Try each
  // in turn and keep the first that downloads as a real image, handing the renderer a
  // local path (so convert/drag/export need no second network trip) plus a data-URL
  // preview built from those same bytes. The preview must be a data URL because the
  // renderer CSP only allows img-src from self/data/blob/Discogs — a raw remote URL would
  // render as a broken thumbnail. Null when nothing resolves to an image, so the drop is
  // a clean no-op instead of a red ffmpeg error on undecodable bytes.
  ipcMain.handle('cover:resolveDragged', async (_e, urls: string[]) => {
    for (const url of urls) {
      // A real inline image dragged from the page is usable as-is; skip the ~1px data-URL
      // placeholders lazy-loading leaves behind in an <img src>.
      if (url.startsWith('data:image/')) {
        const data = url.slice(url.indexOf(',') + 1)
        if (Buffer.from(data, 'base64').length > 1024) return { coverUrl: url }
        continue
      }
      if (!url.startsWith('http')) continue
      try {
        const path = await downloadCover(url)
        const buf = await readFile(path)
        const ext = imageExt(buf) ?? 'jpg'
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
        return { coverPath: path, coverUrl: `data:${mime};base64,${buf.toString('base64')}` }
      } catch {
        // Not an image, or unreachable from the main process — try the next candidate.
      }
    }
    return null
  })

  ipcMain.on('cover:drag', (e, path: string) => {
    e.sender.startDrag({
      file: path,
      icon: nativeImage.createFromPath(path).resize({ width: 128, height: 128 }),
    })
  })

  // The dragged source file already exists on disk, so unlike a cover it needs no
  // prepare pass — hand the OS the untouched path so a row can be dropped straight
  // onto Spek (or any app) to inspect the original track.
  ipcMain.on('track:drag', (e, { paths, coverUrl }: { paths: string[]; coverUrl?: string }) => {
    if (paths.length === 0) return
    // `files` carries the whole selection; `file` is the (required) single-item field
    // Electron ignores once `files` is set. One icon represents the whole drag.
    e.sender.startDrag({ file: paths[0], files: paths, icon: trackDragIcon(coverUrl) })
  })

  // Copy the artwork to the system clipboard so it can be pasted onto another track
  // (or into another app). The source is resolved and processed exactly like an
  // export/drag, then handed to the clipboard as an image; the temp file is removed
  // once the clipboard has its own copy of the bytes.
  ipcMain.handle('cover:copyImage', async (_e, src: CoverSource) => {
    const settings = getSettings()
    const prepared = await prepareProcessedCover(src, {
      maxSize: settings.coverMaxSize,
      square: settings.coverSquare,
      upscale: settings.coverUpscale,
    })
    if (!prepared) return false
    try {
      const img = nativeImage.createFromPath(prepared.path)
      if (img.isEmpty()) return false
      clipboard.writeImage(img)
      return true
    } finally {
      await prepared.cleanup()
    }
  })

  // Paste a clipboard image as a cover: write it to a temp PNG and hand back the path
  // (for the embed) plus a data URL (for the preview), mirroring a picked file. Null
  // when the clipboard holds no image, so the renderer leaves the artwork alone.
  ipcMain.handle('cover:pasteImage', async () => {
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    const dir = await mkdtemp(join(tmpdir(), 'surco-paste-'))
    const coverPath = join(dir, 'cover.png')
    await writeFile(coverPath, img.toPNG())
    return { coverPath, coverUrl: img.toDataURL() }
  })

  // Lets the cover well show its paste affordance only when there's an image to paste.
  ipcMain.handle('clipboard:hasImage', () => !clipboard.readImage().isEmpty())

  registerShellIpc()

  // Restarts into the already-downloaded update. Paired with the update:downloaded
  // push below — without this handler the toast's "Restart" button rejects.
  // quitAndInstall mostly fails asynchronously through the autoUpdater 'error'
  // event (Squirrel.Mac rejecting a signature mismatch, etc.), but catch the rare
  // synchronous throw too and surface it instead of dying silently.
  ipcMain.handle('update:install', (e) => {
    try {
      electronUpdater.autoUpdater.quitAndInstall()
    } catch (err) {
      log.error('update:install failed', err)
      e.sender.send('update:error', err instanceof Error ? err.message : String(err))
    }
  })

  registerAudioIpc()
}

app.setName('Surco')
// The default macOS About panel only shows the bundle name and version; spelling
// out the brand and author here gives it a finished look instead of a bare window.
// `website` is Linux-only, so on macOS the URL and contact email live in
// `credits`, and the empty `version` drops the redundant "(x.y.z)" build suffix.
app.setAboutPanelOptions({
  applicationName: 'Surco',
  applicationVersion: app.getVersion(),
  version: '',
  credits: 'getsurco.app\nhello@vicent.io',
  copyright: `© ${new Date().getFullYear()} Vicent Gozalbes`,
  website: 'https://getsurco.app',
})

app.whenReady().then(() => {
  if (!app.isPackaged && process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png')))
  }
  registerIpc()
  // Lock scripts to same-origin in the packaged build. The meta CSP in index.html
  // keeps 'unsafe-inline' because the dev server's React Fast Refresh injects an
  // inline script; production has no inline scripts (the theme bootstrap is the
  // static theme.js), so this stricter header — which the browser intersects with
  // the meta policy — drops the inline allowance an injection would otherwise ride.
  // Skipped in dev so HMR keeps working.
  if (app.isPackaged) {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://i.discogs.com https://img.discogs.com https://*.bcbits.com",
      "media-src 'self' blob: surco:",
      "connect-src 'self'",
    ].join('; ')
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
      })
    })
  }
  // Bound the on-disk analysis cache once at launch, before any new entries land.
  void pruneAnalysisCache()
  // Serve the local audio file ourselves with real HTTP range support: the
  // <audio> element seeks by re-requesting a byte range, and it only honours the
  // jump when the server answers 206 with Content-Range. Streaming the exact
  // slice (rather than net.fetch'ing the whole file:// URL, which ignores Range)
  // is what makes scrubbing work.
  protocol.handle(MEDIA_SCHEME, async (req) => {
    // Refuse any path the app never handed to the renderer, before resolvePlayable
    // can even probe or transcode it — this is what keeps surco:// from being an
    // arbitrary-file-read primitive.
    const requested = mediaPathFromUrl(req.url)
    if (!mediaAccess.isAllowed(requested)) return new Response('Forbidden', { status: 403 })
    // AIFF can't be decoded by the <audio> element, so resolvePlayable swaps it
    // for a transcoded WAV (every other format streams untouched). The size,
    // MIME and ranges below all come from the file we actually serve.
    const filePath = await resolvePlayable(requested)
    const { size } = await stat(filePath)
    const type = mediaMimeType(filePath)
    const range = parseRange(req.headers.get('range'), size)
    if (range) {
      const { start, end } = range
      const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
        },
      })
    }
    const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
    })
  })
  createWindow()

  // Downloads a newer version in the background, then tells the renderer so it can
  // show a "restart to update" toast (which calls quitAndInstall via update:install).
  // Only in packaged builds — there is no update feed in dev, and macOS requires
  // the build to be signed and notarized.
  if (app.isPackaged) {
    const updater = electronUpdater.autoUpdater
    // Route the updater's own logs to a file (~/Library/Logs/Surco/main.log on
    // macOS) so a failed install — which Squirrel.Mac otherwise swallows — leaves
    // a trace we can read.
    updater.logger = log
    // Never capture `win` here: on macOS ⌘W destroys the window while the app and
    // the updater keep running, so anything bound to the launch window would send
    // its events into a destroyed webContents after a Dock reopen.
    const liveWindow = (): BrowserWindow | undefined =>
      BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    wireUpdateDelivery(updater, liveWindow, (cb) =>
      app.on('browser-window-created', (_e, newWin) =>
        newWin.webContents.once('did-finish-load', () => cb(newWin)),
      ),
    )
    updater.on('update-not-available', () => {
      if (!manualUpdateCheck) return
      manualUpdateCheck = false
      const target = liveWindow()
      const opts = { type: 'info' as const, message: createMenuT(app.getLocale())('upToDate') }
      if (target) dialog.showMessageBox(target, opts)
      else dialog.showMessageBox(opts)
    })
    updater.on('error', (err) => {
      // Always log and tell the renderer: when the restart-to-update install fails
      // (manualUpdateCheck is false) this is the only sign the user gets that the
      // button did anything. The manual-check dialog stays as before.
      log.error('autoUpdater error', err)
      liveWindow()?.webContents.send(
        'update:error',
        err instanceof Error ? err.message : String(err),
      )
      if (!manualUpdateCheck) return
      manualUpdateCheck = false
      const target = liveWindow()
      const opts = { type: 'error' as const, message: createMenuT(app.getLocale())('updateError') }
      if (target) dialog.showMessageBox(target, opts)
      else dialog.showMessageBox(opts)
    })
    // Rejections swallowed for the same reason as the manual check: the 'error'
    // handler above already logs and surfaces every failure.
    void updater.checkForUpdates().catch(() => {})
    // The launch probe alone missed every patch: they ship within the hour of their
    // minor, after users have already relaunched, and a running instance never asked
    // again. Re-checking on an interval keeps a long-lived session in the loop.
    armUpdateRecheck(() => void updater.checkForUpdates().catch(() => {}))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Previewing an AIFF (or a FLAC with broken art) leaves a transcoded copy in the
// tmpdir that playback keeps re-serving, so it can only be deleted once the app is
// done with it — sweep them on the way out rather than letting them pile up.
app.on('will-quit', () => cleanupPlaybackTemps())
