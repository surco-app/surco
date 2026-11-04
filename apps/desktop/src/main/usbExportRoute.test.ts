import { describe, expect, it, vi } from 'vitest'
import type { UsbExportRequest, UsbPlanResult } from '../shared/types'
import { latestPlanOnly, routeUsbExports, type UsbExporter, usbProgramOf } from './usbExportRoute'

const fake = (busy = false): UsbExporter => ({
  plan: vi.fn(async () => ({ ok: false as const, reason: 'unsupported' as const })),
  start: vi.fn(async () => ({ ok: true as const })),
  cancel: vi.fn(() => busy),
  stop: vi.fn(async () => {}),
  busy: () => busy,
})

const req = (source?: UsbExportRequest['source']): UsbExportRequest => ({
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
    const route = routeUsbExports({ rekordbox, engine })
    await route.start(req('engine'))
    await route.plan(req())
    expect(engine.start).toHaveBeenCalledOnce()
    expect(engine.plan).not.toHaveBeenCalled()
    expect(rekordbox.plan).toHaveBeenCalledOnce()
    expect(rekordbox.start).not.toHaveBeenCalled()
  })

  it('refuses either export while the other one writes, since both would write the same drive at once', async () => {
    const route = routeUsbExports({ rekordbox: fake(true), engine: fake() })
    expect(await route.start(req('engine'))).toEqual({ ok: false, reason: 'busy' })
    expect(await route.plan(req('engine'))).toEqual({ ok: false, reason: 'busy' })
    expect(route.busy()).toBe(true)
    const other = routeUsbExports({ rekordbox: fake(), engine: fake(true) })
    expect(await other.start(req())).toEqual({ ok: false, reason: 'busy' })
  })

  it('cancels and settles whichever export runs, so Cancel and quitting work for both', async () => {
    const rekordbox = fake()
    const engine = fake(true)
    const route = routeUsbExports({ rekordbox, engine })
    expect(route.cancel()).toBe(true)
    await route.stop()
    expect(engine.stop).toHaveBeenCalledOnce()
    expect(rekordbox.stop).toHaveBeenCalledOnce()
  })

  it('sends a Serato and a Traktor export to their own exporters, never to rekordbox', async () => {
    const rekordbox = fake()
    const serato = fake()
    const traktor = fake()
    const route = routeUsbExports({ rekordbox, engine: fake(), serato, traktor })
    await route.plan(req('serato'))
    await route.start(req('traktor'))
    expect(serato.plan).toHaveBeenCalledWith(req('serato'))
    expect(traktor.start).toHaveBeenCalledWith(req('traktor'))
    expect(rekordbox.plan).not.toHaveBeenCalled()
    expect(rekordbox.start).not.toHaveBeenCalled()
  })

  it('refuses a Serato export while rekordbox writes, and rekordbox while Traktor writes, as a stick takes one export at a time', async () => {
    const route = routeUsbExports({ rekordbox: fake(true), engine: fake(), serato: fake() })
    expect(await route.start(req('serato'))).toEqual({ ok: false, reason: 'busy' })
    const other = routeUsbExports({ rekordbox: fake(), engine: fake(), traktor: fake(true) })
    expect(await other.plan(req())).toEqual({ ok: false, reason: 'busy' })
    expect(other.busy()).toBe(true)
  })

  it('answers unsupported for a source with no exporter here, rather than reading another library', async () => {
    const route = routeUsbExports({ rekordbox: fake(), engine: fake() })
    expect(await route.plan(req('serato'))).toEqual({ ok: false, reason: 'unsupported' })
    expect(await route.start(req('traktor'))).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('cancels and stops a Traktor export like the others', async () => {
    const traktor = fake(true)
    const route = routeUsbExports({ rekordbox: fake(), engine: fake(), traktor })
    expect(route.cancel()).toBe(true)
    await route.stop()
    expect(traktor.stop).toHaveBeenCalledOnce()
  })
})

describe('usbProgramOf', () => {
  it('reads Engine DJ from the request and rekordbox from a request without a source, the format the renderer sends', () => {
    expect(usbProgramOf(req('engine'))).toBe('engine')
    expect(usbProgramOf(req())).toBe('rekordbox')
  })
})

describe('latestPlanOnly', () => {
  const asked = (id: string): UsbExportRequest => ({ ...req('serato'), playlistIds: [id] })
  const done: UsbPlanResult = { ok: false, reason: 'nothing-selected' }

  it('computes only the newest of the plans asked while one runs, so ticking crate by crate never queues one summary per pause on the main process', async () => {
    let release = (): void => {}
    const plan = vi.fn((r: UsbExportRequest) =>
      r.playlistIds[0] === 'a'
        ? new Promise<UsbPlanResult>((resolve) => {
            release = () => resolve(done)
          })
        : Promise.resolve(done),
    )
    const only = latestPlanOnly(plan)
    const a = only(asked('a'))
    const b = only(asked('b'))
    const c = only(asked('c'))
    expect(await b).toEqual({ ok: false, reason: 'busy' })
    release()
    expect(await a).toEqual(done)
    expect(await c).toEqual(done)
    expect(plan.mock.calls.map(([r]) => r.playlistIds[0])).toEqual(['a', 'c'])
  })

  it('runs the next plan after one that failed, so a broken summary never blocks the ones after it', async () => {
    const plan = vi
      .fn<(r: UsbExportRequest) => Promise<UsbPlanResult>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(done)
    const only = latestPlanOnly(plan)
    const a = only(asked('a'))
    const b = only(asked('b'))
    await expect(a).rejects.toThrow('boom')
    expect(await b).toEqual(done)
    expect(await only(asked('c'))).toEqual(done)
  })
})
