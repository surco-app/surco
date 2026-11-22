// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { hoverTooltip } from '../test/tooltip'
import { LibrarySection } from './LibrarySection'

beforeAll(() => i18n.changeLanguage('es'))
afterEach(cleanup)

function mount(props: Partial<Parameters<typeof LibrarySection>[0]> = {}) {
  const onToggleComparison = vi.fn()
  render(
    <LibrarySection
      open
      onToggle={() => {}}
      libraryName="Música"
      librarySource="appleMusic"
      verdict="here"
      copyFormat="FLAC 44,1 kHz"
      comparison={<div data-testid="comparison">numbers</div>}
      comparisonOpen={false}
      onToggleComparison={onToggleComparison}
      {...props}
    />,
  )
  return { onToggleComparison }
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
      const svg = screen.getByTestId('library-verdict').querySelector('svg')?.outerHTML
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

  it('shows no verdict until there is one', () => {
    mount({ verdict: null })
    expect(screen.queryByTestId('library-verdict')).not.toBeInTheDocument()
  })

  // Same audio leaves nothing to weigh: a row that opens onto matching figures would send
  // the reader hunting for a difference that is not there.
  it('opens nothing when both copies are the same audio', () => {
    mount({ verdict: 'same', comparisonOpen: true })
    const row = screen.getByTestId('library-row')
    expect(row.tagName).not.toBe('BUTTON')
    expect(row).not.toHaveAttribute('aria-expanded')
    expect(screen.queryByTestId('comparison')).not.toBeInTheDocument()
  })

  // The row carries the same mark the library wears in the sidebar, so it is recognised
  // before it is read.
  it.each([
    ['appleMusic', 'Apple Music'],
    ['engineDj', 'Engine DJ'],
  ] as const)('leads the row with the %s sidebar glyph', (librarySource, libraryName) => {
    mount({ librarySource, libraryName })
    expect(screen.getByTestId('library-row-icon')).toHaveAccessibleName(libraryName)
    expect(screen.getByTestId('library-row-icon')).toHaveAttribute('data-source', librarySource)
  })

  // The copy's format reads as the same chip the track list uses for a file's format.
  it('sets the copy format in a format chip', () => {
    mount({ copyFormat: 'AIFF 24/48' })
    expect(screen.getByTestId('library-row-format')).toHaveTextContent('AIFF 24/48')
  })

  // The header's amber triangle already says the library holds a better copy; a second
  // amber mark on the row told the reader the same thing twice.
  it('says a better library copy once, in the header', () => {
    mount({ verdict: 'library' })
    expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-tone', 'warn')
    const row = screen.getByTestId('library-row')
    expect(within(row).getAllByRole('img')).toEqual([screen.getByTestId('library-row-icon')])
  })

  it('opens the comparison from the row', () => {
    const { onToggleComparison } = mount({ comparisonOpen: false })
    expect(screen.queryByTestId('comparison')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('library-row'))
    expect(onToggleComparison).toHaveBeenCalledTimes(1)
    cleanup()
    mount({ comparisonOpen: true })
    expect(screen.getByTestId('comparison')).toBeInTheDocument()
    expect(screen.getByTestId('library-row')).toHaveAttribute('aria-expanded', 'true')
  })

  it('renders a plain row without format or chevron', () => {
    mount({ copyFormat: '', comparison: undefined })
    const row = screen.getByTestId('library-row')
    expect(row.tagName).not.toBe('BUTTON')
    const icon = screen.getByTestId('library-row-icon')
    expect([...row.querySelectorAll('svg')].filter((svg) => !icon.contains(svg))).toEqual([])
    expect(screen.queryByTestId('library-row-format')).toBeNull()
    expect(row).toHaveTextContent('Música')
  })
})
