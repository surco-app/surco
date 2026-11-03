import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsbExportRequest } from '../shared/types'
import type { UsbExporter } from './usbExportRoute'

const fromWebContents = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: (s: unknown) => fromWebContents(s) },
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
  rekordbox: null as null | { deps: { ensureRekordboxClosed: () => Promise<boolean> } },
  engine: null as null | { deps: { ensureEngineClosed: () => Promise<boolean> } },
  exporters: { rekordbox: null as unknown, engine: null as unknown },
}))

vi.mock('./usbExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usbExport')>()),
  createUsbExporter: (deps: never) => {
    made.rekordbox = { deps }
    return made.exporters.rekordbox
  },
}))
vi.mock('./engineUsbExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./engineUsbExport')>()),
  createEngineUsbExporter: (deps: never) => {
    made.engine = { deps }
    return made.exporters.engine
  },
}))

import { ipcMain } from 'electron'
import { registerUsbExportIpc } from './usbExportIpc'

function handlerFor(channel: string): (e: unknown, ...args: unknown[]) => unknown {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1] as never
}

const fake = (busy = false): UsbExporter => ({
  plan: vi.fn(async () => ({ ok: false as const, reason: 'unsupported' as const })),
  start: vi.fn(async () => ({ ok: true as const })),
  cancel: vi.fn(() => busy),
  stop: vi.fn(async () => {}),
  busy: () => busy,
})

const req = (source?: 'engine'): UsbExportRequest => ({
  playlistIds: ['1'],
  target: { kind: 'volume', uuid: 'U' },
  prune: false,
  settings: false,
  ...(source && { source }),
})

function register(rekordbox: UsbExporter, engine: UsbExporter) {
  made.exporters.rekordbox = rekordbox
  made.exporters.engine = engine
  const opts = {
    collection: () => '/rb/master.db',
    userData: '/user',
    home: '/home',
    appData: '/appdata',
    baken: () => null,
    ensureClosed: vi.fn(async () => true),
    engineLibrary: () => '/engine',
  }
  const quit = registerUsbExportIpc(opts)
  return { opts, quit }
}

beforeEach(() => {
  vi.clearAllMocks()
  made.rekordbox = null
  made.engine = null
})

describe('registerUsbExportIpc', () => {
  it('plans and exports an Engine DJ request with the Engine exporter and the rest with rekordbox, so each stick gets its own program layout', async () => {
    const rekordbox = fake()
    const engine = fake()
    register(rekordbox, engine)
    await handlerFor('usb:plan')({}, req('engine'))
    await handlerFor('usb:export')({ sender: {} }, req())
    expect(engine.plan).toHaveBeenCalledWith(req('engine'))
    expect(rekordbox.plan).not.toHaveBeenCalled()
    expect(rekordbox.start).toHaveBeenCalledWith(req())
    expect(engine.start).not.toHaveBeenCalled()
  })

  it('refuses an export while the other program writes, since both would write the same drive at once', async () => {
    const engine = fake()
    register(fake(true), engine)
    expect(await handlerFor('usb:export')({ sender: {} }, req('engine'))).toEqual({
      ok: false,
      reason: 'busy',
    })
    expect(engine.start).not.toHaveBeenCalled()
    vi.mocked(ipcMain.handle).mockClear()
    const rekordbox = fake()
    register(rekordbox, fake(true))
    expect(await handlerFor('usb:plan')({}, req())).toEqual({ ok: false, reason: 'busy' })
    expect(rekordbox.plan).not.toHaveBeenCalled()
  })

  it('reaches the running export with Cancel and the quit guard, whichever program it is', async () => {
    const rekordbox = fake()
    const engine = fake(true)
    const { quit } = register(rekordbox, engine)
    expect(handlerFor('usb:cancel')({})).toBe(true)
    expect(engine.cancel).toHaveBeenCalled()
    expect(quit?.busy()).toBe(true)
    await quit?.stop()
    expect(engine.stop).toHaveBeenCalledOnce()
    expect(rekordbox.stop).toHaveBeenCalledOnce()
  })

  it('asks each program to close with its own USB wording, over the window that pressed Export', async () => {
    const { opts } = register(fake(), fake())
    const pressed = { id: 'w' }
    fromWebContents.mockReturnValue(pressed)
    await handlerFor('usb:export')({ sender: {} }, req())
    await made.rekordbox?.deps.ensureRekordboxClosed()
    await made.engine?.deps.ensureEngineClosed()
    expect(opts.ensureClosed).toHaveBeenCalledWith('rekordbox', pressed, 'rekordboxQuitDetailUsb')
    expect(opts.ensureClosed).toHaveBeenCalledWith('engine', pressed, 'engineQuitDetailUsb')
  })
})
