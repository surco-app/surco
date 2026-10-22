import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { measureCueWaveWords } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-cue-words-measure-'))
const track = join(dir, 'track.mp3')

beforeAll(() => {
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=80:duration=3',
    '-ar',
    '32000',
    track,
  ])
})

describe('measureCueWaveWords', () => {
  it('reads the file rate itself, so a 32 kHz track still gets 150 words a second', async () => {
    const words = await measureCueWaveWords(track)
    expect(words?.length).toBeGreaterThanOrEqual(449)
    expect(words?.length).toBeLessThanOrEqual(456)
  })

  it('answers null for a file with no audio to read, so Auto marcar says so instead of proposing on silence', async () => {
    expect(await measureCueWaveWords(join(dir, 'missing.mp3'))).toBeNull()
  })
})
