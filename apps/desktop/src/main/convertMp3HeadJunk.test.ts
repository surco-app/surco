import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { leadingId3v2Size } from './id3Header'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-headjunk-'))
const src = join(dir, 'in.mp3')

const meta: TrackMetadata = {
  title: 'Renamed',
  artist: 'A',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

function titleOf(file: string): string | undefined {
  const f = TagFile.createFromPath(file)
  try {
    return f.tag.title
  } finally {
    f.dispose()
  }
}

beforeAll(() => {
  const clean = join(dir, 'clean.mp3')
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-id3v2_version',
    '3',
    '-metadata',
    'title=Original',
    clean,
  ])
  const bytes = readFileSync(clean)
  const tagSize = leadingId3v2Size(bytes)
  writeFileSync(
    src,
    Buffer.concat([bytes.subarray(0, tagSize), Buffer.alloc(4000, 0), bytes.subarray(tagSize)]),
  )
})

describe('same-format conversion of an MP3 with junk ahead of its first frame', () => {
  it('writes the new tags instead of failing with "MPEG audio header not found"', async () => {
    expect(() => titleOf(src)).toThrow(/MPEG audio header not found/)
    const out = join(dir, 'out.mp3')

    await convertAudio(src, out, 'mp3', meta)

    expect(titleOf(out)).toBe('Renamed')
    expect(() => titleOf(src)).toThrow(/MPEG audio header not found/)
  }, 30000)
})
