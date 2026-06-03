import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from 'electron'
import log from 'electron-log/main'
import electronUpdater from 'electron-updater'
import type { ProcessJob, ProcessStage, Settings } from '../shared/types'
import { addToAppleMusic, lookupInAppleMusic, shouldAddToAppleMusic } from './applemusic'
import { downloadCover, getRelease, search } from './discogs'
import {
  analyzeCutoff,
  buildSpectrum,
  convertAudio,
  extractCover,
  generateSpectrogram,
  probeAudio,
  processCover,
  readTags,
} from './ffmpeg'
import { createMenuT } from './i18n'
import { getSettings, saveSettings } from './settings'
import { tmpName } from './tmp'

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
  // menu without firing twice — and crucially without losing the keymap's
  // "not while typing in a field" guard (⌘⌫ would otherwise delete a track
  // mid-edit).
  const run = (id: string): void => win.webContents.send('menu:command', id)
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: t('checkUpdates'), click: () => checkForUpdates(win) },
        { type: 'separator' },
        {
          label: t('settings'),
          accelerator: 'CmdOrCtrl+,',
          registerAccelerator: false,
          click: () => run('settings'),
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
          accelerator: 'CmdOrCtrl+O',
          registerAccelerator: false,
          click: () => run('add'),
        },
        { label: t('reveal'), accelerator: 'CmdOrCtrl+R', click: () => run('reveal') },
        { type: 'separator' },
        {
          label: t('processCurrent'),
          accelerator: 'CmdOrCtrl+Enter',
          registerAccelerator: false,
          click: () => run('process-current'),
        },
        {
          label: t('processAll'),
          accelerator: 'CmdOrCtrl+Shift+Enter',
          registerAccelerator: false,
          click: () => run('process-all'),
        },
        { type: 'separator' },
        {
          label: t('remove'),
          accelerator: 'CmdOrCtrl+Backspace',
          registerAccelerator: false,
          click: () => run('remove'),
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
          click: () => run('palette'),
        },
        { type: 'separator' },
        {
          label: t('search'),
          accelerator: '/',
          registerAccelerator: false,
          click: () => run('search'),
        },
        {
          label: t('play'),
          accelerator: 'Space',
          registerAccelerator: false,
          click: () => run('play'),
        },
        {
          label: t('prev'),
          accelerator: 'Up',
          registerAccelerator: false,
          click: () => run('prev'),
        },
        {
          label: t('next'),
          accelerator: 'Down',
          registerAccelerator: false,
          click: () => run('next'),
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
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => saveSettings(patch))

  ipcMain.handle('dialog:pickFiles', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Selecciona pistas',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['wav', 'flac', 'aif', 'aiff', 'mp3'] }],
    })
    return canceled ? [] : filePaths
  })

  ipcMain.handle('dialog:pickOutputDir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Carpeta de salida',
      properties: ['openDirectory', 'createDirectory'],
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle('discogs:search', (_e, query: string) => search(query, getSettings().discogsToken))
  ipcMain.handle('discogs:release', (_e, id: number) => getRelease(id, getSettings().discogsToken))

  // The Music AppleScript bridge is macOS-only; off macOS there is no library to
  // query, so report "not present" rather than spawning a missing osascript.
  ipcMain.handle('applemusic:lookup', (_e, artist: string, title: string) =>
    process.platform === 'darwin' ? lookupInAppleMusic(artist, title) : false,
  )

  ipcMain.handle('process:track', async (e, job: ProcessJob) => {
    const settings = getSettings()
    await mkdir(settings.outputDir, { recursive: true })
    const stage = (s: ProcessStage): void =>
      e.sender.send('process:progress', { id: job.id, stage: s })

    let tempCover: string | undefined
    let processedCover: string | undefined
    try {
      let coverPath = job.coverPath
      if (!coverPath && job.coverUrl?.startsWith('http')) {
        stage('cover')
        tempCover = await downloadCover(job.coverUrl)
        coverPath = tempCover
      }
      if (!coverPath && job.coverUrl?.startsWith('data:')) {
        // The cover the user kept from the file's embedded art rides along as a
        // data URL; decode it to disk so it can be re-embedded into the output.
        stage('cover')
        tempCover = join(tmpdir(), tmpName('embed', 'jpg'))
        await writeFile(
          tempCover,
          Buffer.from(job.coverUrl.slice(job.coverUrl.indexOf(',') + 1), 'base64'),
        )
        coverPath = tempCover
      }
      if (coverPath) {
        stage('cover')
        processedCover = await processCover(coverPath, {
          maxSize: settings.coverMaxSize,
          square: settings.coverSquare,
        })
        coverPath = processedCover
      }

      stage('converting')
      const outputPath = join(
        settings.outputDir,
        `${sanitizeFilename(job.outputName)}.${settings.outputFormat}`,
      )
      await convertAudio(job.inputPath, outputPath, settings.outputFormat, job.meta, coverPath)

      if (shouldAddToAppleMusic(settings.addToAppleMusic, process.platform)) {
        stage('appleMusic')
        await addToAppleMusic(outputPath, job.meta, coverPath)
      }

      return { outputPath }
    } finally {
      if (tempCover) await unlink(tempCover).catch(() => {})
      if (processedCover) await unlink(processedCover).catch(() => {})
    }
  })

  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))

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

  ipcMain.handle('audio:cover', (_e, inputPath: string) => extractCover(inputPath))

  ipcMain.handle('audio:read', (_e, inputPath: string) => readFile(inputPath))

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
}

app.setName('Surco')

app.whenReady().then(() => {
  if (!app.isPackaged && process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png')))
  }
  registerIpc()
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
