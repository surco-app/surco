import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { duplicateIds } from './duplicates'

function track(id: string, meta: Partial<TrackMetadata> = {}): TrackItem {
  return {
    id,
    inputPath: `/music/${id}.wav`,
    fileName: `${id}.wav`,
    listLabel: id,
    query: '',
    status: 'idle',
    meta: { ...emptyMetadata(), ...meta },
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
})
