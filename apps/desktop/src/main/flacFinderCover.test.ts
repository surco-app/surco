import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import ffmpegStatic from 'ffmpeg-static'
import type { TrackMetadata } from '../shared/types'
import { convertAudio, readTags } from './ffmpeg'
import { prependFlacId3 } from './flacFinderCover'
import { leadingId3v2Size } from './id3Header'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-findercover-'))
const flac = join(dir, 'in.flac')
const cover = join(dir, 'cover.jpg')

const meta: TrackMetadata = {
  title: 'Elastic Pump',
  artist: 'Javi Soria',
  album: 'Elastic Pump',
  albumArtist: 'Javi Soria',
  year: '2024',
  genre: 'Electronic',
  grouping: '',
  comment: '',
  trackNumber: '1',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

beforeAll(() => {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=300x300:d=1',
    '-frames:v',
    '1',
    cover,
  ])
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:a',
    'flac',
    flac,
  ])
})

// macOS Finder/QuickLook never read FLAC's own PICTURE block, so a FLAC with
// perfectly good embedded art shows a generic icon. Finder does read ID3v2, and
// players skip a leading ID3 header on FLAC, so prepending one with the cover is
// the one way to get thumbnails without breaking playback.
describe('prependFlacId3', () => {
  it('prepends an ID3v2.3 header carrying the cover, with the FLAC stream intact right after it', () => {
    const p = join(dir, 'direct.flac')
    copyFileSync(flac, p)
    prependFlacId3(p, meta, cover)
    const buf = readFileSync(p)
    expect(buf.toString('latin1', 0, 3)).toBe('ID3')
    // v2.3, matching every other ID3 tag Surco writes (v2.4 trips older readers).
    expect(buf[3]).toBe(3)
    const skip = leadingId3v2Size(buf)
    expect(skip).toBeGreaterThan(10)
    expect(buf.toString('latin1', skip, skip + 4)).toBe('fLaC')
    expect(buf.subarray(0, skip).includes('APIC')).toBe(true)
  })

  it('stays readable to ffmpeg, so import/analysis/playback still see the tags through the header', async () => {
    const p = join(dir, 'readable.flac')
    copyFileSync(flac, p)
    execFileSync(FF, ['-y', '-loglevel', 'error', '-i', flac, '-metadata', 'title=Elastic Pump', '-metadata', 'artist=Javi Soria', p])
    prependFlacId3(p, meta, cover)
    const tags = await readTags(p)
    expect(tags.title).toBe('Elastic Pump')
    expect(tags.artist).toBe('Javi Soria')
  })
})

describe('convertAudio with Finder covers enabled', () => {
  it('writes the ID3 header on a FLAC output when asked', async () => {
    const out = join(dir, 'out-finder.flac')
    await convertAudio(
      flac,
      out,
      'flac',
      meta,
      cover,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    )
    const buf = readFileSync(out)
    expect(buf.toString('latin1', 0, 3)).toBe('ID3')
    expect(buf.toString('latin1', leadingId3v2Size(buf), leadingId3v2Size(buf) + 4)).toBe('fLaC')
  })

  it('leaves a standard FLAC when the option is off', async () => {
    const out = join(dir, 'out-plain.flac')
    await convertAudio(flac, out, 'flac', meta, cover)
    expect(readFileSync(out).toString('latin1', 0, 4)).toBe('fLaC')
  })

  it('skips the header when there is no cover to show', async () => {
    const out = join(dir, 'out-nocover.flac')
    await convertAudio(
      flac,
      out,
      'flac',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    )
    expect(readFileSync(out).toString('latin1', 0, 4)).toBe('fLaC')
  })
})
