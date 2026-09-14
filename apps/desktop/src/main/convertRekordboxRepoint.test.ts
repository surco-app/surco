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

  // Reported 14/09: converting a downloaded FLAC that supersedes an MP3 already in the
  // library left rekordbox still pointing at the MP3. The repoint was reading the file
  // being converted — the FLAC, which rekordbox has never seen — so it matched nothing.
  // When the conversion replaces a known file, that file is what the collection knows.
  it('repoints from the file being replaced, not the one being converted', () => {
    expect(
      rekordboxRepointFor(
        '/downloads/Transfer - Possession.flac',
        '/m/Transfer - Possession.aiff',
        {
          replaces: '/m/02 Possession (Dececio Remix).mp3',
        },
      ),
    ).toEqual({
      from: '/m/02 Possession (Dececio Remix).mp3',
      to: '/m/Transfer - Possession.aiff',
    })
  })

  // Without a replacement the input is still the right source: a plain conversion moves the
  // very file rekordbox has indexed.
  it('still repoints from the input when nothing is being replaced', () => {
    expect(rekordboxRepointFor('/m/a.mp3', '/m/a.aiff', {})).toEqual({
      from: '/m/a.mp3',
      to: '/m/a.aiff',
    })
  })

  // A replacement that somehow lands on the very file it replaces has nothing to tell the
  // collection.
  it('says nothing when the replaced file is the output', () => {
    expect(
      rekordboxRepointFor('/downloads/a.flac', '/m/a.mp3', { replaces: '/m/a.mp3' }),
    ).toBeNull()
  })
})
