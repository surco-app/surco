import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { applyProgress, topBarProgress } from './progress'

function track(id: string): TrackItem {
  return {
    id,
    inputPath: `/${id}.wav`,
    fileName: `${id}.wav`,
    listLabel: `${id}.wav`,
    query: '',
    status: 'processing',
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

describe('topBarProgress', () => {
  it('is null when nothing is running so the top bar stays hidden', () => {
    expect(topBarProgress([null, null, { done: 0, total: 0 }], false)).toBeNull()
  })

  it('reports the fraction of a single running sweep', () => {
    expect(topBarProgress([{ done: 3, total: 12 }], false)).toEqual({ fraction: 0.25 })
  })

  it('pools done/total across concurrent sweeps so the bar reflects the total work left', () => {
    // 2/4 analyzing + 8/8 matching = 10 of 12 done overall.
    const progress = topBarProgress(
      [
        { done: 2, total: 4 },
        { done: 8, total: 8 },
      ],
      false,
    )
    expect(progress).toEqual({ fraction: 10 / 12 })
  })

  it('ignores idle sweeps whose total is still zero', () => {
    expect(
      topBarProgress(
        [
          { done: 0, total: 0 },
          { done: 1, total: 5 },
        ],
        false,
      ),
    ).toEqual({
      fraction: 0.2,
    })
  })

  it('shows an indeterminate bar while importing, when no determinate sweep is running', () => {
    // Loading tags has no fixed total, so fraction is null (the bar animates instead).
    expect(topBarProgress([null], true)).toEqual({ fraction: null })
  })

  it('prefers the determinate fraction over the import indeterminate state', () => {
    expect(topBarProgress([{ done: 1, total: 2 }], true)).toEqual({ fraction: 0.5 })
  })
})

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
