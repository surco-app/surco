import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'

const FF = ffmpegStatic as unknown as string

const meta: TrackMetadata = {
  title: 'Someone, Somewhere',
  artist: 'Two Powers',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '11A - Energy 7',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '11A',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

let dir: string
let source: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'surco-keycomment-'))
  source = join(dir, 'source.flac')
  // A source already carrying a COMMENT from another tagger — the state every file djotas
  // feeds Surco is in, since Traktor and Mixed In Key both write one.
  execFileSync(FF, [
    '-v',
    'quiet',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-metadata',
    'COMMENT=stale from another tagger',
    '-y',
    source,
  ])
})

// The field NAMES as they sit in the file, which is what a program matching on them sees.
// ffprobe normalises Vorbis spellings on read — COMMENT and DESCRIPTION both surface as
// "comment", KEY and INITIALKEY both as "key" — so only the raw bytes answer this.
function rawVorbisFields(path: string): string[] {
  const text = readFileSync(path).toString('latin1')
  return [...text.matchAll(/(INITIALKEY|KEY|COMMENT|DESCRIPTION)=/g)].map((m) => m[1])
}

// djotas, correcting what he told us earlier: "initialkey no es, es key". His mp3tag dump
// of a converted file shows both spellings carrying the same value, so dropping INITIALKEY
// would blind whatever reads that one — the same both-spellings bargain the record label
// already strikes with LABEL/PUBLISHER.
describe('a FLAC conversion writes the musical key where Traktor reads it', () => {
  it('carries KEY, not only INITIALKEY', async () => {
    const out = join(dir, 'key.flac')
    await convertAudio(source, out, 'flac', meta)

    const names = rawVorbisFields(out)
    expect(names).toContain('KEY')
    expect(names).toContain('INITIALKEY')
  })

  it('reads its own key back', async () => {
    const out = join(dir, 'key-roundtrip.flac')
    await convertAudio(source, out, 'flac', meta)

    expect((await readMeta(out)).tags.key).toBe('11A')
  })
})

// One comment, under one name. ffmpeg maps the `comment` key onto the Vorbis field
// DESCRIPTION rather than COMMENT, so a file that already carried a COMMENT from another
// tagger could in principle come out with both. It does not — ffmpeg reads the stale one
// into the same internal key our value overwrites — and this pins that, since the two
// spellings are what a DJ program matches on.
describe('a FLAC conversion leaves exactly one comment', () => {
  it('does not leave a stale comment beside the one it writes', async () => {
    const out = join(dir, 'comment.flac')
    await convertAudio(source, out, 'flac', meta)

    const names = rawVorbisFields(out).filter((n) => n === 'COMMENT' || n === 'DESCRIPTION')
    expect(names).toHaveLength(1)
  })

  it('keeps the comment readable after the conversion', async () => {
    const out = join(dir, 'comment-roundtrip.flac')
    await convertAudio(source, out, 'flac', meta)

    expect((await readMeta(out)).tags.comment).toBe('11A - Energy 7')
  })
})
