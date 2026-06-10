// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('reports the picked value and closes', () => {
    const onChange = renderSelect()
    fireEvent.click(screen.getByTestId('sort'))
    fireEvent.click(screen.getByTestId('sort-option-artist'))
    expect(onChange).toHaveBeenCalledWith('artist')
    expect(screen.queryByTestId('sort-listbox')).toBeNull()
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
