// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { ModalShell } from './ModalShell'

afterEach(cleanup)

describe('ModalShell', () => {
  it('names the dialog from the heading it wraps', () => {
    render(
      <ModalShell onClose={() => {}} backdropTestId="shell-backdrop" labelledBy="t" className="w-80">
        <h2 id="t">Do the thing?</h2>
      </ModalShell>,
    )
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Do the thing?')
  })

  it('dismisses when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <ModalShell onClose={onClose} backdropTestId="shell-backdrop" className="w-80">
        <p>body</p>
      </ModalShell>,
    )
    fireEvent.click(screen.getByTestId('shell-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  // With onSubmit the body becomes a form, so Enter on the primary button submits.
  it('submits the wrapped form when provided an onSubmit', () => {
    const onSubmit = vi.fn()
    render(
      <ModalShell
        onClose={() => {}}
        backdropTestId="shell-backdrop"
        className="w-80"
        onSubmit={onSubmit}
      >
        <button type="submit" data-testid="ok">
          OK
        </button>
      </ModalShell>,
    )
    fireEvent.submit(screen.getByTestId('ok').closest('form') as HTMLFormElement)
    expect(onSubmit).toHaveBeenCalled()
  })

  it('does not wrap a form when no onSubmit is given', () => {
    render(
      <ModalShell onClose={() => {}} backdropTestId="shell-backdrop" className="w-80">
        <button type="button" data-testid="ok">
          OK
        </button>
      </ModalShell>,
    )
    expect(screen.getByTestId('ok').closest('form')).toBeNull()
  })
})
