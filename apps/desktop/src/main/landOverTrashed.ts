import { mkdtemp, rename, rmdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

// The original a rename lands on, when Copias had no room for its copy and the system Trash
// takes it instead. Trashed before the rename, a cancel or a rename that never landed left
// the track nowhere: so it waits beside its path, under its own name, and goes to the Trash
// only once the new file is there. Anything failing on the way puts both files back.
export async function landOverTrashed(
  original: string,
  tmp: string,
  output: string,
  land: () => Promise<void>,
  trash: (path: string) => Promise<void>,
): Promise<void> {
  const hold = await mkdtemp(join(dirname(original), '.surco-replaced-'))
  const aside = join(hold, basename(original))
  try {
    await rename(original, aside)
  } catch (e) {
    await rmdir(hold).catch(() => undefined)
    throw e
  }
  try {
    await land()
  } catch (e) {
    await rename(aside, original)
    await rmdir(hold).catch(() => undefined)
    throw e
  }
  try {
    await trash(aside)
  } catch (e) {
    await rename(output, tmp)
    await rename(aside, original)
    await rmdir(hold).catch(() => undefined)
    throw e
  }
  await rmdir(hold).catch(() => undefined)
}
