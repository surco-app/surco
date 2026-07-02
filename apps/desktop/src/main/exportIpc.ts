import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { starsTagToEngineRating } from '../shared/rating'
import type { EngineExportTrack } from '../shared/types'
import { activity } from './activity'
import { buildEngineDatabase, type EngineTrack } from './engine'

// The DJ-software export dialogs, split out of index.ts's registerIpc by domain (the
// audioIpc.ts precedent): each picks a destination, writes the bytes the renderer (or
// the Engine builder) produced, and reports the write to the activity feed. None of
// them touch window or session state, which is what makes the domain self-contained.
export function registerExportIpc(): void {
  // Writes a rekordbox collection XML the user can import (File ▸ Import Collection).
  // Returns the saved path, or null when the save dialog is cancelled.
  ipcMain.handle('dialog:exportRekordbox', async (_e, xml: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Exporta a rekordbox',
      defaultPath: 'rekordbox.xml',
      filters: [{ name: 'rekordbox XML', extensions: ['xml'] }],
    })
    if (canceled || !filePath) return null
    // Wrap only the write, not the dialog: the user's think-time is not work.
    await activity.track('export', 'activity.exportRekordbox', () => writeFile(filePath, xml, 'utf8'), {
      detail: filePath,
    })
    return filePath
  })

  // Writes a Traktor collection the user can import (File ▸ Import Collection). Returns
  // the saved path, or null when cancelled — same shape as the rekordbox export.
  ipcMain.handle('dialog:exportTraktor', async (_e, nml: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Exporta a Traktor',
      defaultPath: 'collection.nml',
      filters: [{ name: 'Traktor NML', extensions: ['nml'] }],
    })
    if (canceled || !filePath) return null
    await activity.track('export', 'activity.exportTraktor', () => writeFile(filePath, nml, 'utf8'), {
      detail: filePath,
    })
    return filePath
  })

  // Writes a Serato DJ crate (binary). The renderer builds the bytes; the DJ drops the file
  // into their _Serato_/Subcrates folder. Returns the saved path, or null when cancelled.
  ipcMain.handle('dialog:exportSerato', async (_e, data: Uint8Array) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Exporta a Serato',
      defaultPath: 'Surco.crate',
      filters: [{ name: 'Serato crate', extensions: ['crate'] }],
    })
    if (canceled || !filePath) return null
    await activity.track('export', 'activity.exportSerato', () => writeFile(filePath, data), {
      detail: filePath,
    })
    return filePath
  })

  // Writes a Denon Engine DJ library (Engine Library/Database2/m.db) into a folder the user
  // picks — its own fresh library, never the user's existing one. Returns the Engine Library
  // path, or null when cancelled. The renderer ships serializable track data; here we resolve
  // each to the relative path + file size Engine's SQLite schema wants.
  // Writes an extended M3U8 playlist — the bridge to everything that isn't DJ software.
  // Returns the saved path, or null when cancelled, like the other exports.
  ipcMain.handle('dialog:exportM3u', async (_e, m3u: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Exporta a M3U8',
      defaultPath: 'surco.m3u8',
      filters: [{ name: 'M3U8 playlist', extensions: ['m3u8', 'm3u'] }],
    })
    if (canceled || !filePath) return null
    await activity.track('export', 'activity.exportM3u', () => writeFile(filePath, m3u, 'utf8'), {
      detail: filePath,
    })
    return filePath
  })

  ipcMain.handle(
    'dialog:exportEngine',
    async (_e, tracks: EngineExportTrack[], playlistName: string) => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Exporta a Engine DJ',
        message: 'Elige una carpeta para la biblioteca Engine',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (canceled || !filePaths[0]) return null
      const libraryDir = join(filePaths[0], 'Engine Library')
      const database2Dir = join(libraryDir, 'Database2')
      await mkdir(database2Dir, { recursive: true })
      const resolved: EngineTrack[] = await Promise.all(
        tracks.map(async (t) => {
          const bpm = Number.parseFloat(t.bpm)
          const year = Number.parseInt(t.year, 10)
          let fileBytes: number | null = null
          try {
            fileBytes = (await stat(t.path)).size
          } catch {
            // The source may have moved since import; Engine still imports the row without a size.
          }
          return {
            // Engine stores the path relative to the Engine Library dir, forward-slashed.
            relativePath: relative(libraryDir, t.path).split('\\').join('/'),
            filename: basename(t.path),
            fileType: extname(t.path).slice(1).toLowerCase(),
            fileBytes,
            title: t.title,
            artist: t.artist,
            album: t.album,
            genre: t.genre,
            comment: t.comment,
            bpm: Number.isFinite(bpm) ? Math.round(bpm) : null,
            bpmAnalyzed: Number.isFinite(bpm) ? bpm : null,
            year: Number.isFinite(year) ? year : null,
            rating: starsTagToEngineRating(t.rating),
            durationSec: t.durationSec !== undefined ? Math.round(t.durationSec) : null,
          }
        }),
      )
      // The database build (sql.js) plus the write is the real work worth timing here.
      await activity.track(
        'export',
        'activity.exportEngine',
        async () =>
          writeFile(join(database2Dir, 'm.db'), await buildEngineDatabase(resolved, playlistName)),
        { detail: libraryDir },
      )
      return libraryDir
    },
  )
}
