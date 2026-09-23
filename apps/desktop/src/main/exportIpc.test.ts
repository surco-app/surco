import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, showSaveDialog, showOpenDialog } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showSaveDialog: vi.fn(async (_opts: { title?: string; defaultPath?: string }) => ({
    canceled: true,
    filePath: undefined,
  })),
  showOpenDialog: vi.fn(async (_opts: { title?: string }) => ({ canceled: true, filePaths: [] })),
}))

vi.mock('electron', () => ({
  dialog: { showSaveDialog, showOpenDialog },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}))
vi.mock('./settings', () => ({ defaults: {}, getSettings: () => ({}), replaceSettings: vi.fn() }))

import { registerExportIpc } from './exportIpc'
import { createMenuT } from './i18n'

beforeEach(() => {
  handlers.clear()
  showSaveDialog.mockClear()
  showOpenDialog.mockClear()
})

async function titleOf(channel: string, ...args: unknown[]): Promise<string | undefined> {
  await handlers.get(channel)?.({}, ...args)
  return (showSaveDialog.mock.calls[0] ?? showOpenDialog.mock.calls[0])?.[0].title
}

// The save and open panels are the main process's own windows, so the renderer's language
// never reaches them. Their titles were written in Spanish, and every user in every
// language was asked "Exporta a Traktor" by a panel sitting on top of an English app.
describe('the export dialogs', () => {
  it.each([
    ['dialog:exportRekordbox', 'Export to rekordbox', ''],
    ['dialog:exportTraktor', 'Export to Traktor', ''],
    ['dialog:exportSerato', 'Export to Serato', []],
    ['dialog:exportQualityReport', 'Save the quality report', 'data:image/png;base64,', 'x'],
    ['dialog:exportStatsImage', 'Save your stats', 'data:image/png;base64,'],
    ['dialog:exportM3u', 'Export to M3U8', ''],
    ['dialog:exportSettings', 'Export the settings'],
    ['dialog:importSettings', 'Import the settings'],
  ])('titles %s in the app language', async (channel, title, ...args) => {
    registerExportIpc(() => createMenuT('en'))
    expect(await titleOf(channel, ...args)).toBe(title)
  })

  it('names the stats image in the app language', async () => {
    registerExportIpc(() => createMenuT('en'))
    await handlers.get('dialog:exportStatsImage')?.({}, 'data:image/png;base64,')
    expect(showSaveDialog.mock.calls[0]?.[0].defaultPath).toBe('My Surco stats.png')
  })
})
