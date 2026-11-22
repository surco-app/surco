// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
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
  it('says this copy is the better one in green', () => {
    mount({ verdict: 'here' })
    const pill = screen.getByTestId('library-verdict')
    expect(pill).toHaveAttribute('data-tone', 'good')
    expect(pill).toHaveTextContent('Esta es la mejor')
  })

  it('warns there is a better copy in amber', () => {
    mount({ verdict: 'library' })
    const pill = screen.getByTestId('library-verdict')
    expect(pill).toHaveAttribute('data-tone', 'warn')
    expect(pill).toHaveTextContent('Hay una copia mejor')
  })

  it('shows no verdict until there is one', () => {
    mount({ verdict: null })
    expect(screen.queryByTestId('library-verdict')).not.toBeInTheDocument()
  })

  it('marks the row only when the library copy is better', () => {
    mount({}, { better: true })
    expect(screen.getByTestId('library-row-better')).toHaveAttribute(
      'aria-label',
      'Mejor que este archivo',
    )
    cleanup()
    mount({}, { better: false })
    expect(screen.queryByTestId('library-row-better')).not.toBeInTheDocument()
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
    expect(plain.querySelector('svg')).toBeNull()
    expect(plain).toHaveTextContent('Música')
  })

  // The DJ reads the section top to bottom as one list of the places that hold the track, so
  // each program keeps its slot whatever order the copies were found in.
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

  // Each copy is a different file with its own numbers; opening one must not unfold the rest
  // and bury the one the DJ asked for under tables they did not ask for.
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

  // The amber dot says "this copy beats the file you have"; on a copy that does not, it would
  // send the DJ to swap in a worse file.
  it('marks only the copies that beat this file', () => {
    mount({
      rows: [
        row({ id: 'appleMusic', better: false }),
        row({ id: 'rekordbox', name: 'rekordbox', better: true }),
        row({ id: 'serato', name: 'Serato', better: false }),
      ],
    })
    const [music, rekordbox, serato] = screen.getAllByTestId('library-row')
    expect(within(music).queryByTestId('library-row-better')).toBeNull()
    expect(within(rekordbox).getByTestId('library-row-better')).toBeInTheDocument()
    expect(within(serato).queryByTestId('library-row-better')).toBeNull()
  })
})
