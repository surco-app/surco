import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem, TrackStatus } from '../types'
import { canProcessTrack, eligibleForBatch, summarizeBatch } from './batch'

function track(id: string, status: TrackStatus, meta: Partial<TrackMetadata> = {}): TrackItem {
  return {
    id,
    inputPath: `/${id}.wav`,
    fileName: id,
    listLabel: meta.title ?? id,
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
    expect(eligibleForBatch(tracks, [])).toEqual(['a', 'b'])
  })

  it('skips tracks already done or currently processing', () => {
    const tracks = [track('a', 'done'), track('b', 'processing'), track('c', 'idle')]
    expect(eligibleForBatch(tracks, [])).toEqual(['c'])
  })

  it('returns an empty list when nothing is pending', () => {
    expect(eligibleForBatch([track('a', 'done')], [])).toEqual([])
  })

  it('re-includes a done track edited since it was converted (stale)', () => {
    // After converting, the user fills a tag Discogs lacked (e.g. the year) across the
    // selection; the file no longer matches the editor, so "Convert all" must pick the
    // track up again rather than skip it as already done — otherwise the edit never lands.
    const stale = { ...track('a', 'done', { year: '2000' }), processedSignature: 'old-snapshot' }
    expect(eligibleForBatch([stale], [])).toEqual(['a'])
  })

  it('leaves out a convertible track that is missing a required field', () => {
    // The toolbar "Convert (N)" used to count and enable on status alone, so it offered a
    // batch that would only error the incomplete track. The batch now skips it (it stays
    // flagged in the list) — the same gate the single-track convert button enforces.
    const tracks = [track('a', 'idle', { artist: 'Alex' }), track('b', 'idle')]
    expect(eligibleForBatch(tracks, ['artist'])).toEqual(['a'])
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

  it('allows re-converting a done track edited since it was processed', () => {
    const stale = { ...track('a', 'done', { title: 'x', artist: 'y' }), processedSignature: 'old' }
    expect(canProcessTrack(stale, ['title', 'artist'])).toBe(true)
  })
})

describe('summarizeBatch', () => {
  // After a batch the user needs to know the outcome without scanning the list,
  // so the run is reduced to how many converted, were skipped and failed.
  it('counts converted and failed tracks', () => {
    expect(summarizeBatch(['converted', 'failed', 'converted'])).toEqual({
      converted: 2,
      skipped: 0,
      failed: 1,
    })
  })

  it('reports zero failures when every track converted', () => {
    expect(summarizeBatch(['converted', 'converted'])).toEqual({
      converted: 2,
      skipped: 0,
      failed: 0,
    })
  })

  // A skip past a file conflict is a deliberate no-op, not an error, so it must
  // not inflate the failure count the user reads as "something went wrong".
  it('counts a skipped track on its own, not as a failure', () => {
    expect(summarizeBatch(['converted', 'skipped', 'failed'])).toEqual({
      converted: 1,
      skipped: 1,
      failed: 1,
    })
  })
})
