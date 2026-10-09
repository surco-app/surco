import { shell } from 'electron'
import type { BackupPolicy } from '../shared/backupPolicy'
import { keepOriginal } from './originalKeeper'
import { volumeKeepsTrash } from './trashSupport'

export interface RecoverableTrashDeps {
  keepsTrash: (path: string) => boolean
  keep: (path: string) => Promise<unknown>
  trashItem: (path: string) => Promise<void>
}

const defaultDeps: RecoverableTrashDeps = {
  keepsTrash: volumeKeepsTrash,
  keep: (path) => keepOriginal(path, 'deleted'),
  trashItem: (path) => shell.trashItem(path),
}

export interface TrashRequest {
  // The user named this file in a dialog and confirmed it; no removal the app decides on.
  userConfirmed?: boolean
  policy?: BackupPolicy
}

// A volume with no Trash of its own (a NAS: macOS deletes outright there) sends the file
// to Surco's trash instead. If that fails too it throws: the OS call would be a hard delete.
// The one exception is the user's own confirmed delete under "Nunca", which Settings warns
// is for good there. Says which of the two took it.
export async function trashRecoverably(
  path: string,
  { userConfirmed = false, policy }: TrashRequest = {},
  deps: RecoverableTrashDeps = defaultDeps,
): Promise<'trash' | 'surco'> {
  if (!deps.keepsTrash(path) && !(userConfirmed && policy === 'never')) {
    if (await deps.keep(path)) return 'surco'
    throw new Error(`No recoverable trash for ${path}`)
  }
  await deps.trashItem(path)
  return 'trash'
}
