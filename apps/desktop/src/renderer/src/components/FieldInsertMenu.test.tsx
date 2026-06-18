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
  cleanResult,
}: {
  sources?: InsertSource[]
  initial?: string
  cleanResult?: string
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
      <FieldInsertMenu
        fieldName="title"
        sources={sources}
        value={value}
        cleanResult={cleanResult}
        inputRef={ref}
        onChange={setValue}
      />
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

  it('moves focus to the first option on open and cycles with arrow keys across inserts and transforms alike', () => {
    render(<Harness />)
    openMenu()
    expect(screen.getByTestId('field-insert-option-year')).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId('field-insert-menu'), { key: 'ArrowDown' })
    expect(screen.getByTestId('field-insert-option-artist')).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId('field-insert-menu'), { key: 'End' })
    expect(screen.getByTestId('field-insert-option-case-upper')).toHaveFocus()
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
})

describe('FieldInsertMenu case transforms', () => {
  // The same menu that composes a field also fixes its case: rip tags often
  // arrive ALL CAPS, and each option previews its result so picking is one
  // informed click, exactly like the insert rows.
  it('offers case transforms on the current value, each with a preview of the result', () => {
    render(<Harness initial="PEPITO DE LOS PALOTES" />)
    openMenu()
    const title = screen.getByTestId('field-insert-option-case-title')
    expect(title).toHaveTextContent('Pepito De Los Palotes')
    fireEvent.click(title)
    expect(host().value).toBe('Pepito De Los Palotes')
  })

  it('replaces the whole value when a transform is picked, regardless of where the caret was', () => {
    render(<Harness initial="Pepito de los palotes" />)
    const input = host()
    input.focus()
    input.setSelectionRange(2, 2)
    openMenu()
    fireEvent.click(screen.getByTestId('field-insert-option-case-upper'))
    expect(host().value).toBe('PEPITO DE LOS PALOTES')
  })

  // A transform that changes nothing is a dead action — offering "UPPERCASE" on
  // an already-uppercase field would only make the menu feel broken.
  it('hides the transforms that would not change the value', () => {
    render(<Harness initial="PEPITO DE LOS PALOTES" />)
    openMenu()
    expect(screen.queryByTestId('field-insert-option-case-upper')).toBeNull()
    expect(screen.getByTestId('field-insert-option-case-lower')).toBeInTheDocument()
  })

  // Formatting needs no other filled field, so the trigger must exist even when
  // there is nothing to insert — the menu then offers only the transforms.
  it('opens with only transforms when no insert source has a value', () => {
    render(<Harness sources={[]} initial="PEPITO" />)
    openMenu()
    expect(screen.getByTestId('field-insert-option-case-title')).toBeInTheDocument()
  })

  it('renders nothing when there is neither a value to format nor a source to insert', () => {
    render(<Harness sources={[]} initial="" />)
    expect(screen.queryByTestId('field-insert-title')).toBeNull()
  })

  // The "without version" row rewrites the field with the pre-resolved clean value
  // (the editor strips the mix parenthetical), previewing it like the case rows.
  it('offers the clean result as a transform and applies it on pick', () => {
    render(<Harness initial="My Weapon (Original mix)" cleanResult="My Weapon" />)
    openMenu()
    const clean = screen.getByTestId('field-insert-option-clean')
    expect(clean).toHaveTextContent('My Weapon')
    fireEvent.click(clean)
    expect(host().value).toBe('My Weapon')
  })

  // The editor only passes cleanResult when there is something to strip, so an
  // empty field can still surface the row — its value comes from another field
  // (the title), not from this one.
  it('shows the clean row even when the field itself is empty', () => {
    render(<Harness sources={[]} initial="" cleanResult="My Weapon" />)
    openMenu()
    expect(screen.getByTestId('field-insert-option-clean')).toHaveTextContent('My Weapon')
  })

  // No cleanResult means nothing to strip; the row must not appear.
  it('omits the clean row when no clean result is provided', () => {
    render(<Harness initial="My Weapon" />)
    openMenu()
    expect(screen.queryByTestId('field-insert-option-clean')).toBeNull()
  })
})
