import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsbExportRequest } from '../shared/types'
import type { UsbExporterDeps } from './usbExport'
import type { UsbExporter } from './usbExportRoute'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))
vi.mock('electron-log/main', () => ({ default: { info: vi.fn() } }))
vi.mock('./usbVolumes', () => ({
  systemVolumeSource: () => ({ idAt: async () => null }),
  readVolumes: async () => [],
  watchVolumes: vi.fn(),
  stickHolder: vi.fn(),
}))

const made = vi.hoisted(() => ({
  pioneer: [] as unknown[],
  exporters: [] as unknown[],
  fake: null as null | (() => unknown),
}))

vi.mock('./usbExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usbExport')>()),
  createUsbExporter: (deps: never) => {
    made.pioneer.push(deps)
    const exporter = made.fake?.()
    made.exporters.push(exporter)
    return exporter
  },
}))
vi.mock('./engineUsbExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./engineUsbExport')>()),
  createEngineUsbExporter: () => made.fake?.(),
}))

import { dialog, ipcMain } from 'electron'
import { registerUsbExportIpc } from './usbExportIpc'

function handlerFor(channel: string): (e: unknown, ...args: unknown[]) => unknown {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1] as never
}

const fake = (): UsbExporter => ({
  plan: vi.fn(async () => ({ ok: false as const, reason: 'unsupported' as const })),
  start: vi.fn(async () => ({ ok: true as const })),
  cancel: vi.fn(() => false),
  stop: vi.fn(async () => {}),
  busy: () => false,
})
made.fake = fake

const req = (): UsbExportRequest => ({
  playlistIds: ['1'],
  target: { kind: 'volume', uuid: 'U' },
  prune: false,
  settings: false,
})

const ROOT = { dir: '/Users/dj/Music/_Serato_', root: '/' }
const ENTRY = {
  playlistIds: ['Sets'],
  trackIds: ['9'],
  at: 3,
  pdb: null,
  prune: false,
  settings: false,
}

let userData = ''

function register(sources: Pick<Parameters<typeof registerUsbExportIpc>[0], 'serato' | 'traktor'>) {
  registerUsbExportIpc({
    collection: () => '/rb/master.db',
    userData,
    home: '/home',
    appData: '/appdata',
    baken: () => null,
    ensureClosed: vi.fn(async () => true),
    engineLibrary: () => '/engine',
    ...sources,
  })
  return {
    pioneer: made.pioneer as UsbExporterDeps[],
    exporters: made.exporters as UsbExporter[],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  made.pioneer = []
  made.exporters = []
  userData = mkdtempSync(join(tmpdir(), 'usb-sources-'))
})

describe('registerUsbExportIpc with Serato and Traktor', () => {
  it('builds the Serato and Traktor exporters with their own memory and none of rekordbox pieces', async () => {
    const { pioneer } = register({
      serato: { roots: () => [ROOT] },
      traktor: { nml: () => '/t/collection.nml', bootVolume: () => 'HD' },
    })
    const [serato, traktor] = pioneer.slice(0, 2)
    for (const d of [serato, traktor]) {
      expect(d.identity('', [])).toBeNull()
      expect(await d.rekordboxRunning()).toBe(false)
    }
    serato.memory.remember('volume:U', ENTRY)
    expect(existsSync(join(userData, 'usb-serato-exports.json'))).toBe(true)
    expect(existsSync(join(userData, 'usb-exports.json'))).toBe(false)
  })

  it('has no Serato library to export without a Serato folder', () => {
    const { pioneer } = register({ serato: { roots: () => [] } })
    expect(pioneer[0].collection()).toBe('')
  })

  it('sends a Serato request to the Serato exporter', async () => {
    const { exporters } = register({ serato: { roots: () => [ROOT] } })
    await handlerFor('usb:plan')({}, { ...req(), source: 'serato' })
    expect(exporters.at(0)?.plan).toHaveBeenCalled()
    expect(exporters.at(-1)?.plan).not.toHaveBeenCalled()
  })

  it('answers a folder pick with what Surco remembers there for Traktor', async () => {
    const { pioneer } = register({ traktor: { nml: () => '/t/c.nml', bootVolume: () => 'HD' } })
    pioneer[0].memory.remember('folder:/Volumes/S/sets', ENTRY)
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ['/Volumes/S/sets'],
    })
    expect(await handlerFor('usb:pickFolder')({ sender: {} }, 'traktor')).toMatchObject({
      remembered: { playlistIds: ENTRY.playlistIds },
    })
  })

  it('reads the Traktor collection Settings point at, failing loudly when it is gone so the export says unreadable', async () => {
    const nml = join(userData, 'missing.nml')
    const { pioneer } = register({ traktor: { nml: () => nml, bootVolume: () => 'HD' } })
    expect(pioneer[0].collection()).toBe(nml)
    await expect(
      Promise.resolve().then(() => pioneer[0].readSelection(nml, ['1'])),
    ).rejects.toThrow(/ENOENT/)
  })
})
