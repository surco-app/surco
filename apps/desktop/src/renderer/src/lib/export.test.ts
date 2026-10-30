import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { exportedPatch } from './export'
import { supersededFile } from './supersededFile'

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'a',
    inputPath: '/music/old name.wav',
    fileName: 'old name.wav',
    listLabel: 'Till I Come',
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
  it('remembers the path an in-place export moved the file away from', () => {
    const patch = exportedPatch(track({ movedFrom: ['/music/older.wav'] }), {
      outputPath: '/music/ATB - Till I Come.aiff',
      inPlace: true,
    })
    expect(patch.movedFrom).toEqual(['/music/older.wav', '/music/old name.wav'])
  })

  it('remembers no move when the in-place export kept the path', () => {
    const patch = exportedPatch(track(), { outputPath: '/music/old name.wav', inPlace: true })
    expect(patch.movedFrom).toBeUndefined()
  })

  // Handed back on the next export, it is how main tells the track's own previous output
  // from a file another track has written over that path since.
  it('records the identity of the file the export wrote', () => {
    const patch = exportedPatch(track(), {
      outputPath: '/out/a.aiff',
      inPlace: false,
      outputIdentity: 'dev:7',
    })
    expect(patch.outputIdentity).toBe('dev:7')
  })

  // The applied config is what a later dial change is compared against (see
  // isNormalizeStale) — without it, re-normalizing never earns the Update button.
  it('records the normalization the export applied', () => {
    const normalize = { mode: 'loudness' as const, targetLufs: -9, truePeakDb: -1, peakDb: -1 }
    const patch = exportedPatch(track(), { outputPath: '/out/a.aiff', inPlace: false }, normalize)
    expect(patch.processedNormalize).toEqual(normalize)
  })

  // Same contract for click repair (isDeclickStale reads it back).
  it('records the click repair the export applied', () => {
    const patch = exportedPatch(track(), { outputPath: '/out/a.aiff', inPlace: false }, undefined, {
      mode: 'standard',
      noise: 'off',
    })
    expect(patch.processedDeclick).toEqual({ mode: 'standard', noise: 'off' })
  })

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

  // The in-place export baked the trim into the rewritten source, so the new
  // inputPath already starts at the cut. Leaving the trim staged would re-cut the
  // already-cut file on the next Update — swallowing the start of the track. The
  // patch clears it so the track reads as freshly trimmed at its real length.
  it('clears the staged trim after an in-place export baked it into the file', () => {
    const t = track({ trim: { startSec: 3, endSec: 200 } })
    const patch = exportedPatch(t, {
      outputPath: '/music/ATB - Till I Come.wav',
      inPlace: true,
    })
    expect('trim' in patch).toBe(true)
    expect(patch.trim).toBeUndefined()
    // The processed snapshot must describe the post-cut state, not the state that
    // still carried the trim — otherwise the track reads stale the instant it lands.
    expect(patch.processedSignature).toBe(trackSignature({ ...t, trim: undefined }))
    expect(patch.diskSignature).toBe(trackSignature({ ...t, trim: undefined }))
  })

  // No trim staged: an in-place export must not invent a trim clear.
  it('leaves the trim untouched after an in-place export with no trim', () => {
    const t = track({})
    const patch = exportedPatch(t, {
      outputPath: '/music/ATB - Till I Come.wav',
      inPlace: true,
    })
    expect(patch.trim).toBeUndefined()
  })

  // A real conversion left the source untouched, so the staged trim still describes
  // a valid cut of the (still-original) inputPath — clearing it would lose the edit.
  it('keeps the staged trim after a real conversion to a new file', () => {
    const t = track({ trim: { startSec: 3 } })
    const patch = exportedPatch(t, {
      outputPath: '/out/ATB - Till I Come.mp3',
      inPlace: false,
    })
    expect(patch.trim).toBeUndefined()
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

  // Converting writes the staged state into a file, so nothing is at risk anymore:
  // re-stamping the disk snapshot is what makes the session store stop persisting
  // this track and lets the reopen offer expire freely again.
  // Once written, the clean-up is just the file's spelling: no mark, no count, nothing to undo.
  it('drops the load-time clean-up record once the values are written', () => {
    const cleaned = { title: { raw: 'Till  I Come', before: 'Till  I Come', to: 'Till I Come' } }
    for (const result of [
      { outputPath: '/out/a.aiff', inPlace: false },
      { outputPath: '', inPlace: false, addedToMusicOnly: true },
    ])
      expect(exportedPatch(track({ cleaned }), result)).toHaveProperty('cleaned', undefined)
  })

  it('marks the exported state as safely on disk', () => {
    const t = track()
    const patch = exportedPatch(t, { outputPath: '/out/a.mp3', inPlace: false })
    expect(patch.diskSignature).toBe(trackSignature(t))
    const musicOnly = exportedPatch(t, { outputPath: '', inPlace: false, addedToMusicOnly: true })
    expect(musicOnly.diskSignature).toBe(trackSignature(t))
  })

  it('records no file and marks the track added when it went to Apple Music only', () => {
    // "Apple Music only" removed the output-folder copy, so there is nothing to reveal:
    // the track must carry no outputPath and show as already in the library.
    const t = track()
    const patch = exportedPatch(t, {
      outputPath: '',
      inPlace: false,
      addedToMusicOnly: true,
    })
    expect(patch.status).toBe('done')
    expect(patch.outputPath).toBeUndefined()
    expect(patch.musicStatus).toBe('added')
    expect(patch.processedSignature).toBe(trackSignature(t))
  })

  it('stores the Apple Music persistent ID and marks the track added when the conversion put it in the library, so the footer offers update/reveal instead of an add that would duplicate it', () => {
    const t = track()
    const patch = exportedPatch(t, {
      outputPath: '/out/ATB - Till I Come.mp3',
      inPlace: false,
      musicPersistentId: 'ABCD1234',
    })
    expect(patch.musicPersistentId).toBe('ABCD1234')
    expect(patch.musicStatus).toBe('added')
  })

  it('keeps the persistent ID it already had when the conversion did not touch Apple Music (the setting is off), so a manual update later still finds the library copy', () => {
    const t = track({ musicPersistentId: 'ABCD1234' })
    const patch = exportedPatch(t, {
      outputPath: '/out/ATB - Till I Come.mp3',
      inPlace: false,
    })
    expect(patch.musicPersistentId).toBeUndefined()
    expect(patch.musicStatus).toBeUndefined()
  })

  it('stores the persistent ID in Apple Music only mode too', () => {
    const t = track()
    const patch = exportedPatch(t, {
      outputPath: '',
      inPlace: false,
      addedToMusicOnly: true,
      musicPersistentId: 'ABCD1234',
    })
    expect(patch.musicPersistentId).toBe('ABCD1234')
  })

  // A conversion that replaced the Music entry in another format leaves the old file
  // referenced by nothing, so it is offered for trash. It must not land in replacesPath:
  // the next job sends that field, and a plain re-sync would replace the entry again and
  // repoint rekordbox from a file no library indexes any more.
  it('records the file a format change superseded apart from what the next job replaces', () => {
    const t = track({ supersededTrashed: true })
    const patch = exportedPatch(t, {
      outputPath: '/out/ATB - Till I Come.wav',
      inPlace: false,
      supersededPath: '/lib/Till I Come.aiff',
    })
    expect(patch.replacesPath).toBeUndefined()
    expect(supersededFile({ ...t, ...patch })).toBe('/lib/Till I Come.aiff')
  })

  it('records the superseded file in Apple Music only mode too', () => {
    const t = track()
    const patch = exportedPatch(t, {
      outputPath: '',
      inPlace: false,
      addedToMusicOnly: true,
      supersededPath: '/lib/Till I Come.aiff',
    })
    expect(patch.replacesPath).toBeUndefined()
    expect(supersededFile({ ...t, ...patch })).toBe('/lib/Till I Come.aiff')
  })

  // Opened from the Music tab, the row IS the AIFF Music played. Left on it, trashing the
  // AIFF leaves a row that plays nothing and the next conversion starts from a dead file.
  it('moves the row to the file Music landed when the superseded file was its own source', () => {
    const t = track({ inputPath: '/lib/Till I Come.aiff', fileName: 'Till I Come' })
    const patch = exportedPatch(t, {
      outputPath: '',
      inPlace: false,
      addedToMusicOnly: true,
      supersededPath: '/lib/Till I Come.aiff',
      musicLandedPath: '/Music/Media/ATB/Till I Come.wav',
    })
    expect(patch.inputPath).toBe('/Music/Media/ATB/Till I Come.wav')
    expect(patch.fileName).toBe('Till I Come')
    expect(patch.movedFrom).toEqual(['/lib/Till I Come.aiff'])
    expect(supersededFile({ ...t, ...patch, status: 'done' })).toBe('/lib/Till I Come.aiff')
  })
})
