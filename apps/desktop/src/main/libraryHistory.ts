import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { CopyReason, LibraryCopy } from '../shared/types'
import { backupOf } from './libraryBackups'
import { renameWithRetry } from './renameRetry'
import { writeBackup } from './rekordboxSessionBackup'

export const HISTORY_KEEP = 5

const PARTIAL = '.partial'
const MANIFEST = 'copy.json'
const ASIDE = '.aside'
const STAGED = '.staged'

function historyRoot(collectionPath: string): string {
  return join(dirname(backupOf(collectionPath, 'backup')), 'history')
}

function restoreRoot(collectionPath: string): string {
  return join(dirname(backupOf(collectionPath, 'backup')), 'history-restore')
}

export function copyFolder(copy: LibraryCopy): string {
  return copy.reason === 'restore'
    ? restoreRoot(copy.collectionPath)
    : join(historyRoot(copy.collectionPath), copy.id)
}

async function readCopy(folder: string): Promise<LibraryCopy | null> {
  try {
    return JSON.parse(await readFile(join(folder, MANIFEST), 'utf8')) as LibraryCopy
  } catch {
    return null
  }
}

export async function listCopies(collectionPath: string): Promise<LibraryCopy[]> {
  const root = historyRoot(collectionPath)
  const names = await readdir(root).catch(() => [] as string[])
  const copies: LibraryCopy[] = []
  for (const name of names) {
    if (name.endsWith(PARTIAL) || name.endsWith(ASIDE)) continue
    const copy = await readCopy(join(root, name))
    if (copy) copies.push(copy)
  }
  return copies.sort((a, b) => b.takenAt - a.takenAt)
}

export async function restoreSlot(collectionPath: string): Promise<LibraryCopy | null> {
  return readCopy(restoreRoot(collectionPath))
}

function describeCopy(
  collectionPath: string,
  companions: string[],
  reason: CopyReason,
  now: number,
): LibraryCopy {
  return {
    id: String(now),
    collectionPath,
    takenAt: now,
    reason,
    files: [collectionPath, ...companions.filter((path) => existsSync(path))].map((target) => ({
      name: basename(target),
      target,
    })),
  }
}

async function writeCopy(copy: LibraryCopy, folder: string): Promise<void> {
  const partial = `${folder}${PARTIAL}`
  await rm(partial, { recursive: true, force: true })
  try {
    await mkdir(partial, { recursive: true })
    for (const file of copy.files) await writeBackup(file.target, join(partial, file.name))
    await writeFile(join(partial, MANIFEST), JSON.stringify(copy))
    await swapIn(partial, folder)
  } catch (err) {
    await rm(partial, { recursive: true, force: true })
    throw err
  }
}

async function swapIn(from: string, folder: string): Promise<void> {
  const aside = `${folder}${ASIDE}`
  await rm(aside, { recursive: true, force: true })
  const had = existsSync(folder)
  if (had) await renameWithRetry(folder, aside)
  try {
    await renameWithRetry(from, folder)
  } catch (err) {
    if (had) await renameWithRetry(aside, folder)
    throw err
  }
  await rm(aside, { recursive: true, force: true })
}

export async function takeCopy(
  collectionPath: string,
  companions: string[],
  reason: CopyReason,
  now: number = Date.now(),
): Promise<LibraryCopy> {
  const copy = describeCopy(collectionPath, companions, reason, now)
  await writeCopy(copy, copyFolder(copy))
  if (reason !== 'restore') await prune(collectionPath)
  return copy
}

export async function stageRestoreCopy(
  collectionPath: string,
  companions: string[],
  now: number = Date.now(),
): Promise<{ commit: () => Promise<void>; discard: () => Promise<void> }> {
  const copy = describeCopy(collectionPath, companions, 'restore', now)
  const staged = `${restoreRoot(collectionPath)}${STAGED}`
  await writeCopy(copy, staged)
  return {
    commit: () => swapIn(staged, copyFolder(copy)),
    discard: () => rm(staged, { recursive: true, force: true }),
  }
}

async function prune(collectionPath: string): Promise<void> {
  const stale = (await listCopies(collectionPath)).slice(HISTORY_KEEP)
  for (const copy of stale) await rm(copyFolder(copy), { recursive: true, force: true })
}
