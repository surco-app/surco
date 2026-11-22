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

// A second copy in another state keeps each row's own pill: a state every row shares goes
// once in the header instead.
function mountApart(only: Partial<LibraryRow> = {}) {
  const first = row(only)
  const other = row({
    id: 'rekordbox',
    name: 'rekordbox',
    verdict: only.verdict === 'measuring' ? 'same' : 'measuring',
  })
  render(<LibrarySection open onToggle={() => {}} rows={[first, other]} />)
  return within(screen.getAllByTestId('library-row')[0]).getByTestId('library-row-state')
}

describe('LibrarySection', () => {
  // A glyph beside the title did not read as "the same copy": each copy now says its relation
  // to this file in a short word, on its own row, next to its format.
  it.each([
    ['same', 'Son el mismo'],
    ['here', 'Tu archivo es mejor'],
    ['library', 'Tu archivo es peor'],
    ['tie', 'Parecidas'],
    ['even', 'Ni mejor ni peor'],
    ['measuring', 'Comparando'],
  ] as const)('says the %s state in words on the row', (verdict, words) => {
    const pill = mountApart({ verdict })
    expect(pill).toHaveTextContent(words)
    expect(pill).toHaveAccessibleName(words)
    expect(pill).toHaveAttribute('data-state', verdict)
  })

  // Another version is told apart from a copy that is merely alike, and its length is what
  // tells it apart at a glance: 8:03 here against 7:28 in the library.
  it('names another version with the library copy length', () => {
    const pill = mountApart({ verdict: 'different', durationSec: 448.6 })
    expect(pill).toHaveTextContent('Otra versión · 7:28')
    expect(pill).toHaveAccessibleName('Otra versión · 7:28')
    expect(pill).toHaveAttribute('data-state', 'different')
  })

  it('names another version without a length it does not know', () => {
    expect(mountApart({ verdict: 'different' })).toHaveAccessibleName('Otra versión')
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
    const pill = mountApart({ verdict: 'library', detail: 'Este archivo tiene pérdida (MP3).' })
    expect(pill).toHaveTextContent(/^Tu archivo es peor$/)
    expect(pill).toHaveAccessibleName('Tu archivo es peor. Este archivo tiene pérdida (MP3).')
    expect(hoverTooltip(pill)).toBe('Tu archivo es peor. Este archivo tiene pérdida (MP3).')
  })

  // Japanese closes a sentence with 。, so the state and its reason join the way each
  // language punctuates, not with an ASCII period glued in by code.
  it('joins the state and its reason with the language own full stop', async () => {
    await i18n.changeLanguage('ja')
    try {
      const name =
        mountApart({ verdict: 'library', detail: '理由' }).getAttribute('aria-label') ?? ''
      expect(name.endsWith('。理由')).toBe(true)
    } finally {
      await i18n.changeLanguage('es')
    }
  })

  // The two greens and the amber used to be told apart by shape; now the word does it, so
  // the amber is never carried by colour alone.
  it('keeps every settled state in words of its own', () => {
    const words = (['same', 'here', 'library', 'different', 'tie', 'even'] as const).map(
      (verdict) => {
        const text = mountApart({ verdict }).textContent
        cleanup()
        return text
      },
    )
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
        'Son el mismo',
        'Tu archivo es mejor',
        'Tu archivo es peor',
        'Parecidas',
        'Ni mejor ni peor',
        'Otra versión · 0:00:00',
        'Es este archivo',
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
    mountApart({ verdict: 'library' })
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
    expect(pill).toHaveAccessibleName('Tu archivo es mejor')
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
    expect(pill).toHaveTextContent(/^Mejor copia en Engine DJ$/)
    expect(pill).toHaveAccessibleName('Mejor copia en Engine DJ. Razón.')
  })

  // A row that is the open file itself is never blank: it says so, beside its format, and it is
  // a state of its own that never rides up to the header with the others.
  it('says on its own row that a copy is the open file, beside its format, and opens nothing', () => {
    mount(
      {},
      { verdict: 'thisFile', comparable: false, comparison: undefined, format: 'AIFF 16/44,1' },
    )
    const pill = screen.getByTestId('library-row-state')
    expect(pill).toHaveTextContent('Es este archivo')
    expect(pill).toHaveAttribute('data-state', 'thisFile')
    expect(screen.getByTestId('library-row-format')).toHaveTextContent('AIFF 16/44,1')
    expect(screen.getByTestId('library-row').tagName).not.toBe('BUTTON')
    expect(screen.queryByTestId('library-verdict')).toBeNull()
  })

  it('keeps the open file own state on its row when every row is that file', () => {
    mount({
      rows: [
        row({ id: 'appleMusic', name: 'Apple Music', verdict: 'thisFile', comparison: undefined }),
        row({ id: 'rekordbox', name: 'rekordbox', verdict: 'thisFile', comparison: undefined }),
      ],
    })
    expect(screen.getAllByTestId('library-row-state')).toHaveLength(2)
    expect(screen.queryByTestId('library-verdict')).toBeNull()
  })

  it('says the file is worse plainly when folded over one row', () => {
    mount({ open: false }, { verdict: 'library' })
    expect(screen.getByTestId('library-verdict')).toHaveTextContent(/^Tu archivo es peor$/)
  })

  it('says another version in the folded header without a length when the rows differ in state', () => {
    mount({
      open: false,
      rows: [
        row({ id: 'appleMusic', name: 'Apple Music', verdict: 'different', durationSec: 300 }),
        row({ id: 'rekordbox', name: 'rekordbox', verdict: 'same' }),
      ],
    })
    expect(screen.getByTestId('library-verdict')).toHaveTextContent(/^Otra versión$/)
  })

  it('says another version with its length in the header when it is the only state', () => {
    mount({}, { verdict: 'different', durationSec: 300 })
    expect(screen.getByTestId('library-verdict')).toHaveTextContent(/^Otra versión · 5:00$/)
  })

  // The same state on every row was said once per row; said once in the header, the rows keep
  // only what tells them apart: the program and the format.
  it('says a state shared by every row once in the header, open or folded', () => {
    const rows = [
      row({ id: 'appleMusic', name: 'Apple Music', verdict: 'here' }),
      row({ id: 'rekordbox', name: 'rekordbox', verdict: 'here' }),
    ]
    for (const open of [true, false]) {
      render(<LibrarySection open={open} onToggle={() => {}} rows={rows} />)
      expect(screen.getAllByTestId('library-verdict')).toHaveLength(1)
      expect(screen.getByTestId('library-verdict')).toHaveTextContent(/^Tu archivo es mejor$/)
      expect(screen.queryByTestId('library-row-state')).toBeNull()
      cleanup()
    }
  })

  it('leaves no empty state place on rows whose state went up to the header', () => {
    mount({
      rows: [
        row({ id: 'appleMusic', name: 'Apple Music', verdict: 'same' }),
        row({ id: 'rekordbox', name: 'rekordbox', verdict: 'same' }),
      ],
    })
    expect(screen.queryByTestId('library-row-state-slot')).toBeNull()
    expect(screen.getAllByTestId('library-row-format')).toHaveLength(2)
  })

  // Different states keep one pill per row and nothing beside the title while it is open.
  it('keeps one pill per row and an empty open header when the states differ', () => {
    mount({
      rows: [
        row({ id: 'appleMusic', name: 'Apple Music', verdict: 'here' }),
        row({ id: 'rekordbox', name: 'rekordbox', verdict: 'library' }),
      ],
    })
    expect(screen.getAllByTestId('library-row-state')).toHaveLength(2)
    expect(screen.queryByTestId('library-verdict')).toBeNull()
  })

  // While a copy is still being measured the header must not settle on a shared state and
  // jump when the other one lands.
  it('keeps each row its own pill while any row is still comparing', () => {
    mount({
      rows: [
        row({ id: 'appleMusic', name: 'Apple Music', verdict: 'measuring' }),
        row({ id: 'rekordbox', name: 'rekordbox', verdict: 'measuring' }),
      ],
    })
    expect(screen.getAllByTestId('library-row-state')).toHaveLength(2)
    expect(screen.queryByTestId('library-verdict')).toBeNull()
  })

  it('names the program when a folded header covers a better copy among different states', () => {
    mount({
      open: false,
      rows: [
        row({ id: 'appleMusic', name: 'Apple Music', verdict: 'same' }),
        row({ id: 'engine', name: 'Engine DJ', verdict: 'library' }),
      ],
    })
    expect(screen.getByTestId('library-verdict')).toHaveTextContent(/^Mejor copia en Engine DJ$/)
  })

  it('says the file is worse, not a program, when every folded row says it', () => {
    mount({
      open: false,
      rows: [
        row({ id: 'appleMusic', name: 'Apple Music', verdict: 'library' }),
        row({ id: 'engine', name: 'Engine DJ', verdict: 'library' }),
      ],
    })
    expect(screen.getByTestId('library-verdict')).toHaveTextContent(/^Tu archivo es peor$/)
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
