import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

const spawned: { args: string[]; signal?: AbortSignal; timeout?: number }[] = []
let onSpawn: (() => void) | undefined
const digests = () => spawned.filter((o) => o.args.includes('md5'))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  const real = promisify(actual.execFile)
  const execFile = Object.assign(actual.execFile.bind(actual), {
    [promisify.custom]: (file: string, args: string[], opts: never) => {
      spawned.push({ ...(opts as object), args } as (typeof spawned)[number])
      if (args.includes('md5')) onSpawn?.()
      return real(file, args, opts)
    },
  })
  return { ...actual, execFile }
})

import { ANALYSIS_TIMEOUT_MS } from './ffmpeg'
import { pcmDigest, pcmTimeoutMs } from './verifyPcm'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-verifypcm-'))
const kick = 'aevalsrc=0.95*sin(2*PI*55*t)*exp(-4*mod(t\\,0.5)):s=44100:d=3'
const at = (name: string) => join(dir, name)

function ff(...args: string[]): void {
  execFileSync(FF, ['-y', '-v', 'error', ...args])
}

beforeAll(() => {
  ff('-f', 'lavfi', '-i', kick, '-ac', '2', '-c:a', 'pcm_s16be', at('kick16.aiff'))
  ff('-f', 'lavfi', '-i', kick, '-ac', '2', '-c:a', 'pcm_s24be', at('kick24.aiff'))
  ff('-i', at('kick16.aiff'), '-c:a', 'pcm_s16le', at('kick16.wav'))
  ff('-i', at('kick24.aiff'), '-c:a', 'pcm_s24le', at('kick24.wav'))
  ff('-i', at('kick24.aiff'), '-c:a', 'flac', at('kick.flac'))
  ff('-i', at('kick.flac'), '-c:a', 'alac', at('kick.m4a'))
  ff('-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '1200', '-c:a', 'pcm_u8', at('long.wav'))
  ff('-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '3600', '-b:a', '8k', at('hour.mp3'))
  ff(
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=96000:cl=stereo',
    '-t',
    '450',
    '-c:a',
    'pcm_s24le',
    at('big.wav'),
  )
}, 120_000)

describe('pcmDigest', () => {
  afterEach(() => {
    onSpawn = undefined
  })

  // The self-check proves a conversion kept every sample, so byte order and container
  // must not leak into the fingerprint.
  it('an AIFF and the WAV transcoded from it digest the same', async () => {
    expect((await pcmDigest(at('kick16.wav'))).md5).toBe((await pcmDigest(at('kick16.aiff'))).md5)
    expect((await pcmDigest(at('kick24.wav'))).md5).toBe((await pcmDigest(at('kick24.aiff'))).md5)
  })

  it('a FLAC and the ALAC made from it digest the same', async () => {
    expect((await pcmDigest(at('kick.m4a'))).md5).toBe((await pcmDigest(at('kick.flac'))).md5)
  })

  // A rewrite of tags or cover is not a change to the music and must never fail the check.
  it('the same audio with different tags and cover digests the same', async () => {
    ff('-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-frames:v', '1', at('cover.jpg'))
    ff(
      '-i',
      at('kick.flac'),
      '-i',
      at('cover.jpg'),
      '-map',
      '0:a',
      '-map',
      '1:v',
      '-c',
      'copy',
      '-disposition:v',
      'attached_pic',
      '-metadata',
      'title=Other',
      at('tagged.flac'),
    )
    expect((await pcmDigest(at('tagged.flac'))).md5).toBe((await pcmDigest(at('kick.flac'))).md5)
  })

  it('one changed sample changes the digest', async () => {
    const bytes = readFileSync(at('kick16.wav'))
    const data = bytes.indexOf('data') + 8
    bytes[data + 20000] ^= 0x01
    writeFileSync(at('flipped.wav'), bytes)
    expect((await pcmDigest(at('flipped.wav'))).md5).not.toBe(
      (await pcmDigest(at('kick16.wav'))).md5,
    )
  })

  // A 24 or 32 bit file differs from its twin only in the lowest bits; decoding to 16 bits
  // would hide exactly the corruption the check exists to catch.
  it('the lowest bit of one sample changes the digest at 24 and 32 bits', async () => {
    ff('-i', at('kick24.aiff'), '-c:a', 'pcm_s32le', at('kick32.wav'))
    for (const [name, stride] of [
      ['kick24.wav', 3],
      ['kick32.wav', 4],
    ] as const) {
      const bytes = readFileSync(at(name))
      const data = bytes.indexOf('data') + 8
      bytes[data + stride * 30000] ^= 0x01
      writeFileSync(at(`lsb-${name}`), bytes)
      expect((await pcmDigest(at(`lsb-${name}`))).md5).not.toBe((await pcmDigest(at(name))).md5)
    }
  })

  // A batch checks each track while the next one converts: a conversion's source digest
  // waiting behind the checks' would hold the whole batch back.
  it('a high priority digest runs before the low ones queued ahead of it', async () => {
    spawned.length = 0
    const low = [1, 2, 3, 4].map(() => pcmDigest(at('kick24.wav')))
    const high = pcmDigest(at('kick16.wav'), { priority: 'high' })
    await Promise.all([...low, high])
    const order = digests().map((o) => o.args.includes(at('kick16.wav')))
    expect(order.indexOf(true)).toBeLessThan(4)
  })

  // An aborted or timed out decode must reject, never hand back a digest of partial audio.
  it('rejects when the signal is already aborted', async () => {
    await expect(pcmDigest(at('kick16.wav'), { signal: AbortSignal.abort() })).rejects.toThrow()
  })

  // Half-read audio must never be vouched for: a kill mid-decode has to reject.
  it('rejects when the decode is aborted at the moment it spawns', async () => {
    const controller = new AbortController()
    onSpawn = () => controller.abort()
    await expect(pcmDigest(at('kick16.wav'), { signal: controller.signal })).rejects.toThrow()
  })

  it('rejects when the decode is aborted while its child is running', async () => {
    const controller = new AbortController()
    onSpawn = () => setTimeout(() => controller.abort(), 5)
    await expect(pcmDigest(at('long.wav'), { signal: controller.signal })).rejects.toThrow()
  })

  it('rejects on a file that is not there', async () => {
    await expect(pcmDigest(at('missing.wav'))).rejects.toThrow()
  })

  it('rejects when the decode outlives its timeout', async () => {
    await expect(pcmDigest(at('kick16.wav'), { timeoutMs: 1 })).rejects.toThrow()
  })

  it('forwards the signal of the caller to the decode', async () => {
    const controller = new AbortController()
    spawned.length = 0
    await pcmDigest(at('kick16.wav'), { signal: controller.signal })
    expect(digests().map((o) => o.signal)).toEqual([controller.signal])
  })

  it('a 48 kHz resample does not digest the same', async () => {
    ff('-i', at('kick16.wav'), '-ar', '48000', at('kick48.wav'))
    const resampled = await pcmDigest(at('kick48.wav'))
    expect(resampled.sampleRate).toBe(48000)
    expect(resampled.md5).not.toBe((await pcmDigest(at('kick16.wav'))).md5)
  })

  // A float file can carry samples past full scale; folding it to integers would clip two
  // different files to the same audio and the check would vouch for a lost headroom.
  it('float samples past full scale still tell two files apart', async () => {
    for (const [name, level] of [
      ['over15', 1.5],
      ['over20', 2],
    ] as const) {
      ff(
        '-f',
        'lavfi',
        '-i',
        `aevalsrc=${level}:s=44100:d=1`,
        '-c:a',
        'pcm_f32le',
        at(`${name}.wav`),
      )
    }
    expect((await pcmDigest(at('over15.wav'))).md5).not.toBe(
      (await pcmDigest(at('over20.wav'))).md5,
    )
  })

  it('reports the sample rate and channels it decoded', async () => {
    expect(await pcmDigest(at('kick16.wav'))).toMatchObject({ sampleRate: 44100, channels: 2 })
  })

  it('rejects on an undecodable file', async () => {
    writeFileSync(at('junk.wav'), Buffer.from('this is not audio at all'))
    await expect(pcmDigest(at('junk.wav'))).rejects.toThrow()
  })
})

describe('pcmTimeoutMs', () => {
  it('never drops below the analysis timeout', () => {
    expect(pcmTimeoutMs(0)).toBe(ANALYSIS_TIMEOUT_MS)
    expect(pcmTimeoutMs(10_000_000)).toBe(ANALYSIS_TIMEOUT_MS)
  })

  // A 4 GB WAV read from a slow share at 2 MB/s needs far more than two minutes.
  it('grows with the header duration when the size is small', () => {
    expect(pcmTimeoutMs(14_000_000, 3600)).toBe(360_000)
  })

  it('grows with the size of a long mix', () => {
    expect(pcmTimeoutMs(4_000_000_000)).toBe(2_000_000)
  })

  // A long compressed file is small for its length, so its header duration has to scale
  // the timeout where the size term would stay at the floor.
  it('scales a long MP3 by its header duration', async () => {
    const size = statSync(at('hour.mp3')).size
    expect(pcmTimeoutMs(size)).toBe(ANALYSIS_TIMEOUT_MS)
    spawned.length = 0
    await pcmDigest(at('hour.mp3'))
    const timeout = digests()[0]?.timeout ?? 0
    expect(timeout).toBeGreaterThanOrEqual(360_000)
    expect(timeout).toBeLessThan(362_000)
  })

  // Asking for the duration of a file without one decodes it a second time under the
  // very timeout that is too short, so the size alone must carry the scaling.
  it('scales by size and never decodes a second time to learn the duration', async () => {
    const size = statSync(at('big.wav')).size
    spawned.length = 0
    await pcmDigest(at('big.wav'))
    const bySize = Math.ceil((size / 2_000_000) * 1000)
    expect(digests().map((o) => o.timeout)).toEqual([bySize])
    expect(bySize).toBeGreaterThan(ANALYSIS_TIMEOUT_MS)
    expect(bySize).toBeGreaterThan(450 * 100)
    expect(spawned.filter((o) => o.args.includes('format=duration'))).toHaveLength(0)
    expect(digests()).toHaveLength(1)
  })
})
