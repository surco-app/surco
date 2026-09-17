import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { extractCoverFile } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-extract-cover-'))
const jpeg = join(dir, 'cover.jpg')
const png = join(dir, 'cover.png')
const withJpeg = join(dir, 'jpeg.flac')
const withPng = join(dir, 'png.flac')

function embed(cover: string, out: string): void {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-i',
    cover,
    '-map',
    '0:a',
    '-map',
    '1:v',
    '-c:a',
    'flac',
    '-c:v',
    'copy',
    '-disposition:v',
    'attached_pic',
    out,
  ])
}

beforeAll(() => {
  // Noise rather than a flat colour: a re-encode of a flat block can land on the same
  // bytes by chance, and the byte comparison below has to be able to fail.
  for (const [file, size] of [
    [jpeg, '300x300'],
    [png, '64x64'],
  ]) {
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
      file,
    ])
  }
  embed(jpeg, withJpeg)
  embed(png, withPng)
})

describe('extracting the embedded cover for a write path', () => {
  // The extract decoded and re-encoded the picture on every pass: a user's 85 KB front
  // cover came back as a 53 KB JPEG after an update that only meant to refresh the
  // thumbnail (17/09/2026), and every further update would have degraded it again. A
  // JPEG is copied out byte for byte.
  it('copies a JPEG out unchanged', async () => {
    const out = await extractCoverFile(withJpeg)
    expect(out).not.toBeNull()
    try {
      expect(readFileSync(out as string).equals(readFileSync(jpeg))).toBe(true)
    } finally {
      unlinkSync(out as string)
    }
  })

  // Every consumer of the extract (Apple Music's artwork, the Finder header, the .jpg
  // export) is handed a JPEG at a .jpg path, so art in any other format is still
  // transcoded rather than copied under a name that lies about it.
  it('still delivers a JPEG when the embedded art is a PNG', async () => {
    const out = await extractCoverFile(withPng)
    expect(out).not.toBeNull()
    try {
      expect(readFileSync(out as string).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    } finally {
      unlinkSync(out as string)
    }
  })
})
