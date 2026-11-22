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
  window.localStorage.clear()
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

  // A user with their own genres per folder could not see which ones a track carried: the
  // ones past the cut hid behind "+N" and the row read as if nothing else was applied.
  it('keeps the applied tags in view when the row collapses', () => {
    overflow.visibleCount = 2
    render(
      <SuggestionChips
        suggestions={['Acid', 'Bases', 'Cierre', 'Trance']}
        isOn={(s) => s === 'Trance'}
        isPartial={(s) => s === 'Cierre'}
        onPick={() => {}}
      />,
    )
    expect(screen.getByTestId('chip-Trance')).toBeInTheDocument()
    expect(screen.getByTestId('chip-Cierre')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-Acid')).not.toBeInTheDocument()
  })

  // Reordering on every toggle would slide the chip out from under the pointer.
  it('leaves a chip where it is when it is toggled', () => {
    overflow.visibleCount = 3
    const on = new Set<string>()
    const props = { suggestions: ['Acid', 'Bases', 'Cierre', 'Trance'], onPick: () => {} }
    const { rerender } = render(<SuggestionChips {...props} isOn={(s) => on.has(s)} />)
    on.add('Bases')
    rerender(<SuggestionChips {...props} isOn={(s) => on.has(s)} />)
    const row = screen.getByTestId('field-suggestions')
    expect([...row.querySelectorAll('[data-state]')].map((c) => c.textContent)).toEqual([
      'Acid',
      'Bases',
      'Cierre',
    ])
  })

  // A genre filled in by a release match or typed in the field lands while the row is
  // already up: it has to come into view the same as one the track arrived with.
  it('brings a tag applied past the cut into view', () => {
    overflow.visibleCount = 2
    const on = new Set<string>()
    const props = { suggestions: ['Acid', 'Bases', 'Cierre', 'Trance'], onPick: () => {} }
    const { rerender } = render(<SuggestionChips {...props} isOn={(s) => on.has(s)} />)
    expect(screen.queryByTestId('chip-Trance')).not.toBeInTheDocument()
    on.add('Trance')
    rerender(<SuggestionChips {...props} isOn={(s) => on.has(s)} />)
    expect(screen.getByTestId('chip-Trance')).toBeInTheDocument()
    expect(screen.getByTestId('chip-more')).toBeInTheDocument()
  })

  // "+N" must never stand for a tag the track carries, however many it carries. The row
  // grows to hold the applied ones and nothing else: opening the whole list for them
  // pushed the form down with tags nobody asked to see, and there was no way to fold it.
  it('shows every applied tag when they do not fit in one line, and keeps the rest folded', () => {
    overflow.visibleCount = 1
    render(
      <SuggestionChips
        suggestions={['Acid', 'Bases', 'Cierre', 'Trance']}
        isOn={(s) => s === 'Cierre' || s === 'Trance'}
        onPick={() => {}}
      />,
    )
    expect(screen.getByTestId('chip-Cierre')).toBeInTheDocument()
    expect(screen.getByTestId('chip-Trance')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-Acid')).not.toBeInTheDocument()
    expect(screen.getByTestId('chip-more')).toHaveTextContent('+2')
  })

  // Someone with a fixed list of their own genres opens the row to see them all. There was
  // no way to close it again when the form needed the room.
  it('folds the row again from the chip that takes the place of "+N"', () => {
    overflow.visibleCount = 2
    render(
      <SuggestionChips
        suggestions={['Acid', 'Bases', 'Cierre', 'Trance']}
        isOn={() => false}
        onPick={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('chip-more'))
    expect(screen.getByTestId('chip-Trance')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('chip-less'))
    expect(screen.queryByTestId('chip-Trance')).not.toBeInTheDocument()
    expect(screen.getByTestId('chip-more')).toBeInTheDocument()
  })

  // And it had to be opened on every track: the row forgot how it was left.
  it('remembers per field whether the row was left open', () => {
    overflow.visibleCount = 2
    const props = {
      suggestions: ['Acid', 'Bases', 'Cierre', 'Trance'],
      isOn: () => false,
      onPick: () => {},
    }
    const first = render(<SuggestionChips {...props} foldKey="genre" />)
    fireEvent.click(screen.getByTestId('chip-more'))
    first.unmount()
    render(<SuggestionChips {...props} foldKey="genre" />)
    expect(screen.getByTestId('chip-Trance')).toBeInTheDocument()
    cleanup()
    render(<SuggestionChips {...props} foldKey="grouping" />)
    expect(screen.queryByTestId('chip-Trance')).not.toBeInTheDocument()
  })

  // A row left open on a track with many tags must not show a fold chip where every tag
  // fits in one line anyway: it would fold nothing.
  it('offers no fold when the whole row fits', () => {
    const props = { suggestions: ['Acid', 'Bases'], isOn: () => false, onPick: () => {} }
    window.localStorage.setItem('surco.chips.open.genre', '1')
    render(<SuggestionChips {...props} foldKey="genre" />)
    expect(screen.queryByTestId('chip-less')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chip-more')).not.toBeInTheDocument()
  })
})
