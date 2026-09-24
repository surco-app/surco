import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile } from 'node-taglib-sharp'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-readmeta-opens-'))
  return { app: { isPackaged: false, getPath: () => dir } }
})
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { readMeta } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-readmeta-opens-src-'))
let wav: string

beforeAll(() => {
  wav = join(dir, 'untagged-grouping.wav')
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:a',
    'pcm_s16le',
    wav,
  ])
  const f = TagFile.createFromPath(wav)
  try {
    f.tag.title = 'Rave Till My Grave'
    f.tag.publisher = 'MQD Records'
    f.save()
  } finally {
    f.dispose()
  }
})

afterEach(() => vi.restoreAllMocks())

// readMeta runs on the main process for every imported file, often over a NAS, and each
// TagLib open is a few dozen synchronous reads. A WAV with no grouping and no rating needs
// all three of TagLib's fallbacks (iTunes grouping, the extras ffprobe cannot see, the
// POPM stars), which used to open the same file three times over.
describe('readMeta through TagLib', () => {
  it('opens the file with TagLib once for every fallback it needs', async () => {
    const opens = vi.spyOn(TagFile, 'createFromPath')

    const meta = await readMeta(wav)

    expect(meta.tags.publisher).toBe('MQD Records')
    expect(opens).toHaveBeenCalledTimes(1)
  })
})
