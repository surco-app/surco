// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import '../i18n'
import { FieldInsertMenu, type InsertSource } from './FieldInsertMenu'

afterEach(cleanup)

const SOURCES: InsertSource[] = [
  { key: 'year', label: 'Year', value: '2025' },
  { key: 'artist', label: 'Artist', value: 'DJ Pepito' },
]

function Harness({
  sources = SOURCES,
  initial = 'Pepito de los palotes',
}: {
  sources?: InsertSource[]
  initial?: string
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  return (
    <span className="relative">
      <input
        data-testid="host"
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <FieldInsertMenu fieldName="title" sources={sources} inputRef={ref} onChange={setValue} />
    </span>
  )
}

function host(): HTMLInputElement {
  return screen.getByTestId('host') as HTMLInputElement
}

function openMenu(): void {
  const trigger = screen.getByTestId('field-insert-title')
  fireEvent.mouseDown(trigger)
  fireEvent.click(trigger)
}

describe('FieldInsertMenu', () => {
  // The whole point of the menu is letting the user compose a field from the
  // others without retyping: each option must show which field it is AND what
  // will be inserted, so picking is a single informed click.
  it('lists each source field with its current value', () => {
    render(<Harness />)
    openMenu()
    const menu = screen.getByTestId('field-insert-menu')
    expect(menu).toBeInTheDocument()
    expect(screen.getByTestId('field-insert-option-year')).toHaveTextContent('Year')
    expect(screen.getByTestId('field-insert-option-year')).toHaveTextContent('2025')
    expect(screen.getByTestId('field-insert-option-artist')).toHaveTextContent('DJ Pepito')
  })

  // Inserting at the caret (not always appending) is what lets users build
  // "Pepito 2025 de los palotes"-style values; focus must come back to the
  // input with the caret after the insertion so they can keep typing.
  it('inserts the picked value at the caret and returns focus to the input', async () => {
    render(<Harness />)
    const el = host()
    el.focus()
    el.setSelectionRange(6, 6)
    openMenu()
    fireEvent.click(screen.getByTestId('field-insert-option-year'))
    expect(el).toHaveValue('Pepito2025 de los palotes')
    await waitFor(() => {
      expect(el).toHaveFocus()
      expect(el.selectionStart).toBe(10)
    })
  })

  it('replaces the selected text with the picked value', () => {
    render(<Harness />)
    const el = host()
    el.focus()
    el.setSelectionRange(0, 6)
    openMenu()
    fireEvent.click(screen.getByTestId('field-insert-option-year'))
    expect(el).toHaveValue('2025 de los palotes')
  })

  // An unfocused input reports caret 0, but nobody opening the menu cold wants
  // the value PREPENDED — the common intent ("add the year to the title") is to
  // append, so that is the default when no caret was placed.
  it('appends at the end when the input was never focused', () => {
    render(<Harness />)
    openMenu()
    fireEvent.click(screen.getByTestId('field-insert-option-year'))
    expect(host()).toHaveValue('Pepito de los palotes2025')
  })

  it('moves focus to the first option on open and cycles with arrow keys', () => {
    render(<Harness />)
    openMenu()
    expect(screen.getByTestId('field-insert-option-year')).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId('field-insert-menu'), { key: 'ArrowDown' })
    expect(screen.getByTestId('field-insert-option-artist')).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId('field-insert-menu'), { key: 'ArrowDown' })
    expect(screen.getByTestId('field-insert-option-year')).toHaveFocus()
  })

  it('closes on Escape without changing the value and refocuses the input', () => {
    render(<Harness />)
    openMenu()
    fireEvent.keyDown(screen.getByTestId('field-insert-menu'), { key: 'Escape' })
    expect(screen.queryByTestId('field-insert-menu')).toBeNull()
    expect(host()).toHaveValue('Pepito de los palotes')
    expect(host()).toHaveFocus()
  })

  it('closes when the backdrop is clicked', () => {
    render(<Harness />)
    openMenu()
    fireEvent.click(screen.getByTestId('field-insert-backdrop'))
    expect(screen.queryByTestId('field-insert-menu')).toBeNull()
  })

  it('renders nothing when there are no sources', () => {
    render(<Harness sources={[]} />)
    expect(screen.queryByTestId('field-insert-title')).toBeNull()
  })
})
