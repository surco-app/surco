import { type DjProgram, USB_PROGRAMS, type UsbProgram } from '../shared/djProgram'
import type { UsbExportRequest, UsbPlanResult, UsbStartResult } from '../shared/types'

export interface UsbExporter {
  plan: (req: UsbExportRequest) => Promise<UsbPlanResult>
  start: (req: UsbExportRequest) => Promise<UsbStartResult>
  cancel: () => boolean
  stop: () => Promise<void>
  busy: () => boolean
}

export type UsbExporters = { [P in UsbProgram]: UsbExporter | undefined } & Record<
  'rekordbox' | 'engine',
  UsbExporter
>

export function usbProgramOf(req: UsbExportRequest): DjProgram {
  return req.source ?? 'rekordbox'
}

export function routeUsbExports(exporters: UsbExporters): UsbExporter {
  const registered = USB_PROGRAMS.flatMap((p) => {
    const exporter = exporters[p]
    return exporter ? [{ program: p, exporter }] : []
  })
  const exporterOf = (program: DjProgram): UsbExporter | undefined =>
    registered.find((r) => r.program === program)?.exporter
  const otherBusy = (program: DjProgram): boolean =>
    registered.some((r) => r.program !== program && r.exporter.busy())
  return {
    plan: (req) => {
      const program = usbProgramOf(req)
      const exporter = exporterOf(program)
      if (!exporter) return Promise.resolve({ ok: false, reason: 'unsupported' })
      return otherBusy(program)
        ? Promise.resolve({ ok: false, reason: 'busy' })
        : exporter.plan(req)
    },
    start: (req) => {
      const program = usbProgramOf(req)
      const exporter = exporterOf(program)
      if (!exporter) return Promise.resolve({ ok: false, reason: 'unsupported' })
      return otherBusy(program)
        ? Promise.resolve({ ok: false, reason: 'busy' })
        : exporter.start(req)
    },
    cancel: () => registered.some((r) => r.exporter.cancel()),
    stop: async () => {
      await Promise.all(registered.map((r) => r.exporter.stop()))
    },
    busy: () => registered.some((r) => r.exporter.busy()),
  }
}

const SUPERSEDED: UsbPlanResult = { ok: false, reason: 'busy' }

export function latestPlanOnly(plan: UsbExporter['plan']): UsbExporter['plan'] {
  let running = false
  let waiting: {
    req: UsbExportRequest
    resolve: (answer: Promise<UsbPlanResult>) => void
  } | null = null
  const run = (req: UsbExportRequest): Promise<UsbPlanResult> => {
    running = true
    return plan(req).finally(() => {
      running = false
      const next = waiting
      waiting = null
      if (next) next.resolve(run(next.req))
    })
  }
  return (req) => {
    if (!running) return run(req)
    waiting?.resolve(Promise.resolve(SUPERSEDED))
    return new Promise((resolve) => {
      waiting = { req, resolve }
    })
  }
}
