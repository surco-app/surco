import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import {
  emptyTitleFormatFields,
  outputNamePatches,
  renderOutputName,
  renderTitle,
  titleFormatPatches,
  titleFormatSummary,
  unformatTitle,
} from './outputName'

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

describe('renderOutputName', () => {
  it('fills tokens in template order so the user controls the file-name shape', () => {
    const r = renderOutputName(
      '{artist} - {title}',
      meta({ artist: 'Chumi Dj', title: 'Open Your Eyes' }),
    )
    expect(r).toBe('Chumi Dj - Open Your Eyes')
  })

  it('supports reordering and extra tokens like the track number', () => {
    const r = renderOutputName(
      '{trackNumber} - {artist} - {title}',
      meta({ trackNumber: '03', artist: 'Acer', title: 'Keep Calm' }),
    )
    expect(r).toBe('03 - Acer - Keep Calm')
  })

  it('drops a dangling separator when a leading token (e.g. track no.) is empty', () => {
    const r = renderOutputName(
      '{trackNumber} - {artist} - {title}',
      meta({ artist: 'Acer', title: 'Keep Calm' }),
    )
    expect(r).toBe('Acer - Keep Calm')
  })

  it('collapses a separator left by an empty token in the middle', () => {
    const r = renderOutputName('{artist} - {title}', meta({ title: 'Keep Calm' }))
    expect(r).toBe('Keep Calm')
  })

  it('renders unknown tokens as empty', () => {
    const r = renderOutputName('{artist} {bogus}', meta({ artist: 'Acer' }))
    expect(r).toBe('Acer')
  })

  it('returns empty when no token has a value, so the caller can fall back', () => {
    expect(renderOutputName('{artist} - {title}', meta({}))).toBe('')
  })

  it('fills a parenthesised token like ({year}) when the field has a value', () => {
    const r = renderOutputName(
      '{artist} - {title} ({year})',
      meta({ artist: 'Chumi Dj', title: 'Open Your Eyes', year: '1999' }),
    )
    expect(r).toBe('Chumi Dj - Open Your Eyes (1999)')
  })

  it('drops the empty "()" a blank year leaves behind instead of shipping it in the name', () => {
    const r = renderOutputName(
      '{artist} - {title} ({year})',
      meta({ artist: 'Chumi Dj', title: 'Open Your Eyes' }),
    )
    expect(r).toBe('Chumi Dj - Open Your Eyes')
  })

  it('drops empty "[]" the same way so bracket styles behave alike', () => {
    const r = renderOutputName(
      '{artist} - {title} [{key}]',
      meta({ artist: 'Chumi Dj', title: 'Open Your Eyes' }),
    )
    expect(r).toBe('Chumi Dj - Open Your Eyes')
  })

  it('keeps a "/" in the template as a subfolder boundary', () => {
    const r = renderOutputName(
      '{albumArtist}/{album}/{trackNumber} {title}',
      meta({
        albumArtist: 'Various',
        album: 'Hard House Nation',
        trackNumber: '01',
        title: 'Snap',
      }),
    )
    expect(r).toBe('Various/Hard House Nation/01 Snap')
  })

  it('drops a folder segment a blank field would have left empty', () => {
    const r = renderOutputName(
      '{albumArtist}/{album}/{title}',
      meta({ album: 'Hard House Nation', title: 'Snap' }),
    )
    expect(r).toBe('Hard House Nation/Snap')
  })

  it('sanitizes a slash inside a value so it never becomes an accidental folder', () => {
    expect(renderOutputName('{artist} - {title}', meta({ artist: 'AC/DC', title: 'TNT' }))).toBe(
      'AC-DC - TNT',
    )
  })

  // Discogs disambiguates same-named labels with a trailing "(8)"; the artist token
  // already comes out clean, so the label must too — otherwise the file is left as
  // "[One Way Records (8)]" for the user to fix by hand. Cleaned at render time so a
  // publisher typed by hand or read from an already-tagged file is covered too.
  it('strips the Discogs disambiguation suffix from the label token', () => {
    const r = renderOutputName(
      '{artist} - {title} [{publisher}] {year}',
      meta({
        artist: 'DJ Hotas',
        title: 'One Way',
        publisher: 'One Way Records (8)',
        year: '2024',
      }),
    )
    expect(r).toBe('DJ Hotas - One Way [One Way Records] 2024')
  })
})

