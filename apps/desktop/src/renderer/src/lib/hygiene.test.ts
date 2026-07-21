import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import { sanitizeMeta, stripTitleNumbering, stripTitleNumberingLoose } from './hygiene'

function meta(patch: Partial<TrackMetadata>): TrackMetadata {
  return {
    title: '',
    artist: '',
    album: '',
    albumArtist: '',
    year: '',
    genre: '',
    grouping: '',
    comment: '',
    trackNumber: '',
    discNumber: '',
    bpm: '',
    key: '',
    publisher: '',
    catalogNumber: '',
    remixArtist: '',
    ...patch,
  }
}

describe('sanitizeMeta', () => {
  it('trims and collapses whitespace so stray spaces never reach the tags', () => {
    const r = sanitizeMeta(meta({ title: '  Open   Your Eyes  ', artist: ' Chumi Dj ' }), {
      trim: true,
      zeroPad: false,
    })
    expect(r.title).toBe('Open Your Eyes')
    expect(r.artist).toBe('Chumi Dj')
  })

  it('zero-pads the track number so it sorts and shows as 03, not 3', () => {
    expect(
      sanitizeMeta(meta({ trackNumber: '3' }), { trim: false, zeroPad: true }).trackNumber,
    ).toBe('03')
    expect(
      sanitizeMeta(meta({ trackNumber: '12' }), { trim: false, zeroPad: true }).trackNumber,
    ).toBe('12')
  })

  it('leaves an empty track number alone instead of padding it to 00', () => {
    expect(
      sanitizeMeta(meta({ trackNumber: '' }), { trim: false, zeroPad: true }).trackNumber,
    ).toBe('')
  })

  it('leaves a vinyl position untouched when zero-padding, keeping the side letter', () => {
    // "A1" from a Discogs vinyl release is the whole value; stripping to digits and
    // padding ("01") destroys exactly what collectors tag for.
    expect(
      sanitizeMeta(meta({ trackNumber: 'A1' }), { trim: false, zeroPad: true }).trackNumber,
    ).toBe('A1')
  })

  it('applies nothing when both options are off', () => {
    const input = meta({ title: '  x  ', trackNumber: '3' })
    const r = sanitizeMeta(input, { trim: false, zeroPad: false })
    expect(r.title).toBe('  x  ')
    expect(r.trackNumber).toBe('3')
  })
})

describe('stripTitleNumbering', () => {
  it('strips a leading number and the space it leaves behind', () => {
    // The reported bug: deleting "1." by hand through find/replace left " Shake It"
    // with an orphan leading space, because the space belonged to neither side.
    expect(stripTitleNumbering('1. Shake It')).toBe('Shake It')
  })

  it('strips a vinyl position without eating the title, unlike a blind find/replace', () => {
    // Searching "1." to clean "1. Deep Cut" also matched inside "A1. Deep Cut" and left
    // a stray "A" glued to the title. Anchoring to the start is what makes both safe.
    expect(stripTitleNumbering('A1. Deep Cut')).toBe('Deep Cut')
    expect(stripTitleNumbering('A1 Deep Cut')).toBe('Deep Cut')
  })

  it('accepts the separators rips actually use', () => {
    expect(stripTitleNumbering('01 - Last One')).toBe('Last One')
    expect(stripTitleNumbering('1) Last One')).toBe('Last One')
    expect(stripTitleNumbering('(1) Last One')).toBe('Last One')
  })

  it('keeps a bare leading number when nothing confirms it is a position', () => {
    // "05 Last One" is numbering and "7 Seconds" is not, yet they have the same shape.
    // With no track number to check against, preserving both is the safe half of that
    // trade: a missed prefix is an edit away, a destroyed title is not.
    expect(stripTitleNumbering('05 Last One')).toBe('05 Last One')
  })

  it('strips a bare leading number once the track number confirms it', () => {
    // The separator-less rips ("05 Last One") that the anchored pattern alone cannot
    // touch. The tagged position is the evidence that turns a guess into a fact, so
    // matching it — 5 vs "05" — is what makes the strip safe.
    expect(stripTitleNumbering('05 Last One', '5')).toBe('Last One')
    expect(stripTitleNumbering('5 Last One', '05')).toBe('Last One')
    expect(stripTitleNumbering('05 Last One', 'A5')).toBe('Last One')
  })

  it('keeps a bare number that disagrees with the track number', () => {
    // "7 Seconds" on track 3 is a title, not a position: no match, no strip. This is
    // the whole point of checking rather than pattern-matching the text.
    expect(stripTitleNumbering('7 Seconds', '3')).toBe('7 Seconds')
    expect(stripTitleNumbering('99 Problems', '2')).toBe('99 Problems')
  })

  it('strips a separator prefix regardless of the track number', () => {
    // "1." is unambiguous on its own, so a stale or missing position must not veto it —
    // the track number is extra evidence for the bare case, not a gate on every case.
    expect(stripTitleNumbering('1. Shake It', '7')).toBe('Shake It')
    expect(stripTitleNumbering('1. Shake It', '')).toBe('Shake It')
  })

  it('still refuses to empty a title that is only its own track number', () => {
    // Track 1999 of nothing: stripping leaves nothing, so the title stands.
    expect(stripTitleNumbering('1999', '1999')).toBe('1999')
  })

  it('never strips a number that is the title itself', () => {
    // "Quitar numeración" must not empty the tag: these are the whole title.
    expect(stripTitleNumbering('1999')).toBe('1999')
    expect(stripTitleNumbering('7 Seconds')).toBe('7 Seconds')
    expect(stripTitleNumbering('99 Problems')).toBe('99 Problems')
  })

  it('only strips at the start, so a number mid-title survives', () => {
    expect(stripTitleNumbering('Track 1. Reprise')).toBe('Track 1. Reprise')
  })

  it('leaves a title that carries no numbering exactly as it is', () => {
    expect(stripTitleNumbering('Shake It')).toBe('Shake It')
    expect(stripTitleNumbering('')).toBe('')
  })
})

