// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuggestionChips } from './SuggestionChips'

afterEach(cleanup)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('SuggestionChips', () => {
  it('draws a tag some tracks carry as partial, distinct from on and off', () => {
    render(
      <SuggestionChips
        suggestions={['Bases', 'Cantaditas', 'Cierre']}
        isOn={(s) => s === 'Bases'}
        isPartial={(s) => s === 'Cantaditas'}
        onPick={() => {}}
      />,
    )
    expect(screen.getByTestId('chip-Bases')).toHaveAttribute('data-state', 'on')
    expect(screen.getByTestId('chip-Cantaditas')).toHaveAttribute('data-state', 'some')
    expect(screen.getByTestId('chip-Cierre')).toHaveAttribute('data-state', 'off')
  })

  // The on/some/off state is painted only in color, so a screen reader user toggling a
  // chip had no way to know whether the tag was applied, to all tracks or to some.
  it('exposes each chip state as a pressed state assistive tech can read', () => {
    render(
      <SuggestionChips
        suggestions={['Bases', 'Cantaditas', 'Cierre']}
        isOn={(s) => s === 'Bases'}
        isPartial={(s) => s === 'Cantaditas'}
        onPick={() => {}}
      />,
    )
    expect(screen.getByTestId('chip-Bases')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('chip-Cantaditas')).toHaveAttribute('aria-pressed', 'mixed')
    expect(screen.getByTestId('chip-Cierre')).toHaveAttribute('aria-pressed', 'false')
  })

  it('scopes its testids so several rows of the same tags stay addressable', () => {
    const onPick = vi.fn()
    render(
      <SuggestionChips scope="a1" suggestions={['Bases']} isOn={() => false} onPick={onPick} />,
    )
    fireEvent.click(screen.getByTestId('chip-a1-Bases'))
    expect(onPick).toHaveBeenCalledWith('Bases')
    expect(screen.getByTestId('field-suggestions-a1')).toBeInTheDocument()
  })
})
