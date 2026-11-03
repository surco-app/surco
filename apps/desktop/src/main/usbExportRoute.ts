import { DJ_PROGRAMS, type DjProgram } from '../shared/djProgram'
import type { UsbExportRequest, UsbPlanResult, UsbStartResult } from '../shared/types'

export interface UsbExporter {
  plan: (req: UsbExportRequest) => Promise<UsbPlanResult>
  start: (req: UsbExportRequest) => Promise<UsbStartResult>
  cancel: () => boolean
  stop: () => Promise<void>
  busy: () => boolean
}

export type UsbProgram = Exclude<DjProgram, 'traktor'>

export type UsbExporters = Partial<Record<DjProgram, UsbExporter>> & Record<UsbProgram, UsbExporter>

export function usbProgramOf(req: UsbExportRequest): UsbProgram {
  return req.source === 'engine' ? 'engine' : 'rekordbox'
}

export function routeUsbExports(exporters: UsbExporters): UsbExporter {
  const registered = DJ_PROGRAMS.flatMap((p) => {
    const exporter = exporters[p]
    return exporter ? [{ program: p, exporter }] : []
  })
  const otherBusy = (program: DjProgram): boolean =>
    registered.some((r) => r.program !== program && r.exporter.busy())
  return {
    plan: (req) => {
      const program = usbProgramOf(req)
      return otherBusy(program)
        ? Promise.resolve({ ok: false, reason: 'busy' })
        : exporters[program].plan(req)
    },
    start: (req) => {
      const program = usbProgramOf(req)
      return otherBusy(program)
        ? Promise.resolve({ ok: false, reason: 'busy' })
        : exporters[program].start(req)
    },
    cancel: () => registered.some((r) => r.exporter.cancel()),
    stop: async () => {
      await Promise.all(registered.map((r) => r.exporter.stop()))
    },
    busy: () => registered.some((r) => r.exporter.busy()),
  }
}
