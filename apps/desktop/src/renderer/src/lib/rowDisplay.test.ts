import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { rowDisplay } from './rowDisplay'

const preview = {
  title: 'Night Train (Extended Mix)',
  artist: 'Rebel Vision',
  durationSec: 256,
  coverUrl: 'surco://media/cover',
  cues: [],
}

function track(over: Partial<TrackItem>): TrackItem {
  return {
    id: 'a',
    inputPath: '/m/Night Train.aiff',
    fileName: 'Night Train',
    listLabel: 'Night Train',
    query: '',
    status: 'idle',
    meta: { title: 'Night Train', artist: '' } as TrackMetadata,
    ...over,
  }
}

describe('rowDisplay', () => {
  it('shows what rekordbox knows while the file is still being read', () => {
    expect(rowDisplay(track({ loadingMeta: true, sourcePreview: preview }))).toEqual({
      title: 'Night Train (Extended Mix)',
      artist: 'Rebel Vision',
      duration: 256,
      cover: 'surco://media/cover',
      waiting: false,
    })
  })

  it('shows the file once it is read, because Surco edits the file and not rekordbox', () => {
    const read = rowDisplay(
      track({
        loadingMeta: false,
        sourcePreview: preview,
        listLabel: 'Night Train (Original Mix)',
        meta: { title: 'Night Train (Original Mix)', artist: 'Rebel' } as TrackMetadata,
        duration: 255.6,
        embeddedCover: 'surco://cover/x.jpg',
      }),
    )
    expect(read).toEqual({
      title: 'Night Train (Original Mix)',
      artist: 'Rebel',
      duration: 255.6,
      cover: 'surco://cover/x.jpg',
      waiting: false,
    })
  })

  it('keeps rekordbox cover and length when the file gives none', () => {
    const read = rowDisplay(track({ loadingMeta: false, sourcePreview: preview }))
    expect(read.cover).toBe('surco://media/cover')
    expect(read.duration).toBe(256)
  })

  it('waits with a skeleton only for a row that has nothing to show yet', () => {
    expect(rowDisplay(track({ loadingMeta: true })).waiting).toBe(true)
    expect(
      rowDisplay(track({ loadingMeta: true, sourcePreview: { ...preview, durationSec: 0 } }))
        .duration,
    ).toBeUndefined()
  })
})
