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
  // The empty container still mounts: a live region must exist before content arrives
  // or screen readers miss the first toast. No cards means nothing visible or clickable.
  it('keeps an empty, announced live region mounted when the queue is empty', () => {
    const { container } = render(
      <ToastStack toasts={[]} onExpire={vi.fn()} onClose={vi.fn()} />,
    )
    const region = container.firstElementChild as HTMLElement
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()
  })

  // A centred modal owns the bottom-right corner with its Cancel/Save bar; a toast pinned
  // there covers the primary action. While an overlay is open the stack moves to the
  // bottom-left so the modal's actions stay reachable.
  it('anchors the stack bottom-left while an overlay is open, bottom-right otherwise', () => {
    const { container, rerender } = render(
      <ToastStack toasts={[]} onExpire={vi.fn()} onClose={vi.fn()} />,
    )
    const region = container.firstElementChild as HTMLElement
    expect(region.className).toContain('right-5')
    expect(region.className).not.toContain('left-5')

    rerender(<ToastStack toasts={[]} overlayOpen onExpire={vi.fn()} onClose={vi.fn()} />)
    expect(region.className).toContain('left-5')
    expect(region.className).not.toContain('right-5')
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

  // An error's whole value is being reportable: a raw osascript/ffmpeg failure is long and
  // easy to mistype, so a danger toast must offer a one-click copy of the exact message.
  it('copies the message from a danger toast, but offers no copy button on a neutral one', () => {
    const copyText = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { api: { copyText: typeof copyText } }).api = { copyText }

    const { rerender } = render(
      <ToastStack
        toasts={[toast({ testid: 'process-error', tone: 'danger', message: 'osascript failed (-1712)' })]}
        onExpire={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('process-error-copy'))
    expect(copyText).toHaveBeenCalledWith('osascript failed (-1712)')

    rerender(
      <ToastStack
        toasts={[toast({ testid: 'app-notice', tone: 'neutral', message: 'saved' })]}
        onExpire={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('app-notice-copy')).toBeNull()
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

    // A dismissed card must not blink out of existence — it lingers just long enough
    // for its leave animation, then unmounts. Now that several toasts expire on their
    // own, an instant unmount reads as a rendering glitch, not a dismissal.
    it('keeps a dismissed card briefly for its exit animation, then drops it', () => {
      const { rerender } = render(
        <ToastStack
          toasts={[toast({ id: 'a', testid: 'app-notice' })]}
          onExpire={vi.fn()}
          onClose={vi.fn()}
        />,
      )
      rerender(<ToastStack toasts={[]} onExpire={vi.fn()} onClose={vi.fn()} />)
      expect(screen.getByTestId('app-notice')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(400))
      expect(screen.queryByTestId('app-notice')).toBeNull()
    })

    // A keyed re-push (the new-tracks count updating in place) swaps ids in the queue;
    // the outgoing twin must vanish immediately or every count change would flash a
    // duplicate card fading out under the fresh one.
    it('replaces a keyed card instantly instead of fading the old one out', () => {
      const { rerender } = render(
        <ToastStack
          toasts={[toast({ id: 'a', key: 'new-tracks', message: '2 new tracks' })]}
          onExpire={vi.fn()}
          onClose={vi.fn()}
        />,
      )
      rerender(
        <ToastStack
          toasts={[toast({ id: 'b', key: 'new-tracks', message: '3 new tracks' })]}
          onExpire={vi.fn()}
          onClose={vi.fn()}
        />,
      )
      expect(screen.getByText('3 new tracks')).toBeInTheDocument()
      expect(screen.queryByText('2 new tracks')).toBeNull()
    })
  })
})
