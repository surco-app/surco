import { ipcMain, type WebContents } from 'electron'
import type { DamageScan } from '../shared/types'
import { type DamageScanDeps, scanDamage } from './damageScan'

export interface DamageIpcDeps {
  scanDeps: (sender: WebContents) => DamageScanDeps
}

export const pendingDamage = new Set<string>()

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
}
