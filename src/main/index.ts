import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { mkdir, unlink } from 'fs/promises'
import { getSettings, saveSettings } from './settings'
import { search, getRelease, downloadCover } from './discogs'
import { convertToAiff } from './ffmpeg'
import { addToAppleMusic } from './applemusic'
import { Settings, ProcessJob } from '../shared/types'

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
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

  ipcMain.handle('process:track', async (_e, job: ProcessJob) => {
    const settings = getSettings()
    await mkdir(settings.outputDir, { recursive: true })

    let tempCover: string | undefined
    try {
      let coverPath = job.coverPath
      if (!coverPath && job.coverUrl?.startsWith('http')) {
        tempCover = await downloadCover(job.coverUrl)
        coverPath = tempCover
      }

      const outputPath = join(settings.outputDir, `${sanitizeFilename(job.outputName)}.aiff`)
      await convertToAiff(job.inputPath, outputPath, job.meta, coverPath)

      if (settings.addToAppleMusic) await addToAppleMusic(outputPath, job.meta)

      return { outputPath }
    } finally {
      if (tempCover) await unlink(tempCover).catch(() => {})
    }
  })

  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
