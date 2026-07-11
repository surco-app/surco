import { describe, expect, it } from 'vitest'
import { cleanMatchTitle } from '../shared/searchClean'
import { buildSearchCandidates, cleanQuery } from './searchQuery'

describe('cleanMatchTitle', () => {
  it('strips a duplicated, track-numbered tail so the real track title can match', () => {
    expect(
      cleanMatchTitle(
        'Francesco Donadoni - Rock that sound (Original mix) - 02 Francesco Donadoni - Rock that sound (Original mix)',
      ),
    ).toBe('Francesco Donadoni - Rock that sound')
  })

  it('takes the track title that follows the track number, not the release prefix', () => {
    // "Label - Artist - Album (Mix) - 01 Preview" → the real track is "Preview" (Bandcamp
    // names many tracks that way); scoring it against the release's "Preview" entry must win.
    expect(
      cleanMatchTitle('Francesco Donadoni - Rock that sound (Original mix) - 01 Preview'),
    ).toBe('Preview')
  })

  it('leaves a title whose only parenthetical is a meaningful mix untouched', () => {
    // Extended/Dub/Club/… name a distinct version, so they survive to keep disambiguating
    // mixes — unlike a bare "(Original mix)", which is dropped to match a catalog's plain title.
    expect(cleanMatchTitle('Rock that sound (Extended mix)')).toBe('Rock that sound (Extended mix)')
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
    expect(cleanQuery('Tiesto Adagio For Strings feat. Someone')).toBe('Tiesto Adagio For Strings')
  })

  it('keeps a musical parenthetical and the real words intact', () => {
    // The mix name is meaningful for finding the right release, so it stays in the
    // cleaned query — only the junk is removed.
    expect(cleanQuery('Rank 1 Airwave (Original Mix) 320')).toBe('Rank 1 Airwave (Original Mix)')
  })

  it('leaves an already-clean query untouched', () => {
    expect(cleanQuery('Rank 1 Airwave')).toBe('Rank 1 Airwave')
  })

  it('drops a leading label/catalog code that would poison the specific candidates', () => {
    // A DJ-rip prefixed with its catalog code ("BL2-045 Artist - Title") returns nothing for
    // the exact candidate and then matches the bare code against random catalogs.
    expect(cleanQuery('BL2-045 Tito Dj & Solá Brothers Love Again (Extended)')).toBe(
      'Tito Dj & Solá Brothers Love Again (Extended)',
    )
  })
})

