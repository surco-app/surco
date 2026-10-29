import { describe, expect, it } from 'vitest'
import { DESTINATIONS, fromDestination, toDestination } from './destination'

describe('toDestination', () => {
  it('reads the stored booleans back as the single radio choice', () => {
    expect(toDestination(false, false, false)).toBe('folder')
    expect(toDestination(true, false, false)).toBe('appleMusic')
    expect(toDestination(false, false, false, true)).toBe('beside')
  })

  // FLAC can't be added to Apple Music, so the choice falls back to the always-valid
  // output folder regardless of what the booleans say.
  it('pins to the output folder while FLAC is the format', () => {
    expect(toDestination(true, true, false)).toBe('folder')
  })

  // Overwrite is its own axis (it rewrites the source in place), so it wins over every
  // other flag — including the FLAC pin and any library booleans left set.
  it('reports overwrite whenever the flag is set, regardless of the other booleans', () => {
    expect(toDestination(false, false, true)).toBe('overwrite')
    expect(toDestination(true, true, true, true)).toBe('overwrite')
  })

  // Beside-original writes a fresh file next to the source, so it is FLAC-proof — the
  // pin to the output folder must not eat the choice.
  it('keeps beside-original while FLAC is the format', () => {
    expect(toDestination(false, true, false, true)).toBe('beside')
  })
})

describe('fromDestination', () => {
  it('maps each choice onto the stored booleans', () => {
    expect(fromDestination('folder')).toEqual({
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: false,
      convertBesideOriginal: false,
    })
    expect(fromDestination('appleMusic')).toEqual({
      addToAppleMusic: true,
      keepOutputCopy: false,
      overwriteOriginal: false,
      convertBesideOriginal: false,
    })
  })

  it('picking a destination never turns Engine off', () => {
    for (const d of DESTINATIONS) expect(fromDestination(d)).not.toHaveProperty('addToEngineDj')
  })

  // Overwrite leaves nothing in the output folder and adds nothing to any library: the
  // source file itself is rewritten, so the library booleans are cleared.
  it('clears the library booleans and sets the overwrite flag for overwrite', () => {
    expect(fromDestination('overwrite')).toEqual({
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: true,
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
      convertBesideOriginal: true,
    })
  })

  // Round-tripping any choice through both functions must return it unchanged, which is
  // what guarantees Settings and the wizard never drift apart.
  it('round-trips every choice', () => {
    for (const d of DESTINATIONS) {
      const { addToAppleMusic, overwriteOriginal, convertBesideOriginal } = fromDestination(d)
      expect(toDestination(addToAppleMusic, false, overwriteOriginal, convertBesideOriginal)).toBe(
        d,
      )
    }
  })
})
