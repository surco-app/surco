import { ipcMain, type WebContents } from 'electron'
import type { DamageRepairItem, DamageScan } from '../shared/types'
import { type DamageRepairDeps, pendingDamage, repairDamage } from './damageRepair'
import { type DamageScanDeps, scanDamage } from './damageScan'

export { pendingDamage }

export interface DamageIpcDeps {
  scanDeps: (sender: WebContents) => DamageScanDeps
  repairDeps: (sender: WebContents) => DamageRepairDeps
  serial?: <T>(task: () => Promise<T>) => Promise<T>
}

function markPending(scan: DamageScan): DamageScan {
  const found = new Set(scan.findings.map((f) => f.id))
  for (const id of pendingDamage) if (!found.has(id)) pendingDamage.delete(id)
  return {
    ...scan,
    findings: scan.findings.map((f) => (pendingDamage.has(f.id) ? { ...f, pending: true } : f)),
  }
}

export function registerDamageIpc(deps: DamageIpcDeps): void {
  ipcMain.handle('damage:scan', async (e, paths: string[]) =>
    markPending(await scanDamage(paths, deps.scanDeps(e.sender))),
  )
  ipcMain.handle('damage:repair', (e, items: DamageRepairItem[]) => {
    const run = () => repairDamage(items, deps.repairDeps(e.sender))
    return deps.serial ? deps.serial(run) : run()
  })
}
