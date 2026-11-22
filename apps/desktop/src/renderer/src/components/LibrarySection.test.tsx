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
    better: false,
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
  render(<LibrarySection open onToggle={() => {}} verdict="here" rows={[single]} {...props} />)
  return { onToggleComparison: single.onToggleComparison }
}

describe('LibrarySection', () => {
  // The verdict is read at a glance beside the title: a line of words under every header
  // turned the section into a wall of text. Each state keeps its words for a screen reader
  // and the tooltip, and the warning keeps a shape of its own so it never rests on colour.
  it.each([
    ['here', 'good', 'Esta es la mejor'],
    ['library', 'warn', 'Hay una copia mejor'],
    ['same', 'good', 'Misma copia'],
    ['measuring', 'neutral', 'Comparando…'],
  ] as const)(
    'shows the %s verdict as a glyph named for it, with no words',
    (verdict, tone, label) => {
      mount({ verdict })
      const glyph = screen.getByTestId('library-verdict')
      expect(glyph).toHaveAttribute('role', 'img')
      expect(glyph).toHaveAccessibleName(label)
      expect(glyph).toHaveAttribute('data-tone', tone)
      expect(screen.getByTestId('section-status').textContent).toBe('')
      expect(hoverTooltip(glyph)).toBe(label)
    },
  )

  // The two greens and the amber are told apart by shape too, for a colour-blind reader.
  it('draws a different shape for each settled verdict', () => {
    const shapes = (['here', 'library', 'same'] as const).map((verdict) => {
      mount({ verdict })
      const svg = screen.getByTestId('library-verdict').querySelector('svg')?.innerHTML
      cleanup()
      return svg
    })
    expect(new Set(shapes).size).toBe(3)
  })

  // The table under the row shows the figures; why they decide (a lossy source, a limiter) is
  // said once, on the verdict's glyph, instead of a sentence above the table.
  it('names the reason with the verdict when there is one', () => {
    mount({ verdict: 'library', verdictDetail: 'Este archivo tiene pérdida (MP3).' })
    expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
      'Hay una copia mejor. Este archivo tiene pérdida (MP3).',
    )
  })

  // Japanese closes a sentence with 。, so the verdict and its reason join the way each
  // language punctuates, not with an ASCII period glued in by code.
  it('joins the verdict and its reason with the language own full stop', async () => {
    await i18n.changeLanguage('ja')
    try {
      mount({ verdict: 'library', verdictDetail: '理由' })
      expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
        'より良いコピーがあります。理由',
      )
    } finally {
      await i18n.changeLanguage('es')
    }
  })

  it('shows no verdict until there is one', () => {
    mount({ verdict: null })
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

  // The header's amber triangle already says the library holds a better copy; a second
  // amber mark on the only row told the reader the same thing twice.
  it('says a better copy once, in the header, when there is one row', () => {
    mount({ verdict: 'library' }, { better: true })
    expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-tone', 'warn')
    const row = screen.getByTestId('library-row')
    expect(within(row).getAllByRole('img')).toEqual([screen.getByTestId('library-row-icon')])
  })

  // With several programs the header cannot say which one holds the better copy, so that row
  // carries a small triangle, named for a screen reader and the tooltip, and no words.
  it('marks only the rows whose copy beats this file when there are several', () => {
    mount({
      verdict: 'library',
      rows: [
        row({ id: 'appleMusic', name: 'Apple Music', better: false }),
        row({ id: 'rekordbox', name: 'rekordbox', better: true }),
        row({ id: 'serato', name: 'Serato', better: false }),
      ],
    })
    const [music, rekordbox, serato] = screen.getAllByTestId('library-row')
    expect(within(music).queryByTestId('library-row-better')).toBeNull()
    expect(within(serato).queryByTestId('library-row-better')).toBeNull()
    const mark = within(rekordbox).getByTestId('library-row-better')
    expect(mark).toHaveAccessibleName('Mejor que este archivo')
    expect(hoverTooltip(mark)).toBe('Mejor que este archivo')
    expect(rekordbox.textContent).not.toContain('Mejor')
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

  it('renders a plain row without format or chevron', () => {
    mount({}, { format: '', comparison: undefined })
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
