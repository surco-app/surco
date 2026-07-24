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

// A stable key for "would prepareProcessedCover produce the same file": the three
// mutually-exclusive source fields plus every knob coverFilter reads. Two jobs with
// equal keys are guaranteed byte-identical output, so they can safely share one prepare.
function memoKey(src: CoverSource, opts: CoverProcessOpts): string {
  return JSON.stringify([
    src.coverPath,
    src.coverUrl,
    src.coverFromFile,
    opts.maxSize,
    opts.square,
    opts.upscale,
  ])
}

// Shares one prepareProcessedCover per distinct (source, opts) across concurrent callers
// — a batch adding N tracks that all carry the same album art used to run the ffmpeg
// encode N times. Refcounted rather than copy-per-caller: every consumer only reads the
// processed file (ffmpeg -i, AppleScript "read POSIX file"), never writes it, so handing
// out the same path is safe, and refcounting lets every caller's own `finally { cleanup() }`
// stay untouched — the underlying file is only unlinked once the last caller that
// received it has cleaned up. A failed prepare is never memoized (mirrors cachedAnalysis's
// shouldCache): the entry is dropped immediately so the next caller retries instead of
// replaying the same rejection.
export interface CoverMemo {
  prepare: (src: CoverSource, opts: CoverProcessOpts) => Promise<PreparedCover | undefined>
}

export function createCoverMemo(
  prepare: (
    src: CoverSource,
    opts: CoverProcessOpts,
  ) => Promise<PreparedCover | undefined> = prepareProcessedCover,
): CoverMemo {
  const inFlight = new Map<string, { promise: Promise<PreparedCover | undefined>; refs: number }>()

  return {
    prepare: async (src, opts) => {
      const key = memoKey(src, opts)
      const existing = inFlight.get(key)
      if (existing) {
        existing.refs++
      } else {
        const promise = prepare(src, opts)
        inFlight.set(key, { promise, refs: 1 })
        // A rejection must not pin itself for callers that haven't awaited yet, nor
        // strand the entry for the next job with the same key — drop it immediately.
        promise.catch(() => inFlight.delete(key))
      }
      // Set unconditionally just above (either branch), so this read always hits.
      const entry = inFlight.get(key) as {
        promise: Promise<PreparedCover | undefined>
        refs: number
      }
      const result = await entry.promise
      // No art to prepare: nothing was ever cached, so free the slot for the next
      // (source, opts) — an undefined result carries no cleanup to share.
      if (!result) {
        inFlight.delete(key)
        return undefined
      }
      let cleaned = false
      return {
        path: result.path,
        cleanup: async () => {
          // Each caller's own finally calls this once; a defensive guard keeps a
          // caller that somehow cleans up twice from double-decrementing the refcount.
          if (cleaned) return
          cleaned = true
          entry.refs--
          if (entry.refs <= 0) {
            inFlight.delete(key)
            await result.cleanup()
          }
        },
      }
    },
  }
}
