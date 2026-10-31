import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  Id3v2FrameClassType,
  Id3v2FrameIdentifiers,
  Id3v2Settings,
  type Id3v2Tag,
  type Id3v2TextInformationFrame,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { damageV23 } from './genreDamage'
import { id3TextOf } from './tags'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-genre-damage-'))

const GENRES = [
  'House; Deep House',
  'House/Deep House',
  'House; Techno; Deep House',
  'Electronic; Techno',
  'Techno; House',
  'Deep House; Tech House',
  'Techno (Peak Time / Driving)',
  'Afro House (Melodic)',
]

function rawTcon(file: string): string {
  const f = TagFile.createFromPath(file)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    const [tcon] = id3.getFramesByIdentifier<Id3v2TextInformationFrame>(
      Id3v2FrameClassType.TextInformationFrame,
      Id3v2FrameIdentifiers.TCON,
    )
    return id3TextOf(tcon.render(3).subarray(10).toByteArray())
  } finally {
    f.dispose()
  }
}

function oldSave(file: string, comment: string): void {
  const f = TagFile.createFromPath(file)
  try {
    void f.tag.genres
    f.tag.comment = comment
    f.save()
  } finally {
    f.dispose()
  }
}

function replay(text: string, n: number): string {
  let out = text
  for (let i = 0; i < n; i++) out = damageV23(out)
  return out
}

let seq = 0

// The repair trusts damageV23 to say what TagLib's old setting left behind: a library value
// counts as the genre the user wrote only when replaying the damage on it gives the bytes on
// disk. So the model has to match the real library, save after save.
describe('damageV23 — the same text TagLib left with its old genre separators', () => {
  afterEach(() => {
    Id3v2Settings.useNonStandardV2V3GenreSeparators = false
  })

  it.each(GENRES.flatMap((g) => [1, 2, 3].map((n) => [g, n] as const)))(
    '"%s" saved %i times',
    (genre, n) => {
      const file = join(dir, `g-${seq++}.mp3`)
      execFileSync(FF, [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'anoisesrc=d=0.5',
        '-id3v2_version',
        '3',
        '-metadata',
        `genre=${genre}`,
        file,
      ])
      Id3v2Settings.useNonStandardV2V3GenreSeparators = true
      for (let i = 0; i < n; i++) oldSave(file, `c${i}`)
      Id3v2Settings.useNonStandardV2V3GenreSeparators = false
      expect(rawTcon(file)).toBe(replay(genre, n))
    },
  )

  it('pins the rows measured on 31/10', () => {
    expect(damageV23('House; Deep House')).toBe('(35) Deep House')
    expect(damageV23('House/Deep House')).toBe('(35)Deep House')
    expect(damageV23('House; Techno; Deep House')).toBe('(35) Techno; Deep House')
    expect(damageV23('Electronic; Techno')).toBe('(52) Techno')
    expect(damageV23('Deep House; Tech House')).toBe('Deep House; Tech House')
    expect(damageV23('Techno (Peak Time / Driving)')).toBe('Techno ((Peak Time ; Driving)')
  })
})
