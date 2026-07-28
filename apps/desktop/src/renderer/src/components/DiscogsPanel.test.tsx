// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { DiscogsBrowser } from '../hooks/useDiscogsBrowser'
import { DiscogsPanel } from './DiscogsPanel'

afterEach(cleanup)

function browser(overrides: Partial<DiscogsBrowser>): DiscogsBrowser {
  return {
    query: '',
    setQuery: vi.fn(),
    doSearch: vi.fn(),
    results: [],
    providerCounts: [{ provider: 'discogs', count: 0 }],
    providerFilter: 'all',
    setProviderFilter: vi.fn(),
    release: null,
    openKey: null,
    suggestedKey: null,
    loading: false,
    busy: false,
    resolving: false,
    noResults: false,
    error: '',
    previewRelease: vi.fn(),
    ...overrides,
  }
}

function renderPanel(b: DiscogsBrowser) {
  return render(
    <DiscogsPanel
      browser={b}
      matchedTrack={undefined}
      matchTier={undefined}
      appliedTrack={undefined}
      hasToken={true}
      isMulti={false}
      selectedTracks={undefined}
      onApplyMatches={undefined}
      selectTrack={vi.fn()}
      searchInputRef={createRef<HTMLInputElement>()}
      formatFilter={[]}
      resultsWidth={315}
      onResultsWidthChange={vi.fn()}
    />,
  )
}

describe('DiscogsPanel result entrance', () => {
  function results(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      provider: 'discogs' as const,
      id: i + 1,
      title: `Album ${i + 1}`,
    }))
  }

  // A search lands ~50 rows in one frame, which reads as a slab appearing rather than
  // results arriving. A short per-row delay turns that into an arrival — but the delay MUST
  // stop after the first handful: it is decoration, and a row 30 places down that waits its
  // turn would be invisible-but-pending when the user scrolls to it, which is decoration
  // blocking the actual content. Past the cap every row is at zero, i.e. already there.
  it('staggers only the first rows and leaves the rest with no delay', () => {
    renderPanel(browser({ results: results(20) }))
    const rows = screen.getAllByTestId('discogs-result')

    expect(rows[0].style.animationDelay).toBe('0ms')
    expect(rows[1].style.animationDelay).toBe('40ms')
    expect(rows[5].style.animationDelay).toBe('200ms')
    // Capped: the seventh row onwards carries no delay at all.
    expect(rows[6].style.animationDelay).toBe('0ms')
    expect(rows[19].style.animationDelay).toBe('0ms')
  })
})

describe('DiscogsPanel empty states', () => {
  // Before this split, an empty result set always showed the "choose an album" hint, so a
  // search that genuinely matched nothing looked identical to never having searched — the
  // user got no signal their query came up dry. The no-results placeholder is what tells
  // them the search ran and found nothing.
  it('shows the no-results placeholder when a search settled with zero rows', () => {
    renderPanel(browser({ query: 'zzz no such album', noResults: true }))

    expect(screen.getByTestId('discogs-no-results')).toBeInTheDocument()
    expect(screen.getByText(/no albums matched/i)).toBeInTheDocument()
    expect(screen.queryByText(/choose an album/i)).not.toBeInTheDocument()
  })

  // The idle, never-searched state must keep the original hint — the no-results placeholder
  // would be a lie before any search has run.
  it('shows the choose-album hint when idle (no search run yet)', () => {
    renderPanel(browser({ noResults: false }))

    expect(screen.getByText(/choose an album/i)).toBeInTheDocument()
    expect(screen.queryByTestId('discogs-no-results')).not.toBeInTheDocument()
  })
})
