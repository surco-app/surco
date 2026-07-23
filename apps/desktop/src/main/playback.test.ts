import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { cleanupPlaybackTemps, resolvePlayable, resolveRecovered } from './playback'

function deps(over: Record<string, unknown> = {}) {
  let n = 0
  return {
    mtime: vi.fn(async () => 1),
    transcode: vi.fn(async () => {}),
    stripPicture: vi.fn(async () => {}),
    hasUnreadablePicture: vi.fn(async () => false),
    tempPath: vi.fn((ext: string) => `/tmp/play-${n++}.${ext}`),
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

  it('serves a FLAC with a malformed embedded picture as an art-stripped temp copy, since Chromium refuses to open the original', async () => {
    const d = deps({ hasUnreadablePicture: vi.fn(async () => true) })
    const out = await resolvePlayable('/badpic.flac', d)
    expect(out).toBe('/tmp/play-0.flac')
    expect(d.stripPicture).toHaveBeenCalledWith('/badpic.flac', '/tmp/play-0.flac')
  })

  it('streams a FLAC whose embedded art is fine untouched, so the common case spawns no ffmpeg', async () => {
    const d = deps()
    expect(await resolvePlayable('/goodpic.flac', d)).toBe('/goodpic.flac')
    expect(d.stripPicture).not.toHaveBeenCalled()
  })

  it('strips once and reuses it across the range requests one playback fires, re-probing the art at most once', async () => {
    const d = deps({ hasUnreadablePicture: vi.fn(async () => true) })
    const a = await resolvePlayable('/reuse-pic.flac', d)
    const b = await resolvePlayable('/reuse-pic.flac', d)
    expect(a).toBe(b)
    expect(d.stripPicture).toHaveBeenCalledTimes(1)
    expect(d.hasUnreadablePicture).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed strip, so a transient ffmpeg error can be retried', async () => {
    const stripPicture = vi
      .fn()
      .mockRejectedValueOnce(new Error('ffmpeg died'))
      .mockResolvedValueOnce(undefined)
    const d = deps({ hasUnreadablePicture: vi.fn(async () => true), stripPicture })
    await expect(resolvePlayable('/retry-pic.flac', d)).rejects.toThrow('ffmpeg died')
    await expect(resolvePlayable('/retry-pic.flac', d)).resolves.toBe('/tmp/play-1.flac')
    expect(stripPicture).toHaveBeenCalledTimes(2)
  })
})

describe('resolveRecovered', () => {
  // A shared rip with mid-stream corruption plays everywhere except the <audio>
  // element: Chromium's demuxer aborts on the first frame it can't timestamp,
  // while ffmpeg decodes past the damage. The recovery path re-encodes the whole
  // file to a WAV the element can take, traded for the retry click only.
  it('re-encodes the damaged source to a temp WAV the element can decode', async () => {
    const d = deps()
    const out = await resolveRecovered('/damaged.flac', d)
    expect(out).toBe('/tmp/play-0.wav')
    expect(d.transcode).toHaveBeenCalledWith('/damaged.flac', '/tmp/play-0.wav')
  })

  it('re-encodes once and reuses it across the range requests one playback fires', async () => {
    const d = deps()
    const a = await resolveRecovered('/reuse-recover.flac', d)
    const b = await resolveRecovered('/reuse-recover.flac', d)
    expect(a).toBe(b)
    expect(d.transcode).toHaveBeenCalledTimes(1)
  })

  it('keeps its cache apart from the plain resolve, which must keep serving the original', async () => {
    const d = deps()
    expect(await resolvePlayable('/mixed.flac', d)).toBe('/mixed.flac')
    expect(await resolveRecovered('/mixed.flac', d)).toBe('/tmp/play-0.wav')
    expect(await resolvePlayable('/mixed.flac', d)).toBe('/mixed.flac')
  })

  it('does not cache a failed re-encode, so a transient ffmpeg error can be retried', async () => {
    const transcode = vi
      .fn()
      .mockRejectedValueOnce(new Error('ffmpeg died'))
      .mockResolvedValueOnce(undefined)
    const d = deps({ transcode })
    await expect(resolveRecovered('/retry-recover.flac', d)).rejects.toThrow('ffmpeg died')
    await expect(resolveRecovered('/retry-recover.flac', d)).resolves.toBe('/tmp/play-1.wav')
    expect(transcode).toHaveBeenCalledTimes(2)
  })
})

describe('cleanupPlaybackTemps', () => {
  // The temp transcodes must outlive each playback (the cache re-serves them across
  // range requests and replays), so nothing deletes them mid-session; without this
  // quit-time sweep every previewed AIFF would leave a multi-MB WAV in the tmpdir.
  it('removes every temp the session created and only those', async () => {
    cleanupPlaybackTemps(vi.fn()) // drain temps recorded by the tests above
    const d = deps({ hasUnreadablePicture: vi.fn(async () => true) })
    await resolvePlayable('/sweep.aiff', d)
    await resolvePlayable('/sweep.flac', d)
    await resolvePlayable('/sweep.mp3', d)
    const remove = vi.fn()
    cleanupPlaybackTemps(remove)
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/tmp/play-0.wav',
      '/tmp/play-1.flac',
    ])
  })

  it('forgets what it removed, so a second sweep deletes nothing', async () => {
    cleanupPlaybackTemps(vi.fn())
    const d = deps()
    await resolvePlayable('/sweep-twice.aiff', d)
    cleanupPlaybackTemps(vi.fn())
    const again = vi.fn()
    cleanupPlaybackTemps(again)
    expect(again).not.toHaveBeenCalled()
  })

  // ffmpeg -y creates the output before it finishes, so a failed transcode can leave
  // a partial file behind — it must be swept like a successful one.
  it('sweeps the partial output of a failed transcode too', async () => {
    cleanupPlaybackTemps(vi.fn())
    const d = deps({ transcode: vi.fn().mockRejectedValue(new Error('ffmpeg died')) })
    await expect(resolvePlayable('/sweep-fail.aiff', d)).rejects.toThrow('ffmpeg died')
    const remove = vi.fn()
    cleanupPlaybackTemps(remove)
    expect(remove).toHaveBeenCalledWith('/tmp/play-0.wav')
  })
})
