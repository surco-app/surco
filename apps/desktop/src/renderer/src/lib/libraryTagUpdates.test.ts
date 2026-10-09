import { describe, expect, it } from 'vitest'
import type { ReviewOutcome } from '../../../shared/types'
import { libraryUpdatesOf, tagUpdatesOf } from './libraryTagUpdates'

const outcome = (over: Partial<ReviewOutcome>): ReviewOutcome => ({
  id: 'C',
  path: '/m/c.mp3',
  fixes: [
    { id: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    { id: 'C', field: 'genre', from: 'electronic', to: 'Electronic' },
  ],
  music: ['set', 'set'],
  file: 'written',
  written: ['artist'],
  ...over,
})

describe('tagUpdatesOf', () => {
  // The libraries read the file, so only what reached the file follows, like an Update.
  it('carries only the fields written to the file', () => {
    expect(tagUpdatesOf([outcome({})], 'apply')).toEqual([
      { path: '/m/c.mp3', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } },
    ])
  })

  it('swaps the direction to undo', () => {
    expect(tagUpdatesOf([outcome({})], 'undo')).toEqual([
      { path: '/m/c.mp3', fields: { artist: { from: 'DJ Lara', to: 'Dj Lara' } } },
    ])
  })

  it('sends nothing for a track whose file was not written', () => {
    expect(tagUpdatesOf([outcome({ file: 'unchanged', written: [] })], 'apply')).toEqual([])
  })
})

// The user's rule: a track corrected in Music is corrected in rekordbox, Engine DJ and
// Traktor too, whether or not its file could be written (a WAV Music keeps its own copy
// of, a file whose value differed). Each library still only changes a track that holds
// the old value.
describe('libraryUpdatesOf', () => {
  it('carries what Music took even when the file was left as it was', () => {
    expect(
      libraryUpdatesOf(
        [outcome({ file: 'unchanged', written: [], music: ['set', 'mismatch'] })],
        'apply',
      ),
    ).toEqual([{ path: '/m/c.mp3', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } }])
  })

  it('sends nothing Music refused', () => {
    expect(
      libraryUpdatesOf(
        [outcome({ file: 'skipped', written: [], music: ['mismatch', 'failed'] })],
        'apply',
      ),
    ).toEqual([])
  })

  it('swaps the direction to undo', () => {
    expect(libraryUpdatesOf([outcome({ file: 'unchanged', written: [] })], 'undo')).toEqual([
      {
        path: '/m/c.mp3',
        fields: {
          artist: { from: 'DJ Lara', to: 'Dj Lara' },
          genre: { from: 'Electronic', to: 'electronic' },
        },
      },
    ])
  })

  // The list review writes the file first and Music only for a track Music holds: a list
  // track outside Music must still reach the libraries, or its fix stops at the file.
  it('carries what the file took for a track Music does not hold', () => {
    expect(
      libraryUpdatesOf(
        [outcome({ written: ['artist', 'genre'], music: ['none', 'none'] })],
        'apply',
      ),
    ).toEqual([
      {
        path: '/m/c.mp3',
        fields: {
          artist: { from: 'Dj Lara', to: 'DJ Lara' },
          genre: { from: 'electronic', to: 'Electronic' },
        },
      },
    ])
  })

  it('sends nothing for a track Music has no file for', () => {
    expect(libraryUpdatesOf([outcome({ path: undefined, file: 'missing' })], 'apply')).toEqual([])
  })
})
