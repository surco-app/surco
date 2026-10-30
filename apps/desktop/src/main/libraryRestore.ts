import { existsSync, statSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import log from 'electron-log/main'
import type { LibraryCopy, RestoreRefusal, RestoreResult } from '../shared/types'
import { collectionKey } from './libraryBackups'
import {
  copyFolder,
  listCopies,
  restoreSlot,
  type StagedRestoreCopy,
  stageRestoreCopy,
} from './libraryHistory'
import { removeTemp, renameWithRetry } from './renameRetry'

export type { RestoreRefusal, RestoreResult }

export interface RestoreDeps {
  ensureClosed: () => Promise<boolean>
  isRunning: () => Promise<boolean>
  pendingLog: (collectionPath: string) => boolean
  discardQueue: () => void
  busy: () => boolean
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
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
  if (collectionKey(copy.collectionPath) !== collectionKey(req.collectionPath))
    return { ok: false, reason: 'other-collection' }
  try {
    if (!(await deps.ensureClosed())) return { ok: false, reason: 'running' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
  return deps.exclusive(() => replaceFiles(copy, req.collectionPath, deps))
}

async function putBack(undo: StagedRestoreCopy, target: string): Promise<boolean> {
  const temp = `${target}${TEMP}`
  try {
    const file = undo.copy.files.find((f) => f.target === target)
    if (file) {
      await copyFile(join(undo.folder, file.name), temp)
      await renameWithRetry(temp, target)
      return true
    }
    if (!undo.copy.absent?.includes(target)) return false
    await rm(target, { force: true })
    return true
  } catch (err) {
    log.error(`${target} could not be put back after its undo copy failed: ${String(err)}`)
    await removeTemp(temp)
    return false
  }
}

async function replaceFiles(
  copy: LibraryCopy,
  collectionPath: string,
  deps: RestoreDeps,
): Promise<RestoreResult> {
  if (deps.busy()) return { ok: false, reason: 'busy' }
  try {
    if (deps.pendingLog(collectionPath)) return { ok: false, reason: 'pending-log' }
  } catch {
    return { ok: false, reason: 'failed' }
  }

  const folder = copyFolder(copy)
  const moves = copy.files.map((file) => ({ from: `${file.target}${TEMP}`, to: file.target }))
  const pending: { from?: string; to: string }[] = [
    ...moves,
    ...(copy.absent ?? []).map((to) => ({ to })),
  ]
  const clean = () => Promise.all(moves.map((file) => removeTemp(file.from)))
  let undo: StagedRestoreCopy | null = null
  try {
    for (const [i, file] of copy.files.entries()) {
      await copyFile(join(folder, file.name), moves[i].from)
    }
    const companions = pending.map((step) => step.to).filter((t) => t !== copy.collectionPath)
    if (pending.some((step) => existsSync(step.to))) {
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
    const step = pending[0]
    let running: boolean
    try {
      running = await deps.isRunning()
    } catch {
      return stop('failed')
    }
    if (running) return stop('running')
    try {
      if (step.from) await renameWithRetry(step.from, step.to)
      else await rm(step.to, { force: true })
    } catch {
      return stop('failed')
    }
    if (!replaced && undo) {
      try {
        await undo.commit()
      } catch (err) {
        log.warn(`undo copy of ${copy.collectionPath} could not be kept: ${String(err)}`)
        if (await putBack(undo, step.to)) {
          await clean()
          await undo.discard().catch(() => undefined)
          return { ok: false, reason: 'failed' }
        }
        replaced = true
        return stop('failed')
      }
    }
    replaced = true
    pending.shift()
  }
  deps.discardQueue()
  return { ok: true }
}
