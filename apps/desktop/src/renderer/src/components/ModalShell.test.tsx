// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { ModalShell } from './ModalShell'
import { ToastStack } from './ToastStack'

afterEach(cleanup)

describe('ModalShell background', () => {
  // aria-modal alone leaves the app behind reachable to VoiceOver's cursor and to a mouse
  // click through a gap: the rest of the window goes inert while the dialog is up. The
  // toasts stay live (an "Undo" must still be pressable) and so does the shell's own
  // backdrop, which is how a click outside closes it. Closing hands everything back.
  it('makes the rest of the app inert while open, except the toasts, and restores it', () => {
    const shell = (
      <ModalShell onClose={() => {}} backdropTestId="shell-backdrop" className="w-80">
        <button type="button">inside</button>
      </ModalShell>
    )
    const { container, rerender } = render(
      <div>
        <button type="button" data-testid="behind">
          behind
        </button>
        <ToastStack toasts={[]} onExpire={vi.fn()} onClose={vi.fn()} />
        {shell}
      </div>,
    )
    const toasts = container.querySelector('[aria-live]') as HTMLElement
    expect(screen.getByTestId('behind')).toHaveAttribute('inert')
    expect(toasts).not.toHaveAttribute('inert')
    expect(screen.getByTestId('shell-backdrop')).not.toHaveAttribute('inert')
    expect(screen.getByRole('dialog')).not.toHaveAttribute('inert')

    rerender(
      <div>
        <button type="button" data-testid="behind">
          behind
        </button>
        <ToastStack toasts={[]} onExpire={vi.fn()} onClose={vi.fn()} />
      </div>,
    )
    expect(screen.getByTestId('behind')).not.toHaveAttribute('inert')
  })
})

describe('ModalShell', () => {
  it('names the dialog from the heading it wraps', () => {
    render(
      <ModalShell
        onClose={() => {}}
        backdropTestId="shell-backdrop"
        labelledBy="t"
        className="w-80"
      >
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

describe('ModalShell entrance', () => {
  function open(): void {
    render(
      <ModalShell onClose={() => {}} backdropTestId="shell-backdrop" className="w-80">
        <p>body</p>
      </ModalShell>,
    )
  }

  // ⌘, ⌘⇧R, ⌘F, ⌘I and ? open their dialogs from the keyboard, and a keystroke expects its
  // answer on the next frame: an entrance there reads as input latency, the same reason the
  // palette opens bare. The pop stays for the click, where it shows where the dialog came from.
  it('opens without the entrance when a key opened it', () => {
    fireEvent.keyDown(window, { key: ',', metaKey: true })
    open()
    expect(screen.getByRole('dialog').className).not.toContain('animate-pop')
    expect(screen.getByTestId('shell-backdrop').className).not.toContain('animate-overlay')
  })

  it('keeps the entrance when a click opened it', () => {
    fireEvent.keyDown(window, { key: ',', metaKey: true })
    fireEvent.pointerDown(window)
    open()
    expect(screen.getByRole('dialog').className).toContain('animate-pop')
    expect(screen.getByTestId('shell-backdrop').className).toContain('animate-overlay')
  })
})
