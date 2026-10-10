import { execFileSync } from 'node:child_process'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { emptyMetadata } from '../shared/metadata'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const PROBE = ffprobeInstaller.path
const dir = mkdtempSync(join(tmpdir(), 'surco-aac-filter-'))
const source = join(dir, 'purchase.m4a')
const meta = { ...emptyMetadata(), title: 'Purchase', artist: 'Artist' }

function codecOf(file: string): string {
  return execFileSync(PROBE, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name',
    '-of',
    'default=nw=1:nk=1',
    file,
  ])
    .toString()
    .trim()
}

beforeAll(() => {
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=30:c=pink:a=0.2',
    '-ac',
    '2',
    '-ar',
    '44100',
    '-c:a',
    'aac',
    '-b:a',
    '256k',
    source,
  ])
})

// An iTunes purchase is AAC in an .m4a. Evening out its loudness or repairing clicks has
// to re-encode it, and doing that to ALAC made the file three to four times bigger in
// place, without any warning and without sounding better.
describe('an AAC .m4a through an audio filter', () => {
  it('stays AAC and about its own size when normalized', async () => {
    const out = join(dir, 'normalized.m4a')
    await convertAudio(source, out, 'alac', meta, undefined, {
      mode: 'loudness',
      targetLufs: -14,
      truePeakDb: -1,
      peakDb: -1,
      removeDcOffset: false,
      peakPerChannel: false,
    })
    expect(codecOf(out)).toBe('aac')
    expect(statSync(out).size).toBeLessThan(statSync(source).size * 1.3)
  }, 120000)

  it('stays AAC when clicks are repaired', async () => {
    const out = join(dir, 'declicked.m4a')
    await convertAudio(
      source,
      out,
      'alac',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'standard',
    )
    expect(codecOf(out)).toBe('aac')
  }, 120000)
})
