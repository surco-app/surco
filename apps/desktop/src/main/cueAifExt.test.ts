import { describe, expect, it } from 'vitest'
import { keepsCuesInId3 } from './tags'

// AIFF rips use BOTH .aif and .aiff — shared/format.ts states that rule outright, and
// expand.ts's AUDIO_EXTS imports both. Every sibling predicate in the codebase matches
// the pair with /\.aiff?$/i (ffmpeg.ts, playback.ts, shared/format.ts, shared/media.ts).
// tags.ts's ID3_SOURCED is the one literal set, and it lists only '.aiff'.
//
// keepsCuesInId3 is asked about the SOURCE extension when deciding how to carry Traktor's
// cues across a conversion (ffmpeg.ts:1531). Answering false for a .aif source routes it
// to shiftFlacCues, which looks for a TRAKTOR4 Vorbis comment, finds none in an AIFF, and
// returns — so every hot cue and the beatgrid are dropped. That is verbatim the bug the
// comment above the call says was just fixed for WAV.
describe('keepsCuesInId3 treats both AIFF spellings alike', () => {
  it('recognises .aif, not just .aiff', () => {
    expect(keepsCuesInId3('.aiff')).toBe(true)
    // A DJ converting a .aif rip to FLAC silently loses every cue point and the grid.
    expect(keepsCuesInId3('.aif')).toBe(true)
  })

  it('is case-insensitive for .aif like it is for the rest', () => {
    expect(keepsCuesInId3('.AIFF')).toBe(true)
    expect(keepsCuesInId3('.AIF')).toBe(true)
  })
})
