// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { SourcePlaylistEntry } from '../../../shared/types'
import i18n from '../i18n'
import type { TrackItem } from '../types'
import { duplicatesDetail, reviewDetail, reviewOpening, reviewTarget } from './reviewTarget'

const row = (inputPath: string) => ({ inputPath }) as TrackItem
const music = (path: string | null, musicPersistentId?: string): SourcePlaylistEntry => ({
  path,
  separator: false,
  meta: {},
  ...(musicPersistentId && { musicPersistentId }),
})
const tr = i18n.t.bind(i18n)

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('reviewTarget', () => {
  // No source open is the working list, the review as it always was.
  it('is the working list when no playlist is open', () => {
    expect(
      reviewTarget({
        source: null,
        playlistName: null,
        entries: undefined,
        playlistTracks: null,
        workingCount: 71,
      }),
    ).toEqual({ kind: 'list', count: 71 })
  })

  // A click acts on the rows shown: until the picked playlist's rows arrive the list still
  // shows the working list, and so that is what a review would read.
  it('is the working list while the picked playlist is still loading', () => {
    expect(
      reviewTarget({
        source: 'appleMusic',
        playlistName: '2K',
        entries: undefined,
        playlistTracks: null,
        workingCount: 5,
      }),
    ).toEqual({ kind: 'list', count: 5 })
  })

  // rekordbox has no review of its own: its playlist is reviewed through the files, the rows
  // the list shows for it.
  it('is the rows of an open rekordbox playlist, by path', () => {
    expect(
      reviewTarget({
        source: 'rekordbox',
        playlistName: 'Factory',
        entries: [],
        playlistTracks: [row('/m/a.wav'), row('/m/b.wav')],
        workingCount: 9,
      }),
    ).toEqual({
      kind: 'playlist',
      name: 'Factory',
      paths: new Set(['/m/a.wav', '/m/b.wav']),
      count: 2,
    })
  })

  // The count is what the Music review will load: one per Music entry, so a row with no file
  // (streaming) or an ID seen twice does not inflate it.
  it('is the distinct Music persistent IDs of an open Music playlist', () => {
    expect(
      reviewTarget({
        source: 'appleMusic',
        playlistName: '2K',
        entries: [
          music('/m/a.wav', 'A1'),
          music('/m/b.wav', 'B1'),
          music(null),
          music('/m/c.wav', 'A1'),
        ],
        playlistTracks: [row('/m/a.wav'), row('/m/b.wav'), row('/m/c.wav')],
        workingCount: 9,
      }),
    ).toEqual({ kind: 'music', name: '2K', ids: new Set(['A1', 'B1']), count: 2 })
  })
})

describe('reviewOpening', () => {
  const musicTarget = { kind: 'music' as const, name: '2K', ids: new Set(['A1']), count: 1 }

  it('opens the Music review on the playlist tracks, or on their copies for duplicates', () => {
    expect(reviewOpening(musicTarget, 'all')).toEqual({
      source: 'music',
      filter: 'all',
      scope: { ids: musicTarget.ids, mode: 'tracks' },
    })
    expect(reviewOpening(musicTarget, 'duplicates')).toEqual({
      source: 'music',
      filter: 'duplicates',
      scope: { ids: musicTarget.ids, mode: 'duplicates' },
    })
  })

  it('opens the list review on the playlist paths, or on the whole list', () => {
    const paths = new Set(['/m/a.wav'])
    expect(reviewOpening({ kind: 'playlist', name: 'F', paths, count: 1 }, 'all')).toEqual({
      source: 'list',
      filter: 'all',
      paths,
    })
    expect(reviewOpening({ kind: 'list', count: 3 }, 'all')).toEqual({
      source: 'list',
      filter: 'all',
    })
  })

  // A playlist of streaming rows only has nothing to review; opening anyway would show the
  // Music review's "your library is empty", which is false.
  it('opens nothing for a target with no tracks', () => {
    expect(reviewOpening({ ...musicTarget, ids: new Set(), count: 0 }, 'all')).toBeNull()
    expect(reviewOpening({ kind: 'list', count: 0 }, 'all')).toBeNull()
  })
})

describe('reviewDetail', () => {
  it('says what each target touches and where it writes', () => {
    expect(reviewDetail(tr, { kind: 'list', count: 71 })).toBe(
      'The 71 tracks in the list. Changes the files',
    )
    expect(reviewDetail(tr, { kind: 'list', count: 1 })).toBe(
      'The only track in the list. Changes the file',
    )
    expect(
      reviewDetail(tr, { kind: 'playlist', name: 'Factory', paths: new Set(), count: 70 }),
    ).toBe('The 70 tracks in “Factory”. Changes the files')
    expect(reviewDetail(tr, { kind: 'music', name: '2K', ids: new Set(), count: 406 })).toBe(
      'The 406 tracks in “2K”. Changes Apple Music',
    )
    expect(duplicatesDetail(tr, '2K')).toBe('From “2K” across your whole Music library')
  })

  // English sends 0 to _other: without _zero the disabled item would read "The 0 tracks".
  it('says a playlist has nothing to review instead of counting zero tracks', () => {
    expect(reviewDetail(tr, { kind: 'music', name: '2K', ids: new Set(), count: 0 })).toBe(
      '“2K” has no tracks to review',
    )
  })

  // The wording Vicent approved on the sketch.
  it('reads in Spanish as approved', async () => {
    await i18n.changeLanguage('es')
    expect(reviewDetail(tr, { kind: 'music', name: '2K', ids: new Set(), count: 406 })).toBe(
      'Las 406 pistas de «2K». Cambia Apple Music',
    )
    expect(
      reviewDetail(tr, { kind: 'playlist', name: 'Factory', paths: new Set(), count: 70 }),
    ).toBe('Las 70 pistas de «Factory». Cambia los ficheros')
    expect(duplicatesDetail(tr, '2K')).toBe('De «2K» en toda tu biblioteca de Music')
    expect(reviewDetail(tr, { kind: 'list', count: 71 })).toBe(
      'Las 71 pistas de la lista. Cambia los ficheros',
    )
  })
})
