import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { analyzeBitsUsage } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-bits-'))
const src16 = join(dir, 'src16.flac')
const padded24 = join(dir, 'padded24.flac')
const true24 = join(dir, 'true24.flac')
const lossy = join(dir, 'lossy.mp3')

beforeAll(() => {
  // A 16-bit source, the same audio padded into a 24-bit FLAC (zero low bits by
  // construction), genuinely 24-bit noise (a float source fills every bit), and
  // an MP3 (no bit depth at all).
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-c:a',
    'flac',
    '-sample_fmt',
    's16',
    src16,
  ])
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-i',
    src16,
    '-c:a',
    'flac',
    '-sample_fmt',
    's32',
    padded24,
  ])
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=3:a=0.3',
    '-c:a',
    'flac',
    '-sample_fmt',
    's32',
    true24,
  ])
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-c:a',
    'libmp3lame',
    lossy,
  ])
}, 60000)

describe('analyzeBitsUsage', () => {
  it('proves 16-bit audio padded into a 24-bit container: every low byte is zero', async () => {
    const res = await analyzeBitsUsage(padded24)
    expect(res?.usage).toBe('padded16')
    expect(res?.lowBytePct).toBe(0)
  }, 30000)

  it('confirms genuine 24-bit content: the low byte carries signal almost everywhere', async () => {
    const res = await analyzeBitsUsage(true24)
    expect(res?.usage).toBe('full')
    expect(res?.lowBytePct).toBeGreaterThan(50)
  }, 30000)

  it('makes no claim about files that declare 16 bits', async () => {
    expect(await analyzeBitsUsage(src16)).toBeNull()
  }, 30000)

  it('makes no claim about lossy files, which have no bit depth at all', async () => {
    expect(await analyzeBitsUsage(lossy)).toBeNull()
  }, 30000)
})
