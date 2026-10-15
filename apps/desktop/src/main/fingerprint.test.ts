import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { audioFingerprint } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-fp-'))
const wav16 = join(dir, 'a.wav')
const aiff24 = join(dir, 'a.aiff')
const louder = join(dir, 'b.wav')

beforeAll(() => {
  const sine = [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-ac',
    '2',
  ]
  execFileSync(FF, [...sine, '-af', 'volume=0.4', '-c:a', 'pcm_s16le', wav16])
  execFileSync(FF, ['-v', 'error', '-y', '-i', wav16, '-c:a', 'pcm_s24be', aiff24])
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-i',
    wav16,
    '-af',
    'volume=0.1dB',
    '-c:a',
    'pcm_s16le',
    louder,
  ])
})

describe('audioFingerprint', () => {
  // Netzwerk's AIF declared 24 bits with an empty low byte: the same samples as a 16-bit
  // WAV. The fingerprint must prove that, whatever the container says.
  it('matches a 16-bit file and its padded 24-bit copy', async () => {
    expect(await audioFingerprint(aiff24)).toBe(await audioFingerprint(wav16))
  })

  it('tells apart a copy only a tenth of a decibel louder', async () => {
    expect(await audioFingerprint(louder)).not.toBe(await audioFingerprint(wav16))
  })

  it('returns null for a file it cannot decode', async () => {
    expect(await audioFingerprint(join(dir, 'missing.wav'))).toBeNull()
  })
})
