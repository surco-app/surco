import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it } from 'vitest'
import { mpeg1Info } from './rekordboxTimeline'
import { TRAKTOR_ITUNES_MP3_LEAD_MS, traktorLeadOfFile } from './traktorTimeline'

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

describe('traktorLeadOfFile', () => {
  it('puts an iTunes MP3 27 ms later, as measured on ten of the DJ’s Traktor tracks', async () => {
    const file = await mp3('Appl')
    expect(mpeg1Info(readFileSync(file))?.encoder).toBe('Appl')
    expect(await traktorLeadOfFile(file)).toBe(TRAKTOR_ITUNES_MP3_LEAD_MS)
  })

  it('leaves uncompressed files on Surco’s own clock', async () => {
    expect(await traktorLeadOfFile('/m/a.wav')).toBe(0)
    expect(await traktorLeadOfFile('/m/a.flac')).toBe(0)
  })

  it('knows no lead for MP3s Traktor was never measured on, so their grid stays off', async () => {
    expect(await traktorLeadOfFile(await mp3('LAME'))).toBeNull()
    expect(await traktorLeadOfFile(await mp3(null))).toBeNull()
    expect(await traktorLeadOfFile('/m/a.m4a')).toBeNull()
  })
})
