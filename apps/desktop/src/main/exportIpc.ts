import { readFile, writeFile } from 'node:fs/promises'
import { dialog, ipcMain } from 'electron'
import { errorWithKey } from '../shared/errorKeys'
import { buildSeratoCrate } from '../shared/serato'
import type { Settings } from '../shared/types'
import { activity } from './activity'
import type { createMenuT } from './i18n'
import { defaults, getSettings, replaceSettings, settingsForRenderer } from './settings'

// The DJ-software export dialogs, split out of index.ts's registerIpc by domain (the
// audioIpc.ts precedent): each picks a destination, writes the bytes the renderer
// produced, and reports the write to the activity feed. None of them touch window or
// session state, which is what makes the domain self-contained.
export function serializeSettingsForExport(): string {
  const { beatportUsername: _user, beatportPassword: _password, ...exported } = getSettings()
  return JSON.stringify(exported, null, 2)
}

export function applyImportedSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) {
    throw errorWithKey('settingsFileNotSurco')
  }
  const known = Object.keys(defaults) as (keyof Settings)[]
  const hasKnownKey = known.some((k) => k in (raw as object))
  if (!hasKnownKey) {
    throw errorWithKey('settingsFileNotSurco')
  }
  return replaceSettings(raw as Partial<Settings>)
}

// The panels are the main process's own windows, out of the renderer's i18next reach, so
// their titles resolve through the menu strings in the language Surco is set to.
export function registerExportIpc(menuT: () => ReturnType<typeof createMenuT>): void {
  // Writes a rekordbox collection XML the user can import (File ▸ Import Collection).
  // Returns the saved path, or null when the save dialog is cancelled.
  ipcMain.handle('dialog:exportRekordbox', async (_e, xml: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: menuT()('dialogExportRekordbox'),
      defaultPath: 'rekordbox.xml',
      filters: [{ name: 'rekordbox XML', extensions: ['xml'] }],
    })
    if (canceled || !filePath) return null
    // Wrap only the write, not the dialog: the user's think-time is not work.
    await activity.track(
      'export',
      'activity.exportRekordbox',
      () => writeFile(filePath, xml, 'utf8'),
      {
        detail: filePath,
      },
    )
    return filePath
  })

  // Writes a Traktor collection the user can import (File ▸ Import Collection). Returns
  // the saved path, or null when cancelled — same shape as the rekordbox export.
  ipcMain.handle('dialog:exportTraktor', async (_e, nml: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: menuT()('dialogExportTraktor'),
      defaultPath: 'collection.nml',
      filters: [{ name: 'Traktor NML', extensions: ['nml'] }],
    })
    if (canceled || !filePath) return null
    await activity.track(
      'export',
      'activity.exportTraktor',
      () => writeFile(filePath, nml, 'utf8'),
      {
        detail: filePath,
      },
    )
    return filePath
  })

  // Writes a Serato DJ crate (binary) into the DJ's _Serato_/Subcrates folder. The bytes
  // are built HERE, after the dialog: crate paths are relative to the volume the crate
  // lands on, so the save location has to be known before the paths can be rendered.
  ipcMain.handle(
    'dialog:exportSerato',
    async (_e, tracks: { inputPath: string; outputPath?: string }[]) => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: menuT()('dialogExportSerato'),
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
    const safe =
      baseName
        .replace(/[/\\:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Surco'
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: menuT()('dialogSaveQualityReport'),
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
      title: menuT()('dialogSaveStats'),
      defaultPath: menuT()('dialogStatsFileName'),
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
      title: menuT()('dialogExportM3u'),
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
      title: menuT()('dialogExportSettings'),
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

  ipcMain.handle('dialog:importSettings', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: menuT()('dialogImportSettings'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (canceled || filePaths.length === 0) return null
    try {
      const raw = JSON.parse(await readFile(filePaths[0], 'utf8'))
      const settings = settingsForRenderer(applyImportedSettings(raw))
      return { ok: true as const, settings }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