describe('stripTitleNumberingLoose', () => {
  // The in-field ⋯ menu acts on one title the user is looking at, with a before→after
  // preview and undo a keystroke away — so it strips track numbering the cautious bulk
  // command leaves alone. "Numbering" is a shape, not just any leading digit: a
  // separator, a vinyl side letter, or a zero-padded prefix ("01", "02") mark a
  // position, while a bare digit with no zero and no separator is part of the title.
  it('strips the reported separator-less zero-padded number', () => {
    // "01 Label Red (Apokaliptip Remix)": no dot, no tagged position — the case that
    // never cleaned. The leading zero is the tell that "01" is a position, not a word.
    expect(stripTitleNumberingLoose('01 Label Red (Apokaliptip Remix)')).toBe(
      'Label Red (Apokaliptip Remix)',
    )
    expect(stripTitleNumberingLoose('05 Last One')).toBe('Last One')
  })

  it('strips only the position when the title itself starts with a number', () => {
    // "02 3 Heads Label Red": the "02" is the position, "3 Heads" is the artist. Strip
    // the zero-padded prefix and stop — the "3" of "3 Heads" is not numbering.
    expect(stripTitleNumberingLoose('02 3 Heads Label Red')).toBe('3 Heads Label Red')
  })

  it('leaves a bare number that is part of the title, with no zero and no separator', () => {
    // The whole reason the loose strip is not "drop any leading digit": these are band
    // and title names, not positions. Stripping them would mangle the tag, and the menu
    // must not even offer that.
    expect(stripTitleNumberingLoose('3 Heads')).toBe('3 Heads')
    expect(stripTitleNumberingLoose('3 Heads Label Red')).toBe('3 Heads Label Red')
    expect(stripTitleNumberingLoose('2 Unlimited')).toBe('2 Unlimited')
    expect(stripTitleNumberingLoose('808 State')).toBe('808 State')
    expect(stripTitleNumberingLoose('7 Seconds')).toBe('7 Seconds')
    expect(stripTitleNumberingLoose('1 Nombre')).toBe('1 Nombre')
  })

  it('still handles every case a separator or vinyl side already made unambiguous', () => {
    // Separators, parens and vinyl positions clean exactly as the cautious strip does —
    // the loose form only ADDS the zero-padded case, it never regresses these.
    expect(stripTitleNumberingLoose('1. Shake It')).toBe('Shake It')
    expect(stripTitleNumberingLoose('01 - Nombre')).toBe('Nombre')
    expect(stripTitleNumberingLoose('A1 - Deep Cut')).toBe('Deep Cut')
    expect(stripTitleNumberingLoose('A1 Deep Cut')).toBe('Deep Cut')
    expect(stripTitleNumberingLoose('(1) Last One')).toBe('Last One')
    expect(stripTitleNumberingLoose('1) Last One')).toBe('Last One')
    // Parenthesized position, zero-padded inside the parens ("(02) Heads Label Red"):
    // the closing paren is the separator, so it strips whatever the number's width.
    expect(stripTitleNumberingLoose('(02) Heads Label Red (Apokaliptip Remix)')).toBe(
      'Heads Label Red (Apokaliptip Remix)',
    )
    expect(stripTitleNumberingLoose('(2) Heads')).toBe('Heads')
  })

  it('never empties a title that is only a number', () => {
    // Emptying the tag is never the intent behind "remove numbering", even loosely.
    expect(stripTitleNumberingLoose('1999')).toBe('1999')
  })

  it('leaves an un-numbered title untouched', () => {
    expect(stripTitleNumberingLoose('Shake It')).toBe('Shake It')
    expect(stripTitleNumberingLoose('')).toBe('')
  })

  it('only strips at the start, so a mid-title number survives', () => {
    expect(stripTitleNumberingLoose('Track 1. Reprise')).toBe('Track 1. Reprise')
  })
})
