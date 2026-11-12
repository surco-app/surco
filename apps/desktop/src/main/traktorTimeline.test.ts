import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it } from 'vitest'
import { automaticCueOffsetMs, mp3TimingOfFile } from './cueCalibration'
import { mpeg1Info } from './rekordboxTimeline'
import { traktorLeadOfFile } from './traktorTimeline'

async function mp3(encoder: 'Appl' | 'LAME' | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-tklead-'))
  const file = join(dir, 'a.mp3')
  execFileSync(ffmpegStatic as unknown as string, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    file,
  ])
  const bytes = readFileSync(file)
  const at = bytes.indexOf('Lavc')
  if (encoder === null) bytes.write('Xxxx', bytes.indexOf('Info'), 'latin1')
  else {
    bytes.write(encoder, at, 'latin1')
    if (encoder === 'Appl') {
      bytes[at + 21] = 0
      bytes[at + 22] = 0
    }
  }
  writeFileSync(file, bytes)
  return file
}

const samplesMs = (samples: number) => (samples / 44100) * 1000

describe('traktorLeadOfFile', () => {
  it('draws a LAME MP3 51.18 ms later, the Xing frame plus encoder delay Traktor plays and ffmpeg skips, as measured on 31/10', async () => {
    expect(await traktorLeadOfFile(await mp3('LAME'))).toBeCloseTo(samplesMs(1152 + 576 + 529), 6)
    expect(await traktorLeadOfFile(await mp3('LAME'))).toBeCloseTo(51.18, 2)
  })

  it('draws an MP3 with no Xing frame on Surco’s clock, since ffmpeg then decodes the delay Traktor plays', async () => {
    expect(await traktorLeadOfFile(await mp3(null))).toBe(0)
  })

  it('draws an iTunes MP3 one silent frame later, the ≈27 ms measured on the DJ’s tracks on 03/11', async () => {
    const file = await mp3('Appl')
    expect(mpeg1Info(readFileSync(file))?.encoder).toBe('Appl')
    expect(await traktorLeadOfFile(file)).toBeCloseTo(samplesMs(1152), 6)
    expect(Math.abs(((await traktorLeadOfFile(file)) as number) - 27)).toBeLessThan(1)
  })

  it('leaves uncompressed files on Surco’s own clock', async () => {
    expect(await traktorLeadOfFile('/m/a.wav')).toBe(0)
    expect(await traktorLeadOfFile('/m/a.flac')).toBe(0)
  })

  it('knows no lead for an MP3 whose timing cannot be read, nor for formats Traktor was never measured on, so their grid stays off', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-tklead-'))
    const junk = join(dir, 'junk.mp3')
    writeFileSync(junk, Buffer.alloc(4096, 0x20))
    expect(await traktorLeadOfFile(junk)).toBeNull()
    expect(await traktorLeadOfFile(join(dir, 'missing.mp3'))).toBeNull()
    expect(await traktorLeadOfFile('/m/a.m4a')).toBeNull()
  })

  it('agrees with the conversion, which carries a cue out of the same MP3 into PCM by minus this lead', async () => {
    for (const file of [await mp3('LAME'), await mp3(null), await mp3('Appl')]) {
      const lead = (await traktorLeadOfFile(file)) as number
      expect(automaticCueOffsetMs(await mp3TimingOfFile(file), null)).toBeCloseTo(-lead, 9)
    }
  })

  it('puts a cue placed at 10000 ms on Surco’s wave of a LAME MP3 at 10051.18 ms in Traktor, and back on 10000 once converted to WAV', async () => {
    const file = await mp3('LAME')
    const lead = (await traktorLeadOfFile(file)) as number
    const stored = 10000 + lead
    expect(stored).toBeCloseTo(10051.18, 2)
    expect(stored + automaticCueOffsetMs(await mp3TimingOfFile(file), null)).toBeCloseTo(10000, 6)
  })
})
