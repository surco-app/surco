import { ipcMain } from 'electron'
import type { DjMainProgram, DjMainTable } from '../shared/djApi'
import type { DjProgram } from '../shared/djProgram'

type Section<S extends keyof DjMainProgram> = NonNullable<DjMainProgram[S]>

function registerOperation<S extends keyof DjMainProgram, O extends keyof Section<S> & string>(
  table: DjMainTable,
  section: S,
  operation: O,
): void {
  ipcMain.handle(`dj:${operation}`, async (_event, program: DjProgram, ...args: unknown[]) => {
    const row = table[program]
    if (!row) throw new Error(`unknown DJ program ${program}`)
    const target = row[section] as unknown as Record<string, unknown> | undefined
    const run = target?.[operation]
    if (typeof run !== 'function') throw new Error(`${program} has no ${operation}`)
    return run.apply(target, args)
  })
}

export function registerDjIpc(table: DjMainTable): void {
  registerOperation(table, 'read', 'available')
  registerOperation(table, 'read', 'tree')
  registerOperation(table, 'read', 'recentCount')
  registerOperation(table, 'read', 'trackCount')
  registerOperation(table, 'read', 'playlist')
  registerOperation(table, 'read', 'membership')
  registerOperation(table, 'read', 'collection')
}
