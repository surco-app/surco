import { describe, expect, it } from 'vitest'
import type { TrackItem, TrackStatus } from '../types'
import { eligibleForBatch } from './batch'

function track(id: string, status: TrackStatus): TrackItem {
  return {
    id,
    inputPath: `/${id}.wav`,
    fileName: id,
    query: '',
    status,
    meta: {
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
    },
  }
}

describe('eligibleForBatch', () => {
  it('includes idle and previously failed tracks', () => {
    const tracks = [track('a', 'idle'), track('b', 'error')]
    expect(eligibleForBatch(tracks)).toEqual(['a', 'b'])
  })

  it('skips tracks already done or currently processing', () => {
    const tracks = [track('a', 'done'), track('b', 'processing'), track('c', 'idle')]
    expect(eligibleForBatch(tracks)).toEqual(['c'])
  })

  it('returns an empty list when nothing is pending', () => {
    expect(eligibleForBatch([track('a', 'done')])).toEqual([])
  })
})
