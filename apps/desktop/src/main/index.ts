import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  shell,
} from 'electron'
import log from 'electron-log/main'
import electronUpdater from 'electron-updater'
import { MEDIA_SCHEME, mediaMimeType, mediaPathFromUrl, parseRange } from '../shared/media'
import { resolveBindings } from '../shared/shortcutDefaults'
import { chordToAccelerator } from '../shared/shortcuts'
import type {
  AppleMusicAddJob,
  CoverExportJob,
  ProcessJob,
  ProcessStage,
  Settings,
} from '../shared/types'
import { addToAppleMusic, lookupInAppleMusic, shouldAddToAppleMusic } from './applemusic'
import type { CoverSource } from './cover'
import { prepareProcessedCover } from './cover'
import { expandPaths } from './expand'
import {
  analyzeCutoff,
  buildSpectrum,
  convertAudio,
  extractCover,
  generateSpectrogram,
  measureLoudness,
  probeAudio,
  probeDuration,
  probeProperties,
  readTags,
} from './ffmpeg'
import { createMenuT } from './i18n'
import { keymapMenuClick } from './menuCommand'
import {
  isOutputConflict,
  removeRenamedOriginal,
  resolveOutputTarget,
  sanitizeOutputName,
  uniqueOutputPath,
} from './inplace'
import { resolvePlayable } from './playback'
import { getProvider } from './providers'
import { getSettings, recordConversion, saveSettings } from './settings'

// Must run before app ready: a privileged scheme can stream and respond to fetch,
// which is what lets the renderer's <audio> element seek through a local file
// served by surco:// instead of buffering the whole thing across IPC.
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
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
  electronUpdater.autoUpdater.checkForUpdates()
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
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      label: t('help'),
      submenu: [
        { label: t('faq'), click: () => run('help') },
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
    backgroundColor: '#09090d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  })

  win.on('ready-to-show', () => win.show())
  buildAppMenu(win)

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function registerIpc(): void {
  // Synchronous so the preload can expose api.version as a plain value.
  ipcMain.on('app:version', (e) => {
    e.returnValue = app.getVersion()
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

  ipcMain.handle('dialog:pickFiles', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Selecciona pistas',
      properties: ['openFile', 'multiSelections'],
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
    return canceled ? [] : filePaths
  })

  ipcMain.handle('files:expand', (_e, paths: string[]) => expandPaths(paths))

  ipcMain.handle('dialog:pickOutputDir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Carpeta de salida',
      properties: ['openDirectory', 'createDirectory'],
    })
    return canceled ? null : filePaths[0]
  })

  // Writes a rekordbox collection XML the user can import (File ▸ Import Collection).
  // Returns the saved path, or null when the save dialog is cancelled.
  ipcMain.handle('dialog:exportRekordbox', async (_e, xml: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Exporta a rekordbox',
      defaultPath: 'rekordbox.xml',
      filters: [{ name: 'rekordbox XML', extensions: ['xml'] }],
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, xml, 'utf8')
    return filePath
  })

  ipcMain.handle('search:query', (_e, query: string, provider) =>
    getProvider(provider).search(query),
  )
  ipcMain.handle('search:release', (_e, id: number, provider) =>
    getProvider(provider).getRelease(id),
  )

  // The Music AppleScript bridge is macOS-only; off macOS there is no library to
  // query, so report "not present" rather than spawning a missing osascript.
  ipcMain.handle('applemusic:lookup', (_e, artist: string, title: string) =>
    process.platform === 'darwin' ? lookupInAppleMusic(artist, title) : false,
  )

  // Adds an already-converted track to Apple Music on demand — the tail of
  // process:track, but invoked by hand from the editor/palette/menu when the
  // automatic add is off. The processed cover is re-prepared from the same source
  // so the artwork written to the library matches the embedded one, then cleaned
  // up. macOS-only; the renderer never offers it elsewhere.
  ipcMain.handle('applemusic:add', async (_e, job: AppleMusicAddJob) => {
    if (process.platform !== 'darwin') return
    const settings = getSettings()
    let prepared: Awaited<ReturnType<typeof prepareProcessedCover>>
    try {
      if (job.coverPath || job.coverUrl) {
        prepared = await prepareProcessedCover(job, {
          maxSize: settings.coverMaxSize,
          square: settings.coverSquare,
        })
      }
      await addToAppleMusic(job.outputPath, job.meta, prepared?.path)
    } finally {
      if (prepared) await prepared.cleanup()
    }
  })

  ipcMain.handle('process:track', async (e, job: ProcessJob) => {
    const settings = getSettings()
    const stage = (s: ProcessStage): void =>
      e.sender.send('process:progress', { id: job.id, stage: s })

    let prepared: Awaited<ReturnType<typeof prepareProcessedCover>>
    try {
      if (job.coverPath || job.coverUrl) {
        stage('cover')
        prepared = await prepareProcessedCover(job, {
          maxSize: settings.coverMaxSize,
          square: settings.coverSquare,
        })
      }
      const coverPath = prepared?.path

      stage('converting')
      const format = job.format ?? settings.outputFormat
      const { outputPath, inPlace } = resolveOutputTarget(
        job.inputPath,
        sanitizeOutputName(job.outputName),
        format,
        settings.outputDir,
      )
      let target = outputPath
      if (isOutputConflict(outputPath, job.previousOutputPath, inPlace, existsSync(outputPath))) {
        const t = createMenuT(app.getLocale())
        const win = BrowserWindow.fromWebContents(e.sender)
        const opts = {
          type: 'warning' as const,
          message: basename(outputPath),
          detail: t('conflictExists'),
          buttons: [t('conflictOverwrite'), t('conflictKeepBoth'), t('conflictSkip')],
          defaultId: 1,
          cancelId: 2,
        }
        const { response } = win
          ? await dialog.showMessageBox(win, opts)
          : await dialog.showMessageBox(opts)
        if (response === 2) return { outputPath: '', inPlace, skipped: true }
        if (response === 1) target = uniqueOutputPath(outputPath, existsSync)
      }

      // Create the target's folder (and any subfolders the file-name template asks for)
      // before writing; recursive so it's a no-op when the directory already exists.
      await mkdir(dirname(target), { recursive: true })
      await convertAudio(
        job.inputPath,
        target,
        format,
        job.meta,
        coverPath,
        job.normalize ?? settings.normalize,
      )
      if (inPlace) await removeRenamedOriginal(job.inputPath, target)
      recordConversion()

      if (shouldAddToAppleMusic(settings.addToAppleMusic, process.platform, format)) {
        stage('appleMusic')
        await addToAppleMusic(target, job.meta, coverPath)
      }

      return { outputPath: target, inPlace }
    } finally {
      if (prepared) await prepared.cleanup()
    }
  })

  // Saves the artwork the way it gets embedded — run through the same resize/square
  // pipeline — so what the user exports matches what lands in the output file.
  ipcMain.handle('cover:export', async (_e, job: CoverExportJob) => {
    const settings = getSettings()
    const prepared = await prepareProcessedCover(job, {
      maxSize: settings.coverMaxSize,
      square: settings.coverSquare,
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
    })
    return prepared?.path ?? null
  })

  ipcMain.on('cover:drag', (e, path: string) => {
    e.sender.startDrag({
      file: path,
      icon: nativeImage.createFromPath(path).resize({ width: 128, height: 128 }),
    })
  })

  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:open', (_e, path: string) => shell.openPath(path))
  // trashItem sends to the OS Trash / Recycle Bin (recoverable), never a hard delete.
  ipcMain.handle('shell:trash', (_e, path: string) => shell.trashItem(path))
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))

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

  ipcMain.handle('audio:tags', (_e, inputPath: string) => readTags(inputPath))

  ipcMain.handle('audio:duration', (_e, inputPath: string) => probeDuration(inputPath))

  ipcMain.handle('audio:cover', (_e, inputPath: string) => extractCover(inputPath))

  ipcMain.handle('audio:spectrogram', async (_e, inputPath: string) => {
    try {
      const { image, cutoffHz, sampleRateHz, cutoffError } = await buildSpectrum(inputPath, {
        probe: probeAudio,
        spectrogram: generateSpectrogram,
        cutoff: analyzeCutoff,
      })
      // A cutoff failure still yields a usable spectrogram, so log it (with ffmpeg's
      // stderr) rather than reject — this is the only trace when it breaks on a
      // machine we can't reach, e.g. Windows.
      if (cutoffError) log.error('audio:spectrogram cutoff analysis failed', cutoffError)
      return { image, cutoffHz, sampleRateHz }
    } catch (err) {
      log.error('audio:spectrogram failed', err)
      throw err
    }
  })

  ipcMain.handle('audio:loudness', async (_e, inputPath: string) => {
    try {
      return await measureLoudness(inputPath)
    } catch (err) {
      log.error('audio:loudness failed', err)
      return null
    }
  })

  ipcMain.handle('audio:properties', async (_e, inputPath: string) => {
    try {
      return await probeProperties(inputPath)
    } catch (err) {
      log.error('audio:properties failed', err)
      return null
    }
  })
}

