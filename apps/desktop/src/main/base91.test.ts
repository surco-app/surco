import { describe, expect, it } from 'vitest'
import { decodeBase91, encodeBase91 } from './base91'

describe('base91', () => {
  // The reference vectors from Joachim Henke's basE91, the scheme Traktor armors
  // its FLAC cue blob with — 91 printable ASCII symbols, everything from '!' to
  // '~' except the quote, backslash and apostrophe a text field can't carry raw.
  it('matches the reference encoding', () => {
    expect(encodeBase91(Buffer.from('test'))).toBe('fPNKd')
    expect(encodeBase91(Buffer.from('Hello World!'))).toBe('>OwJh>Io0Tv!8PE')
  })

  it('decodes back to the original bytes', () => {
    expect(decodeBase91('fPNKd').toString()).toBe('test')
    expect(decodeBase91('>OwJh>Io0Tv!8PE').toString()).toBe('Hello World!')
  })

  // The blob is 54 KB of binary with every byte value in it, so what matters is
  // that arbitrary bytes survive the round trip untouched — a decoder that only
  // works on text would corrupt the cue doubles.
  it('round-trips arbitrary binary', () => {
    const bytes = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 7 + 13) % 256))
    expect(Buffer.compare(decodeBase91(encodeBase91(bytes)), bytes)).toBe(0)
  })

  it('round-trips the empty case', () => {
    expect(encodeBase91(Buffer.alloc(0))).toBe('')
    expect(decodeBase91('').length).toBe(0)
  })

  // Traktor's field is one long line, but a tagger or a copy-paste can wrap it;
  // characters outside the alphabet are not data and must be skipped, not decoded.
  it('ignores characters outside the alphabet', () => {
    expect(decodeBase91('fP\nNK d').toString()).toBe('test')
  })
})
