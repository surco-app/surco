import { describe, expect, it } from 'vitest'
import { cleanMatchTitle } from '../shared/searchClean'
import { buildSearchCandidates, cleanQuery } from './searchQuery'

describe('cleanMatchTitle', () => {
  it('strips a duplicated, track-numbered tail so the real track title can match', () => {
    expect(
      cleanMatchTitle(
        'Francesco Donadoni - Rock that sound (Original mix) - 02 Francesco Donadoni - Rock that sound (Original mix)',
      ),
    ).toBe('Francesco Donadoni - Rock that sound (Original mix)')
  })

  it('takes the track title that follows the track number, not the release prefix', () => {
    // "Label - Artist - Album (Mix) - 01 Preview" → the real track is "Preview" (Bandcamp
    // names many tracks that way); scoring it against the release's "Preview" entry must win.
    expect(
      cleanMatchTitle('Francesco Donadoni - Rock that sound (Original mix) - 01 Preview'),
    ).toBe('Preview')
  })

  it('leaves an already-clean title untouched', () => {
    expect(cleanMatchTitle('Rock that sound (Original mix)')).toBe('Rock that sound (Original mix)')
  })
})

describe('cleanQuery', () => {
  it('strips bitrate and format tokens that never appear in a release title', () => {
    // These live in download file names ("…320 flac") and, dumped into the q= text,
    // make Discogs miss a release that a clean "artist title" search finds at once.
    expect(cleanQuery('Rank 1 Airwave 320 kbps flac')).toBe('Rank 1 Airwave')
    expect(cleanQuery('Rank 1 Airwave 320k')).toBe('Rank 1 Airwave')
  })

  it('drops bracketed label/catalog/source noise', () => {
    // [LABEL001], [Beatport], [vinyl rip] etc. are provenance, not part of the title.
    expect(cleanQuery('Rank 1 Airwave [Anjunabeats ANJ001]')).toBe('Rank 1 Airwave')
  })

  it('drops a feat./ft. credit, which the release title usually omits', () => {
    expect(cleanQuery('Tiesto Adagio For Strings feat. Someone')).toBe(
      'Tiesto Adagio For Strings',
    )
  })

  it('keeps a musical parenthetical and the real words intact', () => {
    // The mix name is meaningful for finding the right release, so it stays in the
    // cleaned query — only the junk is removed.
    expect(cleanQuery('Rank 1 Airwave (Original Mix) 320')).toBe('Rank 1 Airwave (Original Mix)')
  })

  it('leaves an already-clean query untouched', () => {
    expect(cleanQuery('Rank 1 Airwave')).toBe('Rank 1 Airwave')
  })
})

describe('buildSearchCandidates', () => {
  it('yields a single candidate when the cleaned query has no parenthetical', () => {
    // No wasted second API call for the common case.
    expect(buildSearchCandidates('Rank 1 Airwave 320')).toEqual(['Rank 1 Airwave'])
  })

  it('adds a parenthetical-stripped fallback after the cleaned query', () => {
    // First try keeps "(Original Mix)" (precision for remixes); if that finds nothing
    // the caller falls back to the bare title, which is what works on Google.
    expect(buildSearchCandidates('Rank 1 Airwave (Original Mix)')).toEqual([
      'Rank 1 Airwave (Original Mix)',
      'Rank 1 Airwave',
    ])
  })

  it('collapses both forms to one when there is no parenthetical to strip', () => {
    expect(buildSearchCandidates('Rank 1 Airwave [ANJ001] 320')).toEqual(['Rank 1 Airwave'])
  })

  it('never returns an empty candidate, falling back to the raw query', () => {
    // If cleaning removed everything (e.g. the whole thing was bracketed), search
    // the original rather than firing a blank query.
    expect(buildSearchCandidates('[unknown]')).toEqual(['[unknown]'])
  })

  it('adds catalog-number, title-only and swapped fallbacks from hints', () => {
    // After the title search comes the near-unique catalog number, then the bare
    // title (artist may be wrong), then title+artist swapped (name was backwards).
    expect(
      buildSearchCandidates('Some Artist Some Title', {
        artist: 'Some Artist',
        title: 'Some Title',
        catalogNumber: 'ANJ001',
      }),
    ).toEqual(['Some Artist Some Title', 'ANJ001', 'Some Title', 'Some Title Some Artist'])
  })

  it('ignores absent hints and de-dupes ones that repeat the cleaned query', () => {
    // Title-only equal to the cleaned query must not produce a duplicate candidate.
    expect(buildSearchCandidates('Some Title', { title: 'Some Title' })).toEqual(['Some Title'])
  })

  it('cuts a duplicated, track-numbered tail off a DJ-pool file name', () => {
    // "Artist - Title (Mix) - 02 Artist - Title (Mix)": the part before the mid-string
    // track number is already a complete query, and the duplication makes free-text
    // search (Bandcamp's autocomplete especially) return nothing.
    expect(
      buildSearchCandidates(
        'Francesco Donadoni - Rock that sound (Original mix) - 02 Francesco Donadoni - Rock that sound (Original mix)',
      ),
    ).toEqual([
      'Francesco Donadoni - Rock that sound (Original mix) - 02 Francesco Donadoni - Rock that sound (Original mix)',
      'Francesco Donadoni - Rock that sound - 02 Francesco Donadoni - Rock that sound',
      'Francesco Donadoni - Rock that sound (Original mix)',
      'Francesco Donadoni - Rock that sound',
    ])
  })
})
