import { describe, expect, it } from 'vitest'
import type { SourcePlaylistEntry } from '../../../shared/types'
import type { TrackItem } from '../types'
import { playlistMembership, playlistView } from './playlistView'

function track(id: string, inputPath: string): TrackItem {
  return { id, inputPath } as TrackItem
}

function entry(path: string | null, separator = false, linkId?: string): SourcePlaylistEntry {
  return { path, separator, meta: {}, linkId, contentId: linkId && `c-${linkId}` }
}

const A = track('a', '/m/A.wav')
const B = track('b', '/m/B.wav')
const C = track('c', '/m/C.wav')
const SEP = '/m/Blank Audio/_.mp3'

describe('playlistView', () => {
  it('shows only the playlist tracks, in the playlist order, not the order they were loaded', () => {
    const view = playlistView([A, B, C], [entry('/m/C.wav'), entry('/m/A.wav')])
    expect(view.tracks.map((t) => t.id)).toEqual(['c', 'a'])
  })

  it('marks the track after each separator, so the list can draw the break', () => {
    const view = playlistView(
      [A, B],
      [entry('/m/A.wav', false, 'l1'), entry(SEP, true, 's1'), entry('/m/B.wav', false, 'l2')],
    )
    expect([...view.separatorBefore]).toEqual([['b', ['s1']]])
  })

  // A separator with no playlist row of its own is keyed by where it sits, not by its index
  // in the whole playlist: a row added higher up shifted every index below it and React
  // redrew each separator line as new.
  it('keys a separator without a row id the same after a row is added above it', () => {
    const before = playlistView([A, B, C], [entry('/m/A.wav'), entry(SEP, true), entry('/m/B.wav')])
    const after = playlistView(
      [A, B, C],
      [entry('/m/C.wav'), entry('/m/A.wav'), entry(SEP, true), entry('/m/B.wav')],
    )
    expect(after.separatorBefore.get('b')).toEqual(before.separatorBefore.get('b'))
  })

  // Separators can be moved and removed now; one hidden in a collapsed run, or one after the
  // last row, could never be reached. Each stays its own line.
  it('keeps every separator as its own line, side by side and after the last row', () => {
    const view = playlistView(
      [A, B],
      [
        entry(SEP, true, 's0'),
        entry('/m/A.wav', false, 'l1'),
        entry(SEP, true, 's1'),
        entry(SEP, true, 's2'),
        entry('/m/B.wav', false, 'l2'),
        entry(SEP, true, 's3'),
      ],
    )
    expect(Object.fromEntries(view.separatorBefore)).toEqual({ a: ['s0'], b: ['s1', 's2'] })
    expect(view.trailingSeparators).toEqual(['s3'])
  })

  // A track shown once stands for its first row in the playlist: that is the row a drag
  // moves, and the entry another playlist links to when it is copied.
  it('gives each shown track the link of its first row and its collection entry', () => {
    const view = playlistView(
      [A, B],
      [
        entry('/m/A.wav', false, 'l1'),
        entry('/m/B.wav', false, 'l2'),
        entry('/m/A.wav', false, 'l3'),
      ],
    )
    expect(Object.fromEntries(view.linkOf)).toEqual({ a: 'l1', b: 'l2' })
    expect(Object.fromEntries(view.contentOf)).toEqual({ a: 'c-l1', b: 'c-l2' })
  })

  // A drag moves every row of a track the playlist holds twice: moving only the first would
  // leave the second in place, and when it then came first the list would show the track
  // there, not where it was dropped.
  it('gives each shown track every link it has in the playlist, in order', () => {
    const view = playlistView(
      [A, B],
      [
        entry('/m/A.wav', false, 'l1'),
        entry('/m/B.wav', false, 'l2'),
        entry('/m/A.wav', false, 'l3'),
      ],
    )
    expect(Object.fromEntries(view.linksOf)).toEqual({ a: ['l1', 'l3'], b: ['l2'] })
  })

  // A separator before a row Surco does not show (a missing file) still breaks the set; it
  // is drawn above the next row that is shown.
  it('carries a separator over a row the list does not show', () => {
    const view = playlistView(
      [A, B],
      [
        entry('/m/A.wav', false, 'l1'),
        entry(SEP, true, 's1'),
        entry('/m/gone.wav', false, 'l2'),
        entry('/m/B.wav', false, 'l3'),
      ],
    )
    expect(Object.fromEntries(view.separatorBefore)).toEqual({ b: ['s1'] })
  })

  it('shows a track the playlist holds twice only once, at its first place', () => {
    const view = playlistView([A, B], [entry('/m/A.wav'), entry('/m/B.wav'), entry('/m/A.wav')])
    expect(view.tracks.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('finds a track whose path the NAS spells decomposed, whichever side holds the decomposed form', () => {
    const view = playlistView(
      [track('n', '/m/Niña.wav'), track('m', '/m/Cañon.wav')],
      [entry('/m/Niña.wav'), entry('/m/Cañon.wav')],
    )
    expect(view.tracks.map((t) => t.id)).toEqual(['n', 'm'])
  })

  // No row to draw a break above, but the separators are still the playlist's: they stay as
  // trailing lines so they can be dragged or removed.
  it('shows no rows for a playlist of only separators, keeping them as trailing lines', () => {
    const view = playlistView([A], [entry(SEP, true, 's1'), entry(SEP, true, 's2')])
    expect(view.tracks).toEqual([])
    expect(view.separatorBefore.size).toBe(0)
    expect(view.trailingSeparators).toEqual(['s1', 's2'])
  })

  it('skips rows not loaded yet instead of holding a gap', () => {
    const view = playlistView([B], [entry('/m/A.wav'), entry('/m/B.wav'), entry(null)])
    expect(view.tracks.map((t) => t.id)).toEqual(['b'])
  })

  // A conversion that is not in place leaves the input where it was and repoints the
  // rekordbox row at the output, so the re-read playlist names the converted file.
  it('shows a converted track where the playlist now names its output', () => {
    const converted = { ...track('a', '/m/A.wav'), outputPath: '/out/A.aiff' } as TrackItem
    const view = playlistView([converted, B], [entry('/out/A.aiff'), entry('/m/B.wav')])
    expect(view.tracks.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('prefers the track loaded from a file over one that converted into it', () => {
    const converted = { ...track('a', '/m/A.wav'), outputPath: '/m/B.wav' } as TrackItem
    const view = playlistView([converted, B], [entry('/m/B.wav')])
    expect(view.tracks.map((t) => t.id)).toEqual(['b'])
  })
})

describe('playlistMembership', () => {
  // The background sweeps keep the open playlist's work and set the rest aside: a track the
  // playlist reaches through its converted file, or under the NAS's decomposed spelling, is
  // still that playlist's work and must not be set aside.
  it('finds a track by its input or its output, whatever the spelling', () => {
    const inPlaylist = playlistMembership([entry('/m/Niña.wav'), entry('/out/A.aiff')])
    expect(inPlaylist(track('n', '/m/Niña.wav'))).toBe(true)
    expect(inPlaylist({ ...track('a', '/m/A.wav'), outputPath: '/out/A.aiff' })).toBe(true)
    expect(inPlaylist(B)).toBe(false)
  })

  // A separator is rekordbox's blank-audio file, not a track of the set.
  it('leaves the separator file out', () => {
    expect(playlistMembership([entry(SEP, true)])(track('s', SEP))).toBe(false)
  })
})
