import { describe, expect, it } from 'vitest'
import type { DjProgram } from '../../../shared/djProgram'
import type { ReplacedEntry } from '../../../shared/toReview'
import { traktorContentId } from '../../../shared/traktorContent'
import type { SourcePlaylistEntry } from '../../../shared/types'
import { replacedEntryOf, savedReviews, shiftLabel, toReviewEntriesFor } from './toReview'

function row(path: string | null, extra: Partial<SourcePlaylistEntry> = {}): SourcePlaylistEntry {
  return {
    path,
    separator: false,
    meta: {} as SourcePlaylistEntry['meta'],
    ...extra,
  }
}

function replaced(newPath: string, extra: Partial<ReplacedEntry> = {}): ReplacedEntry {
  return {
    newPath,
    oldPath: `${newPath}.old`,
    replacedAt: 1,
    shift: { moved: 10 },
    pending: ['rekordbox'],
    ...extra,
  }
}

const preview = (cues: number) => ({
  title: 't',
  artist: 'a',
  durationSec: 200,
  cues: Array.from({ length: cues }, () => ({}) as never),
})

describe('toReviewEntriesFor', () => {
  it('lists a track by its new path or by the old one a queued repoint still shows', () => {
    const rows = [row('/m/a.flac'), row('/m/b.mp3')]
    const list = toReviewEntriesFor(
      rows,
      [replaced('/m/a.flac'), replaced('/m/b.flac', { oldPath: '/m/b.mp3' })],
      'rekordbox',
    )
    expect(list.map((r) => r.path).sort()).toEqual(['/m/a.flac', '/m/b.mp3'])
  })

  it('matches paths whatever Unicode form the file system gave, so accented titles are not lost', () => {
    const nfd = '/m/Café.flac'
    const nfc = '/m/Café.flac'
    expect(toReviewEntriesFor([row(nfd)], [replaced(nfc)], 'rekordbox')).toHaveLength(1)
  })

  it('leaves out the tracks whose review is already done in this program', () => {
    const rows = [row('/m/a.flac')]
    expect(
      toReviewEntriesFor(rows, [replaced('/m/a.flac', { pending: ['traktor'] })], 'rekordbox'),
    ).toEqual([])
  })

  it('leaves out a track with no cues here, because there is nothing to review', () => {
    const rows = [
      row('/m/a.flac', { preview: preview(0) }),
      row('/m/b.flac'),
      row('/m/c.flac', { preview: preview(2) }),
    ]
    const list = toReviewEntriesFor(
      rows,
      [replaced('/m/a.flac'), replaced('/m/b.flac'), replaced('/m/c.flac')],
      'rekordbox',
    )
    expect(list.map((r) => r.path).sort()).toEqual(['/m/b.flac', '/m/c.flac'])
  })

  it('shows each replaced track once even if both paths are in the library', () => {
    const rows = [row('/m/a.mp3'), row('/m/a.flac')]
    const list = toReviewEntriesFor(
      rows,
      [replaced('/m/a.flac', { oldPath: '/m/a.mp3' })],
      'rekordbox',
    )
    expect(list.map((r) => r.path)).toEqual(['/m/a.flac'])
  })

  it('puts the unmoved tracks first, then the most recent replacement', () => {
    const rows = [row('/m/m3'), row('/m/u1'), row('/m/m2')]
    const list = toReviewEntriesFor(
      rows,
      [
        replaced('/m/m3', { replacedAt: 3 }),
        replaced('/m/u1', { replacedAt: 1, shift: { unmoved: 'noMatch' } as never }),
        replaced('/m/m2', { replacedAt: 2 }),
      ],
      'rekordbox',
    )
    expect(list.map((r) => r.path)).toEqual(['/m/u1', '/m/m3', '/m/m2'])
  })

  it('never lists separators', () => {
    const rows = [{ ...row('/m/a.flac'), separator: true }, row(null)]
    expect(toReviewEntriesFor(rows, [replaced('/m/a.flac')], 'rekordbox')).toEqual([])
  })
})

describe('replacedEntryOf', () => {
  it('finds the entry for the editor only while this program still has it pending', () => {
    const entry = replaced('/m/a.flac', { pending: ['traktor'] })
    expect(replacedEntryOf([entry], '/m/a.flac', 'traktor')).toBe(entry)
    expect(replacedEntryOf([entry], '/m/a.flac.old', 'traktor')).toBe(entry)
    expect(replacedEntryOf([entry], '/m/a.flac', 'rekordbox' as DjProgram)).toBeUndefined()
  })
})

describe('savedReviews', () => {
  it('groups a save by track, so twins in other programs leave the list too', () => {
    expect(
      savedReviews([
        { contentId: '42', path: '/m/a.flac' },
        { contentId: traktorContentId('k'), path: '/m/a.flac' },
        { contentId: '43', path: '/m/b.flac' },
      ]),
    ).toEqual([
      ['/m/a.flac', ['rekordbox', 'traktor']],
      ['/m/b.flac', ['rekordbox']],
    ])
  })
})

describe('shiftLabel', () => {
  it('signs the shift so the DJ sees which way the cues went', () => {
    expect(shiftLabel(120)).toBe('+120 ms')
    expect(shiftLabel(-26)).toBe('−26 ms')
    expect(shiftLabel(0)).toBe('0 ms')
  })
})
