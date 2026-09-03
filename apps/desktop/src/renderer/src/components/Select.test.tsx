// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Clock } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { Select } from './Select'

afterEach(cleanup)

const options = [
  { value: 'import', label: 'Default' },
  { value: 'name', label: 'Name' },
  { value: 'artist', label: 'Artist' },
]

function renderSelect(value = 'import') {
  const onChange = vi.fn()
  render(<Select value={value} options={options} onChange={onChange} label="Sort" testid="sort" />)
  return onChange
}

describe('Select', () => {
  // The whole reason this exists: the native <select> pops the OS menu, which
  // ignores the app's palette and clashes with the dark UI.
  it('shows the current option on the trigger and no native select', () => {
    renderSelect('name')
    expect(screen.getByTestId('sort')).toHaveTextContent('Name')
    expect(document.querySelector('select')).toBeNull()
  })

  it('opens a listbox on click and marks the current option as selected', () => {
    renderSelect('name')
    fireEvent.click(screen.getByTestId('sort'))
    expect(screen.getByTestId('sort-listbox')).toBeInTheDocument()
    expect(screen.getByTestId('sort-option-name')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('sort-option-import')).toHaveAttribute('aria-selected', 'false')
  })

  // Options can carry a leading glyph so the sort menu reads at a glance, like the
  // quality filter's buckets — an option without one stays text-only.
  it('renders an option icon when the option carries one', () => {
    const onChange = vi.fn()
    render(
      <Select
        value="time"
        options={[
          { value: 'time', label: 'Time', icon: Clock },
          { value: 'name', label: 'Name' },
        ]}
        onChange={onChange}
        label="Sort"
        testid="sort"
      />,
    )
    fireEvent.click(screen.getByTestId('sort'))
    // The icon's svg sits alongside the selection-tick svg, so the iconed option carries
    // two graphics where the plain one carries only the tick.
    const iconed = screen.getByTestId('sort-option-time')
    expect(iconed.querySelectorAll('svg')).toHaveLength(2)
    expect(screen.getByTestId('sort-option-name').querySelectorAll('svg')).toHaveLength(1)
    // Layout mirrors the quality filter's buckets: the mode icon leads, the selection tick
    // trails on the right — so the option's first and last children are both graphics.
    expect(iconed.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    expect(iconed.lastElementChild?.tagName.toLowerCase()).toBe('svg')
  })

  it('reports the picked value and closes', () => {
    const onChange = renderSelect()
    fireEvent.click(screen.getByTestId('sort'))
    fireEvent.click(screen.getByTestId('sort-option-artist'))
    expect(onChange).toHaveBeenCalledWith('artist')
    expect(screen.queryByTestId('sort-listbox')).toBeNull()
  })

  // The open dropdown owns its keys. Any that leak to the window-level shortcut
  // handler move the track selection (or toggle the player) behind the popover —
  // and a selection change remounts the editor under the user.
  it('keeps its keys from reaching window-level shortcut handlers', () => {
    renderSelect('name')
    const seen = vi.fn()
    window.addEventListener('keydown', seen)
    fireEvent.click(screen.getByTestId('sort'))
    const listbox = screen.getByTestId('sort-listbox')
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    fireEvent.keyDown(listbox, { key: ' ' })
    fireEvent.keyDown(listbox, { key: 'Escape' })
    expect(seen).not.toHaveBeenCalled()
    window.removeEventListener('keydown', seen)
  })

  // Opening on the current option keeps the keyboard flow of a native select:
  // arrows continue from what is chosen, not from the top of the list.
  it('moves focus to the selected option on open and walks the list with arrows', () => {
    renderSelect('name')
    fireEvent.click(screen.getByTestId('sort'))
    expect(screen.getByTestId('sort-option-name')).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId('sort-listbox'), { key: 'ArrowDown' })
    expect(screen.getByTestId('sort-option-artist')).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId('sort-listbox'), { key: 'ArrowUp' })
    expect(screen.getByTestId('sort-option-name')).toHaveFocus()
  })

  it('closes on Escape without picking, returning focus to the trigger', () => {
    const onChange = renderSelect()
    fireEvent.click(screen.getByTestId('sort'))
    fireEvent.keyDown(screen.getByTestId('sort-listbox'), { key: 'Escape' })
    expect(screen.queryByTestId('sort-listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('sort')).toHaveFocus()
  })

  it('closes on a click outside without picking', () => {
    const onChange = renderSelect()
    fireEvent.click(screen.getByTestId('sort'))
    fireEvent.click(screen.getByTestId('sort-backdrop'))
    expect(screen.queryByTestId('sort-listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
})

// The full-width menu is fixed-positioned, so a trigger near the bottom of the window
// dropped its menu past the viewport edge: unreachable, because scrolling the page does
// not move a fixed element. The last row of the album-match picker is exactly that case,
// and it left that row's picker unusable.
describe('Select full-width menu placement', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    value: String(i),
    label: `Track ${i + 1}`,
  }))

  function openAt(bottom: number, viewport = 800): HTMLElement {
    window.innerHeight = viewport
    render(
      <Select value="0" options={many} onChange={vi.fn()} label="Track" testid="pick" fullWidth />,
    )
    const trigger = screen.getByTestId('pick')
    trigger.getBoundingClientRect = () =>
      ({ top: bottom - 32, bottom, left: 20, width: 200, height: 32 }) as DOMRect
    fireEvent.click(trigger)
    return screen.getByTestId('pick-listbox')
  }

  // Anchored by its bottom edge just above the trigger's top (760), which on an 800-tall
  // window is 800 - 760 + gap up from the floor: the menu grows upward, into the room.
  it('flips the menu above a trigger sitting at the bottom of the window', () => {
    const style = openAt(792).style
    expect(style.top).toBe('')
    expect(Number.parseFloat(style.bottom)).toBe(800 - 760 + 4)
  })

  it('still drops below the trigger when there is room underneath', () => {
    const style = openAt(132).style
    expect(style.bottom).toBe('')
    expect(Number.parseFloat(style.top)).toBeGreaterThanOrEqual(132)
  })

  // Whichever way it opens, the menu may not grow past the edge it is anchored to.
  it('caps a flipped menu to the room above the trigger', () => {
    expect(Number.parseFloat(openAt(792).style.maxHeight)).toBeLessThanOrEqual(792 - 32)
  })

  it('caps a dropped menu to the room below the trigger', () => {
    expect(Number.parseFloat(openAt(132).style.maxHeight)).toBeLessThanOrEqual(800 - 132)
  })

  // The placement is measured once, when the menu opens. Anything that moves the trigger
  // afterwards leaves the menu stranded away from it — pointing at nothing, and in the
  // album-match column (its own scroller) covering rows it no longer belongs to. Closing
  // is what a native select does, and it beats chasing the trigger every frame.
  it('closes when the window is resized under an open menu', () => {
    openAt(132)
    fireEvent(window, new Event('resize'))
    expect(screen.queryByTestId('pick-listbox')).toBeNull()
  })

  // Captured on the way down, so a scroll inside the editor's own column counts too, not
  // just one on the window: that inner scroller is what moves the album-match rows.
  it('closes when an ancestor scrolls under an open menu', () => {
    openAt(132)
    fireEvent.scroll(document.body)
    expect(screen.queryByTestId('pick-listbox')).toBeNull()
  })

  // Only while it is open: a stray scroll must not fight the click that opens it.
  it('leaves the trigger alone when nothing is open', () => {
    render(
      <Select value="0" options={many} onChange={vi.fn()} label="Track" testid="quiet" fullWidth />,
    )
    fireEvent(window, new Event('resize'))
    fireEvent.scroll(document.body)
    expect(screen.getByTestId('quiet')).toHaveAttribute('aria-expanded', 'false')
  })
})
