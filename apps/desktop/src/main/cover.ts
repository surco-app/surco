import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadCover } from './coverDownload'
import { type CoverProcessOpts, extractCoverFile, processCover } from './ffmpeg'
import { tmpName } from './tmp'

export interface CoverSource {
  coverPath?: string
  coverUrl?: string
  // Path of an audio file whose own embedded art should be used. The renderer only
  // keeps a display thumbnail of embedded art, so write paths name the source file
  // and main pulls the full-resolution picture fresh.
  coverFromFile?: string
}

export interface PreparedCover {
  path: string
  cleanup: () => Promise<void>
}

// For the IPC handlers that gate preparation (and its progress stage) on whether a
// job names any art at all. Lives here so the check can never drift from the
// origins prepareProcessedCover actually resolves — when a handler hand-rolled it,
// coverFromFile jobs converted with no artwork.
export function hasCoverSource(src: CoverSource): boolean {
  return Boolean(src.coverPath || src.coverUrl || src.coverFromFile)
}

// Resolves a cover from any of its three origins — a file the user dropped, a
// Discogs http URL, or a data: URL carrying the input file's embedded art — to a
// local file, then runs it through processCover. Returns the processed path plus
// a cleanup() that removes whatever temp files this produced; the user's own
// dropped file is never touched, only material we wrote.
export async function prepareProcessedCover(
  src: CoverSource,
  opts: CoverProcessOpts,
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
  if (!coverPath && src.coverFromFile) {
    tempCover = (await extractCoverFile(src.coverFromFile)) ?? undefined
    coverPath = tempCover
  }
  if (!coverPath) return undefined

  let processed: string
  try {
    processed = await processCover(coverPath, opts)
  } catch (e) {
    // cleanup() only ships on success, so a failed pass would otherwise strand the
    // temp we downloaded/extracted (the user's own dropped file is never touched).
    if (tempCover) await unlink(tempCover).catch(() => {})
    throw e
  }
  return {
    path: processed,
    cleanup: async () => {
      if (tempCover) await unlink(tempCover).catch(() => {})
      await unlink(processed).catch(() => {})
    },
  }
}
