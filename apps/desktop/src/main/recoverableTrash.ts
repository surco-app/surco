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
  keep: (path) => keepOriginal(path, 'deleted', undefined, { regardlessOfPolicy: true }),
  trashItem: (path) => shell.trashItem(path),
}

// A volume with no Trash of its own (a NAS: macOS deletes outright there) sends the file
// to Surco's trash instead. If that fails too it throws: the OS call would be a hard delete.
// Says which of the two took it.
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
