import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it } from 'vitest'
import {
  rekordboxLeadMs,
  rekordboxLeadOfFile,
  rekordboxShiftMs,
  rekordboxShiftOfFile,
} from './rekordboxTimeline'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-audition-lead-'))

const MPEG1_44K_STEREO = [0xff, 0xfb, 0x90, 0x44]
const MPEG1_48K_STEREO = [0xff, 0xfb, 0x94, 0x44]
const MPEG1_44K_MONO = [0xff, 0xfb, 0x90, 0xc4]
const MPEG2_22K_STEREO = [0xff, 0xf3, 0x90, 0x44]

function infoFrame(
  header: number[],
  sideInfo: number,
  encoder: string,
  tag = 'Info',
  delay = 576,
): Buffer {
  const frame = Buffer.alloc(417)
  Buffer.from(header).copy(frame, 0)
  frame.write(tag, 4 + sideInfo, 'latin1')
  frame.writeUInt32BE(0, 8 + sideInfo)
  frame.write(encoder, 12 + sideInfo, 'latin1')
  frame[12 + sideInfo + 21] = delay >> 4
  frame[12 + sideInfo + 22] = (delay & 0x0f) << 4
  return frame
}

function vbrFrame(header: number[], encoder: string): Buffer {
  const frame = Buffer.alloc(417)
  Buffer.from(header).copy(frame, 0)
  frame.write('Xing', 36, 'latin1')
  frame.writeUInt32BE(0x0f, 40)
  frame.write('LAME', 44, 'latin1')
  frame.write(encoder, 44 + 4 + 4 + 100 + 4, 'latin1')
  return frame
}

function id3(size: number): Buffer {
  const tag = Buffer.alloc(10 + size)
  tag.write('ID3', 0, 'latin1')
  tag[3] = 3
  tag[9] = size & 0x7f
  tag[8] = (size >> 7) & 0x7f
  tag[7] = (size >> 14) & 0x7f
  tag[6] = (size >> 21) & 0x7f
  return tag
}

function box(type: string, ...body: Buffer[]): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + body.reduce((n, b) => n + b.length, 0), 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, ...body])
}

interface TrackSpec {
  codec: string
  handler?: string
  timescale?: number
  edits?: number[]
  wideEdits?: boolean
  truncatedEdits?: boolean
}

function track(t: TrackSpec): Buffer {
  const mdhd = Buffer.alloc(24)
  mdhd.writeUInt32BE(t.timescale ?? 44100, 12)
  const hdlr = Buffer.alloc(25)
  hdlr.write(t.handler ?? 'soun', 8, 'latin1')
  const stsd = box('stsd', Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), box(t.codec, Buffer.alloc(28)))
  const media = box('mdia', box('mdhd', mdhd), box('hdlr', hdlr), box('minf', box('stbl', stsd)))
  if (t.truncatedEdits) return box('trak', media, box('edts', box('elst')))
  if (!t.edits) return box('trak', media)
  const entry = t.wideEdits ? 20 : 12
  const elst = Buffer.alloc(8 + t.edits.length * entry)
  elst[0] = t.wideEdits ? 1 : 0
  elst.writeUInt32BE(t.edits.length, 4)
  t.edits.forEach((mediaTime, i) => {
    const at = 8 + i * entry
    if (t.wideEdits) elst.writeBigInt64BE(BigInt(mediaTime), at + 8)
    else elst.writeInt32BE(mediaTime, at + 4)
  })
  return box('trak', box('edts', box('elst', elst)), media)
}

function itunSmpb(priming: number): Buffer {
  const smpb = ` 00000000 ${priming.toString(16).toUpperCase().padStart(8, '0')} 00000338 0000000000015888`
  return box(
    'udta',
    box(
      'meta',
      Buffer.alloc(4),
      box(
        'ilst',
        box(
          '----',
          box('mean', Buffer.alloc(4), Buffer.from('com.apple.iTunes')),
          box('name', Buffer.alloc(4), Buffer.from('iTunSMPB')),
          box('data', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from(smpb)),
        ),
      ),
    ),
  )
}

function moov(...children: Buffer[]): Buffer {
  return box('moov', ...children)
}

function appleM4a(codec: string, priming: number): Buffer {
  return moov(track({ codec }), itunSmpb(priming))
}

