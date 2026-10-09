import { shell } from 'electron'
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

// A volume with no Trash of its own (a NAS: macOS deletes outright there) sends the file
// to Surco's trash instead. If that fails too it throws: the OS call would be a hard delete.
export async function trashRecoverably(
  path: string,
  deps: RecoverableTrashDeps = defaultDeps,
): Promise<void> {
  if (!deps.keepsTrash(path)) {
    if (await deps.keep(path)) return
    throw new Error(`No recoverable trash for ${path}`)
  }
  return deps.trashItem(path)
}
