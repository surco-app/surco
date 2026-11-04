import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it } from 'vitest'
import { mp3Head, mpeg1Info, rekordboxShiftMs } from './rekordboxTimeline'
import { seratoLeadMs, seratoLeadOfFile } from './seratoClock'

const MPEG1_44K_STEREO = [0xff, 0xfb, 0x90, 0x44]

function infoFrame(encoder: string, delay = 576): Buffer {
  const frame = Buffer.alloc(417)
  Buffer.from(MPEG1_44K_STEREO).copy(frame, 0)
  frame.write('Info', 36, 'latin1')
  frame.writeUInt32BE(0, 40)
  frame.write(encoder, 44, 'latin1')
  frame[44 + 21] = delay >> 4
  frame[44 + 22] = (delay & 0x0f) << 4
  return frame
}

describe('seratoLeadMs', () => {
  it('puts Serato 51.18 ms after Surco on a LAME MP3, because Serato plays the Info frame and the encoder delay', () => {
    expect(seratoLeadMs('.mp3', infoFrame('LAME3.100'), 44100)).toBeCloseTo(51.18, 2)
  })

  it('counts the encoder delay ffmpeg writes into its own Info frame, as it does for LAME', () => {
    expect(seratoLeadMs('.mp3', infoFrame('Lavf58.76'), 44100)).toBeCloseTo(51.18, 2)
    expect(seratoLeadMs('.mp3', infoFrame('Lavc60.3.'), 44100)).toBeCloseTo(51.18, 2)
    expect(seratoLeadMs('.mp3', infoFrame('Lavc60.3.', 1105), 44100)).toBeCloseTo(
      ((1152 + 1105 + 529) / 44100) * 1000,
      3,
    )
  })

  it('skips only the Info frame of an MP3 another encoder wrote, one frame of 1152 samples', () => {
    expect(seratoLeadMs('.mp3', infoFrame('GOGO'), 44100)).toBeCloseTo((1152 / 44100) * 1000, 3)
  })

  it('agrees with Surco on an MP3 with no Xing or Info frame', () => {
    expect(seratoLeadMs('.mp3', Buffer.alloc(4096), 44100)).toBe(0)
  })

  it('puts Serato 1024 samples before Surco on an M4A, the opposite sign of the MP3 lead', () => {
    expect(seratoLeadMs('.m4a', Buffer.alloc(0), 44100)).toBeCloseTo(-23.22, 2)
  })

  it('scales the M4A lead by the sample rate', () => {
    expect(seratoLeadMs('.m4a', Buffer.alloc(0), 48000)).toBeCloseTo(-21.33, 2)
  })

  it('agrees with Surco on FLAC, WAV and AIFF', () => {
    for (const ext of ['.flac', '.wav', '.aiff', '.aif'])
      expect(seratoLeadMs(ext, Buffer.alloc(0), 44100)).toBe(0)
  })
})

describe('seratoLeadOfFile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surco-serato-clock-'))

  it('reads the head of an MP3 on disk', async () => {
    const file = join(dir, 'a.mp3')
    writeFileSync(file, infoFrame('LAME3.100'))
    expect(await seratoLeadOfFile(file, 44100)).toBeCloseTo(51.18, 2)
  })

  it('gives an MP3 the bundled ffmpeg encoded the same lead as a LAME one', async () => {
    const file = join(dir, 'ffmpeg.mp3')
    execFileSync(ffmpegStatic as unknown as string, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:a',
      'libmp3lame',
      file,
    ])
    const head = await mp3Head(file)
    expect(head && mpeg1Info(head)?.encoder).toBe('Lavc')
    expect(await seratoLeadOfFile(file, 44100)).toBeCloseTo(51.18, 2)
    expect(head && rekordboxShiftMs('.mp3', head, 44100)).toBeCloseTo((1152 / 44100) * 1000, 3)
  })

  it('is zero for a missing MP3 and fixed for an M4A without reading it', async () => {
    expect(await seratoLeadOfFile(join(dir, 'gone.mp3'), 44100)).toBe(0)
    expect(await seratoLeadOfFile(join(dir, 'gone.m4a'), 44100)).toBeCloseTo(-23.22, 2)
  })
})
