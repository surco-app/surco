// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { DeclickControls } from './DeclickControls'

afterEach(cleanup)

describe('DeclickControls', () => {
  it('offers the whole intensity ladder and reports the pick through onChange', () => {
    const onChange = vi.fn()
    render(<DeclickControls value="off" onChange={onChange} />)
    expect(screen.getByTestId('declick-mode-soft')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('declick-mode-standard'))
    expect(onChange).toHaveBeenCalledWith('standard')
  })

  // Each active step explains its trade-off right under the control — off needs
  // no caveat.
  it('shows the active step’s hint and none while off', () => {
    const { rerender } = render(<DeclickControls value="off" onChange={() => {}} />)
    expect(screen.queryByTestId('declick-mode-hint')).not.toBeInTheDocument()
    rerender(<DeclickControls value="strong" onChange={() => {}} />)
    expect(screen.getByTestId('declick-mode-hint')).toBeInTheDocument()
  })

  // No raw ffmpeg strings in the UI — the ladder labels are the whole vocabulary a
  // user needs (the filter mapping lives in shared/declick.ts for the tests).
  it('never surfaces the underlying filter string', () => {
    render(<DeclickControls value="strong" onChange={() => {}} />)
    expect(screen.queryByTestId('declick-applied')).not.toBeInTheDocument()
    expect(screen.queryByText(/adeclick/)).not.toBeInTheDocument()
  })
})

// The picker is four bare words ("Off", "Gentle"...). Without a group name a screen
// reader lands on "Gentle, toggle button" with nothing saying what is gentle, in the
// editor where no settings label sits above it.
describe('DeclickControls group name', () => {
  it('names the intensity ladder after the repair it sets', () => {
    render(<DeclickControls value="off" onChange={() => {}} />)
    expect(screen.getByRole('group', { name: 'Vinyl click repair' })).toBeInTheDocument()
  })
})
