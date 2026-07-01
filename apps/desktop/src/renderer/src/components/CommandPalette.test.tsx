// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { Command } from '../lib/commands'
import type { TrackItem } from '../types'
import { CommandPalette } from './CommandPalette'

afterEach(cleanup)

function cmd(over: Partial<Command> & { id: string }): Command {
  return { title: over.id, enabled: true, run: () => {}, ...over }
}

function track(id: string, artist: string, title: string): TrackItem {
  return { id, listLabel: title, meta: { artist, title } } as TrackItem
}

describe('CommandPalette', () => {
  it('exposes an accessible name on the dialog and search field', () => {
    render(<CommandPalette commands={[cmd({ id: 'a', title: 'Add' })]} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveAccessibleName()
    expect(screen.getByTestId('palette-input')).toHaveAccessibleName()
  })

  // Virtual focus (aria-activedescendant) never scrolls on its own: with ~25
  // commands the list overflows, and arrowing below the fold would move the
  // highlight off-screen — Enter would then run an invisible command.
  it('keeps the active option visible while arrowing through the list', () => {
    const scrolled = vi.fn()
    const proto = Element.prototype as Element & { scrollIntoView?: (o?: unknown) => void }
    const original = proto.scrollIntoView
    proto.scrollIntoView = scrolled
    try {
      render(
        <CommandPalette
          commands={[cmd({ id: 'a' }), cmd({ id: 'b' }), cmd({ id: 'c' })]}
          onClose={vi.fn()}
        />,
      )
      scrolled.mockClear()
      fireEvent.keyDown(screen.getByTestId('palette-input'), { key: 'ArrowDown' })
      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
    } finally {
      proto.scrollIntoView = original
    }
  })

  it('runs an enabled command and closes when its item is clicked', () => {
    const run = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette commands={[cmd({ id: 'a', title: 'Add', run })]} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('palette-item'))
    expect(run).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  // Frecency end-to-end: a filtered list floats the most-used matching command first, so
  // the habitual choice sits under the cursor when the user types.
  it('orders filtered results by usage so the most-used command leads', () => {
    render(
      <CommandPalette
        commands={[
          cmd({ id: 'clear-meta', title: 'Clear metadata' }),
          cmd({ id: 'clear-list', title: 'Clear the list' }),
        ]}
        usage={{ 'clear-list': 4, 'clear-meta': 1 }}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'clear' } })
    const items = screen.getAllByTestId('palette-item')
    expect(items[0]).toHaveTextContent('Clear the list')
  })

  // Running a command records one more use so the ranking keeps learning.
  it('records a command run for frecency', () => {
    const onRunCommand = vi.fn()
    render(
      <CommandPalette
        commands={[cmd({ id: 'clear-list', title: 'Clear the list' })]}
        onRunCommand={onRunCommand}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('palette-item'))
    expect(onRunCommand).toHaveBeenCalledWith('clear-list')
  })

  // A track jump is one-off navigation, not a command whose ranking should stick, so it
  // must not feed the frecency counter.
  it('does not record a track jump for frecency', () => {
    const onRunCommand = vi.fn()
    render(
      <CommandPalette
        commands={[]}
        tracks={[track('t1', 'Nifra', 'Everglow')]}
        onGoToTrack={vi.fn()}
        onRunCommand={onRunCommand}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'nifra' } })
    fireEvent.click(screen.getByTestId('palette-item'))
    expect(onRunCommand).not.toHaveBeenCalled()
  })

  // The palette is a combobox over a listbox: the input keeps DOM focus and points at
  // the active option via aria-activedescendant, so a screen reader announces the
  // highlighted command as the arrows move it.
  it('drives a listbox of options through aria-activedescendant', () => {
    render(
      <CommandPalette
        commands={[cmd({ id: 'a', title: 'Add' }), cmd({ id: 'b', title: 'Bee' })]}
        onClose={vi.fn()}
      />,
    )
    const input = screen.getByTestId('palette-input')
    expect(input).toHaveAttribute('role', 'combobox')
    expect(input).toHaveAttribute('aria-controls', 'palette-listbox')
    expect(input).toHaveAttribute('aria-activedescendant', 'palette-option-a')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', 'palette-option-b')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
  })

  // Typing re-filters the list underneath the highlight: after arrowing down, a new
  // query must pull the highlight back to the first result, or Enter runs whichever
  // command happens to land at the stale index — or nothing at all.
  it('resets the highlight to the first result when the query changes', () => {
    const runAdd = vi.fn()
    render(
      <CommandPalette
        commands={[cmd({ id: 'a', title: 'Add', run: runAdd }), cmd({ id: 'b', title: 'Bee' })]}
        onClose={vi.fn()}
      />,
    )
    const input = screen.getByTestId('palette-input')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.change(input, { target: { value: 'Add' } })
    expect(input).toHaveAttribute('aria-activedescendant', 'palette-option-a')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(runAdd).toHaveBeenCalled()
  })

  it('does not run a disabled command', () => {
    const run = vi.fn()
    render(
      <CommandPalette
        commands={[cmd({ id: 'a', title: 'Add', enabled: false, run })]}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('palette-item'))
    expect(run).not.toHaveBeenCalled()
  })

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<CommandPalette commands={[cmd({ id: 'a' })]} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('palette-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('filters commands by the query', () => {
    render(
      <CommandPalette
        commands={[cmd({ id: 'a', title: 'Add files' }), cmd({ id: 'b', title: 'Settings' })]}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'sett' } })
    expect(screen.getAllByTestId('palette-item')).toHaveLength(1)
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  // ⌘K doubles as a jump-to-track launcher: typing a title/artist surfaces matching
  // tracks under a heading, and picking one jumps to it and dismisses the palette — the
  // fast keyboard path to a specific track without scrolling the list by hand.
  it('surfaces matching tracks for a query and jumps to the one picked', () => {
    const onGoToTrack = vi.fn()
    const onClose = vi.fn()
    render(
      <CommandPalette
        commands={[cmd({ id: 'a', title: 'Add files' })]}
        tracks={[track('t1', 'Daft Punk', 'Da Funk'), track('t2', 'Justice', 'Genesis')]}
        onGoToTrack={onGoToTrack}
        onClose={onClose}
      />,
    )
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'da funk' } })
    expect(screen.getByText('Daft Punk — Da Funk')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Daft Punk — Da Funk'))
    expect(onGoToTrack).toHaveBeenCalledWith('t1')
    expect(onClose).toHaveBeenCalled()
  })

  // The empty query keeps ⌘K a pure command launcher — tracks only appear once the user
  // types — so opening the palette never dumps the whole library into it.
  it('shows no track results until the query is non-empty', () => {
    render(
      <CommandPalette
        commands={[cmd({ id: 'a', title: 'Add files' })]}
        tracks={[track('t1', 'Daft Punk', 'Da Funk')]}
        onGoToTrack={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByText('Daft Punk — Da Funk')).not.toBeInTheDocument()
  })
})
