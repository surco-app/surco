// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { DeclickControls } from './DeclickControls'

afterEach(cleanup)

describe('DeclickControls', () => {
  it('reports the picked mode through onChange', () => {
    const onChange = vi.fn()
    render(<DeclickControls value="off" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('declick-mode-standard'))
    expect(onChange).toHaveBeenCalledWith('standard')
  })

  // The strong preset can soften sharp percussive transients, so each active mode
  // explains its trade-off right under the control — off needs no caveat.
  it('shows the active mode’s hint and none while off', () => {
    const { rerender } = render(<DeclickControls value="off" onChange={() => {}} />)
    expect(screen.queryByTestId('declick-mode-hint')).not.toBeInTheDocument()
    rerender(<DeclickControls value="strong" onChange={() => {}} />)
    expect(screen.getByTestId('declick-mode-hint')).toBeInTheDocument()
  })
})
