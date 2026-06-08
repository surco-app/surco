import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripFlacPicture, transcodeAiffToWav } from './ffmpeg'
import { flacHasUnreadablePicture } from './flac'
import { tmpName } from './tmp'

const AIFF = /\.aiff?$/i
const FLAC = /\.flac$/i

export interface PlaybackDeps {
  mtime: (path: string) => Promise<number>
  transcode: (input: string, output: string) => Promise<void>
  stripPicture: (input: string, output: string) => Promise<void>
  hasUnreadablePicture: (input: string) => Promise<boolean>
  tempPath: (ext: string) => string
}

const defaultDeps: PlaybackDeps = {
  mtime: async (p) => (await stat(p)).mtimeMs,
  transcode: transcodeAiffToWav,
  stripPicture: stripFlacPicture,
  hasUnreadablePicture: flacHasUnreadablePicture,
  tempPath: (ext) => join(tmpdir(), tmpName('play', ext)),
}

// source path -> the resolved playback path in flight or done for it, keyed by
// the source's mtime so an in-place edit invalidates the cached result.
const cache = new Map<string, { mtime: number; out: Promise<string> }>()

// One playback fires many requests (the initial load plus a range request per
// seek), so whatever resolve() decides — a transcode, a re-mux, or the original
// path — is cached per source and reused across them. Without the cache every
// range request would re-probe and re-spawn ffmpeg.
async function cached(
  filePath: string,
  deps: PlaybackDeps,
  resolve: () => Promise<string>,
): Promise<string> {
  const mtime = await deps.mtime(filePath)
  const hit = cache.get(filePath)
  if (hit && hit.mtime === mtime) return hit.out
  const out = resolve()
  cache.set(filePath, { mtime, out })
  // A failed transcode/re-mux must not be cached, or a transient ffmpeg error
  // would wedge the file as unplayable for the rest of the session.
  out.catch(() => {
    if (cache.get(filePath)?.out === out) cache.delete(filePath)
  })
  return out
}

// Returns the path the surco:// handler should actually stream. Chromium's
// <audio> element can decode WAV/FLAC/MP3 but not AIFF, so an AIFF served
// verbatim loads and then plays nothing; we transcode it once to a temp WAV.
// A FLAC can also fail to play despite being a supported format: if it carries a
// malformed embedded picture (an empty-MIME PICTURE block, see flac.ts) the
// demuxer refuses to open the whole file, so we serve an art-stripped re-mux.
// Everything else streams untouched.
export async function resolvePlayable(
  filePath: string,
  deps: PlaybackDeps = defaultDeps,
): Promise<string> {
  if (AIFF.test(filePath)) {
    return cached(filePath, deps, async () => {
      const out = deps.tempPath('wav')
      await deps.transcode(filePath, out)
      return out
    })
  }
  if (FLAC.test(filePath)) {
    return cached(filePath, deps, async () => {
      if (!(await deps.hasUnreadablePicture(filePath))) return filePath
      const out = deps.tempPath('flac')
      await deps.stripPicture(filePath, out)
      return out
    })
  }
  return filePath
}
