import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { resolvePlayable } from './playback'

function deps(over: Record<string, unknown> = {}) {
  let n = 0
  return {
    mtime: vi.fn(async () => 1),
    transcode: vi.fn(async () => {}),
    tempPath: vi.fn(() => `/tmp/play-${n++}.wav`),
    ...over,
  }
}

describe('resolvePlayable', () => {
  it('streams a non-AIFF source untouched, since the player already decodes WAV/FLAC/MP3', async () => {
    const d = deps()
    expect(await resolvePlayable('/song.flac', d)).toBe('/song.flac')
    expect(await resolvePlayable('/song.wav', d)).toBe('/song.wav')
    expect(await resolvePlayable('/song.mp3', d)).toBe('/song.mp3')
    // no transcode for a format the <audio> element can already play
    expect(d.transcode).not.toHaveBeenCalled()
  })

  // Each test uses a distinct source path because the module-level cache (which
  // is the point — it lives across requests) would otherwise leak between tests.

  it('transcodes an AIFF source to a temp WAV and serves that, because Chromium has no AIFF decoder', async () => {
    const d = deps()
    const out = await resolvePlayable('/transcode.aiff', d)
    expect(out).toBe('/tmp/play-0.wav')
    expect(d.transcode).toHaveBeenCalledWith('/transcode.aiff', '/tmp/play-0.wav')
  })

  it('accepts the .aif alias case-insensitively', async () => {
    const d = deps()
    expect(await resolvePlayable('/alias.AIF', d)).toBe('/tmp/play-0.wav')
    expect(d.transcode).toHaveBeenCalledTimes(1)
  })

  it('transcodes once and reuses it across the many range requests one playback fires', async () => {
    // The <audio> element re-requests byte ranges to seek; without a cache each
    // request would spawn a fresh ffmpeg transcode of the whole file.
    const d = deps()
    const a = await resolvePlayable('/reuse.aiff', d)
    const b = await resolvePlayable('/reuse.aiff', d)
    expect(a).toBe(b)
    expect(d.transcode).toHaveBeenCalledTimes(1)
  })

  it('re-transcodes when the source changes, so an in-place tag edit is not served stale', async () => {
    const mtime = vi.fn(async () => 1)
    const d = deps({ mtime })
    await resolvePlayable('/edited.aiff', d)
    mtime.mockResolvedValue(2)
    await resolvePlayable('/edited.aiff', d)
    expect(d.transcode).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed transcode, so a transient ffmpeg error can be retried', async () => {
    const transcode = vi
      .fn()
      .mockRejectedValueOnce(new Error('ffmpeg died'))
      .mockResolvedValueOnce(undefined)
    const d = deps({ transcode })
    await expect(resolvePlayable('/retry.aiff', d)).rejects.toThrow('ffmpeg died')
    await expect(resolvePlayable('/retry.aiff', d)).resolves.toBe('/tmp/play-1.wav')
    expect(transcode).toHaveBeenCalledTimes(2)
  })
})