describe('buildSearchCandidates', () => {
  it('yields a single candidate when the cleaned query has no parenthetical', () => {
    // No wasted second API call for the common case.
    expect(buildSearchCandidates('Rank 1 Airwave 320')).toEqual(['Rank 1 Airwave'])
  })

  it('leads with the bare title for a generic "(Original Mix)", keeping the full one as fallback', () => {
    // "(Original Mix)" is the file's name for the default version; catalogs omit it and a
    // free-text search on it returns noise that — by returning *something* — blocks the bare
    // fallback. So the bare title is tried first; the version is recovered for the
    // suggestion from the file title regardless.
    expect(buildSearchCandidates('Rank 1 Airwave (Original Mix)')).toEqual([
      'Rank 1 Airwave',
      'Rank 1 Airwave (Original Mix)',
    ])
  })

  it('keeps a meaningful mix name first so a remix resolves to its own release', () => {
    // Extended/Dub/Club name a distinct version, kept up front; the bare title is the fallback.
    expect(buildSearchCandidates('Rank 1 Airwave (Extended Mix)')).toEqual([
      'Rank 1 Airwave (Extended Mix)',
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

  it('omits the catalog-number candidate when includeCatalog is false', () => {
    // Bandcamp has no catalog index: a code like "ANJ001" matches dozens of unrelated
    // releases, and since the loop keeps the first candidate that returns *anything*, that
    // noise would mask the real release. Discogs (default) still gets the candidate.
    expect(
      buildSearchCandidates(
        'Some Artist Some Title',
        { artist: 'Some Artist', title: 'Some Title', catalogNumber: 'ANJ001' },
        { includeCatalog: false },
      ),
    ).toEqual(['Some Artist Some Title', 'Some Title', 'Some Title Some Artist'])
  })

  // The reported case end-to-end: a file whose name leads with its catalog code must search
  // the clean "Artist Title" first, not the code-poisoned candidate that returns nothing.
  it('leads with the catalog-free query for a code-prefixed file name', () => {
    expect(
      buildSearchCandidates('BL2-045 Tito Dj & Solá Brothers Love Again (Extended)')[0],
    ).toBe('Tito Dj & Solá Brothers Love Again (Extended)')
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
      'Francesco Donadoni - Rock that sound',
      'Francesco Donadoni - Rock that sound (Original mix)',
      'Francesco Donadoni - Rock that sound (Original mix) - 02 Francesco Donadoni - Rock that sound (Original mix)',
      'Francesco Donadoni - Rock that sound - 02 Francesco Donadoni - Rock that sound',
    ])
  })

  // A title can legitimately start with a number ("99 Luftballons", "7 Seconds"). With a
  // single "Artist - Title" segment, cutting at the number leaves just the artist, whose
  // search returns plenty — and since the loop keeps the first candidate that returns
  // anything, the real title would never be searched. Only a prefix that is itself a full
  // "A - B" query (the DJ-pool duplication shape) is safe to cut to.
  it('keeps a numeric title intact instead of cutting to the bare artist', () => {
    expect(buildSearchCandidates('Nena - 99 Luftballons')).toEqual(['Nena - 99 Luftballons'])
  })

  // The reported case: a file tagged "Artist Title (Original Mix)" must search the bare
  // "Artist Title" first, or the parenthetical pulls in Bandcamp noise that hides the EP.
  it('searches the bare "Artist Title" first for an "(Original Mix)" tag', () => {
    expect(buildSearchCandidates('Alex K Shake it Up (Original Mix)')[0]).toBe('Alex K Shake it Up')
  })

  // The reported case: a "presents"/"pres." alias in the artist ("Brian Cross pres. Fat
  // Synth") makes the full query return unrelated "Various" compilations; Discogs files the
  // release under the lead act ("Brian Cross & Fat Synth"). Lead with "<lead artist> <title>"
  // so that clean candidate is tried before the noisy query, whose non-empty junk would
  // otherwise break the loop before any fallback.
  it('leads with the lead artist + title when the artist carries a "presents" alias', () => {
    expect(
      buildSearchCandidates('Brian Cross pres. Fat Synth Secret', {
        artist: 'Brian Cross pres. Fat Synth',
        title: 'Secret',
      })[0],
    ).toBe('Brian Cross Secret')
  })

  // The Spanish catalog spells the same credit "presenta"/"presentan" ("Chumi DJ
  // Presenta Different") and Discogs files those releases under the lead act too —
  // the case a Valencian crate hits constantly.
  it('handles the Spanish "presenta"/"presentan" credits like "presents"', () => {
    expect(
      buildSearchCandidates('Chumi Dj Presenta Different Dancing Hearts', {
        artist: 'Chumi Dj Presenta Different',
        title: 'Dancing Hearts',
      })[0],
    ).toBe('Chumi Dj Dancing Hearts')
    expect(
      buildSearchCandidates('Los Residentes Presentan Happiness Track', {
        artist: 'Los Residentes Presentan Happiness',
        title: 'Track',
      })[0],
    ).toBe('Los Residentes Track')
  })

  // "presents" spelled out is the same credit and gets the same treatment; an artist with
  // no such credit adds no extra candidate, so unrelated searches are untouched.
  it('handles spelled-out "presents" and leaves a credit-free artist alone', () => {
    expect(
      buildSearchCandidates('Pasta presents Rigatoni Penne', {
        artist: 'Pasta presents Rigatoni',
        title: 'Penne',
      })[0],
    ).toBe('Pasta Penne')
    expect(
      buildSearchCandidates('Some Artist Some Title', {
        artist: 'Some Artist',
        title: 'Some Title',
      }),
    ).toEqual(['Some Artist Some Title', 'Some Title', 'Some Title Some Artist'])
  })

  // The reported case: a file tagged "DJ Miguel Serna, Alex Cervera" where Bandcamp files
  // the act bare ("Miguel Serna, Alex Cervera"). Its autocomplete needs every term to
  // match, so the "DJ" token alone returns nothing — and the loop then degrades to the
  // bare title, whose homonym noise ends the search on the wrong releases. Retry without
  // the prefix after the full forms but before the bare title.
  it('retries without a leading "DJ" prefix before falling back to the bare title', () => {
    expect(
      buildSearchCandidates("DJ Miguel Serna, Alex Cervera I'm Ready", {
        artist: 'DJ Miguel Serna, Alex Cervera',
        title: "I'm Ready",
      }),
    ).toEqual([
      "DJ Miguel Serna, Alex Cervera I'm Ready",
      "Miguel Serna, Alex Cervera I'm Ready",
      "I'm Ready",
      "I'm Ready DJ Miguel Serna, Alex Cervera",
    ])
  })

  // An act genuinely named "DJ" gets no variant: dropping the word would search a
  // different artist. And "DJ" alone must never strip to an empty artist.
  it('adds no DJ-free variant when there is nothing after the prefix or no prefix at all', () => {
    expect(
      buildSearchCandidates('DJ Track', { artist: 'DJ', title: 'Track' }),
    ).toEqual(['DJ Track', 'Track', 'Track DJ'])
    expect(
      buildSearchCandidates('Chumi Dj Dancing Hearts', {
        artist: 'Chumi Dj',
        title: 'Dancing Hearts',
      }),
    ).toEqual(['Chumi Dj Dancing Hearts', 'Dancing Hearts', 'Dancing Hearts Chumi Dj'])
  })

  // The reported case: a self-referential version label that only echoes the title plus a
  // generic version word ("Sunshine (Sunshine Version)") drags Discogs onto unrelated
  // compilations, while the bare "Sevilla Sunshine" finds the single. Lead bare; the file's
  // own title still recovers the version for the tracklist match.
  it('leads bare when a version parenthetical only echoes the title', () => {
    expect(buildSearchCandidates('Sevilla Sunshine (Sunshine Version)')[0]).toBe('Sevilla Sunshine')
    expect(buildSearchCandidates('Sevilla Sunshine (Sunshine Version)')).toContain(
      'Sevilla Sunshine (Sunshine Version)',
    )
  })

  // A parenthetical that names a real remixer is not a redundant echo even when it shares a
  // title word ("Love To Infinity" is the remixer), so it stays first to find the remix's
  // own release. Likewise a plain meaningful mix with no echo.
  it('keeps a remixer-named or meaningful-mix parenthetical that is not a pure echo', () => {
    expect(buildSearchCandidates('Love (Love To Infinity Mix)')[0]).toBe(
      'Love (Love To Infinity Mix)',
    )
    expect(buildSearchCandidates('Rank 1 Airwave (Euro Mix)')[0]).toBe('Rank 1 Airwave (Euro Mix)')
  })
})
