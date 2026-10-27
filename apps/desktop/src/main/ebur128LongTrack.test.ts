import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it } from 'vitest'
import { ebur128MeasureArgs, parseEbur128Measured } from './normalize'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-ebur128-long-'))
const short = join(dir, 'short.flac')
const long = join(dir, 'long.flac')

function tone(path: string, seconds: number): void {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=f=440:d=${seconds}`,
    '-ac',
    '2',
    path,
  ])
}

beforeAll(() => {
  tone(short, 10)
  tone(long, 60)
})

// The measurement is read from stderr through a 16 MB buffer. ebur128 logs a line per
// 100 ms frame by default, 104 KB per minute measured, so a mix past ~160 minutes
// overflowed the buffer and its loudness could not be measured at all. Only the Summary
// is read, so the pass has to print the same few lines however long the file is.
describe('the loudness pass on a long mix', () => {
  it('prints the same amount whatever the length, and still the Summary', () => {
    const shortErr = spawnSync(FF, ebur128MeasureArgs(short), { encoding: 'utf8' }).stderr
    const longErr = spawnSync(FF, ebur128MeasureArgs(long), { encoding: 'utf8' }).stderr

    expect(Math.abs(longErr.length - shortErr.length)).toBeLessThan(1024)
    expect(parseEbur128Measured(longErr)?.inputI).toBeCloseTo(-21.8, 0)
  })
})
