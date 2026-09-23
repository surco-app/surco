// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuggestionChips } from './SuggestionChips'

afterEach(cleanup)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const overflow = vi.hoisted(() => ({ visibleCount: Number.POSITIVE_INFINITY }))
vi.mock('../hooks/useChipOverflow', () => ({
  useChipOverflow: (suggestions: string[]) => ({
    containerRef: { current: null },
    measureRef: { current: null },
    visibleCount: Math.min(overflow.visibleCount, suggestions.length),
  }),
}))

afterEach(() => {
  overflow.visibleCount = Number.POSITIVE_INFINITY
})

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

  // The "+N" chip unmounts when pressed; without moving focus a keyboard user was
  // dropped on the document body and had to tab back from the top of the editor.
  it('hands focus to the first revealed chip when "+N" expands the row', () => {
    overflow.visibleCount = 1
    render(
      <SuggestionChips
        suggestions={['Bases', 'Cantaditas', 'Cierre']}
        isOn={() => false}
        onPick={() => {}}
      />,
    )
    const more = screen.getByTestId('chip-more')
    more.focus()
    fireEvent.click(more)
    expect(screen.queryByTestId('chip-more')).not.toBeInTheDocument()
    expect(screen.getByTestId('chip-Cantaditas')).toHaveFocus()
  })
})
