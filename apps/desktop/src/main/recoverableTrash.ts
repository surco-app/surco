import { unlink } from 'node:fs/promises'
import { shell } from 'electron'
import type { BackupPolicy } from '../shared/backupPolicy'
import { currentBackupPolicy, keepOriginal } from './originalKeeper'
import { volumeKeepsTrash } from './trashSupport'

export interface RecoverableTrashDeps {
  keepsTrash: (path: string) => boolean
  keep: (path: string) => Promise<unknown>
  trashItem: (path: string) => Promise<void>
  policy: () => BackupPolicy
  remove: (path: string) => Promise<void>
}

const defaultDeps: RecoverableTrashDeps = {
  keepsTrash: volumeKeepsTrash,
  keep: (path) => keepOriginal(path, 'deleted', undefined, { regardlessOfPolicy: true }),
  trashItem: (path) => shell.trashItem(path),
  policy: currentBackupPolicy,
  remove: unlink,
}

// A volume with no Trash of its own (a NAS: macOS deletes outright there) sends the file
// to Surco's trash instead, whatever the backup setting says. If that fails too it throws:
// the OS call would be a hard delete. Says which of the two took it.
export async function trashRecoverably(
  path: string,
  over: Partial<RecoverableTrashDeps> = {},
): Promise<'trash' | 'surco'> {
  const deps = { ...defaultDeps, ...over }
  if (!deps.keepsTrash(path)) {
    if (await deps.keep(path)) return 'surco'
    throw new Error(`No recoverable trash for ${path}`)
  }
  await deps.trashItem(path)
  return 'trash'
}

// A delete the user confirmed in the trash or clean-up dialog. Under "Never" on a disk
// with no Trash there is nowhere recoverable to send it, so it is deleted for good, and
// only when the dialog said so before the user confirmed.
export async function trashAsConfirmed(
  path: string,
  { permanentConfirmed }: { permanentConfirmed: boolean },
  over: Partial<RecoverableTrashDeps> = {},
): Promise<'trash' | 'surco' | 'deleted'> {
  const deps = { ...defaultDeps, ...over }
  if (!deps.keepsTrash(path) && deps.policy() === 'never') {
    if (!permanentConfirmed) throw new Error(`Permanent delete of ${path} was not confirmed`)
    await deps.remove(path)
    return 'deleted'
  }
  return trashRecoverably(path, over)
}
