// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
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
      verdict="here"
      copyFormat="FLAC 44,1 kHz"
      libraryBetter={false}
      comparison={<div data-testid="comparison">numbers</div>}
      comparisonOpen={false}
      onToggleComparison={onToggleComparison}
      {...props}
    />,
  )
  return { onToggleComparison }
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
    mount({ libraryBetter: true })
    expect(screen.getByTestId('library-row-better')).toHaveAttribute(
      'aria-label',
      'Mejor que este archivo',
    )
    cleanup()
    mount({ libraryBetter: false })
    expect(screen.queryByTestId('library-row-better')).not.toBeInTheDocument()
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
    expect(row.querySelector('svg')).toBeNull()
    expect(row).toHaveTextContent('Música')
  })
})
