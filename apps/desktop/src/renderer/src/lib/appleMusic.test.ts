import { describe, expect, it } from 'vitest'
import type { TrackItem, TrackStatus } from '../types'
import { canAddToAppleMusic } from './appleMusic'

function track(overrides: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'a',
    inputPath: '/a.wav',
    fileName: 'a',
    query: '',
    status: 'done',
    outputPath: '/out/a.aiff',
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
    ...overrides,
  }
}

describe('canAddToAppleMusic', () => {
  it('allows a converted track on macOS with a non-FLAC output', () => {
    expect(canAddToAppleMusic(track(), 'darwin', 'aiff')).toBe(true)
  })

  it('refuses off macOS because the Music AppleScript bridge only exists there', () => {
    expect(canAddToAppleMusic(track(), 'win32', 'aiff')).toBe(false)
    expect(canAddToAppleMusic(track(), 'linux', 'aiff')).toBe(false)
  })

  it('refuses FLAC because Apple Music cannot ingest it', () => {
    expect(canAddToAppleMusic(track(), 'darwin', 'flac')).toBe(false)
  })

  it('requires the track to be converted first — there is no file to add otherwise', () => {
    for (const status of ['idle', 'processing', 'error'] as TrackStatus[]) {
      expect(canAddToAppleMusic(track({ status }), 'darwin', 'aiff')).toBe(false)
    }
  })

  it('refuses a done track with no output path, since the add needs a real file', () => {
    expect(canAddToAppleMusic(track({ outputPath: undefined }), 'darwin', 'aiff')).toBe(false)
  })

  it('blocks while adding and once added so the same track is never imported twice', () => {
    expect(canAddToAppleMusic(track({ musicStatus: 'adding' }), 'darwin', 'aiff')).toBe(false)
    expect(canAddToAppleMusic(track({ musicStatus: 'added' }), 'darwin', 'aiff')).toBe(false)
  })

  it('allows a retry after a failed add', () => {
    expect(canAddToAppleMusic(track({ musicStatus: 'error' }), 'darwin', 'aiff')).toBe(true)
  })
})
