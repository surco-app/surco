// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { ConfirmDialog } from './ConfirmDialog'

afterEach(cleanup)

function renderDialog(over: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(
    <ConfirmDialog
      title="Clear the list?"
      message="This removes all 4 tracks."
      confirmLabel="Clear"
      onConfirm={onConfirm}
      onClose={onClose}
      {...over}
    />,
  )
  return { onConfirm, onClose }
}

describe('ConfirmDialog', () => {
  it('shows the title and message so the user knows what will happen', () => {
    renderDialog()
    expect(screen.getByText('Clear the list?')).toBeInTheDocument()
    expect(screen.getByText('This removes all 4 tracks.')).toBeInTheDocument()
  })

  // A screen reader announces a dialog by its accessible name; without one it just
  // says "dialog", leaving the user unsure what they're confirming.
  it('names the dialog after its title for screen readers', () => {
    renderDialog()
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Clear the list?')
  })

  // The default action must be reachable from the keyboard the instant the dialog
  // opens: macOS focuses the default button, and that focus is what makes Enter fire it.
  it('focuses the default confirm button on open', () => {
    renderDialog()
    expect(screen.getByTestId('confirm-ok')).toHaveFocus()
  })

  // Pressing Enter submits the dialog's form; without form wiring it did nothing.
  it('confirms when the form is submitted (Enter)', () => {
    const { onConfirm, onClose } = renderDialog()
    fireEvent.submit(screen.getByTestId('confirm-ok').closest('form') as HTMLFormElement)
    expect(onConfirm).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('runs the action and closes on confirm', () => {
    const { onConfirm, onClose } = renderDialog()
    fireEvent.click(screen.getByTestId('confirm-ok'))
    expect(onConfirm).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('closes without acting on cancel', () => {
    const { onConfirm, onClose } = renderDialog()
    fireEvent.click(screen.getByTestId('confirm-cancel'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('disables confirm when there is nothing to do', () => {
    const { onConfirm } = renderDialog({ confirmDisabled: true })
    fireEvent.click(screen.getByTestId('confirm-ok'))
    expect(screen.getByTestId('confirm-ok')).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
