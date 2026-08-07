// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

function panel(b: DiscogsBrowser) {
  return (
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
    />
  )
}

function renderPanel(b: DiscogsBrowser) {
  return render(panel(b))
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

describe('cursor de teclado', () => {
  const results = [
    { provider: 'discogs', id: 1, title: 'Uno', thumb: '' },
    { provider: 'discogs', id: 2, title: 'Dos', thumb: '' },
  ] as unknown as DiscogsBrowser['results']

  it('marca la columna para que los saltos ⌘←/⌘→ la reconozcan', () => {
    renderPanel(browser({ results }))
    expect(screen.getByTestId('matches-column')).toBeInTheDocument()
  })

  it('marca visiblemente la tarjeta enfocada', () => {
    renderPanel(browser({ results }))
    const first = screen.getAllByTestId('discogs-result')[0]
    first.focus()
    expect(first).toHaveFocus()
    expect(first.className).toContain('focus:bg-[var(--color-accent-soft)]')
    expect(first.className).toContain('focus:shadow-[inset_0_0_0_1px_var(--color-accent)]')
    expect(first.className).toContain('focus:outline-none')
  })

  // La garantía de la decisión "foco ≠ despliegue": moverse por los resultados no puede
  // abrir ninguno, porque cada despliegue dispara una query de release a Discogs y el
  // contenido saltaría bajo el cursor mientras navegas. Solo Enter despliega.
  it('mover el foco no despliega ninguna tarjeta', () => {
    const previewRelease = vi.fn()
    renderPanel(browser({ results, previewRelease }))
    const cards = screen.getAllByTestId('discogs-result')
    cards[0].focus()
    fireEvent.keyDown(cards[0], { key: 'ArrowDown' })
    expect(previewRelease).not.toHaveBeenCalled()
    for (const c of cards) expect(c).toHaveAttribute('aria-expanded', 'false')
  })

  it('marca visiblemente la pista enfocada dentro de un release desplegado', () => {
    const release = {
      provider: 'discogs' as const,
      id: 1,
      title: 'Uno',
      artists: [],
      tracklist: [
        { position: '1', title: 'Cara A' },
        { position: '2', title: 'Cara B' },
      ],
    }
    renderPanel(browser({ results, openKey: 'discogs:1', release, loading: false }))
    const track = screen.getAllByTestId('discogs-track')[0]
    track.focus()
    expect(track).toHaveFocus()
    expect(track.className).toContain('focus:bg-[var(--color-accent-soft)]')
    expect(track.className).toContain('focus:shadow-[inset_0_0_0_1px_var(--color-accent)]')
    expect(track.className).toContain('focus:outline-none')
  })
})

describe('pistas de una tarjeta plegada', () => {
  const results = [
    { provider: 'discogs', id: 1, title: 'Uno', thumb: '' },
    { provider: 'discogs', id: 2, title: 'Dos', thumb: '' },
  ] as unknown as DiscogsBrowser['results']

  const release = {
    provider: 'discogs' as const,
    id: 1,
    title: 'Uno',
    artists: [],
    tracklist: [
      { position: '1', title: 'Cara A' },
      { position: '2', title: 'Cara B' },
    ],
  }

  // El colapso es puramente visual (grid-rows-[0fr] + overflow-hidden), y al plegar se
  // sigue renderizando la última tracklist para que la animación de cierre no parpadee.
  // Sin `inert`, esas pistas invisibles siguen siendo paradas de tabulador: el Tab se mete
  // en pistas que el usuario no ve y no puede saber dónde está.
  it('siguen siendo tabulables mientras la tarjeta está desplegada', () => {
    renderPanel(browser({ results, openKey: 'discogs:1', release, loading: false }))
    expect(screen.getAllByTestId('discogs-track')[0].closest('[inert]')).toBeNull()
  })

  it('quedan fuera del tabulador al plegar la tarjeta', () => {
    const { rerender } = renderPanel(
      browser({ results, openKey: 'discogs:1', release, loading: false }),
    )
    rerender(panel(browser({ results, openKey: null, release, loading: false })))

    expect(screen.getAllByTestId('discogs-track')[0].closest('[inert]')).not.toBeNull()
  })

  // jsdom no implementa `inert` (deja enfocar dentro igualmente), así que el tabulador en sí
  // se verifica en Chromium; aquí se cubre lo que sí es lógica nuestra: no dejar el foco
  // huérfano en el body al plegar con el cursor dentro de una pista.
  it('sube el foco a la tarjeta al plegarla con una pista enfocada', () => {
    const { rerender } = renderPanel(
      browser({ results, openKey: 'discogs:1', release, loading: false }),
    )
    screen.getAllByTestId('discogs-track')[0].focus()

    rerender(panel(browser({ results, openKey: null, release, loading: false })))

    expect(screen.getAllByTestId('discogs-result')[0]).toHaveFocus()
  })
})
