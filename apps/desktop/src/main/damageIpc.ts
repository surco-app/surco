import { ipcMain, type WebContents } from 'electron'
import type { DamageFinding, DamageRepairItem, DamageScan } from '../shared/types'
import { type DamageRepairDeps, pendingDamage, repairDamage } from './damageRepair'
import { type DamageScanDeps, scanDamage } from './damageScan'

export { pendingDamage }

export interface QueuedRepairs {
  engine: {
    from: string
    to: string
    expectTrackData?: { sampleRate: number; sampleCount: number }
  }[]
  traktor: { from: string; patch: { cueShift?: unknown } }[]
}

export interface DamageIpcDeps {
  scanDeps: (sender: WebContents) => DamageScanDeps
  repairDeps: (sender: WebContents) => DamageRepairDeps
  serial?: <T>(task: () => Promise<T>) => Promise<T>
  queued?: () => QueuedRepairs
}

const nfc = (s: string) => s.normalize('NFC')

function queuedFor(f: DamageFinding, queued: QueuedRepairs): boolean {
  const r = f.repair
  if (r?.target === 'engine')
    return queued.engine.some(
      (q) =>
        nfc(q.from) === nfc(r.path) &&
        q.expectTrackData?.sampleRate === r.expectTrackData.sampleRate &&
        q.expectTrackData?.sampleCount === r.expectTrackData.sampleCount,
    )
  if (r?.target === 'traktor' && r.entry) {
    const key = [r.entry.volume, r.entry.dir, r.entry.file].map(nfc).join('\0')
    return queued.traktor.some((q) => q.from === key && q.patch.cueShift !== undefined)
  }
  return false
}

function markPending(scan: DamageScan, queued?: QueuedRepairs): DamageScan {
  const pending = (f: DamageFinding) => (queued ? queuedFor(f, queued) : pendingDamage.has(f.id))
  return {
    ...scan,
    findings: scan.findings.map((f) => (pending(f) ? { ...f, pending: true } : f)),
  }
}

export function registerDamageIpc(deps: DamageIpcDeps): void {
  ipcMain.handle('damage:scan', async (e, paths: string[]) =>
    markPending(await scanDamage(paths, deps.scanDeps(e.sender)), deps.queued?.()),
  )
  ipcMain.handle('damage:repair', (e, items: DamageRepairItem[]) => {
    const run = () => repairDamage(items, deps.repairDeps(e.sender))
    return deps.serial ? deps.serial(run) : run()
  })
}
