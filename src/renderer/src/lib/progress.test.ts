import { describe, it, expect } from 'vitest'
import { applyProgress } from './progress'
import type { TrackItem } from '../types'

function track(id: string): TrackItem {
  return {
    id,
    inputPath: `/${id}.wav`,
    fileName: `${id}.wav`,
    query: '',
    status: 'processing',
    meta: {
      title: '', artist: '', album: '', albumArtist: '',
      year: '', genre: '', grouping: '', comment: '', trackNumber: ''
    }
  }
}

describe('applyProgress', () => {
  it('records the current export phase on the matching item so the UI can show what is happening', () => {
    const tracks = [track('a'), track('b')]
    const next = applyProgress(tracks, { id: 'b', stage: 'appleMusic' })
    expect(next.find((t) => t.id === 'b')?.stage).toBe('appleMusic')
  })

  it('leaves other items untouched so concurrent rows do not jump phases', () => {
    const tracks = [track('a'), track('b')]
    const next = applyProgress(tracks, { id: 'b', stage: 'converting' })
    expect(next.find((t) => t.id === 'a')?.stage).toBeUndefined()
  })

  it('ignores progress for an item that is no longer in the list', () => {
    const tracks = [track('a')]
    const next = applyProgress(tracks, { id: 'gone', stage: 'cover' })
    expect(next).toEqual(tracks)
  })
})
