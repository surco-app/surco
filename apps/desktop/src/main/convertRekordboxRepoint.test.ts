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
      replaced: true,
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

  // Measured 24/10: rekordbox places a sound where ffmpeg decodes it plus a per-file lead
  // (51 ms on a LAME MP3, none on an AIFF). The kick the DJ marked at 10 000 ms in the old
  // MP3 sounds in the new AIFF, whose audio starts 1.5 s later, at 11 449 ms of rekordbox's
  // clock, so the cue has to land there or every pad fires 1.4 s early.
  it('moves rekordbox cues later by the measured shift plus the lead each file has', () => {
    expect(
      rekordboxRepointFor('/downloads/a.flac', '/m/a.aiff', {
        replaces: '/m/a.mp3',
        audio: { sourceShiftMs: 0, outputShiftMs: 0, trimmedMs: 0 },
        replaceShift: { moved: 1500 },
        replaceAudio: { oldShiftMs: 51.18, newShiftMs: 0 },
      })?.audio,
    ).toEqual({ cueShiftMs: 1449 })
  })

  // Engine DJ and VirtualDJ read their positions off the file's first sample with no
  // per-codec lead, and their shift subtracts a trim: audio that starts 1.5 s later is a
  // trim of minus 1.5 s, or every pad fires 1.5 s early on the new file.
  it('moves Engine DJ positions by the measured shift, as a negative trim', () => {
    expect(
      rekordboxRepointFor('/downloads/a.flac', '/m/a.aiff', {
        replaces: '/m/a.mp3',
        audio: { sourceShiftMs: 0, outputShiftMs: 0, trimmedMs: 0 },
        replaceShift: { moved: 1500 },
        replaceAudio: { oldShiftMs: 51.18, newShiftMs: 0 },
      })?.engineShift,
    ).toEqual({ trimmedMs: -1500 })
  })

  // A shift the measure would not vouch for is a guess; moving every cue by a guess is
  // worse than leaving them where they were, as every replacement did before.
  it("keeps today's untouched cues when the shift could not be trusted", () => {
    const repoint = rekordboxRepointFor('/downloads/a.flac', '/m/a.aiff', {
      replaces: '/m/a.mp3',
      audio: { sourceShiftMs: 0, outputShiftMs: 0, trimmedMs: 0 },
      replaceShift: { unmoved: 'drift' },
      replaceAudio: { oldShiftMs: 51.18, newShiftMs: 0 },
    })
    expect(repoint?.audio).toEqual({ cueShiftMs: 0 })
    expect(repoint?.replaced).toBe(true)
    expect(repoint?.engineShift?.trimmedMs ?? 0).toBe(0)
  })

  // Engine DJ counts cues in samples at the rate it has stored. A replacement at another
  // rate whose shift was not trusted still has to rescale them, or every cue plays early or
  // late in the booth.
  it("tells Engine DJ the new file's rate even when the shift could not be trusted", () => {
    const repoint = rekordboxRepointFor('/downloads/a.flac', '/m/a.aiff', {
      replaces: '/m/a.mp3',
      audio: { sourceShiftMs: 0, outputShiftMs: 0, trimmedMs: 0 },
      replaceShift: { unmoved: 'noMatch' },
      replaceAudio: { oldShiftMs: 0, newShiftMs: 0, sampleRateHz: 48000 },
    })
    expect(repoint?.engineShift).toEqual({ trimmedMs: 0, sampleRateHz: 48000 })
    expect(repoint?.audio?.cueShiftMs).toBe(0)
  })

  // The waveform and beat grid rekordbox keeps were analysed on the old file. With the audio
  // 200 ms later the moved cues would sit off that grid, so rekordbox has to analyse the
  // replacement again even though its samples were copied rather than re-encoded.
  it('has rekordbox re-analyse a moved replacement whose samples were copied', () => {
    expect(
      rekordboxRepointFor('/downloads/a.flac', '/m/a.aiff', {
        replaces: '/m/a.mp3',
        replaceShift: { moved: 200 },
        replaceAudio: { oldShiftMs: 0, newShiftMs: 0 },
      })?.audio,
    ).toEqual({ cueShiftMs: 200 })
  })

  // Another master of the same track can run a hair faster or slower: the real case drifts
  // about 30 ms over the track. One shift puts each cue near its beat but not on it, so
  // rekordbox has to draw the new file's own grid and Surco then settles every cue onto it;
  // the shift itself is the same an exact measure of that figure would give.
  it('has rekordbox re-analyse another master and settle its moved cues on the new grid', () => {
    const options = {
      replaces: '/m/a.mp3',
      replaceAudio: { oldShiftMs: 26.12, newShiftMs: 0 },
    }
    const other = rekordboxRepointFor('/downloads/a.flac', '/m/a.aiff', {
      ...options,
      replaceShift: { moved: -264, master: 'other' },
    })
    const exact = rekordboxRepointFor('/downloads/a.flac', '/m/a.aiff', {
      ...options,
      replaceShift: { moved: -264 },
    })
    expect(other?.reanalyse).toBe(true)
    expect(other?.snapToGrid).toBe(true)
    expect(other?.audio).toEqual(exact?.audio)
    expect(other?.audio).toEqual({ cueShiftMs: -290 })
    expect(exact?.reanalyse).toBeUndefined()
    expect(exact?.snapToGrid).toBeUndefined()
  })

  // The most common replacement: the lossless master of the MP3 the DJ prepared, the same
  // audio to the sample. Nothing moved for ffmpeg, but rekordbox placed the old LAME MP3
  // 51 ms into its timeline and places the AIFF at 0, so the kick marked at 10 000 ms now
  // sounds at 9 949 ms. The cue has to follow it, and rekordbox has to analyse the new file,
  // or every pad fires 51 ms late over a grid drawn for the MP3.
  it('moves rekordbox cues by the lead of the old MP3 when the measured shift is zero', () => {
    expect(
      rekordboxRepointFor('/downloads/a.flac', '/m/a.aiff', {
        replaces: '/m/a.mp3',
        replaceShift: { moved: 0 },
        replaceAudio: { oldShiftMs: 51.18, newShiftMs: 0 },
      })?.audio,
    ).toEqual({ cueShiftMs: -51 })
  })

  // The 23/11 replacement test on a copy of a real collection: a FLAC of another recording
  // copied into an AIFF kept the old MP3's analysis, and rekordbox never analyses a repointed
  // file by itself, so it would draw the MP3's waveform and grid over the new audio. Without
  // a measure saying it is the same audio, the cues stay put and the analysis goes.
  it('has rekordbox re-analyse a copied replacement whose shift could not be trusted', () => {
    for (const unmoved of ['noMatch', 'drift', 'unreadable'] as const)
      expect(
        rekordboxRepointFor('/downloads/b.flac', '/m/b.aiff', {
          replaces: '/m/b.mp3',
          replaceShift: { unmoved },
          replaceAudio: { oldShiftMs: 26.12, newShiftMs: 0 },
        })?.audio,
      ).toEqual({ cueShiftMs: 0 })
  })

  // Same audio, and rekordbox places both files at the same point of its timeline: the cues
  // and the analysis still describe the new file, so neither moves. Re-analysing would only
  // throw away a grid the DJ may have corrected by hand.
  it('leaves rekordbox alone when a copied replacement moved nothing in its timeline', () => {
    expect(
      rekordboxRepointFor('/downloads/a.flac', '/m/a.aiff', {
        replaces: '/m/a.wav',
        replaceShift: { moved: 0 },
        replaceAudio: { oldShiftMs: 0, newShiftMs: 0 },
      })?.audio,
    ).toBeUndefined()
  })

  // Engine DJ and VirtualDJ tell a row still owed its shift from one already written by the
  // size it had before: without it a replacement on the very path it replaces looks done and
  // its cues are never moved.
  it('keeps the old size when the replacement lands on the replaced path', () => {
    expect(
      rekordboxRepointFor('/dl/a.flac', '/m/a.aiff', {
        replaces: '/m/a.aiff',
        fromBytes: 1234,
        audio: { sourceShiftMs: 0, outputShiftMs: 0, trimmedMs: 0 },
        replaceShift: { moved: 1500 },
        replaceAudio: { oldShiftMs: 0, newShiftMs: 0 },
      })?.fromBytes,
    ).toBe(1234)
  })

  // With "Add to Engine DJ" on, the destination moves the replaced row before the repoint
  // runs: only the old file's size tells the repoint that row still owes its shift.
  it('keeps the old size when the replacement lands on another path', () => {
    expect(
      rekordboxRepointFor('/dl/a.flac', '/m/a.aiff', {
        replaces: '/m/a.mp3',
        fromBytes: 1234,
        replaceShift: { moved: 1500 },
        replaceAudio: { oldShiftMs: 0, newShiftMs: 0 },
      })?.fromBytes,
    ).toBe(1234)
  })

  // Traktor and Engine need to know the old file is held before adding the new one, or a
  // replace would leave a second entry beside the one that should move.
  it('marks a repoint that replaces a library file', () => {
    expect(
      rekordboxRepointFor('/downloads/a.flac', '/m/a.aiff', { replaces: '/m/a.mp3' })?.replaced,
    ).toBe(true)
    expect(rekordboxRepointFor('/m/a.mp3', '/m/a.aiff')?.replaced).toBeUndefined()
  })
})
