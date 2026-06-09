import { describe, expect, it } from 'vitest'
import { fromDestination, toDestination } from './destination'

describe('toDestination', () => {
  it('reads the stored booleans back as the single radio choice', () => {
    expect(toDestination(false, true, false)).toBe('folder')
    expect(toDestination(true, true, false)).toBe('both')
    expect(toDestination(true, false, false)).toBe('appleMusic')
  })

  // FLAC can't be added to Apple Music, so the choice falls back to the always-valid
  // output folder regardless of what the booleans say.
  it('pins to the output folder while FLAC is the format', () => {
    expect(toDestination(true, false, true)).toBe('folder')
    expect(toDestination(true, true, true)).toBe('folder')
  })
})

describe('fromDestination', () => {
  it('maps each choice onto the two stored booleans', () => {
    expect(fromDestination('folder')).toEqual({ addToAppleMusic: false, keepOutputCopy: true })
    expect(fromDestination('both')).toEqual({ addToAppleMusic: true, keepOutputCopy: true })
    expect(fromDestination('appleMusic')).toEqual({ addToAppleMusic: true, keepOutputCopy: false })
  })

  // Round-tripping any non-FLAC choice through both functions must return it unchanged,
  // which is what guarantees Settings and the wizard never drift apart.
  it('round-trips every choice', () => {
    for (const d of ['folder', 'appleMusic', 'both'] as const) {
      const { addToAppleMusic, keepOutputCopy } = fromDestination(d)
      expect(toDestination(addToAppleMusic, keepOutputCopy, false)).toBe(d)
    }
  })
})
