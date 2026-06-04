import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { exportedPatch } from './export'

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'a',
    inputPath: '/music/old name.wav',
    fileName: 'old name.wav',
    query: '',
    status: 'processing',
    meta: {
      title: 'Till I Come',
      artist: 'ATB',
      album: '',
      albumArtist: 'ATB',
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
    ...over,
  }
}

describe('exportedPatch', () => {
  it('repoints the track at the new file after an in-place export', () => {
    // The original was rewritten and renamed, so the path we loaded from is gone.
    // A later edit/re-export/playback must read the new file, not the deleted one.
    const t = track()
    const patch = exportedPatch(t, {
      outputPath: '/music/ATB - Till I Come.wav',
      inPlace: true,
    })
    expect(patch.status).toBe('done')
    expect(patch.outputPath).toBe('/music/ATB - Till I Come.wav')
    expect(patch.inputPath).toBe('/music/ATB - Till I Come.wav')
    expect(patch.fileName).toBe('ATB - Till I Come')
    expect(patch.processedSignature).toBe(trackSignature(t))
  })

  it('leaves the source path alone after a real conversion to a new file', () => {
    // WAV→MP3 kept the original untouched and wrote a copy elsewhere, so the track
    // must keep pointing at its source — only outputPath records the new copy.
    const t = track()
    const patch = exportedPatch(t, {
      outputPath: '/out/ATB - Till I Come.mp3',
      inPlace: false,
    })
    expect(patch.status).toBe('done')
    expect(patch.outputPath).toBe('/out/ATB - Till I Come.mp3')
    expect(patch.inputPath).toBeUndefined()
    expect(patch.fileName).toBeUndefined()
  })
})
