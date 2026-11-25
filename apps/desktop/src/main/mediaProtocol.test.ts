import type { ReadStream } from 'node:fs'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-media-protocol-userdata-'))
  return { app: { getPath: () => dir }, nativeImage: {} }
})

import { app } from 'electron'
import { mediaRecoveryUrl, mediaUrl } from '../shared/media'
import { type MediaProtocolDeps, serveMedia } from './mediaProtocol'
import { traktorCoverUrl } from './traktorCoverCache'

const work = mkdtempSync(join(tmpdir(), 'surco-media-protocol-'))
const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))
const track = join(work, 'track.mp3')
writeFileSync(track, bytes)

const fakeDeps = (allowed: string[]) => {
  const tracked: { path: string; stream: ReadStream }[] = []
  const deps = {
    isAllowed: (path: string) => allowed.includes(path),
    traktorReadPath: () => join(work, 'traktor', 'collection.nml'),
    resolvePlayable: vi.fn(async (path: string) => path),
    resolveRecovered: vi.fn(async (path: string) => path),
    trackMediaStream: (path: string, stream: ReadStream) => {
      tracked.push({ path, stream })
    },
  } satisfies MediaProtocolDeps
  return { deps, tracked }
}

const get = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers })

const body = async (res: Response) => Buffer.from(await res.arrayBuffer())

