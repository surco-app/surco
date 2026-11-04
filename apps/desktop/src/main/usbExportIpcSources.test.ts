import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
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
  readVolumes: vi.fn(async () => []),
  watchVolumes: vi.fn(),
  stickHolder: vi.fn(),
}))

vi.mock('./seratoLibrary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./seratoLibrary')>()),
  readSeratoLibrary: vi.fn(),
}))
vi.mock('./usbExportSerato', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usbExportSerato')>()),
  seratoExportMarks: vi.fn(async () => null),
}))
vi.mock('./usbExportTraktor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usbExportTraktor')>()),
  traktorExportDelta: vi.fn(async () => null),
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
import { readSeratoLibrary } from './seratoLibrary'
import { registerUsbExportIpc } from './usbExportIpc'
import { seratoExportMarks } from './usbExportSerato'
import { traktorExportDelta } from './usbExportTraktor'
import { readVolumes } from './usbVolumes'

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

  it('computes only the newest Serato summary asked while one runs, and leaves rekordbox summaries as they were', async () => {
    const { exporters } = register({ serato: { roots: () => [ROOT] } })
    const [serato, rekordbox] = [exporters[0], exporters.at(-1) as UsbExporter]
    let release = (): void => {}
    vi.mocked(serato.plan).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: false, reason: 'unsupported' })
        }),
    )
    const plan = handlerFor('usb:plan')
    const first = plan({}, { ...req(), source: 'serato' })
    const second = plan({}, { ...req(), playlistIds: ['2'], source: 'serato' })
    const third = plan({}, { ...req(), playlistIds: ['3'], source: 'serato' })
    expect(await second).toEqual({ ok: false, reason: 'busy' })
    release()
    await first
    await third
    expect(vi.mocked(serato.plan).mock.calls.map(([r]) => r.playlistIds)).toEqual([['1'], ['3']])
    vi.mocked(rekordbox.plan).mockImplementation(() => new Promise(() => {}))
    void plan({}, req())
    void plan({}, req())
    expect(rekordbox.plan).toHaveBeenCalledTimes(2)
  })

  it('reads the tags of an unchanged Serato track once across summaries', async () => {
    const file = join(userData, 'a.mp3')
    writeFileSync(file, 'x')
    vi.mocked(readSeratoLibrary).mockReturnValue({
      tracks: [],
      crates: new Map([['Sets', [file]]]),
      links: new Map(),
      unreadable: [],
    })
    const { pioneer } = register({ serato: { roots: () => [ROOT] } })
    await pioneer[0].readSelection('', ['Sets'])
    await pioneer[0].readSelection('', ['Sets'])
    expect(seratoExportMarks).toHaveBeenCalledOnce()
  })

  it('reads the clock of an unchanged Traktor track once across summaries', async () => {
    const file = join(userData, 'a.mp3')
    writeFileSync(file, 'x')
    const dir = `${dirname(file).split('/').join('/:')}/:`
    const nml = join(userData, 'collection.nml')
    writeFileSync(
      nml,
      `<NML VERSION="20"><COLLECTION ENTRIES="1"><ENTRY TITLE="A"><LOCATION DIR="${dir}" FILE="${basename(file)}" VOLUME="HD"></LOCATION></ENTRY></COLLECTION><PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="1"><NODE TYPE="PLAYLIST" NAME="Fri"><PLAYLIST ENTRIES="1" TYPE="LIST" UUID="p1"><ENTRY><PRIMARYKEY TYPE="TRACK" KEY="HD${dir}${basename(file)}"></PRIMARYKEY></ENTRY></PLAYLIST></NODE></SUBNODES></NODE></PLAYLISTS></NML>`,
    )
    const { pioneer } = register({ traktor: { nml: () => nml, bootVolume: () => 'HD' } })
    const first = await pioneer[0].readSelection(nml, ['p1'])
    await pioneer[0].readSelection(nml, ['p1'])
    expect(first).toMatchObject({ tracks: [{ path: file }] })
    expect(traktorExportDelta).toHaveBeenCalledOnce()
  })

  it('lets every Pioneer tab, rekordbox included, see the memories of the other Surco tabs, so a stick one wrote never reads as unknown in another', async () => {
    const { pioneer } = register({
      serato: { roots: () => [ROOT] },
      traktor: { nml: () => '/t/c.nml', bootVolume: () => 'HD' },
    })
    const [serato, traktor, rekordbox] = pioneer
    await handlerFor('usb:volumes')({})
    for (const d of [serato, traktor, rekordbox]) await d.volumes()
    const surcos = vi.mocked(readVolumes).mock.calls.map((c) => c[6])
    expect(surcos).toHaveLength(4)
    for (const surco of surcos)
      expect(surco).toEqual({
        rekordbox: rekordbox.memory,
        serato: serato.memory,
        traktor: traktor.memory,
      })
  })
})