app.setName('Surco')

app.whenReady().then(() => {
  if (!app.isPackaged && process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png')))
  }
  registerIpc()
  // Serve the local audio file ourselves with real HTTP range support: the
  // <audio> element seeks by re-requesting a byte range, and it only honours the
  // jump when the server answers 206 with Content-Range. Streaming the exact
  // slice (rather than net.fetch'ing the whole file:// URL, which ignores Range)
  // is what makes scrubbing work.
  protocol.handle(MEDIA_SCHEME, async (req) => {
    // AIFF can't be decoded by the <audio> element, so resolvePlayable swaps it
    // for a transcoded WAV (every other format streams untouched). The size,
    // MIME and ranges below all come from the file we actually serve.
    const filePath = await resolvePlayable(mediaPathFromUrl(req.url))
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
  const win = createWindow()

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
    updater.on('update-downloaded', (info) =>
      win.webContents.send('update:downloaded', info.version),
    )
    updater.on('update-not-available', () => {
      if (!manualUpdateCheck) return
      manualUpdateCheck = false
      dialog.showMessageBox(win, {
        type: 'info',
        message: createMenuT(app.getLocale())('upToDate'),
      })
    })
    updater.on('error', (err) => {
      // Always log and tell the renderer: when the restart-to-update install fails
      // (manualUpdateCheck is false) this is the only sign the user gets that the
      // button did anything. The manual-check dialog stays as before.
      log.error('autoUpdater error', err)
      win.webContents.send('update:error', err instanceof Error ? err.message : String(err))
      if (!manualUpdateCheck) return
      manualUpdateCheck = false
      dialog.showMessageBox(win, {
        type: 'error',
        message: createMenuT(app.getLocale())('updateError'),
      })
    })
    updater.checkForUpdates()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
