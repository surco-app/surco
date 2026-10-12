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

  // The aria-label replaced the visible text, so VoiceOver said "Sort, pop-up button" and
  // never which order was active; a sighted user reads both, a blind one needs both too.
  it('names the trigger with its label and the current value', () => {
    renderSelect('name')
    expect(screen.getByTestId('sort')).toHaveAccessibleName('Sort: Name')
  })

  // Tab out of an open menu used to leave the listbox floating with the focus elsewhere,
  // detached from anything the keyboard user is doing.
  it('closes the menu when the focus leaves it with Tab', () => {
    renderSelect('name')
    fireEvent.click(screen.getByTestId('sort'))
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    fireEvent.blur(screen.getByTestId('sort-option-name'), { relatedTarget: outside })
    expect(screen.queryByTestId('sort-listbox')).toBeNull()
    outside.remove()
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

  // A bare ";" in a menu says little; the separator menu shows what each choice writes.
  it('shows an option hint beside its label', () => {
    render(
      <Select
        value="semicolon"
        options={[
          { value: 'comma', label: ',', hint: 'Pop, House' },
          { value: 'semicolon', label: ';', hint: 'Pop; House' },
        ]}
        onChange={vi.fn()}
        label="Genre separator"
        testid="sep"
      />,
    )
    fireEvent.click(screen.getByTestId('sep'))
    expect(screen.getByTestId('sep-option-comma')).toHaveTextContent('Pop, House')
    expect(screen.getByTestId('sep')).toHaveTextContent(';')
    expect(screen.getByTestId('sep')).not.toHaveTextContent('Pop; House')
  })

  // A menu inside a narrow list row can show a shorter trigger than its option label,
  // while a screen reader still hears the full one.
  it('shows the short trigger label when the chosen option has one', () => {
    render(
      <Select
        value="custom"
        options={[
          { value: 'comma', label: ',' },
          { value: 'custom', label: 'Other', short: '' },
        ]}
        onChange={vi.fn()}
        label="Genre separator"
        testid="sep"
      />,
    )
    expect(screen.getByTestId('sep')).not.toHaveTextContent('Other')
    expect(screen.getByTestId('sep')).toHaveAccessibleName('Genre separator: Other')
  })

  // A terse menu (a separator's ",", ";", "/") needs its question on it: the heading says
  // what is being picked without a tooltip floating beside the open menu.
  it('heads the open menu with its label when asked to', () => {
    render(
      <Select
        value="comma"
        options={[{ value: 'comma', label: ',' }]}
        onChange={vi.fn()}
        label="Genre separator"
        testid="sep"
        heading
      />,
    )
    fireEvent.click(screen.getByTestId('sep'))
    expect(screen.getByTestId('sep-listbox')).toHaveTextContent('Genre separator')
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

  // An inline menu hangs from its trigger and moves with it, so a scroll has nothing to
  // strand. In Settings the separator picker sat near the panel's bottom edge, and
  // scrolling the panel to see its options closed it every time.
  it('keeps an inline menu open while the panel around it scrolls', () => {
    renderSelect()
    fireEvent.click(screen.getByTestId('sort'))
    fireEvent.scroll(document.body)
    expect(screen.getByTestId('sort-listbox')).toBeInTheDocument()
  })

  // ↓ on a closed select opens it, like a native one. Unhandled, it bubbled to the
  // search results around the album-match rows and moved the focus to the first album;
  // j/k inside the open menu likewise reached the global shortcuts behind it.
  it('opens on the arrow keys and keeps every key it gets from the panel around it', () => {
    const outer = vi.fn()
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a stand-in for the results panel's key handler
      <div onKeyDown={outer}>
        <Select value="import" options={options} onChange={vi.fn()} label="Sort" testid="sort" />
      </div>,
    )
    fireEvent.keyDown(screen.getByTestId('sort'), { key: 'ArrowDown' })
    expect(screen.getByTestId('sort-listbox')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByTestId('sort-listbox'), { key: 'j' })
    expect(outer).not.toHaveBeenCalled()
  })

  // Captured on the way down, so a scroll inside the editor's own column counts too, not
  // just one on the window: that inner scroller is what moves the album-match rows.
  it('closes when an ancestor scrolls under an open menu', () => {
    openAt(132)
    fireEvent.scroll(document.body)
    expect(screen.queryByTestId('pick-listbox')).toBeNull()
  })

  // artexjay, 12/10: on a deluxe release the album-match picker closed as soon as he
  // scrolled its tracklist with the wheel, the scrollbar or the arrows. The menu's own
  // scroll was caught with the ancestors' and dismissed it.
  it('stays open while its own list scrolls', () => {
    const list = openAt(132)
    fireEvent.scroll(list)
    expect(screen.getByTestId('pick-listbox')).toBeInTheDocument()
  })

  // Focusing an option lets the browser scroll every ancestor to show it, and an ancestor's
  // scroll closes the menu: opening on a track far down the list closed it at once, the
  // "sometimes it does not appear" of the same report. Only the list may move.
  it('focuses options without scrolling anything outside the menu', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const list = openAt(132)
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    const optionCalls = focus.mock.contexts
      .map((el, i) => [el, focus.mock.calls[i][0]] as const)
      .filter(([el]) => (el as HTMLElement).getAttribute('role') === 'option')
    expect(optionCalls.length).toBeGreaterThanOrEqual(2)
    for (const [, opts] of optionCalls) expect(opts).toEqual({ preventScroll: true })
    focus.mockRestore()
  })

  // The album-match rows rebuild their options on every render, and a render while the
  // menu was open pulled the focus, and the list with it, back to the assigned track.
  it('keeps the focused option when the options are rebuilt while open', () => {
    window.innerHeight = 800
    const props = { value: '0', onChange: vi.fn(), label: 'Track', testid: 'pick', fullWidth: true }
    const { rerender } = render(<Select {...props} options={many} />)
    fireEvent.click(screen.getByTestId('pick'))
    const list = screen.getByTestId('pick-listbox')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(document.activeElement).toHaveTextContent('Track 3')
    rerender(<Select {...props} options={many.map((o) => ({ ...o }))} />)
    expect(document.activeElement).toHaveTextContent('Track 3')
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
