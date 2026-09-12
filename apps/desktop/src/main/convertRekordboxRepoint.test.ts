import { describe, expect, it } from 'vitest'
import { rekordboxRepointFor } from './rekordboxRepointFor'

// What a finished conversion should tell rekordbox. Kept separate from ffmpeg.ts so the
// rule can be tested on its own: the decision is about paths, not about audio.

describe('rekordboxRepointFor', () => {
  it('repoints when the conversion changed the extension', () => {
    expect(rekordboxRepointFor('/m/a/one.mp3', '/m/a/one.wav')).toEqual({
      from: '/m/a/one.mp3',
      to: '/m/a/one.wav',
    })
  })

  // This is where rekordbox parts company with Traktor. Traktor addresses a track as
  // volume + directory + file and only the file part is rewritten, so a conversion into
  // another folder is left alone there (see recordConversionPatch in ffmpeg.ts). In
  // rekordbox the path is one whole column, so the entry can follow the file anywhere —
  // and the user asked for exactly that.
  it('repoints when the conversion wrote to a different folder', () => {
    expect(rekordboxRepointFor('/m/a/one.mp3', '/out/one.wav')).toEqual({
      from: '/m/a/one.mp3',
      to: '/out/one.wav',
    })
  })

  it('repoints when the file was renamed in place', () => {
    expect(rekordboxRepointFor('/m/a/one.wav', '/m/a/Artist - One.wav')).toEqual({
      from: '/m/a/one.wav',
      to: '/m/a/Artist - One.wav',
    })
  })

  // Nothing moved, so the collection already points at the right file and a repoint would
  // make the flush open and back up the collection for no change.
  it('does not repoint when the file stayed where it was', () => {
    expect(rekordboxRepointFor('/m/a/one.wav', '/m/a/one.wav')).toBeNull()
  })
})
