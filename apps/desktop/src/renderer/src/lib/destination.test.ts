import { describe, expect, it } from 'vitest'
import { fromDestination, toDestination } from './destination'

describe('toDestination', () => {
  it('reads the stored booleans back as the single radio choice', () => {
    expect(toDestination(false, true, false, false)).toBe('folder')
    expect(toDestination(true, true, false, false)).toBe('both')
    expect(toDestination(true, false, false, false)).toBe('appleMusic')
  })

  // FLAC can't be added to Apple Music, so the choice falls back to the always-valid
  // output folder regardless of what the booleans say.
  it('pins to the output folder while FLAC is the format', () => {
    expect(toDestination(true, false, true, false)).toBe('folder')
    expect(toDestination(true, true, true, false)).toBe('folder')
  })

  // Overwrite is its own axis (it rewrites the source in place), so it wins over every
  // other flag — including the FLAC pin and any Apple Music booleans left set.
  it('reports overwrite whenever the flag is set, regardless of the other booleans', () => {
    expect(toDestination(false, true, false, true)).toBe('overwrite')
    expect(toDestination(true, true, true, true)).toBe('overwrite')
  })
})

describe('fromDestination', () => {
  it('maps each choice onto the stored booleans', () => {
    expect(fromDestination('folder')).toEqual({
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: false,
    })
    expect(fromDestination('both')).toEqual({
      addToAppleMusic: true,
      keepOutputCopy: true,
      overwriteOriginal: false,
    })
    expect(fromDestination('appleMusic')).toEqual({
      addToAppleMusic: true,
      keepOutputCopy: false,
      overwriteOriginal: false,
    })
  })

  // Overwrite leaves nothing in the output folder and adds nothing to Apple Music: the
  // source file itself is rewritten, so both library booleans are cleared.
  it('clears the library booleans and sets the overwrite flag for overwrite', () => {
    expect(fromDestination('overwrite')).toEqual({
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: true,
    })
  })

  // Round-tripping any choice through both functions must return it unchanged, which is
  // what guarantees Settings and the wizard never drift apart.
  it('round-trips every choice', () => {
    for (const d of ['folder', 'appleMusic', 'both', 'overwrite'] as const) {
      const { addToAppleMusic, keepOutputCopy, overwriteOriginal } = fromDestination(d)
      expect(toDestination(addToAppleMusic, keepOutputCopy, false, overwriteOriginal)).toBe(d)
    }
  })
})
