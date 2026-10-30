import { existsSync, statSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import log from 'electron-log/main'
import type { LibraryCopy, RestoreRefusal, RestoreResult } from '../shared/types'
import { copyFolder, listCopies, restoreSlot, stageRestoreCopy } from './libraryHistory'
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
  let undo: Awaited<ReturnType<typeof stageRestoreCopy>> | null = null
  try {
    for (const [i, file] of copy.files.entries()) {
      await copyFile(join(folder, file.name), pending[i].from)
    }
    const companions = copy.files
      .map((file) => file.target)
      .filter((t) => t !== copy.collectionPath)
    if (existsSync(copy.collectionPath)) {
      undo = await stageRestoreCopy(copy.collectionPath, companions)
    }
  } catch {
    await clean()
    return { ok: false, reason: 'failed' }
  }

  let replaced = false
  const stop = async (reason: RestoreRefusal): Promise<RestoreResult> => {
    await clean()
    if (!replaced) {
      await undo?.discard()
      return { ok: false, reason }
    }
    deps.discardQueue()
    return { ok: false, reason: 'partial' }
  }
  while (pending.length > 0) {
    let running: boolean
    try {
      running = await deps.isRunning()
    } catch {
      return stop('failed')
    }
    if (running) return stop('running')
    try {
      await renameWithRetry(pending[0].from, pending[0].to)
    } catch {
      return stop('failed')
    }
    if (!replaced)
      await undo
        ?.commit()
        .catch((err) => log.warn(`undo copy of ${copy.collectionPath} left staged: ${String(err)}`))
    replaced = true
    pending.shift()
  }
  deps.discardQueue()
  return { ok: true }
}
