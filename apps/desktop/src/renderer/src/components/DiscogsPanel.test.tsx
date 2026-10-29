// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { DiscogsBrowser } from '../hooks/useDiscogsBrowser'
import { resetEditorPlace } from '../lib/editorPlace'
import { DiscogsPanel } from './DiscogsPanel'

afterEach(() => {
  cleanup()
  resetEditorPlace()
})

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
    suggestedConfident: false,
    pendingProviders: [],
    searchProgress: null,
    held: { count: 0, providers: [] },
    showHeld: vi.fn(),
    choosingBest: false,
    loading: false,
    busy: false,
    noResults: false,
    error: '',
    previewRelease: vi.fn(),
    ...overrides,
  }
}

function panel(b: DiscogsBrowser, fileDurationSec?: number) {
  return (
    <DiscogsPanel
      browser={b}
      matchedTrack={undefined}
      matchTier={undefined}
      appliedTrack={undefined}
      fileDurationSec={fileDurationSec}
      showTokenTip={false}
      isMulti={false}
      selectedTracks={undefined}
      onApplyMatches={undefined}
      selectTrack={vi.fn()}
      searchInputRef={createRef<HTMLInputElement>()}
      formatFilter={[]}
      width={315}
      onResizeStart={vi.fn()}
      onFit={vi.fn()}
    />
  )
}

function renderPanel(b: DiscogsBrowser, fileDurationSec?: number) {
  return render(panel(b, fileDurationSec))
}

describe('DiscogsPanel column width', () => {
  function renderSized(onResizeStart = vi.fn(), onFit = vi.fn<(deficit: number) => void>()) {
    render(
      <DiscogsPanel
        browser={browser({ results: [{ provider: 'discogs', id: 1, title: 'A long album' }] })}
        matchedTrack={undefined}
        matchTier={undefined}
        appliedTrack={undefined}
        fileDurationSec={undefined}
        showTokenTip={false}
        isMulti={false}
        selectedTracks={undefined}
        onApplyMatches={undefined}
        selectTrack={vi.fn()}
        searchInputRef={createRef<HTMLInputElement>()}
        formatFilter={[]}
        width={377}
        onResizeStart={onResizeStart}
        onFit={onFit}
      />,
    )
    return { onResizeStart, onFit }
  }

  it('takes the width the window layout hands it, so resizing the window resizes the column', () => {
    renderSized()
    expect(screen.getByTestId('matches-column')).toHaveStyle({ width: '377px' })
  })

  it('hands the drag of its divider to the layout, which saves it as a share', () => {
    const { onResizeStart } = renderSized()
    fireEvent.pointerDown(screen.getByRole('separator'))
    expect(onResizeStart).toHaveBeenCalledTimes(1)
  })

  it('measures how far the widest title is clipped on double-click and asks the layout for that much', () => {
    const { onFit } = renderSized()
    const span = within(screen.getByTestId('discogs-result')).getByText('A long album')
    const fit = span.closest<HTMLElement>('[data-fit]') ?? span
    Object.defineProperty(fit, 'scrollWidth', { configurable: true, value: 260 })
    Object.defineProperty(fit, 'clientWidth', { configurable: true, value: 200 })
    fireEvent.doubleClick(screen.getByRole('separator'))
    expect(onFit).toHaveBeenCalledWith(60)
  })
})

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

// A late answer takes its ranked place among rows already on screen. Without a mark it
// slips in unnoticed between them; the row that just arrived says so for a moment.
describe('DiscogsPanel late arrivals', () => {
  const row = (id: number, provider: 'discogs' | 'bandcamp' = 'discogs') => ({
    provider,
    id,
    title: `Album ${id}`,
  })
  const fresh = () =>
    screen
      .getAllByTestId('discogs-result')
      .filter((b) => b.dataset.fresh === 'true')
      .map((b) => b.textContent?.match(/Album \d+/)?.[0])

  it('marks a row that joins a list already on screen', () => {
    const { rerender } = renderPanel(browser({ query: 'x', results: [row(1), row(2)] }))
    expect(fresh()).toEqual([])

    rerender(panel(browser({ query: 'x', results: [row(1), row(9, 'bandcamp'), row(2)] })))

    expect(fresh()).toEqual(['Album 9'])
  })

  // A new search is a new list, not a late arrival: nothing in it is marked.
  it('marks nothing in the list a new search brings', () => {
    const { rerender } = renderPanel(browser({ query: 'x', results: [row(1), row(2)] }))

    rerender(panel(browser({ query: 'y', results: [row(7), row(8)] })))

    expect(fresh()).toEqual([])
  })
})

