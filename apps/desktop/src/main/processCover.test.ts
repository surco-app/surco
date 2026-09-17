import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { ffprobePath } from './binaries'
import { processCover } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-process-cover-'))
const jpeg600 = join(dir, '600.jpg')
const jpeg2000 = join(dir, '2000.jpg')
const jpegWide = join(dir, 'wide.jpg')
const png = join(dir, 'art.png')

function makeImage(path: string, size: string): void {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `nullsrc=s=${size},geq=random(1)*255:128:128`,
    '-frames:v',
    '1',
    path,
  ])
}

function dims(path: string): { width: number; height: number } {
  const out = execFileSync(
    ffprobePath,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      path,
    ],
    { encoding: 'utf8' },
  )
  const s = JSON.parse(out).streams[0]
  return { width: Number(s.width), height: Number(s.height) }
}

const opts = { maxSize: 1200, square: false, upscale: false }

beforeAll(() => {
  makeImage(jpeg600, '600x600')
  makeImage(jpeg2000, '2000x2000')
  makeImage(jpegWide, '800x600')
  makeImage(png, '64x64')
})

// Every cover a conversion embeds goes through here, including the file's own art on a
// same-format update. It decoded and re-encoded the picture on every pass: a user's 85 KB
// front cover came back 53 KB after an update meant only to refresh the thumbnail
// (17/09/2026), the next update would have degraded it again, and on the test matrix a
// 150 KB JPEG grew to 234 KB. Art that already satisfies the settings is handed on as it
// is; only art that needs shrinking, cropping, enlarging or transcoding is touched.
describe('processCover', () => {
  it('passes a JPEG that already fits the settings through byte for byte', async () => {
    const out = await processCover(jpeg600, opts)
    try {
      expect(out).not.toBe(jpeg600)
      expect(readFileSync(out).equals(readFileSync(jpeg600))).toBe(true)
    } finally {
      unlinkSync(out)
    }
  })

  it('shrinks a JPEG larger than the cap', async () => {
    const out = await processCover(jpeg2000, opts)
    try {
      expect(dims(out)).toEqual({ width: 1200, height: 1200 })
    } finally {
      unlinkSync(out)
    }
  })

  it('crops a JPEG that is not square when a square is asked for', async () => {
    const out = await processCover(jpegWide, { ...opts, square: true })
    try {
      expect(dims(out)).toEqual({ width: 600, height: 600 })
    } finally {
      unlinkSync(out)
    }
  })

  it('enlarges a JPEG below the target when upscaling is on', async () => {
    const out = await processCover(jpeg600, { ...opts, upscale: true })
    try {
      expect(dims(out)).toEqual({ width: 1200, height: 1200 })
    } finally {
      unlinkSync(out)
    }
  })

  it('still transcodes a PNG to JPEG', async () => {
    const out = await processCover(png, opts)
    try {
      expect(readFileSync(out).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    } finally {
      unlinkSync(out)
    }
  })
})