describe('renderTitle', () => {
  it('fills tokens and keeps slashes as plain text, unlike a filename', () => {
    // A title is a tag value, not a path: "AC/DC" or "Action / Base" must survive
    // verbatim, and a "/" in the pattern is just punctuation, never a folder.
    const r = renderTitle(
      '({trackNumber}) {title}',
      meta({ trackNumber: 'A2', title: 'Action / Base' }),
    )
    expect(r).toBe('(A2) Action / Base')
  })

  it('drops the brackets and separators a blank field leaves behind', () => {
    // The pattern is global but not every track has every field; "() Title" or a
    // leading dash would look broken on the deck.
    expect(renderTitle('({trackNumber}) {title}', meta({ title: 'Action' }))).toBe('Action')
    expect(renderTitle('{trackNumber} - {title}', meta({ title: 'Action' }))).toBe('Action')
  })

  it('renders an empty pattern or all-blank fields to an empty string', () => {
    expect(renderTitle('', meta({ title: 'Action' }))).toBe('')
    expect(renderTitle('({trackNumber})', meta({}))).toBe('')
  })

  // Same Discogs "(8)" disambiguator as the filename side: a label baked into the
  // title tag must not carry it either.
  it('strips the Discogs disambiguation suffix from the label token', () => {
    const r = renderTitle(
      '{title} [{publisher}]',
      meta({ title: 'One Way', publisher: 'One Way Records (8)' }),
    )
    expect(r).toBe('One Way [One Way Records]')
  })
})

describe('unformatTitle', () => {
  const FORMAT = '({trackNumber}) {title} ({year})'

  // The round-trip that broke re-matching: the title pattern wrote "(A2) X (1998)" into
  // the tag, and the matcher then scored against that dressed title — its own prefix
  // words buried the real one below the suggestion bar. Inverting the configured
  // pattern recovers the bare title (and the fields it wrapped) for matching.
  it('recovers the bare title and the wrapped fields from a formatted title', () => {
    expect(unformatTitle(FORMAT, '(A2) Sueño Latino (1998)')).toEqual({
      title: 'Sueño Latino',
      fields: { trackNumber: 'A2', year: '1998' },
    })
  })

  it('handles a field that was blank when the pattern was applied', () => {
    // renderTitle drops the "()" a blank year leaves behind, so the tagged title is
    // "(A2) X" — the inverse must accept that layout too, not demand the full pattern.
    expect(unformatTitle(FORMAT, '(A2) Sueño Latino')).toEqual({
      title: 'Sueño Latino',
      fields: { trackNumber: 'A2' },
    })
  })

  it('returns an unformatted title unchanged with no fields', () => {
    expect(unformatTitle(FORMAT, 'Sueño Latino')).toEqual({
      title: 'Sueño Latino',
      fields: {},
    })
  })

  it('keeps a dashed title intact instead of eating it as a track number', () => {
    // "My Song - Remix" wears the "{trackNumber} - {title}" shape textually, but
    // "My Song" is no track number — the field's shape guard must reject it so a
    // legitimate dashed title never loses its first words.
    expect(unformatTitle('{trackNumber} - {title}', 'My Song - Remix')).toEqual({
      title: 'My Song - Remix',
      fields: {},
    })
    expect(unformatTitle('{trackNumber} - {title}', 'A2 - Remix')).toEqual({
      title: 'Remix',
      fields: { trackNumber: 'A2' },
    })
  })

  it('recovers vinyl and plain track numbers alike', () => {
    expect(unformatTitle('({trackNumber}) {title}', '(12) Open Up')).toEqual({
      title: 'Open Up',
      fields: { trackNumber: '12' },
    })
    expect(unformatTitle('({trackNumber}) {title}', '(AA1) Open Up')).toEqual({
      title: 'Open Up',
      fields: { trackNumber: 'AA1' },
    })
  })

  it('returns undefined when the pattern has no {title} to recover', () => {
    expect(unformatTitle('({trackNumber})', '(A2) X')).toBeUndefined()
    expect(unformatTitle('', 'X')).toBeUndefined()
  })
})

