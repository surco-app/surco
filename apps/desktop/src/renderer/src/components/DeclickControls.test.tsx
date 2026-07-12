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

  // The transparency line: the exact ffmpeg stage, built by the same shared function
  // the conversion uses, so what the user reads is what runs.
  it('shows the exact applied filter for the current step', () => {
    const { rerender } = render(<DeclickControls value="soft" onChange={() => {}} />)
    expect(screen.getByTestId('declick-applied')).toHaveTextContent('adeclick=t=4')
    rerender(<DeclickControls value="strong" onChange={() => {}} />)
    expect(screen.getByTestId('declick-applied')).toHaveTextContent('adeclick=b=4')
    rerender(<DeclickControls value="off" onChange={() => {}} />)
    expect(screen.queryByTestId('declick-applied')).not.toBeInTheDocument()
  })
})
