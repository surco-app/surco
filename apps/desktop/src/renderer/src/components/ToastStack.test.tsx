// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { Toast } from '../lib/toastQueue'
import { ToastStack } from './ToastStack'

afterEach(cleanup)

function toast(over: Partial<Toast> = {}): Toast {
  return { id: 't1', tone: 'neutral', message: 'hello', ...over }
}

describe('ToastStack', () => {
  it('renders nothing when the queue is empty', () => {
    const { container } = render(
      <ToastStack toasts={[]} onExpire={vi.fn()} onClose={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('stacks every queued toast so a notice and a prompt show at once', () => {
    // The reason the toasts were unified: independent notifications coexist instead of one
    // corner overwriting another.
    render(
      <ToastStack
        toasts={[toast({ id: 'a', message: 'skipped 3' }), toast({ id: 'b', message: 'update ready' })]}
        onExpire={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('skipped 3')).toBeInTheDocument()
    expect(screen.getByText('update ready')).toBeInTheDocument()
  })

  it('shows an action button that fires the toast action', () => {
    const onAction = vi.fn()
    render(
      <ToastStack
        toasts={[toast({ testid: 'new-tracks', action: { label: 'Load', onAction } })]}
        onExpire={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('new-tracks-action'))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('shows a countdown bar only on a toast that auto-dismisses', () => {
    // The bar visualises the remaining time before a transient notice clears itself; a
    // persistent prompt (no duration) has nothing to count down, so it must not show one.
    const { rerender } = render(
      <ToastStack
        toasts={[toast({ testid: 'app-notice', duration: 4000 })]}
        onExpire={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('app-notice-countdown')).toBeInTheDocument()

    rerender(
      <ToastStack
        toasts={[toast({ testid: 'new-tracks', action: { label: 'Load', onAction: vi.fn() } })]}
        onExpire={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('new-tracks-countdown')).toBeNull()
  })

  it('the ✕ routes through onClose so the toast’s own cleanup runs, not a bare removal', () => {
    // onClose carries side effects (clearing the pending-new set); the timer must not, which
    // is why the two paths are separate. The ✕ must take the onClose path.
    const onExpire = vi.fn()
    const onClose = vi.fn()
    render(
      <ToastStack
        toasts={[toast({ id: 'x', testid: 'new-tracks' })]}
        onExpire={onExpire}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByTestId('new-tracks-dismiss'))
    expect(onClose).toHaveBeenCalledWith('x')
    expect(onExpire).not.toHaveBeenCalled()
  })

  describe('with fake timers', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('auto-expires a toast that carries a duration, via onExpire not onClose', () => {
      // A transient notice clears itself without side effects; that is the onExpire path.
      const onExpire = vi.fn()
      const onClose = vi.fn()
      render(
        <ToastStack
          toasts={[toast({ id: 'n', duration: 4000 })]}
          onExpire={onExpire}
          onClose={onClose}
        />,
      )
      act(() => vi.advanceTimersByTime(4000))
      expect(onExpire).toHaveBeenCalledWith('n')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('leaves a toast without a duration on screen indefinitely', () => {
      const onExpire = vi.fn()
      render(
        <ToastStack toasts={[toast({ id: 'p' })]} onExpire={onExpire} onClose={vi.fn()} />,
      )
      act(() => vi.advanceTimersByTime(60_000))
      expect(onExpire).not.toHaveBeenCalled()
    })
  })
})