describe('rekordboxLeadMs', () => {
  it('puts rekordbox one frame ahead of the editor on a LAME MP3, because rekordbox plays the Info frame as silence and Chromium skips it', () => {
    expect(rekordboxLeadMs(infoFrame(MPEG1_44K_STEREO, 32, 'LAME3.100'))).toBeCloseTo(
      (1152 / 44100) * 1000,
      3,
    )
  })

  it('reads the encoder past the frame count, size, seek table and quality a VBR Xing header carries', () => {
    expect(rekordboxLeadMs(vbrFrame(MPEG1_44K_STEREO, 'LAME3.100'))).toBeCloseTo(26.122, 3)
    expect(rekordboxLeadMs(vbrFrame(MPEG1_44K_STEREO, 'Lavc58.43'))).toBe(0)
  })

  it('scales the frame by the sample rate, measured 24 ms on a 48 kHz LAME file', () => {
    expect(rekordboxLeadMs(infoFrame(MPEG1_48K_STEREO, 32, 'LAME3.99r'))).toBeCloseTo(24, 3)
  })

  it('finds the Info tag after the shorter side info of a mono frame', () => {
    expect(rekordboxLeadMs(infoFrame(MPEG1_44K_MONO, 17, 'LAME3.100'))).toBeCloseTo(26.122, 3)
  })

  it('looks past a leading ID3 tag, which nearly every library MP3 carries', () => {
    const head = Buffer.concat([id3(300), infoFrame(MPEG1_44K_STEREO, 32, 'LAME3.100')])
    expect(rekordboxLeadMs(head)).toBeCloseTo(26.122, 3)
  })

  it('leaves an ffmpeg-encoded MP3 alone, since rekordbox and the editor were measured in step on Lavc files', () => {
    expect(rekordboxLeadMs(infoFrame(MPEG1_44K_STEREO, 32, 'Lavc58.43'))).toBe(0)
  })

  it('leaves a headerless MP3 alone, where both play the first frame as audio', () => {
    const plain = Buffer.alloc(417)
    Buffer.from(MPEG1_44K_STEREO).copy(plain, 0)
    expect(rekordboxLeadMs(plain)).toBe(0)
  })

  it('does not guess for MPEG-2 files, which no measurement covered', () => {
    expect(rekordboxLeadMs(infoFrame(MPEG2_22K_STEREO, 17, 'LAME3.100'))).toBe(0)
  })

  it('reads anything that is not an MPEG stream as in step', () => {
    expect(rekordboxLeadMs(Buffer.from('RIFF....WAVEfmt '))).toBe(0)
  })
})

describe('rekordboxLeadOfFile', () => {
  it('reads the lead from the file on disk', async () => {
    const file = join(dir, 'lame.mp3')
    writeFileSync(file, Buffer.concat([id3(64), infoFrame(MPEG1_44K_STEREO, 32, 'LAME3.100')]))
    expect(await rekordboxLeadOfFile(file)).toBeCloseTo(26.122, 3)
  })

  it('gives a real ffmpeg MP3 no lead', async () => {
    const file = join(dir, 'ffmpeg.mp3')
    execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', file])
    expect(readFileSync(file).includes('Lavc')).toBe(true)
    expect(await rekordboxLeadOfFile(file)).toBe(0)
  })

  it('never shifts a track whose file cannot be read, so the editor keeps playing as before', async () => {
    expect(await rekordboxLeadOfFile(join(dir, 'gone.mp3'))).toBe(0)
  })

  it('only parses MP3 files, so a WAV that happens to contain sync bytes is never shifted', async () => {
    const file = join(dir, 'fake.wav')
    writeFileSync(file, infoFrame(MPEG1_44K_STEREO, 32, 'LAME3.100'))
    expect(await rekordboxLeadOfFile(file)).toBe(0)
  })
})

