import { describe, it, expect } from 'vitest'
import { renderOutputName } from './outputName'
import type { TrackMetadata } from '../../../shared/types'

function meta(patch: Partial<TrackMetadata>): TrackMetadata {
  return {
    title: '',
    artist: '',
    album: '',
    albumArtist: '',
    year: '',
    genre: '',
    grouping: '',
    comment: '',
    trackNumber: '',
    ...patch
  }
}

describe('renderOutputName', () => {
  it('fills tokens in template order so the user controls the file-name shape', () => {
    const r = renderOutputName('{artist} - {title}', meta({ artist: 'Chumi Dj', title: 'Open Your Eyes' }))
    expect(r).toBe('Chumi Dj - Open Your Eyes')
  })

  it('supports reordering and extra tokens like the track number', () => {
    const r = renderOutputName(
      '{trackNumber} - {artist} - {title}',
      meta({ trackNumber: '03', artist: 'Acer', title: 'Keep Calm' })
    )
    expect(r).toBe('03 - Acer - Keep Calm')
  })

  it('drops a dangling separator when a leading token (e.g. track no.) is empty', () => {
    const r = renderOutputName(
      '{trackNumber} - {artist} - {title}',
      meta({ artist: 'Acer', title: 'Keep Calm' })
    )
    expect(r).toBe('Acer - Keep Calm')
  })

  it('collapses a separator left by an empty token in the middle', () => {
    const r = renderOutputName('{artist} - {title}', meta({ title: 'Keep Calm' }))
    expect(r).toBe('Keep Calm')
  })

  it('renders unknown tokens as empty', () => {
    const r = renderOutputName('{artist} {bogus}', meta({ artist: 'Acer' }))
    expect(r).toBe('Acer')
  })

  it('returns empty when no token has a value, so the caller can fall back', () => {
    expect(renderOutputName('{artist} - {title}', meta({}))).toBe('')
  })
})
