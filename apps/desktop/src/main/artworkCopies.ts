import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

// Where the cover fetched from a Music entry is kept (see appleMusicArtwork). It is served
// from there from then on, so a cover Surco puts on the entry forgets it.
export function artworkCopyPath(persistentId: string): string {
  return join(app.getPath('userData'), 'applemusic-artwork', `${persistentId}.jpg`)
}

export async function forgetArtworkCopy(persistentId: string): Promise<void> {
  await unlink(artworkCopyPath(persistentId)).catch(() => undefined)
}
