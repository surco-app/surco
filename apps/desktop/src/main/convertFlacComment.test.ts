import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile, TagTypes, type XiphComment } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-flac-comment-'))
const src = join(dir, 'in.flac')

const meta: TrackMetadata = {
  title: 'T',
  artist: 'A',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: 'A2S B1S C2S D1S - E6 F4 G2 H1 I6 J4 K2 L1',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

// The field names as they sit in the Vorbis comment block. ffmpeg's own readers fold
// DESCRIPTION back into "comment" on the way out, so `ffmpeg -i` and ffprobe cannot tell
// the two spellings apart; TagLib reports the block as written.
function xiphFields(file: string): Record<string, string[]> {
  const f = TagFile.createFromPath(file)
  try {
    const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
    return Object.fromEntries((xiph?.fieldNames ?? []).map((n) => [n, xiph?.getField(n) ?? []]))
  } finally {
    f.dispose()
  }
}

beforeAll(() => {
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
    src,
  ])
})

// A user compared a FLAC before and after an update in mp3tag (17/09/2026): the COMMENT
// he had written — the structure of the track, the one field a DJ reads at a glance — came
// back as DESCRIPTION. ffmpeg's flac muxer renames the comment key on write whatever its
// spelling (measured: -metadata COMMENT= and -metadata comment= both land as DESCRIPTION),
// and Traktor and Engine read COMMENT, so the comment vanished for them.
describe('the comment on a FLAC target', () => {
  it('is written as COMMENT, the field DJ software reads', async () => {
    const out = join(dir, 'out.flac')
    await convertAudio(src, out, 'flac', meta)
    const fields = xiphFields(out)
    expect(fields.COMMENT).toEqual([meta.comment])
    expect(fields.DESCRIPTION).toBeUndefined()
  })

  // Files an earlier Surco converted carry the DESCRIPTION spelling. Re-tagging one has
  // to move the comment over, and emptying it has to clear both spellings, or the old
  // text resurfaces in the editor from the alias the reader falls back to.
  describe('on a file that carries the DESCRIPTION an earlier Surco wrote', () => {
    const legacy = join(dir, 'legacy.flac')
    beforeAll(() => {
      execFileSync(FF, [
        '-y',
        '-loglevel',
        'error',
        '-i',
        src,
        '-c:a',
        'copy',
        '-metadata',
        'comment=old',
        legacy,
      ])
      expect(xiphFields(legacy).DESCRIPTION, 'the fixture has to carry DESCRIPTION').toEqual([
        'old',
      ])
    })

    it('moves the new comment to COMMENT and drops DESCRIPTION', async () => {
      const out = join(dir, 'migrated.flac')
      await convertAudio(legacy, out, 'flac', meta)
      const fields = xiphFields(out)
      expect(fields.COMMENT).toEqual([meta.comment])
      expect(fields.DESCRIPTION).toBeUndefined()
    })

    it('leaves neither spelling behind when the comment is emptied', async () => {
      const out = join(dir, 'cleared.flac')
      await convertAudio(legacy, out, 'flac', { ...meta, comment: '' })
      const fields = xiphFields(out)
      expect(fields.COMMENT).toBeUndefined()
      expect(fields.DESCRIPTION).toBeUndefined()
    })
  })
})
