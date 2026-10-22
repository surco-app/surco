import { describe, expect, it, vi } from 'vitest'
import type { UsbExportRequest } from '../shared/types'
import { routeUsbExports, type UsbExporter } from './usbExportRoute'

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

describe('routeUsbExports', () => {
  it('sends an Engine DJ export to the Engine exporter and everything else to rekordbox, as before', async () => {
    const rekordbox = fake()
    const engine = fake()
    const route = routeUsbExports(rekordbox, engine)
    await route.start(req('engine'))
    await route.plan(req())
    expect(engine.start).toHaveBeenCalledOnce()
    expect(engine.plan).not.toHaveBeenCalled()
    expect(rekordbox.plan).toHaveBeenCalledOnce()
    expect(rekordbox.start).not.toHaveBeenCalled()
  })

  it('refuses either export while the other one writes, since both would write the same drive at once', async () => {
    const route = routeUsbExports(fake(true), fake())
    expect(await route.start(req('engine'))).toEqual({ ok: false, reason: 'busy' })
    expect(await route.plan(req('engine'))).toEqual({ ok: false, reason: 'busy' })
    expect(route.busy()).toBe(true)
    const other = routeUsbExports(fake(), fake(true))
    expect(await other.start(req())).toEqual({ ok: false, reason: 'busy' })
  })

  it('cancels and settles whichever export runs, so Cancel and quitting work for both', async () => {
    const rekordbox = fake()
    const engine = fake(true)
    const route = routeUsbExports(rekordbox, engine)
    expect(route.cancel()).toBe(true)
    await route.stop()
    expect(engine.stop).toHaveBeenCalledOnce()
    expect(rekordbox.stop).toHaveBeenCalledOnce()
  })
})
