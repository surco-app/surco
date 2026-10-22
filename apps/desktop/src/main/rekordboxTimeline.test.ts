import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it } from 'vitest'
import { rekordboxLeadMs, rekordboxLeadOfFile } from './rekordboxTimeline'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-audition-lead-'))

const MPEG1_44K_STEREO = [0xff, 0xfb, 0x90, 0x44]
const MPEG1_48K_STEREO = [0xff, 0xfb, 0x94, 0x44]
const MPEG1_44K_MONO = [0xff, 0xfb, 0x90, 0xc4]
const MPEG2_22K_STEREO = [0xff, 0xf3, 0x90, 0x44]

function infoFrame(header: number[], sideInfo: number, encoder: string, tag = 'Info'): Buffer {
  const frame = Buffer.alloc(417)
  Buffer.from(header).copy(frame, 0)
  frame.write(tag, 4 + sideInfo, 'latin1')
  frame.writeUInt32BE(0, 8 + sideInfo)
  frame.write(encoder, 12 + sideInfo, 'latin1')
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
  return tag
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
