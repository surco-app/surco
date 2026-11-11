import { ipcMain } from 'electron'
import type { DjMainProgram, DjMainTable } from '../shared/djApi'
import type { DjProgram } from '../shared/djProgram'

type Section<S extends keyof DjMainProgram> = NonNullable<DjMainProgram[S]>

function resolveOperation(
  table: DjMainTable,
  program: DjProgram,
  section: keyof DjMainProgram,
  operation: string,
  channel: string = operation,
): { target: Record<string, unknown>; run: (...args: unknown[]) => unknown } {
  const row = table[program]
  if (!row) throw new Error(`unknown DJ program ${program}`)
  const target = row[section] as unknown as Record<string, unknown> | undefined
  const run = target?.[operation]
  if (!target || typeof run !== 'function') throw new Error(`${program} has no ${channel}`)
  return { target, run: run as (...args: unknown[]) => unknown }
}

function registerOperation<S extends keyof DjMainProgram, O extends keyof Section<S> & string>(
  table: DjMainTable,
  section: S,
  operation: O,
  channel: string = operation,
): void {
  ipcMain.handle(`dj:${channel}`, async (_event, program: DjProgram, ...args: unknown[]) => {
    const { target, run } = resolveOperation(table, program, section, operation, channel)
    return run.apply(target, args)
  })
}

function registerSave(table: DjMainTable): void {
  ipcMain.handle(
    'dj:editPlaylist',
    async (event, program: DjProgram, edit: unknown, label: unknown, mode: unknown) => {
      const { target, run } = resolveOperation(table, program, 'edit', 'save', 'editPlaylist')
      return run.call(target, edit, label, event.sender, mode)
    },
  )
}

function registerApplyCueQueue(table: DjMainTable): void {
  ipcMain.handle('dj:applyCueQueue', async (event, program: DjProgram) => {
    const { target, run } = resolveOperation(table, program, 'cueQueue', 'apply', 'applyCueQueue')
    return run.call(target, event.sender)
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
  registerSave(table)
  registerOperation(table, 'edit', 'hasSeparator')
  registerOperation(table, 'cueQueue', 'read', 'cueQueue')
  registerApplyCueQueue(table)
  registerOperation(table, 'cueQueue', 'discard', 'discardCueQueue')
  registerOperation(table, 'cueQueue', 'ready', 'cueQueueReady')
}
