import { existsSync, statSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LibraryCopy, RestoreRefusal, RestoreResult } from '../shared/types'
import { copyFolder, listCopies, restoreSlot, takeCopy } from './libraryHistory'
import { removeTemp, renameWithRetry } from './renameRetry'

export type { RestoreRefusal, RestoreResult }

export interface RestoreDeps {
  ensureClosed: () => Promise<boolean>
  isRunning: () => Promise<boolean>
  pendingLog: (collectionPath: string) => boolean
  discardQueue: () => void
}

const TEMP = '.surco-tmp'

function hasFrames(path: string): boolean {
  try {
    return statSync(path).size > 0
  } catch {
    return false
  }
}

export function rekordboxPendingLog(collectionPath: string): boolean {
  return hasFrames(`${collectionPath}-wal`)
}

export function enginePendingLog(collectionPath: string): boolean {
  return hasFrames(`${collectionPath}-wal`) || hasFrames(`${collectionPath}-journal`)
}

async function findCopy(collectionPath: string, copyId: string): Promise<LibraryCopy | null> {
  const listed = (await listCopies(collectionPath)).find((copy) => copy.id === copyId)
  if (listed) return listed
  const slot = await restoreSlot(collectionPath)
  return slot?.id === copyId ? slot : null
}

export async function restoreCopy(
  req: { collectionPath: string; copyId: string },
  deps: RestoreDeps,
): Promise<RestoreResult> {
  const copy = await findCopy(req.collectionPath, req.copyId)
  if (!copy) return { ok: false, reason: 'not-found' }
  if (copy.collectionPath !== req.collectionPath) return { ok: false, reason: 'other-collection' }
  try {
    if (!(await deps.ensureClosed())) return { ok: false, reason: 'running' }
    if (deps.pendingLog(req.collectionPath)) return { ok: false, reason: 'pending-log' }
  } catch {
    return { ok: false, reason: 'failed' }
  }

  const folder = copyFolder(copy)
  const pending = copy.files.map((file) => ({ from: `${file.target}${TEMP}`, to: file.target }))
  const clean = () => Promise.all(pending.map((file) => removeTemp(file.from)))
  try {
    for (const [i, file] of copy.files.entries()) {
      await copyFile(join(folder, file.name), pending[i].from)
    }
    const companions = copy.files
      .map((file) => file.target)
      .filter((t) => t !== copy.collectionPath)
    if (existsSync(copy.collectionPath)) {
      await takeCopy(copy.collectionPath, companions, 'restore')
    }
  } catch {
    await clean()
    return { ok: false, reason: 'failed' }
  }

  let replaced = false
  const stop = async (reason: RestoreRefusal): Promise<RestoreResult> => {
    await clean()
    if (replaced) deps.discardQueue()
    return { ok: false, reason }
  }
  while (pending.length > 0) {
    if (await deps.isRunning().catch(() => true)) return stop('running')
    try {
      await renameWithRetry(pending[0].from, pending[0].to)
    } catch {
      return stop('failed')
    }
    replaced = true
    pending.shift()
  }
  deps.discardQueue()
  return { ok: true }
}
