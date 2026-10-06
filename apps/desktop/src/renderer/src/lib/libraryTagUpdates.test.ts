import { describe, expect, it } from 'vitest'
import type { MusicFixOutcome } from '../../../shared/types'
import { tagUpdatesOf } from './libraryTagUpdates'

const outcome = (over: Partial<MusicFixOutcome>): MusicFixOutcome => ({
  persistentId: 'C',
  path: '/m/c.mp3',
  fixes: [
    { persistentId: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    { persistentId: 'C', field: 'genre', from: 'electronic', to: 'Electronic' },
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
