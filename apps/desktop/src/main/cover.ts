import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadCover } from './discogs'
import { processCover } from './ffmpeg'
import { tmpName } from './tmp'

export interface CoverSource {
  coverPath?: string
  coverUrl?: string
}

export interface PreparedCover {
  path: string
  cleanup: () => Promise<void>
}

// Resolves a cover from any of its three origins — a file the user dropped, a
// Discogs http URL, or a data: URL carrying the input file's embedded art — to a
// local file, then runs it through processCover. Returns the processed path plus
// a cleanup() that removes whatever temp files this produced; the user's own
// dropped file is never touched, only material we wrote.
export async function prepareProcessedCover(
  src: CoverSource,
  opts: { maxSize: number; square: boolean },
): Promise<PreparedCover | undefined> {
  let coverPath = src.coverPath
  let tempCover: string | undefined
  if (!coverPath && src.coverUrl?.startsWith('http')) {
    tempCover = await downloadCover(src.coverUrl)
    coverPath = tempCover
  }
  if (!coverPath && src.coverUrl?.startsWith('data:')) {
    tempCover = join(tmpdir(), tmpName('embed', 'jpg'))
    await writeFile(
      tempCover,
      Buffer.from(src.coverUrl.slice(src.coverUrl.indexOf(',') + 1), 'base64'),
    )
    coverPath = tempCover
  }
  if (!coverPath) return undefined

  const processed = await processCover(coverPath, opts)
  return {
    path: processed,
    cleanup: async () => {
      if (tempCover) await unlink(tempCover).catch(() => {})
      await unlink(processed).catch(() => {})
    },
  }
}
