import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { emptyMetadata } from '../shared/metadata'
import { convertAudio, deliveredDurationSec } from './ffmpeg'
import { checkFile, fileReaders } from './verifyFile'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-flac-length-'))
const kick = 'aevalsrc=0.9*sin(2*PI*55*t)*exp(-4*mod(t\\,0.5)):s=44100:d=8'

let n = 0
function flac(): string {
  const path = join(dir, `in-${n++}.flac`)
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', kick, '-ac', '2', path])
  return path
}

function withoutTotalSamples(path: string): string {
  const bytes = readFileSync(path)
  bytes[21] &= 0xf0
  bytes.fill(0, 22, 26)
  writeFileSync(path, bytes)
  return path
}

async function convertedToMp3(source: string, cutSec?: number) {
  const meta = { ...emptyMetadata(), title: 'T' }
  const out = join(dir, `out-${n++}.mp3`)
  const { written } = await convertAudio(source, out, 'mp3', meta)
  if (cutSec !== undefined)
    execFileSync(FF, ['-y', '-v', 'error', '-i', source, '-t', String(cutSec), out])
  return checkFile(
    {
      path: out,
      ext: written.plan.ext,
      codec: written.plan.codec,
      bitDepth: written.plan.bitDepth,
      samplesKept: written.samplesKept,
      sourcePcm: written.sourcePcm,
      sourceDurationSec: written.sourceDurationSec,
      trimmedSec: written.trimmedSec,
      tags: meta,
      cover: 'untouched',
      ...(cutSec === undefined && written.proven ? { proven: written.proven } : {}),
    },
    fileReaders,
  )
}

// A FLAC decodes in blocks of 4608 samples, and the decoder's clock ends where the last
// block STARTS: an 8 s FLAC measured 7.941 s, short by most of a block (up to 104 ms at
// 44.1 kHz, over the check's 50 ms). The MP3 made from it, in frames of 1152, measured
// 7.995 s, so an exact conversion read as longer than its source and was refused.
describe('the self-check against the length of a FLAC source', () => {
  it('measures every sample, through the last partial block', async () => {
    expect(await deliveredDurationSec(flac())).toBeCloseTo(8, 4)
  })

  it('measures a FLAC that does not declare its total samples by decoding it', async () => {
    expect(await deliveredDurationSec(withoutTotalSamples(flac()))).toBeCloseTo(8, 4)
  })

  it.each([
    ['an exact FLAC to MP3', () => flac()],
    ['an exact FLAC with no total samples to MP3', () => withoutTotalSamples(flac())],
  ])(
    '%s is ok',
    async (_, source) => {
      const check = await convertedToMp3(source())
      expect(check.state, JSON.stringify(check.detail)).toBe('ok')
    },
    30_000,
  )

  it('an MP3 that lost its last 120 ms is still fileTruncated', async () => {
    const check = await convertedToMp3(flac(), 7.88)
    expect(check.detail).toEqual({ key: 'fileTruncated' })
  }, 30_000)
})
