import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

let truncateTagPass = false
vi.mock('./worker', async () => {
  const actual = await vi.importActual<typeof import('./worker')>('./worker')
  return {
    ...actual,
    runInWorker: vi.fn(async (job: { type: string; file?: string }) => {
      const result = await actual.runInWorker(job as Parameters<typeof actual.runInWorker>[0])
      if (truncateTagPass && job.type === 'writeTags' && job.file) {
        const { size } = statSync(job.file)
        truncateSync(job.file, Math.floor(size / 4))
      }
      return result
    }),
  }
})

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-damaged-'))
const src = join(dir, 'damaged.mp3')

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

function decodable(file: string): boolean {
  try {
    execFileSync(FF, ['-hide_banner', '-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
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
    'sine=frequency=440:duration=8',
    '-id3v2_version',
    '3',
    '-metadata',
    'title=Original',
    clean,
  ])
  const bytes = readFileSync(clean)
  const cut = Math.floor(bytes.length / 3)
  writeFileSync(
    src,
    Buffer.concat([bytes.subarray(0, cut), Buffer.alloc(4096, 0), bytes.subarray(cut)]),
  )
})

describe('same-format conversion of an MP3 whose own audio trips the decoder', () => {
  it('delivers the copy when it carries everything the original itself can play', async () => {
    expect(decodable(src)).toBe(false)
    truncateTagPass = false
    const out = join(dir, 'accepted.mp3')

    await convertAudio(src, out, 'mp3', meta)

    expect(titleOf(out)).toBe('Renamed')
  }, 30000)

  it('still refuses a copy that lost part of what the original can play', async () => {
    truncateTagPass = true
    const out = join(dir, 'refused.mp3')

    await expect(convertAudio(src, out, 'mp3', meta)).rejects.toThrow(/convertedOutput/)

    expect(existsSync(out)).toBe(false)
  }, 30000)
})
