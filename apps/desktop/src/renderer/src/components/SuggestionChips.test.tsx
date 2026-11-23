// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuggestionChips } from './SuggestionChips'

afterEach(cleanup)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { value?: string; count?: number; total?: number }) =>
      o?.total != null ? `${k}:${o.value}:${o.count}/${o.total}` : k,
  }),
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
    overflow.visibleCount = 1
    render(
      <SuggestionChips
        suggestions={['Acid', 'Bases', 'Cierre', 'Trance']}
        isOn={(s) => s === 'Trance'}
        onPick={() => {}}
      />,
    )
    expect(screen.getByTestId('chip-Trance')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-Acid')).not.toBeInTheDocument()
  })

  // 308 tracks carried some thirty genres between them, one or two tracks each, and every
  // one of them held the row open: the folded genre row ran sixteen lines and pushed the
  // rest of the editor out of view. Only a tag the whole selection carries may hold it open.
  it('folds a tag only part of the selection carries behind "+N" like any suggestion', () => {
    overflow.visibleCount = 1
    render(
      <SuggestionChips
        suggestions={['Electronic', 'Dance', 'House']}
        isOn={() => false}
        isPartial={() => true}
        onPick={() => {}}
      />,
    )
    expect(screen.getByTestId('chip-Electronic')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-Dance')).not.toBeInTheDocument()
    expect(screen.getByTestId('chip-more')).toHaveTextContent('+2')
  })

  // A partial chip wrote "146/308" after its name. Pressing it applied the tag to every
  // track, the number went away, the chip narrowed and the chips after it slid under the
  // pointer. The share is the chip's fill now, so pressing it changes its colour and not
  // its width, and the number stays in what a screen reader or a hover reads.
  it('fills a partial chip by the share of the selection that carries it instead of writing it', () => {
    render(
      <SuggestionChips
        suggestions={['Electronic']}
        isOn={() => false}
        isPartial={() => true}
        partialOf={{ count: () => 146, total: 308 }}
        onPick={() => {}}
      />,
    )
    const chip = screen.getByTestId('chip-Electronic')
    expect(chip).toHaveTextContent(/^Electronic$/)
    expect(chip.style.backgroundImage).toContain(`${(146 / 308) * 100}%`)
    expect(chip).toHaveAttribute('aria-label', 'fields.suggestionShare:Electronic:146/308')
  })

  it('leaves a chip every track carries and one none carries without a fill', () => {
    render(
      <SuggestionChips
        suggestions={['Bases', 'Cierre']}
        isOn={(s) => s === 'Bases'}
        isPartial={() => false}
        partialOf={{ count: (s) => (s === 'Bases' ? 3 : 0), total: 3 }}
        onPick={() => {}}
      />,
    )
    expect(screen.getByTestId('chip-Bases').style.backgroundImage).toBe('')
    expect(screen.getByTestId('chip-Cierre').style.backgroundImage).toBe('')
    expect(screen.getByTestId('chip-Bases')).not.toHaveAttribute('aria-label')
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

  it('shows the whole tag on hover when the chip had to cut it', () => {
    vi.useFakeTimers()
    const long = 'Techno; Detroit Techno; Electro; Minimal; Deep House; Acid'
    render(<SuggestionChips suggestions={[long, 'Dub']} isOn={() => false} onPick={() => {}} />)
    const name = within(screen.getByTestId(`chip-${long}`)).getByText(long)
    Object.defineProperty(name, 'scrollWidth', { configurable: true, value: 358 })
    Object.defineProperty(name, 'clientWidth', { configurable: true, value: 200 })
    fireEvent.pointerEnter(screen.getByTestId(`chip-${long}`))
    fireEvent.pointerMove(screen.getByTestId(`chip-${long}`), { clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByRole('tooltip')).toHaveTextContent(long)
    fireEvent.pointerLeave(screen.getByTestId(`chip-${long}`))
    fireEvent.pointerEnter(screen.getByTestId('chip-Dub'))
    fireEvent.pointerMove(screen.getByTestId('chip-Dub'), { clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(500))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('lays an Arabic tag out right to left inside its chip', () => {
    render(
      <SuggestionChips
        suggestions={['شعبي']}
        isOn={() => false}
        isPartial={() => true}
        partialOf={{ count: () => 1, total: 7 }}
        onPick={() => {}}
      />,
    )
    expect(within(screen.getByTestId('chip-شعبي')).getByText('شعبي')).toHaveAttribute('dir', 'auto')
  })

  it('keeps the hidden measuring row from widening the editor, so the form never scrolls sideways', () => {
    render(
      <SuggestionChips
        suggestions={['Techno; Detroit Techno; Electro; Minimal; Deep House; Acid', 'V-Pop']}
        isOn={() => false}
        onPick={() => {}}
      />,
    )
    const row = screen.getByTestId('field-suggestions')
    const measuring = screen.getByTestId('field-suggestions-measure')
    expect(measuring.parentElement).not.toBe(row)
  })
})
