import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { pcmDigest } from './verifyPcm'

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
})

describe('pcmDigest', () => {
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
