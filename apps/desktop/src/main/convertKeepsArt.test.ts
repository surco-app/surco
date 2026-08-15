import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { ffprobePath } from './binaries'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-keepart-'))
const cover = join(dir, 'cover.jpg')
const flacWithArt = join(dir, 'art.flac')
const mp3WithArt = join(dir, 'art.mp3')

const meta: TrackMetadata = {
  title: 'Retagged',
  artist: 'Djotas',
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

// An attached picture shows up as a video stream; no stream means no artwork.
function hasArt(path: string): boolean {
  const out = execFileSync(
    ffprobePath,
    [
      '-v',
      'error',
      '-select_streams',
      'v',
      '-show_entries',
      'stream=codec_name',
      '-of',
      'csv=p=0',
      path,
    ],
    { encoding: 'utf8' },
  )
  return out.trim().length > 0
}

function embedArt(source: string, out: string, codec: string): void {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    source,
    '-i',
    cover,
    '-map',
    '0:a',
    '-map',
    '1:v',
    '-c:a',
    codec,
    '-c:v',
    'copy',
    '-disposition:v',
    'attached_pic',
    out,
  ])
}

beforeAll(() => {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=300x300:d=1',
    '-frames:v',
    '1',
    cover,
  ])
  const base = join(dir, 'base.flac')
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
    base,
  ])
  embedArt(base, flacWithArt, 'flac')
  embedArt(base, mp3WithArt, 'libmp3lame')
})

// The fixtures have to genuinely carry art, or every assertion below is vacuous.
describe('the fixtures', () => {
  it('carry embedded artwork to begin with', () => {
    expect(hasArt(flacWithArt)).toBe(true)
    expect(hasArt(mp3WithArt)).toBe(true)
  })
})

// The bug: convertArgs mapped only `0:a` and pulled in a picture stream solely when a
// NEW cover was being applied, so converting a track to fix its title threw away the
// artwork it already had. Users saw "Surco deleted my cover" on an operation that never
// mentioned covers.
describe('a conversion that applies no new cover', () => {
  it('keeps the artwork a FLAC already carried', async () => {
    const out = join(dir, 'flac-kept.flac')
    await convertAudio(flacWithArt, out, 'flac', meta)
    expect(hasArt(out)).toBe(true)
  })

  it('keeps the artwork an MP3 already carried', async () => {
    const out = join(dir, 'mp3-kept.mp3')
    await convertAudio(mp3WithArt, out, 'mp3', meta)
    expect(hasArt(out)).toBe(true)
  })

  // Carrying art across a format change matters just as much: the track is the same
  // release, and the DJ picked a different container, not a blank cover.
  it('carries the artwork across a format change', async () => {
    const out = join(dir, 'flac-to-mp3.mp3')
    await convertAudio(flacWithArt, out, 'mp3', meta)
    expect(hasArt(out)).toBe(true)
  })
})

// Removing the cover is an explicit request, and it has to win over the carry-over above
// — otherwise the "remove artwork" button would silently do nothing.
describe('a conversion that removes the cover', () => {
  it('drops the artwork when removal is asked for', async () => {
    const out = join(dir, 'flac-removed.flac')
    await convertAudio(flacWithArt, out, 'flac', meta, undefined, undefined, true)
    expect(hasArt(out)).toBe(false)
  })
})

// A new cover replaces the old one rather than landing beside it: two attached pictures
// would leave which-one-shows up to each player.
describe('a conversion that applies a new cover', () => {
  it('ends up with exactly one picture stream', async () => {
    const out = join(dir, 'flac-replaced.flac')
    await convertAudio(flacWithArt, out, 'flac', meta, cover)
    const streams = execFileSync(
      ffprobePath,
      [
        '-v',
        'error',
        '-select_streams',
        'v',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'csv=p=0',
        out,
      ],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean)
    expect(streams).toHaveLength(1)
  })
})
