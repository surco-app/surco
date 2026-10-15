import { describe, expect, it } from 'vitest'
import type { SourcePlaylistEntry } from '../../../shared/types'
import type { TrackItem } from '../types'
import { playlistView } from './playlistView'

function track(id: string, inputPath: string): TrackItem {
  return { id, inputPath } as TrackItem
}

function entry(path: string | null, separator = false): SourcePlaylistEntry {
  return { path, separator, meta: {} }
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
    const view = playlistView([A, B], [entry('/m/A.wav'), entry(SEP, true), entry('/m/B.wav')])
    expect([...view.separatorBefore]).toEqual(['b'])
  })

  it('collapses runs of separators and drops a trailing one: a break is a break', () => {
    const view = playlistView(
      [A, B],
      [
        entry(SEP, true),
        entry('/m/A.wav'),
        entry(SEP, true),
        entry(SEP, true),
        entry('/m/B.wav'),
        entry(SEP, true),
      ],
    )
    expect([...view.separatorBefore].sort()).toEqual(['a', 'b'])
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

  it('is empty for a playlist of only separators, with no orphan break', () => {
    const view = playlistView([A], [entry(SEP, true), entry(SEP, true)])
    expect(view.tracks).toEqual([])
    expect(view.separatorBefore.size).toBe(0)
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
