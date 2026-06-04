import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { transcodeAiffToWav } from './ffmpeg'
import { tmpName } from './tmp'

const AIFF = /\.aiff?$/i

export interface PlaybackDeps {
  mtime: (path: string) => Promise<number>
  transcode: (input: string, output: string) => Promise<void>
  tempPath: () => string
}

const defaultDeps: PlaybackDeps = {
  mtime: async (p) => (await stat(p)).mtimeMs,
  transcode: transcodeAiffToWav,
  tempPath: () => join(tmpdir(), tmpName('play', 'wav')),
}

// source path -> the transcode in flight or done for it, keyed by the source's
// mtime so an in-place edit invalidates the cached WAV.
const cache = new Map<string, { mtime: number; wav: Promise<string> }>()

// Returns the path the surco:// handler should actually stream. Chromium's
// <audio> element can decode WAV/FLAC/MP3 but not AIFF, so an AIFF served
// verbatim loads and then plays nothing (the decode fails and the renderer
// swallows the error). For AIFF we transcode once to a temp WAV and serve that;
// every other format already plays and streams untouched.
//
// One playback fires many requests (the initial load plus a range request per
// seek), so the transcode is cached per source and reused across them — without
// the cache every range request would spawn a fresh full-file transcode.
export async function resolvePlayable(
  filePath: string,
  deps: PlaybackDeps = defaultDeps,
): Promise<string> {
  if (!AIFF.test(filePath)) return filePath
  const mtime = await deps.mtime(filePath)
  const hit = cache.get(filePath)
  if (hit && hit.mtime === mtime) return hit.wav
  const wav = (async () => {
    const out = deps.tempPath()
    await deps.transcode(filePath, out)
    return out
  })()
  cache.set(filePath, { mtime, wav })
  // A failed transcode must not be cached, or a transient ffmpeg error would
  // wedge the file as unplayable for the rest of the session.
  wav.catch(() => {
    if (cache.get(filePath)?.wav === wav) cache.delete(filePath)
  })
  return wav
}
