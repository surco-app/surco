import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import { rekordboxMetaFrom } from './rekordboxMetadata'
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

  // Fixing a title in place leaves the path alone but changes what rekordbox should show,
  // and rekordbox shows its own collection, never the file's tags.
  it('still reports a file that stayed put when it carries tags for the entry', () => {
    const meta = rekordboxMetaFrom({ ...emptyMetadata(), title: 'One' })
    expect(rekordboxRepointFor('/m/a/one.wav', '/m/a/one.wav', { meta })).toEqual({
      from: '/m/a/one.wav',
      to: '/m/a/one.wav',
      meta,
    })
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

  // Reported 23/10 by a DJ and measured twice in the user's rekordbox 24/10: rekordbox keeps
  // the cues in milliseconds of its own timeline, and on a LAME MP3 it places every sound
  // 51 ms later than on an AIFF, 26 ms on an ffmpeg MP3. After the conversion every hot cue
  // sat that far AFTER the kick it was set on (51 ms MP3→AIFF, 26 ms MP3→MP3), and a first
  // fix that moved them the other way doubled it to 102 and 51.
  it('moves the cues earlier by how much later rekordbox placed the old file', () => {
    expect(
      rekordboxRepointFor('/m/a.mp3', '/m/a.aiff', {
        audio: { sourceShiftMs: 51.18, outputShiftMs: 0, trimmedMs: 0 },
      }),
    ).toEqual({ from: '/m/a.mp3', to: '/m/a.aiff', audio: { cueShiftMs: -51 } })
  })

  // A trimmed start pulls every beat earlier by exactly what was cut.
  it('moves the cues back by the silence trimmed from the start', () => {
    expect(
      rekordboxRepointFor('/m/a.mp3', '/m/a.mp3', {
        audio: { sourceShiftMs: 51.18, outputShiftMs: 26.12, trimmedMs: 500 },
      })?.audio,
    ).toEqual({ cueShiftMs: -525 })
  })

  // Re-encoding in place keeps the path, but the audio under the cues moved and rekordbox's
  // analysis describes the old file, so the entry still has to hear about it.
  it('reports a file re-encoded in place even without tags for the entry', () => {
    expect(
      rekordboxRepointFor('/m/a.mp3', '/m/a.mp3', {
        audio: { sourceShiftMs: 51.18, outputShiftMs: 26.12, trimmedMs: 0 },
      }),
    ).toEqual({ from: '/m/a.mp3', to: '/m/a.mp3', audio: { cueShiftMs: -25 } })
  })

  // The cues of a replaced file were set on other audio — another master, another encode —
  // so nothing says how far they are from this one. Better left where they are than moved
  // by a figure that belongs to a different file.
  it('leaves the cues alone when the conversion replaces a different file', () => {
    expect(
      rekordboxRepointFor('/downloads/a.flac', '/m/a.aiff', {
        replaces: '/m/a.mp3',
        audio: { sourceShiftMs: 0, outputShiftMs: 0, trimmedMs: 500 },
      })?.audio,
    ).toEqual({ cueShiftMs: 0 })
  })
})
