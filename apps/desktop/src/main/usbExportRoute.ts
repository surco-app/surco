import type { UsbExportRequest, UsbPlanResult, UsbStartResult } from '../shared/types'

export interface UsbExporter {
  plan: (req: UsbExportRequest) => Promise<UsbPlanResult>
  start: (req: UsbExportRequest) => Promise<UsbStartResult>
  cancel: () => boolean
  stop: () => Promise<void>
  busy: () => boolean
}

export function routeUsbExports(rekordbox: UsbExporter, engine: UsbExporter): UsbExporter {
  const pick = (req: UsbExportRequest): [UsbExporter, UsbExporter] =>
    req.source === 'engine' ? [engine, rekordbox] : [rekordbox, engine]
  return {
    plan: (req) => {
      const [chosen, other] = pick(req)
      return other.busy() ? Promise.resolve({ ok: false, reason: 'busy' }) : chosen.plan(req)
    },
    start: (req) => {
      const [chosen, other] = pick(req)
      return other.busy() ? Promise.resolve({ ok: false, reason: 'busy' }) : chosen.start(req)
    },
    cancel: () => rekordbox.cancel() || engine.cancel(),
    stop: async () => {
      await Promise.all([rekordbox.stop(), engine.stop()])
    },
    busy: () => rekordbox.busy() || engine.busy(),
  }
}
