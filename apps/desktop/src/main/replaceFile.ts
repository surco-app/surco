import { chmod, rename, rm, stat, writeFile } from 'node:fs/promises'

// Written beside and renamed over, so rekordbox never finds a half-written file. The temp
// file is born with the default mode; given the original's before the rename, so the
// replacement does not quietly change permissions set on the user's file.
export async function replaceFile(path: string, data: string | Buffer): Promise<void> {
  const temp = `${path}.surco-tmp`
  try {
    const { mode } = await stat(path)
    await writeFile(temp, data)
    await chmod(temp, mode)
    await rename(temp, path)
  } catch (err) {
    // A half step left in rekordbox's folder would stay there for good.
    await rm(temp, { force: true })
    throw err
  }
}
