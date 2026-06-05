import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import { renderOutputName } from './outputName'

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
    discNumber: '',
    bpm: '',
    key: '',
    publisher: '',
    catalogNumber: '',
    remixArtist: '',
    ...patch,
  }
}

describe('renderOutputName', () => {
  it('fills tokens in template order so the user controls the file-name shape', () => {
    const r = renderOutputName(
      '{artist} - {title}',
      meta({ artist: 'Chumi Dj', title: 'Open Your Eyes' }),
    )
    expect(r).toBe('Chumi Dj - Open Your Eyes')
  })

  it('supports reordering and extra tokens like the track number', () => {
    const r = renderOutputName(
      '{trackNumber} - {artist} - {title}',
      meta({ trackNumber: '03', artist: 'Acer', title: 'Keep Calm' }),
    )
    expect(r).toBe('03 - Acer - Keep Calm')
  })

  it('drops a dangling separator when a leading token (e.g. track no.) is empty', () => {
    const r = renderOutputName(
      '{trackNumber} - {artist} - {title}',
      meta({ artist: 'Acer', title: 'Keep Calm' }),
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

  it('keeps a "/" in the template as a subfolder boundary', () => {
    const r = renderOutputName(
      '{albumArtist}/{album}/{trackNumber} {title}',
      meta({ albumArtist: 'Various', album: 'Hard House Nation', trackNumber: '01', title: 'Snap' }),
    )
    expect(r).toBe('Various/Hard House Nation/01 Snap')
  })

  it('drops a folder segment a blank field would have left empty', () => {
    const r = renderOutputName(
      '{albumArtist}/{album}/{title}',
      meta({ album: 'Hard House Nation', title: 'Snap' }),
    )
    expect(r).toBe('Hard House Nation/Snap')
  })

  it('sanitizes a slash inside a value so it never becomes an accidental folder', () => {
    expect(renderOutputName('{artist} - {title}', meta({ artist: 'AC/DC', title: 'TNT' }))).toBe(
      'AC-DC - TNT',
    )
  })
})
