import { writeFile } from 'node:fs/promises'
import { dialog, ipcMain } from 'electron'
import { buildSeratoCrate } from '../shared/serato'
import { activity } from './activity'
import { getSettings } from './settings'

// The DJ-software export dialogs, split out of index.ts's registerIpc by domain (the
// audioIpc.ts precedent): each picks a destination, writes the bytes the renderer
// produced, and reports the write to the activity feed. None of them touch window or
// session state, which is what makes the domain self-contained.
export function serializeSettingsForExport(): string {
  return JSON.stringify(getSettings(), null, 2)
}

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

  // Writes a Serato DJ crate (binary) into the DJ's _Serato_/Subcrates folder. The bytes
  // are built HERE, after the dialog: crate paths are relative to the volume the crate
  // lands on, so the save location has to be known before the paths can be rendered.
  ipcMain.handle(
    'dialog:exportSerato',
    async (_e, tracks: { inputPath: string; outputPath?: string }[]) => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Exporta a Serato',
        defaultPath: 'Surco.crate',
        filters: [{ name: 'Serato crate', extensions: ['crate'] }],
      })
      if (canceled || !filePath) return null
      await activity.track(
        'export',
        'activity.exportSerato',
        () => writeFile(filePath, buildSeratoCrate(tracks, filePath)),
        { detail: filePath },
      )
      return filePath
    },
  )

  // Writes the shareable audio-quality report the renderer composed (a PNG data URL):
  // the spectrogram with its verdict, ready to drop in a forum thread. Returns the saved
  // path, or null when cancelled — same shape as the other exports.
  ipcMain.handle('dialog:exportQualityReport', async (_e, dataUrl: string, baseName: string) => {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    // The base name comes from track metadata, which can carry path separators.
    const safe = baseName.replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Surco'
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Guarda el informe de calidad',
      defaultPath: `${safe}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, Buffer.from(base64, 'base64'))
    return filePath
  })

  // Writes the shareable lifetime-stats card the renderer composed (a PNG data URL),
  // story-sized for social media. Returns the saved path, or null when cancelled.
  ipcMain.handle('dialog:exportStatsImage', async (_e, dataUrl: string) => {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Guarda tus estadísticas',
      defaultPath: 'Mis estadísticas de Surco.png',
      filters: [{ name: 'PNG', extensions: ['png'] }],
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, Buffer.from(base64, 'base64'))
    return filePath
  })

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

  ipcMain.handle('dialog:exportSettings', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Exporta la configuración',
      defaultPath: 'surco-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePath) return null
    const json = serializeSettingsForExport()
    await activity.track(
      'export',
      'activity.exportSettings',
      () => writeFile(filePath, json, 'utf8'),
      { detail: filePath },
    )
    return filePath
  })
}
