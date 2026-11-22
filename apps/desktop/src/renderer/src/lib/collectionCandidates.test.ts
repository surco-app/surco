import { describe, expect, it } from 'vitest'
import { collectionCandidates } from './collectionCandidates'

describe('collectionCandidates', () => {
  it('drops collection rows without a path', () => {
    const result = collectionCandidates([
      { contentId: '1', path: '/a.mp3', title: 'A', artist: 'X', durationSec: 200 },
      { contentId: '2', path: null, title: 'B', artist: 'Y', durationSec: 100 },
    ])
    expect(result).toEqual([{ title: 'A', artist: 'X', durationSec: 200, path: '/a.mp3' }])
  })

  it('maps a missing length to undefined', () => {
    const [row] = collectionCandidates([
      { contentId: '1', path: '/a.mp3', title: 'A', artist: 'X' },
    ])
    expect(row.durationSec).toBeUndefined()
  })
})
