// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchInput } from './SearchInput'

afterEach(cleanup)

function renderInput(props: Partial<React.ComponentProps<typeof SearchInput>> = {}) {
  const onChange = vi.fn()
  const onClear = vi.fn()
  render(
    <SearchInput
      value=""
      onChange={onChange}
      onClear={onClear}
      placeholder="Search tracks"
      ariaLabel="Search tracks"
      clearLabel="Clear search"
      testid="track-search"
      {...props}
    />,
  )
  return { onChange, onClear }
}

describe('SearchInput', () => {
  // The magnifier is the always-on affordance that tells the user the field searches —
  // both the track filter and the Discogs box must read the same way.
  it('always shows the magnifier icon', () => {
    renderInput()
    expect(screen.getByTestId('track-search-icon')).toBeInTheDocument()
  })

  it('reports typing through onChange', () => {
    const { onChange } = renderInput()
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'kraftwerk' } })
    expect(onChange).toHaveBeenCalledWith('kraftwerk')
  })

  // The clear button only earns its space once there is something to clear, so an empty
  // field stays uncluttered.
  it('hides the clear button when empty and shows it once there is text', () => {
    const { rerender } = render(
      <SearchInput
        value=""
        onChange={vi.fn()}
        onClear={vi.fn()}
        placeholder="p"
        ariaLabel="a"
        clearLabel="Clear"
        testid="track-search"
      />,
    )
    expect(screen.queryByTestId('track-search-clear')).toBeNull()
    rerender(
      <SearchInput
        value="x"
        onChange={vi.fn()}
        onClear={vi.fn()}
        placeholder="p"
        ariaLabel="a"
        clearLabel="Clear"
        testid="track-search"
      />,
    )
    expect(screen.getByTestId('track-search-clear')).toBeInTheDocument()
  })

  it('gives the clear button a 24 px press area around its 18 px drawing', () => {
    render(
      <SearchInput
        value="x"
        onChange={vi.fn()}
        onClear={vi.fn()}
        placeholder="p"
        ariaLabel="a"
        clearLabel="Clear"
        testid="track-search"
      />,
    )
    expect(screen.getByTestId('track-search-clear').className).toContain('after:-inset-[3px]')
  })

  it('fires onClear when the clear button is pressed', () => {
    const { onClear } = renderInput({ value: 'x' })
    fireEvent.click(screen.getByTestId('track-search-clear'))
    expect(onClear).toHaveBeenCalledOnce()
  })

  // The Discogs box dives into results with ArrowDown and searches on Enter; the shared
  // component must forward those keystrokes untouched.
  it('forwards keydown to the caller', () => {
    const onKeyDown = vi.fn()
    renderInput({ onKeyDown })
    fireEvent.keyDown(screen.getByTestId('track-search'), { key: 'Enter' })
    expect(onKeyDown).toHaveBeenCalledOnce()
  })

  // While a remote search runs, the magnifier becomes a spinner — this is the feedback
  // that used to live on the now-removed "Search" button.
  it('swaps the magnifier for a spinner while busy', () => {
    renderInput({ busy: true })
    expect(screen.queryByTestId('track-search-icon')).toBeNull()
    expect(screen.getByTestId('track-search-spinner')).toBeInTheDocument()
  })

  // Two search fields stand side by side in the same toolbar row. Once a query is typed the
  // placeholder is gone, and nothing said that this one searches the catalogs, not the list.
  it('names what it searches in front of the query, typed or not', () => {
    renderInput({ value: 'DJ Roy', scope: 'Catalogs' })
    expect(screen.getByTestId('track-search-scope')).toHaveTextContent('Catalogs')
  })

  // The scope sits where the magnifier was, so the in-flight spinner has to live in it too.
  it('keeps the search spinner inside the scope while a search runs', () => {
    renderInput({ value: 'DJ Roy', scope: 'Catalogs', busy: true })
    expect(screen.getByTestId('track-search-scope')).toContainElement(
      screen.getByTestId('track-search-spinner'),
    )
  })

  it('shows no scope on a field that searches the list in front of it', () => {
    renderInput()
    expect(screen.queryByTestId('track-search-scope')).not.toBeInTheDocument()
  })
})
