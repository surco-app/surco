import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio, readMeta, readTags } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const PROBE = ffprobeInstaller.path
const dir = mkdtempSync(join(tmpdir(), 'surco-nfc-'))
const decomposedFlac = join(dir, 'decomposed.flac')

const COMPOSED_ARTIST = 'Mötörhead'
const DECOMPOSED_ARTIST = COMPOSED_ARTIST.normalize('NFD')

const blank: TrackMetadata = {
  title: '',
  artist: '',
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

function rawArtistOf(file: string): string {
  return execFileSync(PROBE, [
    '-v',
    'error',
    '-show_entries',
    'format_tags=artist',
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
    'sine=frequency=440:duration=0.5',
    '-metadata',
    `artist=${DECOMPOSED_ARTIST}`,
    '-metadata',
    `title=${'Café Olé'.normalize('NFD')}`,
    decomposedFlac,
  ])
})

describe('decomposed accents in tags', () => {
  it('fixture really carries the decomposed form, or the tests below prove nothing', () => {
    expect(rawArtistOf(decomposedFlac)).toBe(DECOMPOSED_ARTIST)
    expect(DECOMPOSED_ARTIST).not.toBe(COMPOSED_ARTIST)
  })

  it('reaches the editor composed on import, so backspace removes the whole letter', async () => {
    const { tags } = await readMeta(decomposedFlac)
    expect(tags.artist).toBe(COMPOSED_ARTIST)
    expect(tags.title).toBe('Café Olé')
  })

  it('reaches the editor composed on a plain tag read too', async () => {
    const tags = await readTags(decomposedFlac)
    expect(tags.artist).toBe(COMPOSED_ARTIST)
  })

  it('is written composed, so Traktor, rekordbox and search indexes see one character', async () => {
    const out = join(dir, 'written.flac')
    await convertAudio(decomposedFlac, out, 'flac', {
      ...blank,
      artist: DECOMPOSED_ARTIST,
    })
    expect(rawArtistOf(out)).toBe(COMPOSED_ARTIST)
  })
})