describe('titleFormatPatches', () => {
  const track = (id: string, patch: Partial<TrackMetadata>) => ({ id, meta: meta(patch) })

  it('builds one rename patch per track whose rendered title differs', () => {
    const patches = titleFormatPatches('({trackNumber}) {title}', [
      track('a', { title: 'Action', trackNumber: 'B2' }),
      track('b', { title: '(A1) Open', trackNumber: '' }),
    ])
    expect(patches).toEqual([{ id: 'a', meta: { title: '(B2) Action' } }])
  })

  // The user-facing "why did nothing happen": with the pattern's fields empty the
  // render equals the current title, so the caller can tell "no-op" apart and say so
  // in a toast instead of silently doing nothing.
  it('returns no patches when the pattern changes nothing', () => {
    const patches = titleFormatPatches('({trackNumber}) {title}', [
      track('a', { title: 'Stay With Me', trackNumber: '' }),
    ])
    expect(patches).toEqual([])
  })

  // Pressing the T button twice used to stack the prefix ("(B2) (B2) Action").
  // A title that already carries the pattern's rendered prefix and suffix is
  // treated as formatted and skipped — re-applying is idempotent.
  it('skips a title the pattern already shaped, so re-applying never stacks', () => {
    const patches = titleFormatPatches('({trackNumber}) {title}', [
      track('a', { title: '(B2) Action', trackNumber: 'B2' }),
    ])
    expect(patches).toEqual([])
  })

  it('still patches when only part of the pattern is present', () => {
    // "(B2)" appearing mid-title is not the pattern's prefix; only a real
    // prefix+suffix match counts as already formatted.
    const patches = titleFormatPatches('{title} ({year})', [
      track('a', { title: 'Action (Base)', year: '2026' }),
      track('b', { title: 'Open (2026)', year: '2026' }),
    ])
    expect(patches).toEqual([{ id: 'a', meta: { title: 'Action (Base) (2026)' } }])
  })
})

describe('emptyTitleFormatFields', () => {
  const track = (id: string, patch: Partial<TrackMetadata>) => ({ id, meta: meta(patch) })

  // The "why did nothing change" for the no-op toast: the pattern fields (other
  // than {title}) that are empty on every selected track, in pattern order.
  it('names the pattern fields that are empty on every track', () => {
    const fields = emptyTitleFormatFields('({trackNumber}) {title} ({year})', [
      track('a', { title: 'Stay With Me', trackNumber: '', year: '' }),
    ])
    expect(fields).toEqual(['trackNumber', 'year'])
  })

  it('does not name a field some track fills', () => {
    const fields = emptyTitleFormatFields('({trackNumber}) {title}', [
      track('a', { title: 'A', trackNumber: '' }),
      track('b', { title: 'B', trackNumber: 'B2' }),
    ])
    expect(fields).toEqual([])
  })

  it('never names {title} itself', () => {
    expect(emptyTitleFormatFields('{title}', [track('a', { title: '' })])).toEqual([])
  })
})

describe('titleFormatSummary', () => {
  const track = (id: string, patch: Partial<TrackMetadata>) => ({ id, meta: meta(patch) })

  // One pass over a mixed selection: the caller needs the patches AND how many
  // tracks were skipped, so the notice can say "formatted 1 of 3" instead of
  // celebrating a full pass that silently left tracks out.
  it('reports patches and skipped count over a mixed selection', () => {
    const s = titleFormatSummary('({trackNumber}) {title}', [
      track('a', { title: 'Action', trackNumber: 'B2' }),
      track('b', { title: 'Open', trackNumber: '' }),
      track('c', { title: '(A1) Close', trackNumber: 'A1' }),
    ])
    expect(s.patches).toEqual([{ id: 'a', meta: { title: '(B2) Action' } }])
    expect(s.skipped).toBe(2)
    expect(s.missingFields).toEqual([])
  })

  it('names the missing fields only when they are empty on every track', () => {
    const s = titleFormatSummary('({trackNumber}) {title}', [
      track('a', { title: 'Action', trackNumber: '' }),
    ])
    expect(s.patches).toEqual([])
    expect(s.skipped).toBe(1)
    expect(s.missingFields).toEqual(['trackNumber'])
  })
})

describe('outputNamePatches', () => {
  const track = (
    id: string,
    patch: Partial<TrackMetadata>,
    outputName?: string,
  ): { id: string; outputName?: string; meta: TrackMetadata } => ({
    id,
    outputName,
    meta: meta(patch),
  })

  // djotas's flow: retag a whole crate from Discogs, then stamp every file name at
  // once — one patch per track whose rendered name actually changes, so the caller
  // can report a partial pass honestly and a double press stays a no-op.
  it('renders one rename per track that needs it, skipping no-ops', () => {
    const patches = outputNamePatches('{artist} - {title}', [
      track('a', { artist: 'HH Traxx', title: 'Preview' }),
      track('b', { artist: 'Jeff Mills', title: 'Preview' }, 'Jeff Mills - Preview'),
      track('c', { artist: '', title: '' }),
    ])
    expect(patches).toEqual([{ id: 'a', outputName: 'HH Traxx - Preview' }])
  })
})
