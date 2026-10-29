import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { sourceDamaged } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-source-damaged-'))
const intact = join(dir, 'intact.flac')
const truncated = join(dir, 'truncated.flac')

beforeAll(() => {
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=duration=10:amplitude=0.3',
    '-ar',
    '44100',
    intact,
  ])
  const bytes = readFileSync(intact)
  writeFileSync(truncated, bytes.subarray(0, Math.floor(bytes.length / 4)))
})

describe('sourceDamaged', () => {
  it('flags a FLAC cut short on disk, whose header still promises the whole length', async () => {
    expect(await sourceDamaged(truncated)).toBe(true)
  }, 30000)

  it('clears an intact FLAC, so a healthy track never carries the warning', async () => {
    expect(await sourceDamaged(intact)).toBe(false)
  }, 30000)
})
