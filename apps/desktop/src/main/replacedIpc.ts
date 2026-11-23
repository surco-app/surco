import { ipcMain } from 'electron'
import { DJ_PROGRAMS, type DjProgram } from '../shared/djProgram'
import type { ReplacedEntry } from '../shared/toReview'
import type { ReplacedStore } from './replacedStore'

const isProgramList = (v: unknown): v is DjProgram[] =>
  Array.isArray(v) && v.every((p) => DJ_PROGRAMS.includes(p))

function isEntry(e: unknown): e is ReplacedEntry {
  if (typeof e !== 'object' || e === null) return false
  const x = e as Record<string, unknown>
  return (
    typeof x.newPath === 'string' &&
    x.newPath !== '' &&
    typeof x.oldPath === 'string' &&
    x.oldPath !== '' &&
    typeof x.replacedAt === 'number' &&
    typeof x.shift === 'object' &&
    x.shift !== null &&
    isProgramList(x.pending) &&
    (x.formerPaths === undefined ||
      (Array.isArray(x.formerPaths) && x.formerPaths.every((p) => typeof p === 'string')))
  )
}

export function registerReplacedIpc(store: ReplacedStore): void {
  ipcMain.handle('replaced:list', () => store.list())
  ipcMain.handle('replaced:review', (_e, path: unknown, programs?: unknown) => {
    if (typeof path !== 'string' || path === '') return null
    if (programs === undefined) return store.review(path)
    if (!isProgramList(programs)) return null
    return store.review(path, programs)
  })
  ipcMain.handle('replaced:restore', (_e, entry: unknown) => {
    if (isEntry(entry)) store.restore(entry)
  })
}