describe('rekordboxShiftMs', () => {
  const lame44 = infoFrame(MPEG1_44K_STEREO, 32, 'LAME3.100')

  it('puts rekordbox one frame plus the encoder delay and the decoder delay ahead of ffmpeg on a LAME MP3, measured at 51 ms across 132 of the collection', () => {
    expect(rekordboxShiftMs('.mp3', lame44, 44100)).toBeCloseTo(
      ((1152 + 576 + 529) / 44100) * 1000,
      3,
    )
  })

  it('takes the delay the encoder wrote, not a fixed one', () => {
    const late = infoFrame(MPEG1_44K_STEREO, 32, 'LAME3.100', 'Info', 1000)
    expect(rekordboxShiftMs('.mp3', late, 44100)).toBeCloseTo(
      ((1152 + 1000 + 529) / 44100) * 1000,
      3,
    )
  })

  it('scales by the frame rate of the stream, measured 47 ms on 48 kHz LAME files', () => {
    expect(
      rekordboxShiftMs('.mp3', infoFrame(MPEG1_48K_STEREO, 32, 'LAME3.100'), 48000),
    ).toBeCloseTo(((1152 + 576 + 529) / 48000) * 1000, 3)
  })

  it('puts rekordbox one frame ahead on an ffmpeg-encoded MP3, measured at 26 ms on Lavc files', () => {
    expect(
      rekordboxShiftMs('.mp3', infoFrame(MPEG1_44K_STEREO, 32, 'Lavc58.43'), 44100),
    ).toBeCloseTo((1152 / 44100) * 1000, 3)
  })

  it('keeps a headerless MP3 in step, measured within 4 ms', () => {
    const plain = Buffer.alloc(417)
    Buffer.from(MPEG1_44K_STEREO).copy(plain, 0)
    expect(rekordboxShiftMs('.mp3', plain, 44100)).toBe(0)
  })

  it('puts rekordbox the priming an Apple AAC declares ahead of ffmpeg, which ffmpeg trims and rekordbox plays, measured +48 ms in rekordbox 7 on 31/10', () => {
    expect(rekordboxShiftMs('.m4a', appleM4a('mp4a', 2112), 44100)).toBeCloseTo(
      (2112 / 44100) * 1000,
      3,
    )
    expect(rekordboxShiftMs('.m4a', appleM4a('mp4a', 1600), 44100)).toBeCloseTo(
      (1600 / 44100) * 1000,
      3,
    )
  })

  it('keeps ALAC in step with PCM, measured at the same millisecond as the AIFF in rekordbox 7 on 31/10', () => {
    expect(rekordboxShiftMs('.m4a', appleM4a('alac', 0), 44100)).toBe(0)
    expect(rekordboxShiftMs('.m4a', appleM4a('alac', 2112), 44100)).toBe(0)
  })

  it('reads no priming on an AAC whose moov declares none, since ffmpeg then trims nothing and rekordbox sits where ffmpeg does', () => {
    expect(rekordboxShiftMs('.m4a', moov(track({ codec: 'mp4a' })), 44100)).toBe(0)
  })

  it("falls back to Apple's 2112 samples only when the moov cannot be read, the AAC the collection held when measured", () => {
    expect(rekordboxShiftMs('.m4a', Buffer.alloc(0), 44100)).toBeCloseTo((2112 / 44100) * 1000, 3)
    expect(rekordboxShiftMs('.m4a', Buffer.alloc(0), 48000)).toBeCloseTo(44, 3)
    expect(rekordboxShiftMs('.m4a', Buffer.from('not an mp4 at all'), 44100)).toBeCloseTo(
      (2112 / 44100) * 1000,
      3,
    )
  })

  it('falls back instead of throwing on an edit list cut short at the end of the moov, so a malformed file never fails a conversion', () => {
    expect(
      rekordboxShiftMs('.m4a', moov(track({ codec: 'mp4a', truncatedEdits: true })), 44100),
    ).toBe(0)
  })

  it('reads the sound track, not a chapter or cover track the file lists first', () => {
    const file = moov(
      track({ codec: 'text', handler: 'text', edits: [5000] }),
      track({ codec: 'mp4a', edits: [1024] }),
    )
    expect(rekordboxShiftMs('.m4a', file, 44100)).toBeCloseTo((1024 / 44100) * 1000, 3)
  })

  it("counts the edit list in the track's own timescale, which need not be the sample rate", () => {
    const file = moov(track({ codec: 'mp4a', timescale: 88200, edits: [2048] }))
    expect(rekordboxShiftMs('.m4a', file, 44100)).toBeCloseTo((2048 / 88200) * 1000, 3)
  })

  it('keeps PCM formats in step, measured within 2 ms on WAV and AIFF', () => {
    expect(rekordboxShiftMs('.wav', lame44, 44100)).toBe(0)
    expect(rekordboxShiftMs('.aiff', Buffer.alloc(0), 44100)).toBe(0)
  })
})

describe('rekordboxShiftOfFile', () => {
  it('reads the shift of a real ffmpeg MP3 from disk', async () => {
    const file = join(dir, 'shift.mp3')
    execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', file])
    expect(await rekordboxShiftOfFile(file, 44100)).toBeCloseTo((1152 / 44100) * 1000, 3)
  })

  it("keeps an ALAC that Surco's ffmpeg writes in step with PCM", async () => {
    const file = join(dir, 'shift-alac.m4a')
    execFileSync(FF, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=duration=1',
      '-c:a',
      'alac',
      file,
    ])
    expect(await rekordboxShiftOfFile(file, 44100)).toBe(0)
  })

  it('reads the 1024 samples of priming an ffmpeg AAC declares in its edit list, measured +23 ms in rekordbox 7 on 31/10', async () => {
    for (const rate of [44100, 48000]) {
      const file = join(dir, `shift-aac-${rate}.m4a`)
      execFileSync(FF, [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `sine=duration=1:sample_rate=${rate}`,
        '-c:a',
        'aac',
        file,
      ])
      expect(await rekordboxShiftOfFile(file, rate)).toBeCloseTo((1024 / rate) * 1000, 3)
    }
  })

  it('reads no shift for a file it cannot open', async () => {
    expect(await rekordboxShiftOfFile(join(dir, 'gone.mp3'), 44100)).toBe(0)
  })

  it('reads the header behind an ID3 tag larger than a megabyte, as a big cover makes', async () => {
    const file = join(dir, 'covered.mp3')
    execFileSync(FF, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      file,
    ])
    writeFileSync(file, Buffer.concat([id3(3 << 20), readFileSync(file)]))
    expect(await rekordboxShiftOfFile(file, 44100)).toBeCloseTo((1152 / 44100) * 1000, 3)
  })
})
