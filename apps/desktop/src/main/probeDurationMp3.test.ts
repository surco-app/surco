import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => tmpdir() } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { probeDuration } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-duration-mp3-'))
const lame = join(dir, 'lame.mp3')
const bare = join(dir, 'bare.mp3')

beforeAll(() => {
  const sine = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8']
  execFileSync(FF, [...sine, '-c:a', 'libmp3lame', '-b:a', '320k', lame])
  execFileSync(FF, [...sine, '-c:a', 'libmp3lame', '-b:a', '320k', '-write_xing', '0', bare])
})

// The ffprobe Surco ships (4.4) counts the encoder's delay and padding as audio, about 50 ms
// on every LAME file. Two copies of one track are told apart from two edits by their lengths
// within 2 s, and a real pair (a FLAC of 347.99 s against its Apple Music MP3 of 349.99 s,
// 25/11) crossed that line by those 50 ms alone and showed as another version.
describe('probeDuration on an MP3', () => {
  it('gives the length of the audio, without the padding its encoder added', async () => {
    const seconds = (await probeDuration(lame)) as number
    expect(Math.abs(seconds - 8)).toBeLessThan(0.002)
  })

  it('falls back on the container length for an MP3 with no gapless header', async () => {
    const seconds = (await probeDuration(bare)) as number
    expect(Math.abs(seconds - 8)).toBeLessThan(0.1)
  })
})
