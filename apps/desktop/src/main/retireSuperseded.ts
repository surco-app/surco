import { dirname } from 'node:path'
import type { BackupPolicy } from '../shared/backupPolicy'

export interface RetireDeps {
  usedByLibrary: (path: string) => Promise<boolean>
  exists: (path: string) => boolean
  keepsTrash: (path: string) => boolean
  policy: () => BackupPolicy
  trash: (path: string, permanentConfirmed: boolean) => Promise<unknown>
}

// The automatic retirement of a file a format change superseded. Asked of every DJ library
// right before the file goes: a check that came back ok only covers the places the job
// touched, and one that cannot be read may still use it. A file already gone counts as
// retired only while its folder is there: a NAS that dropped for a moment leaves the row to
// the manual offer.
export async function retireSuperseded(
  path: string,
  deps: RetireDeps,
): Promise<'retired' | 'used'> {
  const gone = () => deps.exists(dirname(path)) && !deps.exists(path)
  if (gone()) return 'retired'
  if (!deps.exists(path)) return 'used'
  if (await deps.usedByLibrary(path).catch(() => true)) return 'used'
  try {
    await deps.trash(path, !deps.keepsTrash(path) && deps.policy() === 'never')
  } catch (error) {
    if (!gone()) throw error
  }
  return 'retired'
}
