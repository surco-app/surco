import { execFileSync } from 'node:child_process'
import { mkdtempSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => tmpdir() } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { ffprobePath } from './binaries'
import { probeDuration, readMeta } from './ffmpeg'
import { probeOffsets } from './fftBands'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-duration-fallback-'))
const streamed = join(dir, 'streamed.flac')

function headerDuration(file: string): string | undefined {
  const out = execFileSync(
    ffprobePath,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file],
    { encoding: 'utf8' },
  )
  return JSON.parse(out).format?.duration
}

beforeAll(() => {
  // Encoded to a pipe: the encoder cannot seek back to write the sample count into
  // STREAMINFO, so the container carries no duration at all. Streaming rippers and
  // some download services leave files exactly like this.
  const fd = openSync(streamed, 'w')
  execFileSync(
    FF,
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=8',
      '-c:a',
      'flac',
      '-f',
      'flac',
      '-',
    ],
    { stdio: ['ignore', fd, 'inherit'] },
  )
  expect(headerDuration(streamed), 'the fixture has to carry no duration').toBeUndefined()
})

// The spectrum probes are placed by duration: twelve 3 s windows spread over the body of
// the track. With no duration they all collapse onto one window at the start, and a
// verdict meant to come from 36 s of music comes from the first three seconds — the
// intro, the fade-in, the filtered opening. Measured on a real track (Pray, 7:08): the
// same audio graded 20 kHz clean with its header and 16 kHz "Reprocessed" without it.
// That is the shape of a user's report (17/09/2026): originals flagged at 10–13 kHz,
// the copy Surco re-encoded (and so re-headered) reading a full 22 kHz.
describe('probeDuration on a file whose container carries no duration', () => {
  it('measures the length by decoding instead of giving up', async () => {
    const seconds = await probeDuration(streamed)
    expect(seconds).not.toBeNull()
    expect(seconds as number).toBeGreaterThan(7.9)
    expect(seconds as number).toBeLessThan(8.1)
  })

  it('so the spectrum probes spread over the track rather than piling on its start', async () => {
    const seconds = (await probeDuration(streamed)) ?? 0
    expect(probeOffsets(seconds).length).toBe(12)
  })

  // The track list reads the same header, and showed such a file with no length at all.
  it('gives the track list a length too', async () => {
    const { duration } = await readMeta(streamed)
    expect(duration).not.toBeNull()
    expect(duration as number).toBeGreaterThan(7.9)
    expect(duration as number).toBeLessThan(8.1)
  })
})
