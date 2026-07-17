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
      onOpenSettings={vi.fn()}
      formatFilter={[]}
      resultsWidth={315}
      onResultsWidthChange={vi.fn()}
    />,
  )
}

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
