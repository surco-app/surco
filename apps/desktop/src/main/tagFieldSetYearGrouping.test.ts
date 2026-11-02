import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { type Id3v2Tag, File as TagFile, TagTypes } from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { emptyMetadata } from '../shared/metadata'
import type { TrackMetadata } from '../shared/types'
import { setTagFields } from './tagFieldSet'
import { snapshotTags } from './tagSnapshot'
import { setId3Grouping, writeTags } from './tags'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-fieldset-year-grouping-'))
const YEAR = /TYER|TDAT|TDRC|ICRD|DATE|©day/
const GROUPING = /TIT1|GRP1|grouping|©grp/i

let n = 0
function tagged(ext: string, meta: Partial<TrackMetadata>): string {
  const file = join(dir, `t${n++}.${ext}`)
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=d=1',
    ...(ext === 'm4a' ? ['-c:a', 'aac'] : []),
    file,
  ])
  writeTags(file, { ...emptyMetadata(), title: 'T', artist: 'A', ...meta })
  return file
}

function flac(metadata: string[]): string {
  const file = join(dir, `t${n++}.flac`)
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=d=1',
    ...metadata.flatMap((m) => ['-metadata', m]),
    file,
  ])
  return file
}

const lines = (file: string, only: RegExp) => snapshotTags(file).filter((l) => only.test(l))

describe('setTagFields — filling a missing year or grouping', () => {
  it.each(['mp3', 'aiff', 'wav', 'm4a'])(
    'leaves a %s with the grouping frames an Update would have written',
    (ext) => {
      const file = tagged(ext, {})
      expect(setTagFields(file, [{ field: 'grouping', from: '', to: 'Wärm Up' }])).toEqual([
        'written',
      ])
      expect(lines(file, GROUPING)).toEqual(lines(tagged(ext, { grouping: 'Wärm Up' }), GROUPING))
      expect(lines(file, GROUPING)).not.toEqual([])
    },
  )

  it.each([
    ['mp3', '1995-04-12'],
    ['aiff', '1995-04-12'],
    ['wav', '1995-04-12'],
    ['m4a', '1995-04-12'],
    ['mp3', '1995'],
    ['m4a', '1995'],
  ])('leaves a %s with the date frames an Update would have written for %s', (ext, year) => {
    const file = tagged(ext, {})
    expect(setTagFields(file, [{ field: 'year', from: '', to: year }])).toEqual(['written'])
    expect(lines(file, YEAR)).toEqual(lines(tagged(ext, { year }), YEAR))
    expect(lines(file, YEAR)).not.toEqual([])
  })

  it('writes a FLAC its Vorbis DATE and GROUPING, the fields ffmpeg tags it with', () => {
    const file = flac(['title=T'])
    expect(
      setTagFields(file, [
        { field: 'year', from: '', to: '1995-04-12' },
        { field: 'grouping', from: '', to: 'Wärm Up' },
      ]),
    ).toEqual(['written', 'written'])
    expect(snapshotTags(file).filter((l) => /DATE|GROUPING/.test(l))).toEqual([
      'xiph DATE=1995-04-12',
      'xiph GROUPING=Wärm Up',
    ])
  })

  it.each(['mp3', 'wav', 'm4a'])(
    'never overwrites a %s whose year or grouping is no longer empty',
    (ext) => {
      const file = tagged(ext, { year: '1990', grouping: 'Peak' })
      const before = snapshotTags(file)
      expect(
        setTagFields(file, [
          { field: 'year', from: '', to: '1995' },
          { field: 'grouping', from: '', to: 'Warm' },
        ]),
      ).toEqual(['unchanged', 'unchanged'])
      expect(snapshotTags(file)).toEqual(before)
    },
  )

  it('reads an MP3 grouping from the GRP1 Apple Music wrote, not only TIT1', () => {
    const file = tagged('mp3', {})
    const f = TagFile.createFromPath(file)
    setId3Grouping(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag, 'Peak', '.mp3')
    f.save()
    f.dispose()
    expect(lines(file, GROUPING)).toEqual(['id3 GRP1=Peak'])
    expect(setTagFields(file, [{ field: 'grouping', from: 'Peak', to: 'Warm' }])).toEqual([
      'written',
    ])
    expect(lines(file, GROUPING)).toEqual(['id3 GRP1=Warm', 'id3 TIT1=Warm'])
  })

  it('replaces the TXXX grouping ffmpeg leaves on an MP3 with the frames DJ software reads', () => {
    const file = join(dir, `t${n++}.mp3`)
    execFileSync(FF, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=d=1',
      '-metadata',
      'title=T',
      '-metadata',
      'grouping=Old',
      file,
    ])
    expect(setTagFields(file, [{ field: 'grouping', from: 'Old', to: 'Warm' }])).toEqual([
      'written',
    ])
    expect(lines(file, GROUPING)).toEqual(['id3 GRP1=Warm', 'id3 TIT1=Warm'])
  })

  it('changes an MP3 year the file holds, dropping the day and month of the old date', () => {
    const file = tagged('mp3', { year: '1990-01-02' })
    expect(setTagFields(file, [{ field: 'year', from: '1990-01-02', to: '1995' }])).toEqual([
      'written',
    ])
    expect(lines(file, YEAR)).toEqual(['id3 TYER=1995'])
  })
})
