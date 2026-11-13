import { describe, expect, it } from 'vitest'
import { truncateTitleMiddle } from './truncateTitle'

const graphemes = (s: string): string[] =>
  Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (g) => g.segment)
const width = (s: string): number => graphemes(s).length

describe('truncateTitleMiddle', () => {
  it('keeps the closing words of the mix, where versions of one track tell apart', () => {
    expect(truncateTitleMiddle('Pray (W.I.P. In The Church Mix)', 22, width)).toBe(
      'Pray (W.I.P. In … Mix)',
    )
  })

  it('fills the width it is given and never more', () => {
    for (let room = 8; room < 31; room++) {
      const out = truncateTitleMiddle('Pray (W.I.P. In The Church Mix)', room, width)
      if (out === 'Pray (W.I.P. In The Church Mix)') continue
      expect(width(out)).toBeLessThanOrEqual(room)
      expect(width(out)).toBeGreaterThanOrEqual(room - 1)
    }
  })

  it('leaves a title that fits as it is', () => {
    expect(truncateTitleMiddle('Pray (Radio Edit)', 40, width)).toBe('Pray (Radio Edit)')
  })

  it('leaves a title without a closing parenthesis to the usual end truncation', () => {
    expect(truncateTitleMiddle('A very long title that has no version at all', 12, width)).toBe(
      'A very long title that has no version at all',
    )
    expect(truncateTitleMiddle('Pray (W.I.P. In The Church Mix) Live', 12, width)).toBe(
      'Pray (W.I.P. In The Church Mix) Live',
    )
  })

  it('gives up when the kept end alone would not fit, so the row still shows the start', () => {
    expect(truncateTitleMiddle('Pray (W.I.P. In The Church Mix)', 6, width)).toBe(
      'Pray (W.I.P. In The Church Mix)',
    )
  })

  it('keeps the whole parenthesis when it is a single word', () => {
    expect(truncateTitleMiddle('Somebody That I Used To Know (Remix)', 20, width)).toBe(
      'Somebody Th… (Remix)',
    )
  })

  it('reads the outer parenthesis when another one is nested inside it', () => {
    const out = truncateTitleMiddle('Children (Robert Miles (UK) Dream Version)', 24, width)
    expect(out.startsWith('Children (')).toBe(true)
    expect(out.endsWith('… Version)')).toBe(true)
    expect(width(out)).toBeLessThanOrEqual(24)
  })

  it('leaves a title whose closing parenthesis opens nowhere', () => {
    expect(truncateTitleMiddle('Pray W.I.P. In The Church Mix)', 12, width)).toBe(
      'Pray W.I.P. In The Church Mix)',
    )
  })

  it('never splits a letter from its accent', () => {
    const title = 'Cafe\u0301 Cafe\u0301 Cafe\u0301 Cafe\u0301 (Ope\u0301ra Mix)'
    const units = (s: string): number => s.length
    for (let room = 10; room < 30; room++) {
      const out = truncateTitleMiddle(title, room, units)
      expect(out.endsWith('… Mix)')).toBe(true)
      expect(out.slice(0, out.indexOf('…')).endsWith('e')).toBe(false)
    }
  })

  it('never splits an emoji', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
    const title = `Party ${family.repeat(5)} Anthem (Club Mix)`
    for (let room = 8; room < 20; room++) {
      const out = truncateTitleMiddle(title, room, width)
      expect(out.endsWith('… Mix)')).toBe(true)
      const head = out.slice(0, out.indexOf('…'))
      expect(graphemes(head).every((g) => g === family || g.length === 1)).toBe(true)
    }
  })

  it('measures with the width it is handed, not with the letter count', () => {
    const wide = (s: string): number => graphemes(s).reduce((n, g) => n + (g === 'W' ? 3 : 1), 0)
    const out = truncateTitleMiddle('WWWW WWWW WWWW (Extended Mix)', 20, wide)
    expect(wide(out)).toBeLessThanOrEqual(20)
    expect(out.endsWith('… Mix)')).toBe(true)
  })
})