describe('DiscogsPanel empty states', () => {
  // Before this split, an empty result set always showed the "choose an album" hint, so a
  // search that genuinely matched nothing looked identical to never having searched — the
  // user got no signal their query came up dry. The no-results placeholder is what tells
  // them the search ran and found nothing.
  it('shows the no-results placeholder when a search settled with zero rows', () => {
    renderPanel(browser({ query: 'zzz no such album', noResults: true }))

    expect(screen.getByTestId('discogs-no-results')).toHaveTextContent(/no albums matched/i)
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

// A screen reader user pressing Enter in the search box heard nothing afterwards: the
// spinner is an icon, the skeleton is hidden and the rows just appear. A status region,
// mounted empty before any search so assistive tech is already listening, says each step,
// and an error interrupts as an alert.
describe('DiscogsPanel search announcements', () => {
  const results = [
    { provider: 'discogs', id: 1, title: 'Uno' },
    { provider: 'discogs', id: 2, title: 'Dos' },
  ] as unknown as DiscogsBrowser['results']

  it('keeps an empty status region mounted before any search', () => {
    renderPanel(browser({}))
    const status = screen.getByTestId('discogs-status')
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toBeEmptyDOMElement()
  })

  it('says it is searching, then how many results arrived', () => {
    const { rerender } = renderPanel(browser({ query: 'uno', busy: true }))
    const status = screen.getByTestId('discogs-status')
    expect(status).toHaveTextContent('Searching…')
    rerender(panel(browser({ query: 'uno', results })))
    expect(screen.getByTestId('discogs-status')).toBe(status)
    expect(status).toHaveTextContent('2 results')
  })

  it('says a search came up empty', () => {
    renderPanel(browser({ query: 'zzz', noResults: true }))
    expect(screen.getByTestId('discogs-status')).toHaveTextContent(/no albums matched/i)
  })

  it('does not call opening a release a search', () => {
    renderPanel(browser({ query: 'uno', results, busy: true, loading: true }))
    expect(screen.getByTestId('discogs-status')).toHaveTextContent('2 results')
  })

  it('announces a failed search as an alert', () => {
    renderPanel(browser({ query: 'uno', error: 'Discogs refused the token' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Discogs refused the token')
  })
})

// The sparkle marks were painted in accent or amber with their word only in a hover
// tooltip, so a screen reader met a bare row and a colour-blind user saw two identical
// marks. The words ride along as text: which result is suggested, and on the track,
// whether the match is confident or still needs confirming.
describe('DiscogsPanel suggestion marks', () => {
  const results = [
    { provider: 'discogs', id: 1, title: 'Uno' },
    { provider: 'discogs', id: 2, title: 'Dos' },
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

  function renderMatched(matchTier: 'high' | 'review') {
    render(
      <DiscogsPanel
        browser={browser({
          results,
          openKey: 'discogs:1',
          suggestedKey: 'discogs:1',
          release,
        })}
        matchedTrack={release.tracklist[1]}
        matchTier={matchTier}
        appliedTrack={undefined}
        fileDurationSec={undefined}
        showTokenTip={false}
        isMulti={false}
        selectedTracks={undefined}
        onApplyMatches={undefined}
        selectTrack={vi.fn()}
        searchInputRef={createRef<HTMLInputElement>()}
        formatFilter={[]}
        width={315}
        onResizeStart={vi.fn()}
        onFit={vi.fn()}
      />,
    )
  }

  it('names the suggested release in its row', () => {
    renderMatched('high')
    const [first, second] = screen.getAllByTestId('discogs-result')
    expect(first).toHaveAccessibleName(/suggested/i)
    expect(second).not.toHaveAccessibleName(/suggested/i)
  })

  it('tells a confident track match from one to confirm', () => {
    renderMatched('high')
    expect(screen.getByTestId('track-confidence')).toHaveAccessibleName('Suggested')
    cleanup()
    renderMatched('review')
    expect(screen.getByTestId('track-confidence')).toHaveAccessibleName('Match to confirm')
  })
})

describe('DiscogsPanel track length check', () => {
  const results = [
    { provider: 'bandcamp', id: 1, title: 'LCE' },
  ] as unknown as DiscogsBrowser['results']
  const release = {
    provider: 'bandcamp' as const,
    id: 1,
    title: 'LCE',
    artists: [],
    tracklist: [
      { position: '1', title: '01 Intro', duration: '0:36' },
      { position: '2', title: '02 Untitled Track', duration: '3:57' },
      { position: '3', title: '03 Outro' },
    ],
  }
  const openRelease = browser({ results, openKey: 'bandcamp:1', release })
  const mismatchOf = (title: string) =>
    within(
      screen
        .getAllByTestId('discogs-track')
        .find((row) => row.textContent?.includes(title)) as HTMLElement,
    ).queryByTestId('track-length-mismatch')

  it('warns on a track far longer than the file, so a different edit is not applied unnoticed', () => {
    renderPanel(openRelease, 35)
    expect(mismatchOf('02 Untitled Track')).toHaveAccessibleName(
      'Length differs from your file (0:35)',
    )
  })

  it('stays quiet on a track whose length agrees with the file', () => {
    renderPanel(openRelease, 35)
    expect(mismatchOf('01 Intro')).toBeNull()
  })

  it('claims no mismatch where either length is unknown', () => {
    renderPanel(openRelease, 35)
    expect(mismatchOf('03 Outro')).toBeNull()
    cleanup()
    renderPanel(openRelease)
    expect(screen.queryByTestId('track-length-mismatch')).toBeNull()
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

  // Solo el cursor de teclado se pinta: con `focus:` la tarjeta que acababas de pulsar con el
  // ratón se quedaba azul, y junto a la pista aplicada y la fila de la lista eran tres bloques
  // azules en pantalla sin que ninguno dijera cuál era la selección.
  it('marca visiblemente la tarjeta enfocada con el teclado, y no la pulsada con el ratón', () => {
    renderPanel(browser({ results }))
    const first = screen.getAllByTestId('discogs-result')[0]
    first.focus()
    expect(first).toHaveFocus()
    expect(first.className).toContain('focus-visible:bg-[var(--color-accent-soft)]')
    expect(first.className).toContain('focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent)]')
    expect(first.className).toContain('focus-visible:outline-none')
    expect(first.className).not.toMatch(/(^|\s)focus:bg-/)
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

  it('names each Beatport version by its mix, since they share the title', () => {
    const release = {
      provider: 'discogs' as const,
      id: 1,
      title: 'DESPECHÁ',
      artists: [],
      tracklist: [
        { position: '1', title: 'DESPECHÁ', mixName: 'Clean' },
        { position: '2', title: 'DESPECHÁ', mixName: 'Intro' },
      ],
    }
    renderPanel(browser({ results, openKey: 'discogs:1', release, loading: false }))
    expect(screen.getAllByTestId('discogs-track').map((t) => t.textContent)).toEqual([
      expect.stringContaining('DESPECHÁ (Clean)'),
      expect.stringContaining('DESPECHÁ (Intro)'),
    ])
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
    expect(track.className).toContain('focus-visible:bg-[var(--color-accent-soft)]')
    expect(track.className).toContain('focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent)]')
    expect(track.className).toContain('focus-visible:outline-none')
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
  // Las pistas sangradas bajo la carátula ya dicen de qué disco son y cuántas hay: la
  // franja "Elige la pista para aplicar · 2 pistas" repetía con palabras lo que se ve.
  it('despliega las pistas sin una franja que las anuncie', () => {
    renderPanel(browser({ results, openKey: 'discogs:1', release, loading: false }))
    expect(screen.queryByText('Choose the track to apply')).toBeNull()
    expect(screen.queryByText('2 tracks')).toBeNull()
    expect(screen.getAllByTestId('discogs-track')).toHaveLength(2)
  })

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

  // El rescate del foco debe mirar SOLO su propia tarjeta. Buscando el botón en toda la
  // lista devolvía siempre el primer resultado, así que cada ↓ por los resultados rebotaba
  // al primer álbum y la columna parecía congelada.
  it('devuelve el foco a su propia tarjeta, no a la primera de la lista', () => {
    const dos = { ...release, id: 2, title: 'Dos' }
    const { rerender } = renderPanel(
      browser({ results, openKey: 'discogs:2', release: dos, loading: false }),
    )
    screen.getAllByTestId('discogs-track')[0].focus()

    rerender(panel(browser({ results, openKey: null, release: dos, loading: false })))

    expect(screen.getAllByTestId('discogs-result')[1]).toHaveFocus()
  })

  // El roving de ↑/↓ no puede parar en las pistas de una tarjeta plegada: siguen montadas
  // por la animación, así que ↓ se detenía en una pista invisible y la columna parecía
  // congelada en el primer álbum. Sólo cuentan los elementos fuera de un contenedor `inert`.
  it('no cuenta las pistas plegadas al recorrer los resultados', () => {
    const { rerender } = renderPanel(
      browser({ results, openKey: 'discogs:1', release, loading: false }),
    )
    rerender(panel(browser({ results, openKey: null, release, loading: false })))

    const navegables = [
      ...screen.getByTestId('matches-column').querySelectorAll('[data-testid]'),
    ].filter(
      (el) =>
        ['discogs-result', 'discogs-track'].includes(el.getAttribute('data-testid') ?? '') &&
        !el.closest('[inert]'),
    )
    expect(navegables).toHaveLength(results.length)
  })
})

// The list waits for every catalog (up to a hold) and then shows once; what answers later
// waits behind a button instead of sliding in among the rows being read (12/10).
describe('DiscogsPanel stable results', () => {
  const rows = [
    { provider: 'bandcamp', id: 9, title: 'Javier Fig - Fast Food / Slow Kids' },
    { provider: 'deezer', id: 5, title: 'Javier Fig - Other' },
  ] as unknown as DiscogsBrowser['results']

  it('says how many catalogs answered while the list waits for them', () => {
    renderPanel(browser({ query: 'x', busy: true, searchProgress: { answered: 2, total: 5 } }))
    expect(screen.getByTestId('discogs-progress')).toHaveTextContent('2 of 5 sources answered')
    expect(screen.getByTestId('discogs-skeleton')).toBeInTheDocument()
  })

  // The count sat in small grey text under the box; the divider above the list fills as
  // the catalogs answer, the way the toolbar's line shows an import.
  it('fills the divider under the search box as the catalogs answer', () => {
    renderPanel(browser({ query: 'x', busy: true, searchProgress: { answered: 3, total: 5 } }))
    const bar = within(screen.getByTestId('matches-column')).getByTestId('top-progress')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('60%')
  })

  // Once the list shows, a slow catalog keeps searching behind it: the line keeps counting
  // it instead of turning into an endless slide.
  it('keeps counting a catalog that answers after the list showed', () => {
    renderPanel(
      browser({
        query: 'x',
        busy: true,
        results: rows,
        providerCounts: [
          { provider: 'discogs', count: 1 },
          { provider: 'bandcamp', count: 1 },
          { provider: 'deezer', count: 1 },
          { provider: 'beatport', count: 0 },
        ],
        pendingProviders: ['beatport'],
      }),
    )
    const bar = within(screen.getByTestId('matches-column')).getByTestId('top-progress')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('75%')
  })

  it('slides the divider while a single catalog or the best match is still working', () => {
    renderPanel(browser({ query: 'x', busy: true }))
    const bar = within(screen.getByTestId('matches-column')).getByTestId('top-progress')
    expect(bar.firstElementChild?.className).toContain('animate-top-progress')
  })

  // Opening a release is not a search: the list is there and the tracks show their own
  // placeholder, so the line stays still.
  it('leaves the divider still while a release opens and when idle', () => {
    renderPanel(browser({ query: 'x', busy: true, loading: true }))
    expect(screen.queryByTestId('top-progress')).not.toBeInTheDocument()
    cleanup()
    renderPanel(browser({ query: 'x' }))
    expect(screen.queryByTestId('top-progress')).not.toBeInTheDocument()
  })

  // No placeholder rows below the list: a late catalog's rows no longer land there, so the
  // panel names it instead of promising rows in a spot they will not fill.
  it('names the catalog still searching below the rows shown', () => {
    renderPanel(browser({ query: 'x', results: rows, busy: true, pendingProviders: ['discogs'] }))
    const pending = screen.getByTestId('discogs-pending')
    expect(pending).toHaveTextContent('Still searching Discogs…')
    expect(within(pending).queryAllByTestId('skeleton-row')).toHaveLength(0)
  })

  it('shows no pending line once every catalog has answered', () => {
    renderPanel(browser({ query: 'x', results: rows }))
    expect(screen.queryByTestId('discogs-pending')).toBeNull()
  })

  // The release the auto-match opens is the one the user came for: it has a fixed place at
  // the top, held open while it is being chosen, so nobody scrolls to find it.
  it('keeps the top slot for the best match while it is being chosen', () => {
    renderPanel(browser({ query: 'x', results: rows, choosingBest: true }))
    const slot = screen.getByTestId('best-match-slot')
    expect(slot).toHaveTextContent('Best match')
    expect(within(slot).getAllByTestId('skeleton-row')).toHaveLength(1)
    expect(slot.compareDocumentPosition(screen.getAllByTestId('result-card')[0])).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('heads the best match at the top of the list', () => {
    renderPanel(
      browser({ query: 'x', results: rows, suggestedKey: 'bandcamp:9', suggestedConfident: true }),
    )
    const label = screen.getByTestId('best-match-label')
    expect(label).toHaveTextContent('Best match')
    expect(label.compareDocumentPosition(screen.getAllByTestId('result-card')[0])).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('calls no unconfirmed suggestion the best match, so an unrelated release is not vouched for', () => {
    renderPanel(browser({ query: 'x', results: rows, suggestedKey: 'bandcamp:9' }))
    expect(screen.queryByTestId('best-match-label')).toBeNull()
    expect(screen.getByTestId('result-suggested')).toBeInTheDocument()
  })

  it('heads nothing when the suggestion is not the first row', () => {
    renderPanel(browser({ query: 'x', results: rows, suggestedKey: 'deezer:5' }))
    expect(screen.queryByTestId('best-match-label')).toBeNull()
  })

  // Late answers wait at the foot of the list, where "Still searching" stood: inserted
  // at the top they pushed every row down under the pointer the moment Discogs answered.
  it('offers what answered late behind a button, after the rows', () => {
    const showHeld = vi.fn()
    renderPanel(
      browser({
        query: 'x',
        results: rows,
        suggestedKey: 'bandcamp:9',
        held: { count: 4, providers: ['discogs'] },
        showHeld,
      }),
    )
    const button = screen.getByTestId('discogs-held')
    expect(button).toHaveTextContent('4 more from Discogs · Show')
    const cards = screen.getAllByTestId('result-card')
    expect(cards.at(-1)?.compareDocumentPosition(button)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    fireEvent.click(button)
    expect(showHeld).toHaveBeenCalled()
  })

  // The sparkle and the heading are visual; a screen reader hears which release is suggested.
  it('names the suggested release in the status once the search settled', () => {
    renderPanel(browser({ query: 'x', results: rows, suggestedKey: 'bandcamp:9' }))
    expect(screen.getByTestId('discogs-status')).toHaveTextContent(
      '2 results. Suggested: Javier Fig - Fast Food / Slow Kids',
    )
  })
})

describe('DiscogsPanel result thumbnail', () => {
  // A MusicBrainz thumbnail is a Cover Art Archive URL asked on faith: a release without
  // art answers 404 and archive.org sometimes 500s. The browser then paints its broken-image
  // glyph in the row, which reads as an app fault; the empty cover slot is the honest look.
  it('falls back to the empty cover slot when the thumbnail fails to load', () => {
    renderPanel(
      browser({
        results: [
          {
            provider: 'musicbrainz',
            id: 1,
            title: 'Jewel - La Morta!',
            thumb: 'https://coverartarchive.org/release/ad66faf4/front-250',
          },
        ],
      }),
    )
    const thumb = screen.getByTestId('result-thumb')
    expect(screen.queryByTestId('result-thumb-empty')).toBeNull()
    fireEvent.error(thumb)
    expect(screen.queryByTestId('result-thumb')).toBeNull()
    expect(screen.getByTestId('result-thumb-empty')).toBeInTheDocument()
  })
})

describe('DiscogsPanel while the pointer is over the results', () => {
  const a = { provider: 'discogs' as const, id: 1, title: 'Album A' }
  const b = { provider: 'discogs' as const, id: 2, title: 'Album B' }
  const c = { provider: 'discogs' as const, id: 3, title: 'Album C' }
  const keys = (): string[] =>
    screen.getAllByTestId('result-card').map((r) => r.getAttribute('data-key') ?? '')
  const releaseC = {
    provider: 'discogs' as const,
    id: 3,
    title: 'Album C',
    artists: [],
    tracklist: [{ position: '1', title: 'One' }],
  }

  // The best-match pick lands seconds after the list shows. Pinning it to the top and
  // unfolding its tracklist moved every row under a user about to click one, and the
  // click opened a different album. Nothing moves until the pointer leaves the list.
  it('holds the order and the auto-open until the pointer leaves', () => {
    const { rerender } = renderPanel(
      browser({ query: 'x', results: [a, b, c], choosingBest: true }),
    )
    fireEvent.pointerEnter(screen.getByTestId('discogs-results'))
    rerender(
      panel(
        browser({
          query: 'x',
          results: [c, a, b],
          suggestedKey: 'discogs:3',
          openKey: 'discogs:3',
          release: releaseC,
        }),
      ),
    )
    expect(keys()).toEqual(['discogs:1', 'discogs:2', 'discogs:3'])
    expect(screen.getByTestId('best-match-slot')).toBeInTheDocument()
    expect(screen.queryByTestId('discogs-track')).toBeNull()
    fireEvent.pointerLeave(screen.getByTestId('discogs-results'))
    expect(keys()).toEqual(['discogs:3', 'discogs:1', 'discogs:2'])
    expect(screen.getAllByTestId('discogs-track')).toHaveLength(1)
  })

  // The user's own click is never held: it opens the row under the pointer at once.
  it('opens a row the user clicks right away', () => {
    const previewRelease = vi.fn()
    const { rerender } = renderPanel(browser({ query: 'x', results: [a, b, c], previewRelease }))
    fireEvent.pointerEnter(screen.getByTestId('discogs-results'))
    fireEvent.click(screen.getAllByTestId('discogs-result')[2])
    expect(previewRelease).toHaveBeenCalled()
    rerender(
      panel(
        browser({
          query: 'x',
          results: [a, b, c],
          previewRelease,
          openKey: 'discogs:3',
          release: releaseC,
        }),
      ),
    )
    expect(screen.getAllByTestId('discogs-track')).toHaveLength(1)
  })
})

describe('DiscogsPanel empty source', () => {
  // Filtering to a source with no answers said "No albums matched your search" while the
  // other sources had plenty, which read as a failed search.
  it('names the filtered source when only it came back empty', () => {
    renderPanel(
      browser({
        query: 'x',
        noResults: true,
        providerFilter: 'bandcamp',
        providerCounts: [
          { provider: 'discogs', count: 4 },
          { provider: 'bandcamp', count: 0 },
        ],
      }),
    )
    expect(screen.getByTestId('discogs-no-results')).toHaveTextContent(
      'Bandcamp has nothing for this search.',
    )
  })
})

describe('DiscogsPanel compilation tracklist', () => {
  // On a compilation every track has its own artist, and the version that tells two
  // tracks apart ("Extended Mix") sits at the end of a title the column cuts. Without
  // both, matching the right track to the file was guesswork.
  it('shows each track artist that differs from the album and the full title on hover', () => {
    const release = {
      provider: 'discogs' as const,
      id: 1,
      title: 'Hard House Nation',
      artists: [{ name: 'Various' }],
      tracklist: [
        { position: '1', title: 'Snap (Extended Mix)', artists: [{ name: 'DJ Lara' }] },
        { position: '2', title: 'Other', artists: [{ name: 'Various' }] },
      ],
    }
    renderPanel(
      browser({
        query: 'x',
        results: [{ provider: 'discogs', id: 1, title: 'Hard House Nation' }],
        openKey: 'discogs:1',
        release,
      }),
    )
    const [first, second] = screen.getAllByTestId('discogs-track')
    expect(first).toHaveTextContent('DJ Lara')
    expect(within(first).getByTitle('DJ Lara - Snap (Extended Mix)')).toBeInTheDocument()
    expect(second).not.toHaveTextContent('Various')
  })
})

describe('DiscogsPanel last applied album', () => {
  const hardHouse = { provider: 'discogs' as const, id: 1, title: 'Hard House Nation' }
  const release = {
    provider: 'discogs' as const,
    id: 1,
    title: 'Hard House Nation',
    artists: [{ name: 'Various' }],
    tracklist: [{ position: '1', title: 'Snap', artists: [{ name: 'Various' }] }],
  }

  function applyFromHardHouse(): void {
    renderPanel(browser({ query: 'x', results: [hardHouse], openKey: 'discogs:1', release }))
    fireEvent.click(screen.getByTestId('discogs-track'))
    cleanup()
  }

  function shownKeys(): string[] {
    return screen.getAllByTestId('result-card').map((c) => c.dataset.key ?? '')
  }

  // Tagging an album means the same release track after track, and the next track's search
  // rarely put it first: finding it again was a scroll through near-identical pressings.
  it('pins the album applied on the last track at the top of the next one', () => {
    applyFromHardHouse()
    const b = browser({
      query: 'y',
      results: [
        { provider: 'discogs', id: 2, title: 'Other' },
        { provider: 'discogs', id: 3, title: 'Another' },
      ],
    })
    renderPanel(b)
    expect(shownKeys()).toEqual(['discogs:1', 'discogs:2', 'discogs:3'])
    expect(screen.getByTestId('last-applied-label')).toBeInTheDocument()
    expect(b.previewRelease).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByTestId('discogs-result')[0])
    expect(b.previewRelease).toHaveBeenCalledWith(hardHouse)
  })

  it('shows the pinned album once when the search also found it', () => {
    applyFromHardHouse()
    renderPanel(
      browser({
        query: 'y',
        results: [{ provider: 'discogs', id: 2, title: 'Other' }, hardHouse],
      }),
    )
    expect(shownKeys()).toEqual(['discogs:1', 'discogs:2'])
  })

  // The source filter row lands above the list with the first results; a pinned card drawn
  // before them slid down under the pointer the moment they arrived.
  it('waits for the results to show the pinned album with them', () => {
    applyFromHardHouse()
    renderPanel(browser({ query: 'y', results: [], busy: true }))
    expect(screen.queryByTestId('last-applied-label')).not.toBeInTheDocument()
    expect(screen.getByTestId('discogs-skeleton')).toBeInTheDocument()
  })

  it('pins nothing before an album was applied', () => {
    renderPanel(browser({ query: 'y', results: [{ provider: 'discogs', id: 2, title: 'Other' }] }))
    expect(screen.queryByTestId('last-applied-label')).not.toBeInTheDocument()
  })
})

// artexjay on v1.8.0: the source menu opened under the result rows, so Discogs → MusicBrainz
// could hardly be picked. The divider's progress line had made the header its own stacking
// context, which traps the menu, and the backdrop that closes it, below the list and every
// layered control in the window.
describe('DiscogsPanel source menu stacking', () => {
  const trapsLayers = (el: Element): boolean => /\b(isolate|z-\S+)/.test(el.className)

  it('leaves the source menu free to layer over the result rows', () => {
    renderPanel(
      browser({
        query: 'x',
        results: [{ provider: 'discogs', id: 1, title: 'Album' }],
        providerCounts: [
          { provider: 'discogs', count: 1 },
          { provider: 'musicbrainz', count: 1 },
        ],
      }),
    )
    fireEvent.click(screen.getByTestId('provider-filter'))
    const column = screen.getByTestId('matches-column')
    let el = screen.getByTestId('provider-filter-listbox').parentElement
    while (el && el !== column) {
      expect(trapsLayers(el)).toBe(false)
      el = el.parentElement
    }
  })
})
