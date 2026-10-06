import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { duplicateGroups, duplicateIds, recordingKey } from './duplicates'

function track(id: string, meta: Partial<TrackMetadata> = {}, duration?: number): TrackItem {
  return {
    id,
    inputPath: `/music/${id}.wav`,
    fileName: `${id}.wav`,
    listLabel: id,
    query: '',
    status: 'idle',
    meta: { ...emptyMetadata(), ...meta },
    duration,
  }
}

describe('duplicateIds', () => {
  // The download-folder reality this exists for: the same song arriving twice as
  // different files (a FLAC and an MP3, or two rips). Both rows are flagged so the
  // filter shows the whole group and the user can pick which to keep.
  it('flags every track sharing an artist and title', () => {
    const ids = duplicateIds([
      track('a', { title: 'Strobe', artist: 'deadmau5' }),
      track('b', { title: 'Strobe', artist: 'deadmau5' }),
      track('c', { title: 'Ghosts', artist: 'deadmau5' }),
    ])
    expect(ids).toEqual(new Set(['a', 'b']))
  })

  // Same folding as the matching pipeline: accents, case and separators must not make
  // two copies of one song read as different.
  it('matches through accents, case and punctuation like the matcher does', () => {
    const ids = duplicateIds([
      track('a', { title: 'Canción #1', artist: 'DJ Ñu & Co' }),
      track('b', { title: 'cancion 1', artist: 'dj nu and co' }),
    ])
    expect(ids).toEqual(new Set(['a', 'b']))
  })

  // Untagged imports all share empty tags; treating them as one giant duplicate group
  // would flag a whole fresh drop before its metadata even loads.
  it('never groups tracks with a missing title or artist', () => {
    const ids = duplicateIds([
      track('a', { title: 'Same', artist: '' }),
      track('b', { title: 'Same', artist: '' }),
      track('c', { title: '', artist: 'X' }),
      track('d', { title: '', artist: 'X' }),
    ])
    expect(ids.size).toBe(0)
  })

  // Measured: "Make My Body Move [ADC075]" at 6:57 and 5:07 is another edit, which the
  // old artist+title rule marked as a duplicate to remove.
  it('stops flagging two edits of different length as duplicates', () => {
    const ids = duplicateIds([
      track('a', { artist: 'ADC', title: 'Move' }, 417),
      track('b', { artist: 'ADC', title: 'Move' }, 307),
    ])
    expect(ids.size).toBe(0)
  })
})

describe('recordingKey', () => {
  it('reads "(Original Mix)" as the plain title', () => {
    expect(recordingKey('DJ Ter', 'This Rap (Original Mix)')).toBe(
      recordingKey('Dj Ter', 'This Rap'),
    )
  })

  it('ignores a featuring credit in the title and the order of the acts', () => {
    expect(recordingKey('A & B', 'Song (feat. C)')).toBe(recordingKey('B, A', 'Song'))
  })

  it('splits acts on a spelled-out and like on an ampersand', () => {
    expect(recordingKey('Hall and Oates', 'Song')).toBe(recordingKey('Oates & Hall', 'Song'))
  })

  it('keeps a named mix apart from the original', () => {
    expect(recordingKey('A', 'Song (Extended Mix)')).not.toBe(recordingKey('A', 'Song'))
  })
})

describe('duplicateGroups', () => {
  const item = (id: string, title: string, durationSec?: number) => ({
    id,
    artist: 'Transfer',
    title,
    durationSec,
  })

  it('groups copies that last the same', () => {
    expect(
      duplicateGroups([
        item('a', 'Possession', 323),
        item('b', 'Possession', 323),
        item('c', 'Possession', 325),
      ]),
    ).toEqual([expect.objectContaining({ kind: 'duplicate', ids: ['a', 'b', 'c'] })])
  })

  it('calls the same title with a different length another version, not a duplicate', () => {
    expect(
      duplicateGroups([item('a', 'Make My Body Move', 417), item('b', 'Make My Body Move', 307)]),
    ).toEqual([expect.objectContaining({ kind: 'version', ids: ['a', 'b'] })])
  })

  it('treats copies 5 s apart as one recording and 6 s apart as another version', () => {
    expect(duplicateGroups([item('a', 'X', 300), item('b', 'X', 305)])).toEqual([
      expect.objectContaining({ kind: 'duplicate', ids: ['a', 'b'] }),
    ])
    expect(duplicateGroups([item('a', 'X', 300), item('b', 'X', 306)])).toEqual([
      expect.objectContaining({ kind: 'version', ids: ['a', 'b'] }),
    ])
  })

  it('chains copies each within the limit of the next into one duplicate group', () => {
    expect(
      duplicateGroups([item('a', 'X', 320), item('b', 'X', 324), item('c', 'X', 328)]),
    ).toEqual([expect.objectContaining({ kind: 'duplicate', ids: ['a', 'b', 'c'] })])
  })

  it('never lets a copy of unknown length join a known one as a duplicate', () => {
    expect(duplicateGroups([item('a', 'X', 417), item('b', 'X', 307), item('c', 'X')])).toEqual([
      expect.objectContaining({ kind: 'version', ids: ['a', 'b', 'c'] }),
    ])
    expect(duplicateGroups([item('a', 'X', 300), item('b', 'X', 301), item('c', 'X')])).toEqual([
      expect.objectContaining({ kind: 'duplicate', ids: ['a', 'b'] }),
      expect.objectContaining({ kind: 'version', ids: ['a', 'b', 'c'] }),
    ])
  })

  it('keeps grouping copies whose length is unknown, as before', () => {
    expect(duplicateGroups([item('a', 'X'), item('b', 'X')])).toEqual([
      expect.objectContaining({ kind: 'duplicate', ids: ['a', 'b'] }),
    ])
  })
})
