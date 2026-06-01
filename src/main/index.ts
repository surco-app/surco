import { app, shell, BrowserWindow, ipcMain, dialog, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdir, unlink, readFile, writeFile } from 'fs/promises'
import { getSettings, saveSettings } from './settings'
import { search, getRelease, downloadCover } from './discogs'
import { convertToAiff, generateSpectrogram, analyzeCutoff, probeAudio, processCover, readTags, extractCover } from './ffmpeg'
import { addToAppleMusic } from './applemusic'
import { Settings, ProcessJob, ProcessStage } from '../shared/types'

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
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
          click: () => win.webContents.send('menu:settings')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 1080,
    minHeight: 620,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0c0c0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())
  buildAppMenu(win)

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => saveSettings(patch))

  ipcMain.handle('dialog:pickFiles', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Selecciona pistas',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['wav', 'flac', 'aif', 'aiff'] }]
    })
    return canceled ? [] : filePaths
  })

  ipcMain.handle('dialog:pickOutputDir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Carpeta de salida',
      properties: ['openDirectory', 'createDirectory']
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle('discogs:search', (_e, query: string) => search(query, getSettings().discogsToken))
  ipcMain.handle('discogs:release', (_e, id: number) => getRelease(id, getSettings().discogsToken))

  ipcMain.handle('process:track', async (e, job: ProcessJob) => {
    const settings = getSettings()
    await mkdir(settings.outputDir, { recursive: true })
    const stage = (s: ProcessStage): void => e.sender.send('process:progress', { id: job.id, stage: s })

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
        tempCover = join(tmpdir(), `rotulo-embed-${Date.now()}.jpg`)
        await writeFile(tempCover, Buffer.from(job.coverUrl.slice(job.coverUrl.indexOf(',') + 1), 'base64'))
        coverPath = tempCover
      }
      if (coverPath) {
        stage('cover')
        processedCover = await processCover(coverPath, {
          maxSize: settings.coverMaxSize,
          square: settings.coverSquare
        })
        coverPath = processedCover
      }

      stage('converting')
      const outputPath = join(settings.outputDir, `${sanitizeFilename(job.outputName)}.aiff`)
      await convertToAiff(job.inputPath, outputPath, job.meta, coverPath)

      if (settings.addToAppleMusic) {
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
    const [image, cutoffHz, probe] = await Promise.all([
      generateSpectrogram(inputPath),
      analyzeCutoff(inputPath),
      probeAudio(inputPath)
    ])
    return { image, cutoffHz, sampleRateHz: Number(probe.sampleRate) || 0 }
  })
}

app.setName('Rótulo')

app.whenReady().then(() => {
  if (!app.isPackaged && process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png')))
  }
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
