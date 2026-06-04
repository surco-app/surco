import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem, TrackStatus } from '../types'
import { canProcessTrack, eligibleForBatch } from './batch'

function track(id: string, status: TrackStatus, meta: Partial<TrackMetadata> = {}): TrackItem {
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
      ...meta,
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

describe('canProcessTrack', () => {
  // The keyboard shortcut and command palette must enforce the same gate as the
  // convert button, so a track with empty required fields can't slip through and
  // fail mid-process.
  it('allows converting an idle track whose required fields are filled', () => {
    expect(
      canProcessTrack(track('a', 'idle', { title: 'Gold', artist: 'Alex' }), ['title', 'artist']),
    ).toBe(true)
  })

  it('allows retrying a previously failed track', () => {
    expect(
      canProcessTrack(track('a', 'error', { title: 'Gold', artist: 'Alex' }), ['title', 'artist']),
    ).toBe(true)
  })

  it('blocks when a required field is empty', () => {
    expect(canProcessTrack(track('a', 'idle', { title: 'Gold' }), ['title', 'artist'])).toBe(false)
  })

  it('blocks tracks already done or currently processing', () => {
    expect(canProcessTrack(track('a', 'done', { title: 'x', artist: 'y' }), ['title'])).toBe(false)
    expect(canProcessTrack(track('a', 'processing', { title: 'x' }), ['title'])).toBe(false)
  })
})