describe('serveMedia', () => {
  // surco:// streams any absolute path it is named. Without the allow-list an XSS'd renderer
  // could read ~/.ssh/id_rsa through an <audio> src; and the refusal has to come before
  // resolvePlayable, which would otherwise probe or transcode the stranger's file first.
  it('refuses a path the renderer was never handed, before probing it', async () => {
    const { deps } = fakeDeps([])

    const res = await serveMedia(get(mediaUrl(track)), deps)

    expect(res.status).toBe(403)
    expect(deps.resolvePlayable).not.toHaveBeenCalled()
    expect(deps.resolveRecovered).not.toHaveBeenCalled()
  })

  // The <audio> element only honours a seek when the answer is 206 with Content-Range, and
  // the bytes must be exactly that slice or playback resumes at the wrong spot.
  it('answers a Range request with 206 and exactly the requested slice', async () => {
    const { deps } = fakeDeps([track])

    const res = await serveMedia(get(mediaUrl(track), { range: 'bytes=100-299' }), deps)

    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 100-299/1000')
    expect(res.headers.get('Content-Length')).toBe('200')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(await body(res)).toEqual(bytes.subarray(100, 300))
  })

  it('serves the suffix range the element uses to seek near the end', async () => {
    const { deps } = fakeDeps([track])

    const res = await serveMedia(get(mediaUrl(track), { range: 'bytes=-10' }), deps)

    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 990-999/1000')
    expect(await body(res)).toEqual(bytes.subarray(990))
  })

  // Without Accept-Ranges on the first answer the element never tries to seek at all.
  it('serves the whole file with 200 and advertises ranges when none is asked', async () => {
    const { deps } = fakeDeps([track])

    const res = await serveMedia(get(mediaUrl(track)), deps)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe('1000')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Range')).toBeNull()
    expect(await body(res)).toEqual(bytes)
  })

  // An AIFF is swapped for a transcoded WAV. Announcing the AIFF's MIME or size for the WAV's
  // bytes makes the element refuse or cut the stream short.
  it('takes MIME and size from the file actually served, not the one asked for', async () => {
    const aiff = join(work, 'song.aiff')
    writeFileSync(aiff, Buffer.alloc(50))
    const wav = join(work, 'song-playable.wav')
    const wavBytes = Buffer.alloc(300, 7)
    writeFileSync(wav, wavBytes)
    const { deps } = fakeDeps([aiff])
    deps.resolvePlayable.mockResolvedValue(wav)

    const res = await serveMedia(get(mediaUrl(aiff)), deps)

    expect(deps.resolvePlayable).toHaveBeenCalledWith(aiff)
    expect(res.headers.get('Content-Type')).toBe('audio/wav')
    expect(res.headers.get('Content-Length')).toBe('300')
    expect(await body(res)).toEqual(wavBytes)
  })

  // The retry after the element rejected a damaged file must get the repaired transcode;
  // handing it the original bytes again would fail the same way.
  it('serves the repaired transcode for a recovery URL', async () => {
    const repaired = join(work, 'track-repaired.wav')
    writeFileSync(repaired, Buffer.alloc(40, 3))
    const { deps } = fakeDeps([track])
    deps.resolveRecovered.mockResolvedValue(repaired)

    const res = await serveMedia(get(mediaRecoveryUrl(track)), deps)

    expect(deps.resolveRecovered).toHaveBeenCalledWith(track)
    expect(deps.resolvePlayable).not.toHaveBeenCalled()
    expect(res.headers.get('Content-Type')).toBe('audio/wav')
    expect(await body(res)).toEqual(Buffer.alloc(40, 3))
  })

  // Saving over a track first closes every stream serving it (Windows refuses to rename an
  // open file), and it looks them up by the path the renderer plays, not the transcode's.
  it('registers each stream under the requested path', async () => {
    const wav = join(work, 'other-playable.wav')
    writeFileSync(wav, Buffer.alloc(20))
    const aiff = join(work, 'other.aiff')
    writeFileSync(aiff, Buffer.alloc(20))
    const { deps, tracked } = fakeDeps([aiff])
    deps.resolvePlayable.mockResolvedValue(wav)

    await body(await serveMedia(get(mediaUrl(aiff)), deps))
    await body(await serveMedia(get(mediaUrl(aiff), { range: 'bytes=0-4' }), deps))

    expect(tracked.map((t) => t.path)).toEqual([aiff, aiff])
    expect(tracked[0].stream.path).toBe(wav)
  })

  describe('Traktor covers', () => {
    const coverDir = join(work, 'traktor', 'Coverart', '012')
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('pixels'),
    ])

    beforeEach(() => {
      mkdirSync(coverDir, { recursive: true })
      writeFileSync(join(coverDir, 'ABCDEF000'), png)
    })

    // A Traktor row paints its cover from Traktor's own cache. The id comes from the user's
    // collection, so it is served without the media allow-list, only from that cache.
    it('serves the cached thumbnail as a PNG without consulting the allow-list', async () => {
      const { deps } = fakeDeps([])

      const res = await serveMedia(get(traktorCoverUrl('012/ABCDEF')), deps)

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/png')
      expect(await body(res)).toEqual(png)
    })

    it('answers 404 for an id the cache does not hold', async () => {
      const { deps } = fakeDeps([])

      const res = await serveMedia(get(traktorCoverUrl('012/MISSING')), deps)

      expect(res.status).toBe(404)
    })
  })

  describe('embedded cover thumbnails', () => {
    const id = `${'a'.repeat(40)}.jpg`
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02])

    // Thumbnails live in the app's own store, so they skip the allow-list and are served as
    // JPEG for the list to draw.
    it('serves a stored thumbnail as JPEG', async () => {
      const store = join(app.getPath('userData'), 'cover-thumbs')
      mkdirSync(store, { recursive: true })
      writeFileSync(join(store, id), jpeg)
      const { deps } = fakeDeps([])

      const res = await serveMedia(get(`surco://cover/${id}`), deps)

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/jpeg')
      expect(await body(res)).toEqual(jpeg)
    })

    // A pruned thumbnail must read as missing, not crash the handler; the next metadata read
    // stores it again.
    it('answers 404 when the thumbnail cannot be read', async () => {
      const { deps } = fakeDeps([])

      const res = await serveMedia(get(`surco://cover/${'b'.repeat(40)}.jpg`), deps)

      expect(res.status).toBe(404)
    })
  })
})
