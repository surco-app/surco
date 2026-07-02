import { writeFile } from 'node:fs/promises'
import { dialog, ipcMain } from 'electron'
import { activity } from './activity'

// The DJ-software export dialogs, split out of index.ts's registerIpc by domain (the
// audioIpc.ts precedent): each picks a destination, writes the bytes the renderer
// produced, and reports the write to the activity feed. None of them touch window or
// session state, which is what makes the domain self-contained.
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

}
