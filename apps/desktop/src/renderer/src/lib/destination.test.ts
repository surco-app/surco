import { describe, expect, it } from 'vitest'
import { DESTINATIONS, fromDestination, toDestination } from './destination'

describe('toDestination', () => {
  it('reads the stored booleans back as the single radio choice', () => {
    expect(toDestination(false, false, false, false)).toBe('folder')
    expect(toDestination(true, false, false, false)).toBe('appleMusic')
    expect(toDestination(false, false, false, true)).toBe('engineDj')
    expect(toDestination(false, false, false, false, true)).toBe('beside')
  })

  // FLAC can't be added to Apple Music, so the choice falls back to the always-valid
  // output folder regardless of what the booleans say.
  it('pins to the output folder while FLAC is the format', () => {
    expect(toDestination(true, true, false, false)).toBe('folder')
  })

  // Engine DJ plays FLAC natively, so unlike Apple Music the choice survives the
  // FLAC format — pinning it to the folder would silently drop the library add.
  it('keeps Engine DJ while FLAC is the format', () => {
    expect(toDestination(false, true, false, true)).toBe('engineDj')
  })

  // Overwrite is its own axis (it rewrites the source in place), so it wins over every
  // other flag — including the FLAC pin and any library booleans left set.
  it('reports overwrite whenever the flag is set, regardless of the other booleans', () => {
    expect(toDestination(false, false, true, false)).toBe('overwrite')
    expect(toDestination(true, true, true, true, true)).toBe('overwrite')
  })

  // Beside-original writes a fresh file next to the source, so like Engine DJ it is
  // FLAC-proof — the pin to the output folder must not eat the choice.
  it('keeps beside-original while FLAC is the format', () => {
    expect(toDestination(false, true, false, false, true)).toBe('beside')
  })
})

describe('fromDestination', () => {
  it('maps each choice onto the stored booleans', () => {
    expect(fromDestination('folder')).toEqual({
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: false,
      addToEngineDj: false,
      convertBesideOriginal: false,
    })
    expect(fromDestination('appleMusic')).toEqual({
      addToAppleMusic: true,
      keepOutputCopy: false,
      overwriteOriginal: false,
      addToEngineDj: false,
      convertBesideOriginal: false,
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
      convertBesideOriginal: false,
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
      convertBesideOriginal: false,
    })
  })

  // Beside-original is the non-destructive sibling of overwrite: a fresh copy next to
  // the source, nothing added to any library, the original never touched.
  it('sets only the beside flag for beside', () => {
    expect(fromDestination('beside')).toEqual({
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: false,
      addToEngineDj: false,
      convertBesideOriginal: true,
    })
  })

  // Round-tripping any choice through both functions must return it unchanged, which is
  // what guarantees Settings and the wizard never drift apart.
  it('round-trips every choice', () => {
    for (const d of DESTINATIONS) {
      const { addToAppleMusic, overwriteOriginal, addToEngineDj, convertBesideOriginal } =
        fromDestination(d)
      expect(
        toDestination(addToAppleMusic, false, overwriteOriginal, addToEngineDj, convertBesideOriginal),
      ).toBe(d)
    }
  })
})
