import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from 'electron'
import electronUpdater from 'electron-updater'
import type { ProcessJob, ProcessStage, Settings } from '../shared/types'
import { addToAppleMusic, shouldAddToAppleMusic } from './applemusic'
import { downloadCover, getRelease, search } from './discogs'
import {
  analyzeCutoff,
  convertAudio,
  extractCover,
  generateSpectrogram,
  probeAudio,
  processCover,
  readTags,
} from './ffmpeg'
import { getSettings, saveSettings } from './settings'

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildAppMenu(win: BrowserWindow): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Ajustes…',
          accelerator: 'CmdOrCtrl+,',
          click: () => win.webContents.send('menu:settings'),
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
    { role: 'editMenu' },
    { role: 'windowMenu' },
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
        tempCover = join(tmpdir(), `surco-embed-${Date.now()}.jpg`)
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
        await addToAppleMusic(outputPath, job.meta)
      }

      return { outputPath }
    } finally {
      if (tempCover) await unlink(tempCover).catch(() => {})
      if (processedCover) await unlink(processedCover).catch(() => {})
    }
  })

  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))

  ipcMain.handle('audio:tags', (_e, inputPath: string) => readTags(inputPath))

  ipcMain.handle('audio:cover', (_e, inputPath: string) => extractCover(inputPath))

  ipcMain.handle('audio:read', (_e, inputPath: string) => readFile(inputPath))

  ipcMain.handle('audio:spectrogram', async (_e, inputPath: string) => {
    const sampleRateHz = Number((await probeAudio(inputPath)).sampleRate) || 0
    const [image, cutoffHz] = await Promise.all([
      generateSpectrogram(inputPath),
      analyzeCutoff(inputPath, sampleRateHz),
    ])
    return { image, cutoffHz, sampleRateHz }
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
    electronUpdater.autoUpdater.on('update-downloaded', (info) =>
      win.webContents.send('update:downloaded', info.version),
    )
    electronUpdater.autoUpdater.checkForUpdates()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
