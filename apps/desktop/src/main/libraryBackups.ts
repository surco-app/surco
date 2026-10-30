import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

let root: string | null = null

export function setLibraryBackupRoot(dir: string): void {
  root = dir
}

export function libraryBackupRoot(): string {
  if (!root) throw new Error('library backup folder not set')
  return root
}

// The copies Surco takes before writing a DJ library live in Surco's own folder, not next
// to the collection: a folder Windows protects, or one the DJ cannot write to, let Surco
// read collection.nml and then refuse every save because the copy beside it failed. One
// folder per collection, named after its parent for a DJ looking for it and keyed by the
// full path so two collection.nml (Traktor 3 and 4) never share, and restore, one copy.
export function collectionKey(collectionPath: string): string {
  return process.platform === 'win32' ? collectionPath.toLowerCase() : collectionPath
}

export function backupOf(collectionPath: string, kind: 'backup' | 'session'): string {
  const id = createHash('sha256').update(collectionKey(collectionPath)).digest('hex').slice(0, 8)
  return join(
    libraryBackupRoot(),
    `${basename(dirname(collectionPath))}-${id}`,
    `${basename(collectionPath)}.surco-${kind}`,
  )
}
