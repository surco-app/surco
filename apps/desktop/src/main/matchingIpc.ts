import { ipcMain } from 'electron'
import type { MatchingStore } from './matchingStore'

const twoPaths = (a: unknown, b: unknown): a is string =>
  typeof a === 'string' && typeof b === 'string' && a !== '' && b !== ''

export function registerMatchingIpc(store: MatchingStore): void {
  ipcMain.handle('matching:list', () => store.list())
  ipcMain.handle('matching:add', (_e, a: unknown, b: unknown) => {
    if (twoPaths(a, b)) store.add(a, b as string)
  })
  ipcMain.handle('matching:remove', (_e, a: unknown, b: unknown) => {
    if (twoPaths(a, b)) store.remove(a, b as string)
  })
}
