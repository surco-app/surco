import { describe, expect, it } from 'vitest'
import { DESTINATIONS, fromDestination, toDestination } from './destination'

describe('toDestination', () => {
  it('reads the stored booleans back as the single radio choice', () => {
    expect(toDestination(false, true, false, false, false)).toBe('folder')
    expect(toDestination(true, true, false, false, false)).toBe('both')
    expect(toDestination(true, false, false, false, false)).toBe('appleMusic')
    expect(toDestination(false, true, false, false, true)).toBe('engineDj')
  })

  // FLAC can't be added to Apple Music, so the choice falls back to the always-valid
  // output folder regardless of what the booleans say.
  it('pins to the output folder while FLAC is the format', () => {
    expect(toDestination(true, false, true, false, false)).toBe('folder')
    expect(toDestination(true, true, true, false, false)).toBe('folder')
  })

  // Engine DJ plays FLAC natively, so unlike Apple Music the choice survives the
  // FLAC format — pinning it to the folder would silently drop the library add.
  it('keeps Engine DJ while FLAC is the format', () => {
    expect(toDestination(false, true, true, false, true)).toBe('engineDj')
  })

  // Overwrite is its own axis (it rewrites the source in place), so it wins over every
  // other flag — including the FLAC pin and any library booleans left set.
  it('reports overwrite whenever the flag is set, regardless of the other booleans', () => {
    expect(toDestination(false, true, false, true, false)).toBe('overwrite')
    expect(toDestination(true, true, true, true, true)).toBe('overwrite')
  })
})

describe('fromDestination', () => {
  it('maps each choice onto the stored booleans', () => {
    expect(fromDestination('folder')).toEqual({
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: false,
      addToEngineDj: false,
    })
    expect(fromDestination('both')).toEqual({
      addToAppleMusic: true,
      keepOutputCopy: true,
      overwriteOriginal: false,
      addToEngineDj: false,
    })
    expect(fromDestination('appleMusic')).toEqual({
      addToAppleMusic: true,
      keepOutputCopy: false,
      overwriteOriginal: false,
      addToEngineDj: false,
    })
  })

  // Engine DJ references the converted file where it lives instead of importing a copy
  // (the Apple Music model), so the output-folder copy must always be kept.
  it('keeps the output copy and clears the other destinations for engineDj', () => {
    expect(fromDestination('engineDj')).toEqual({
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: false,
      addToEngineDj: true,
    })
  })

  // Overwrite leaves nothing in the output folder and adds nothing to any library: the
  // source file itself is rewritten, so the library booleans are cleared.
  it('clears the library booleans and sets the overwrite flag for overwrite', () => {
    expect(fromDestination('overwrite')).toEqual({
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: true,
      addToEngineDj: false,
    })
  })

  // Round-tripping any choice through both functions must return it unchanged, which is
  // what guarantees Settings and the wizard never drift apart.
  it('round-trips every choice', () => {
    for (const d of DESTINATIONS) {
      const { addToAppleMusic, keepOutputCopy, overwriteOriginal, addToEngineDj } =
        fromDestination(d)
      expect(
        toDestination(addToAppleMusic, keepOutputCopy, false, overwriteOriginal, addToEngineDj),
      ).toBe(d)
    }
  })
})
