// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { DeclickControls } from './DeclickControls'

afterEach(cleanup)

describe('DeclickControls', () => {
  it('reports the picked mode through onChange, keeping the sensitivity', () => {
    const onChange = vi.fn()
    render(<DeclickControls value={{ mode: 'off', sensitivity: 3 }} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('declick-mode-standard'))
    expect(onChange).toHaveBeenCalledWith({ mode: 'standard', sensitivity: 3 })
  })

  // The strong preset can soften sharp percussive transients, so each active mode
  // explains its trade-off right under the control — off needs no caveat.
  it('shows the active mode’s hint and none while off', () => {
    const { rerender } = render(
      <DeclickControls value={{ mode: 'off', sensitivity: 5 }} onChange={() => {}} />,
    )
    expect(screen.queryByTestId('declick-mode-hint')).not.toBeInTheDocument()
    rerender(<DeclickControls value={{ mode: 'strong', sensitivity: 5 }} onChange={() => {}} />)
    expect(screen.getByTestId('declick-mode-hint')).toBeInTheDocument()
  })

  it('offers the sensitivity slider only while a mode is active', () => {
    const { rerender } = render(
      <DeclickControls value={{ mode: 'off', sensitivity: 5 }} onChange={() => {}} />,
    )
    expect(screen.queryByTestId('declick-sensitivity')).not.toBeInTheDocument()
    rerender(<DeclickControls value={{ mode: 'standard', sensitivity: 5 }} onChange={() => {}} />)
    expect(screen.getByTestId('declick-sensitivity')).toBeInTheDocument()
  })

  it('reports a sensitivity change through onChange, keeping the mode', () => {
    const onChange = vi.fn()
    render(<DeclickControls value={{ mode: 'standard', sensitivity: 5 }} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('declick-sensitivity'), { target: { value: '3' } })
    expect(onChange).toHaveBeenCalledWith({ mode: 'standard', sensitivity: 3 })
  })

  // The transparency line: the exact ffmpeg stage, built by the same shared function
  // the conversion uses, so what the user reads is what runs.
  it('shows the exact applied filter for the current dials', () => {
    const { rerender } = render(
      <DeclickControls value={{ mode: 'strong', sensitivity: 3 }} onChange={() => {}} />,
    )
    expect(screen.getByTestId('declick-applied')).toHaveTextContent('adeclick=t=4:b=4')
    rerender(<DeclickControls value={{ mode: 'standard', sensitivity: 5 }} onChange={() => {}} />)
    expect(screen.getByTestId('declick-applied')).toHaveTextContent(/adeclick$/)
  })
})
