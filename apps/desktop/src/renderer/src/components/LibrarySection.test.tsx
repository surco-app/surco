// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { hoverTooltip } from '../test/tooltip'
import { type LibraryRow, LibrarySection } from './LibrarySection'

beforeAll(() => i18n.changeLanguage('es'))
afterEach(cleanup)

function row(over: Partial<LibraryRow> = {}): LibraryRow {
  return {
    id: 'appleMusic',
    name: 'Música',
    format: 'FLAC 44,1 kHz',
    verdict: 'here',
    comparable: true,
    comparison: <div data-testid="comparison">numbers</div>,
    comparisonOpen: false,
    onToggleComparison: vi.fn(),
    ...over,
  }
}

function mount(
  props: Partial<Parameters<typeof LibrarySection>[0]> = {},
  only: Partial<LibraryRow> = {},
) {
  const single = row(only)
  render(<LibrarySection open onToggle={() => {}} rows={[single]} {...props} />)
  return { onToggleComparison: single.onToggleComparison }
}

describe('LibrarySection', () => {
  // A glyph beside the title did not read as "the same copy": each copy now says its relation
  // to this file in a short word, on its own row, next to its format.
  it.each([
    ['same', 'Idéntica'],
    ['here', 'Esta es mejor'],
    ['library', 'Mejor allí'],
    ['tie', 'Parecidas'],
    ['even', 'Ni mejor ni peor'],
    ['measuring', 'Comparando'],
  ] as const)('says the %s state in words on the row', (verdict, words) => {
    mount({}, { verdict })
    const pill = within(screen.getByTestId('library-row')).getByTestId('library-row-state')
    expect(pill).toHaveTextContent(words)
    expect(pill).toHaveAccessibleName(words)
    expect(pill).toHaveAttribute('data-state', verdict)
  })

  // Another version is told apart from a copy that is merely alike, and its length is what
  // tells it apart at a glance: 8:03 here against 7:28 in the library.
  it('names another version with the library copy length', () => {
    mount({}, { verdict: 'different', durationSec: 448.6 })
    const pill = screen.getByTestId('library-row-state')
    expect(pill).toHaveTextContent('Otra versión · 7:28')
    expect(pill).toHaveAccessibleName('Otra versión · 7:28')
    expect(pill).toHaveAttribute('data-state', 'different')
  })

  it('names another version without a length it does not know', () => {
    mount({}, { verdict: 'different' })
    expect(screen.getByTestId('library-row-state')).toHaveAccessibleName('Otra versión')
  })

  // A copy that will be compared keeps its slot before anything is known, not even its
  // format, so neither the chip nor, at a narrow width, the second line appears late.
  it('keeps the state place on a copy that will be compared before anything is known', () => {
    mount({}, { verdict: null, format: '', comparable: true })
    expect(screen.queryByTestId('library-row-state')).toBeNull()
    expect(screen.getByTestId('library-row-state-slot')).toBeInTheDocument()
    expect(screen.getByTestId('library-row-chevron-slot')).toBeInTheDocument()
  })

  // A copy that is this very file is never compared, so its row stays one plain line.
  it('keeps no state place on a copy that will never be compared', () => {
    mount({}, { verdict: null, format: 'WAV', comparable: false, comparison: undefined })
    expect(screen.queryByTestId('library-row-state-slot')).toBeNull()
    expect(screen.queryByTestId('library-row-chevron-slot')).toBeNull()
  })

  // The figures sit in the table; why they decide (a lossy source, a limiter) rides the pill
  // for a screen reader and the tooltip, so the row keeps one short word.
  it('names the reason with the state when there is one', () => {
    mount({}, { verdict: 'library', detail: 'Este archivo tiene pérdida (MP3).' })
    const pill = screen.getByTestId('library-row-state')
    expect(pill).toHaveTextContent(/^Mejor allí$/)
    expect(pill).toHaveAccessibleName('Mejor allí. Este archivo tiene pérdida (MP3).')
    expect(hoverTooltip(pill)).toBe('Mejor allí. Este archivo tiene pérdida (MP3).')
  })

  // Japanese closes a sentence with 。, so the state and its reason join the way each
  // language punctuates, not with an ASCII period glued in by code.
  it('joins the state and its reason with the language own full stop', async () => {
    await i18n.changeLanguage('ja')
    try {
      mount({}, { verdict: 'library', detail: '理由' })
      const name = screen.getByTestId('library-row-state').getAttribute('aria-label') ?? ''
      expect(name.endsWith('。理由')).toBe(true)
    } finally {
      await i18n.changeLanguage('es')
    }
  })

  // The two greens and the amber used to be told apart by shape; now the word does it, so
  // the amber is never carried by colour alone.
  it('keeps every settled state in words of its own', () => {
    const words = (['same', 'here', 'library', 'different', 'tie', 'even'] as const).map((verdict) => {
      mount({}, { verdict })
      const text = screen.getByTestId('library-row-state').textContent
      cleanup()
      return text
    })
    expect(new Set(words).size).toBe(6)
  })

  // Nothing moves when the measurement lands and the format chips line up from row to row:
  // every slot reserves the widest state of the language, with room for a length past an hour.
  it('reserves the same slot in every row, wide enough for any state', () => {
    mount({
      rows: [
        row({ id: 'appleMusic', name: 'Apple Music', verdict: 'measuring' }),
        row({ id: 'rekordbox', name: 'rekordbox', verdict: 'different', durationSec: 448 }),
        row({ id: 'serato', name: 'Serato', verdict: 'same' }),
      ],
    })
    const reserved = screen.getAllByTestId('library-row-state-slot').map((slot) =>
      within(slot)
        .getAllByTestId('library-row-state-sizer')
        .map((sizer) => sizer.textContent),
    )
    expect(reserved).toHaveLength(3)
    for (const labels of reserved) {
      expect(labels).toEqual([
        'Comparando',
        'Idéntica',
        'Esta es mejor',
        'Mejor allí',
        'Parecidas',
        'Ni mejor ni peor',
        'Otra versión · 0:00:00',
      ])
    }
    for (const sizer of screen.getAllByTestId('library-row-state-sizer')) {
      expect(sizer).toHaveAttribute('aria-hidden', 'true')
    }
    for (const slot of screen.getAllByTestId('library-row-state-slot')) {
      expect(slot).toContainElement(within(slot).getByTestId('library-row-state'))
    }
  })

  // The chevron only appears once the comparison can open; its place is kept from the start,
  // so the pill does not slide sideways when "Comparing" turns into the result.
  it('keeps the chevron place on a row whose state opens nothing yet', () => {
    mount({}, { verdict: 'measuring', comparison: undefined })
    const waiting = screen.getByTestId('library-row-chevron-slot')
    expect(waiting.querySelector('svg')).toBeNull()
    cleanup()
    mount({}, { verdict: 'here' })
    expect(screen.getByTestId('library-row-chevron-slot').querySelector('svg')).not.toBeNull()
  })

  // An identical copy has nothing to weigh: the editor hands it no comparison, so its row is
  // not a control that opens nothing.
  it('never makes an identical copy a button', () => {
    mount({}, { verdict: 'same', comparison: undefined })
    expect(screen.getByTestId('library-row').tagName).not.toBe('BUTTON')
  })

  // Open, the rows say each copy's state; the header saying it again was the same thing twice.
  it('keeps the header free of a state while the section is open', () => {
    mount({}, { verdict: 'library' })
    expect(screen.queryByTestId('library-verdict')).toBeNull()
  })

  // Folded, the rows are hidden, so the header carries the state that most needs the reader.
  it('carries the most urgent state in the header when folded', () => {
    mount({
      open: false,
      rows: [
        row({ id: 'appleMusic', name: 'Apple Music', verdict: 'same' }),
        row({ id: 'rekordbox', name: 'rekordbox', verdict: 'different', durationSec: 300 }),
        row({ id: 'serato', name: 'Serato', verdict: 'here' }),
      ],
    })
    const pill = screen.getByTestId('library-verdict')
    expect(pill).toHaveAttribute('data-state', 'here')
    expect(pill).toHaveAccessibleName('Esta es mejor')
  })

  // With several programs "better there" cannot say where, so the folded header names it.
  it('names the program holding the better copy when folded over several rows', () => {
    mount({
      open: false,
      rows: [
        row({ id: 'appleMusic', name: 'Apple Music', verdict: 'here' }),
        row({ id: 'engine', name: 'Engine DJ', verdict: 'library', detail: 'Razón.' }),
      ],
    })
    const pill = screen.getByTestId('library-verdict')
    expect(pill).toHaveTextContent(/^Mejor en Engine DJ$/)
    expect(pill).toHaveAccessibleName('Mejor en Engine DJ. Razón.')
  })

  it('says better there plainly when folded over one row', () => {
    mount({ open: false }, { verdict: 'library' })
    expect(screen.getByTestId('library-verdict')).toHaveTextContent(/^Mejor allí$/)
  })

  it('says another version in the folded header without a length', () => {
    mount({ open: false }, { verdict: 'different', durationSec: 300 })
    expect(screen.getByTestId('library-verdict')).toHaveTextContent(/^Otra versión$/)
  })

  it('shows no folded state until there is one', () => {
    mount({ open: false }, { verdict: null })
    expect(screen.queryByTestId('library-verdict')).not.toBeInTheDocument()
  })

  // The row carries the same mark the library wears in the sidebar, so it is recognised
  // before it is read.
  it.each([
    ['appleMusic', 'Apple Music'],
    ['rekordbox', 'rekordbox'],
    ['engine', 'Engine DJ'],
    ['traktor', 'Traktor'],
    ['serato', 'Serato'],
    ['virtualdj', 'VirtualDJ'],
  ] as const)('leads the row with the %s sidebar glyph', (id, name) => {
    mount({}, { id, name })
    expect(screen.getByTestId('library-row-icon')).toHaveAccessibleName(name)
    expect(screen.getByTestId('library-row-icon')).toHaveAttribute('data-source', id)
  })

  // The copy's format reads as the same chip the track list uses for a file's format.
  it('sets the copy format in a format chip', () => {
    mount({}, { format: 'AIFF 24/48' })
    expect(screen.getByTestId('library-row-format')).toHaveTextContent('AIFF 24/48')
  })

  it('opens the comparison from the row', () => {
    const { onToggleComparison } = mount({}, { comparisonOpen: false })
    expect(screen.queryByTestId('comparison')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('library-row'))
    expect(onToggleComparison).toHaveBeenCalledTimes(1)
    cleanup()
    mount({}, { comparisonOpen: true })
    expect(screen.getByTestId('comparison')).toBeInTheDocument()
    expect(screen.getByTestId('library-row')).toHaveAttribute('aria-expanded', 'true')
  })

  it('renders a plain row without format, state or chevron', () => {
    mount({}, { format: '', verdict: null, comparable: false, comparison: undefined })
    const plain = screen.getByTestId('library-row')
    expect(plain.tagName).not.toBe('BUTTON')
    const icon = screen.getByTestId('library-row-icon')
    expect([...plain.querySelectorAll('svg')].filter((svg) => !icon.contains(svg))).toEqual([])
    expect(screen.queryByTestId('library-row-format')).toBeNull()
    expect(plain).toHaveTextContent('Música')
  })

  it('renders one row per program in the given order', () => {
    mount({
      rows: [
        row({ id: 'appleMusic', name: 'Apple Music' }),
        row({ id: 'rekordbox', name: 'rekordbox' }),
        row({ id: 'traktor', name: 'Traktor' }),
      ],
    })
    const rows = screen.getAllByTestId('library-row')
    expect(rows.map((r) => r.getAttribute('data-row'))).toEqual([
      'appleMusic',
      'rekordbox',
      'traktor',
    ])
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Apple Music'),
      expect.stringContaining('rekordbox'),
      expect.stringContaining('Traktor'),
    ])
  })

  it('opens each comparison on its own', () => {
    const music = row({
      id: 'appleMusic',
      comparison: <div data-testid="comparison-music">music</div>,
      comparisonOpen: true,
    })
    const rekordbox = row({
      id: 'rekordbox',
      name: 'rekordbox',
      comparison: <div data-testid="comparison-rekordbox">rekordbox</div>,
    })
    mount({ rows: [music, rekordbox] })
    expect(screen.getByTestId('comparison-music')).toBeInTheDocument()
    expect(screen.queryByTestId('comparison-rekordbox')).not.toBeInTheDocument()
    const [musicRow, rekordboxRow] = screen.getAllByTestId('library-row')
    expect(musicRow).toHaveAttribute('aria-expanded', 'true')
    expect(rekordboxRow).toHaveAttribute('aria-expanded', 'false')
    expect(musicRow.getAttribute('aria-controls')).not.toBe(
      rekordboxRow.getAttribute('aria-controls'),
    )
    fireEvent.click(rekordboxRow)
    expect(rekordbox.onToggleComparison).toHaveBeenCalledTimes(1)
    expect(music.onToggleComparison).not.toHaveBeenCalled()
  })
})
