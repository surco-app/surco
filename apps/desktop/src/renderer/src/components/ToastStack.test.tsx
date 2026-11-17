// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { Toast } from '../lib/toastQueue'
import { ModalShell } from './ModalShell'
import { ToastStack } from './ToastStack'

afterEach(cleanup)

function toast(over: Partial<Toast> = {}): Toast {
  return { id: 't1', tone: 'neutral', message: 'hello', ...over }
}

describe('ToastStack', () => {
  // The empty container still mounts: a live region must exist before content arrives
  // or screen readers miss the first toast. No cards means nothing visible or clickable.
  it('keeps an empty, announced live region mounted when the queue is empty', () => {
    const { container } = render(<ToastStack toasts={[]} onExpire={vi.fn()} onClose={vi.fn()} />)
    const region = container.firstElementChild as HTMLElement
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()
  })

  // The container is already a polite live region; a status or alert role on each card
  // nested a second one inside it and VoiceOver read every toast twice. One path only.
  it('announces a toast through the container alone, not a second live region per card', () => {
    const { container } = render(
      <ToastStack
        toasts={[
          toast({ id: 'a', message: 'saved' }),
          toast({ id: 'b', tone: 'danger', message: 'failed' }),
        ]}
        onExpire={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const region = container.firstElementChild as HTMLElement
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region.querySelectorAll('[role="status"], [role="alert"], [aria-live]')).toHaveLength(0)
  })

  it('anchors the stack top-right under the toolbar, clear of the editor footer and its Convert button', () => {
    const { container } = render(<ToastStack toasts={[]} onExpire={vi.fn()} onClose={vi.fn()} />)
    const region = container.firstElementChild as HTMLElement
    expect(region.className).toContain('right-5')
    expect(region.className).toContain('top-14')
    expect(region.className).not.toContain('bottom-5')
    expect(region.className).not.toContain('left-5')
  })

  it('puts the newest toast on top, nearest the corner it appears from', () => {
    render(
      <ToastStack
        toasts={[
          toast({ id: 'old', message: 'first notice' }),
          toast({ id: 'new', message: 'second notice' }),
        ]}
        onExpire={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const slots = screen.getAllByTestId('toast-slot')
    expect(slots[0]).toHaveTextContent('second notice')
    expect(slots[1]).toHaveTextContent('first notice')
  })

  it('drops a card in from above, the side the stack hangs from, instead of the modal pop', () => {
    render(
      <ToastStack
        toasts={[toast({ id: 'a', message: 'hola' })]}
        onExpire={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const card = screen.getByTestId('toast-slot').querySelector('.rounded-xl') as HTMLElement
    expect(card.className).toContain('animate-toast-in')
    expect(card.className).not.toContain('animate-pop')
  })

  it('stacks every queued toast so a notice and a prompt show at once', () => {
    // The reason the toasts were unified: independent notifications coexist instead of one
    // corner overwriting another.
    render(
      <ToastStack
        toasts={[
          toast({ id: 'a', message: 'skipped 3' }),
          toast({ id: 'b', message: 'update ready' }),
        ]}
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
        toasts={[
          toast({ testid: 'process-error', tone: 'danger', message: 'osascript failed (-1712)' }),
        ]}
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

  // A fresh node replays the pop-in entrance on every update of the new-tracks count, so
  // the notice flickers and slides up again each time a file lands in the watched folder.
  it('keeps the same card node when a keyed toast is re-pushed with a new id', () => {
    const { rerender } = render(
      <ToastStack
        toasts={[toast({ id: 't1', key: 'new-tracks', testid: 'new-tracks', message: '3 new' })]}
        onExpire={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const before = screen.getByTestId('new-tracks')
    rerender(
      <ToastStack
        toasts={[toast({ id: 't2', key: 'new-tracks', testid: 'new-tracks', message: '5 new' })]}
        onExpire={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('new-tracks')).toBe(before)
    expect(screen.getByTestId('new-tracks-message')).toHaveTextContent('5 new')
  })

  describe('with fake timers', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    const withModal = (open: boolean, toasts: Toast[], onExpire = vi.fn()) => (
      <>
        <ToastStack toasts={toasts} onExpire={onExpire} onClose={vi.fn()} />
        {open && (
          <ModalShell
            onClose={vi.fn()}
            backdropTestId="modal-backdrop"
            className=""
            label="Ajustes"
          >
            <button type="button">Cerrar</button>
          </ModalShell>
        )}
      </>
    )

    it('steps a plain notice out of the way of an open dialog and brings it back when it closes', () => {
      const toasts = [
        toast({ id: 'n', testid: 'notice', message: 'disk full' }),
        toast({
          id: 'u',
          testid: 'undo',
          message: 'removed',
          action: { label: 'Undo', onAction: vi.fn() },
        }),
      ]
      const { rerender } = render(withModal(false, toasts))
      rerender(withModal(true, toasts))
      expect(screen.getByTestId('notice')).not.toBeVisible()
      expect(screen.getByTestId('undo')).toBeVisible()
      rerender(withModal(false, toasts))
      expect(screen.getByTestId('notice')).toBeVisible()
    })

    it('holds a hidden notice’s countdown so it cannot expire unseen behind a dialog', () => {
      const onExpire = vi.fn()
      const toasts = [toast({ id: 'n', message: 'saved', duration: 4000 })]
      const { rerender } = render(withModal(true, toasts, onExpire))
      act(() => vi.advanceTimersByTime(10000))
      expect(onExpire).not.toHaveBeenCalled()
      rerender(withModal(false, toasts, onExpire))
      act(() => vi.advanceTimersByTime(4000))
      expect(onExpire).toHaveBeenCalledWith('n')
    })

    // The re-push brings a fresh deadline, so the clock starts over even though the card
    // stays mounted: a count that just grew must not expire on the old toast's leftover time.
    it('restarts the auto-dismiss clock when a keyed toast is re-pushed', () => {
      const onExpire = vi.fn()
      const { rerender } = render(
        <ToastStack
          toasts={[toast({ id: 't1', key: 'new-tracks', duration: 1000 })]}
          onExpire={onExpire}
          onClose={vi.fn()}
        />,
      )
      act(() => vi.advanceTimersByTime(800))
      rerender(
        <ToastStack
          toasts={[toast({ id: 't2', key: 'new-tracks', duration: 1000 })]}
          onExpire={onExpire}
          onClose={vi.fn()}
        />,
      )
      act(() => vi.advanceTimersByTime(800))
      expect(onExpire).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(300))
      expect(onExpire).toHaveBeenCalledWith('t2')
    })

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

    // WCAG 2.2.1: a toast that vanishes on a clock is lost to anyone who reads slowly or
    // is still reaching for its action. Resting the pointer on it must stop the clock, and
    // leaving must resume with the time that was left, not restart or expire at once.
    it('pauses the countdown while the pointer rests on the card and resumes on leave', () => {
      const onExpire = vi.fn()
      render(
        <ToastStack
          toasts={[toast({ id: 'n', testid: 'app-notice', duration: 4000 })]}
          onExpire={onExpire}
          onClose={vi.fn()}
        />,
      )
      act(() => vi.advanceTimersByTime(1000))
      fireEvent.pointerEnter(screen.getByTestId('app-notice'))
      act(() => vi.advanceTimersByTime(10_000))
      expect(onExpire).not.toHaveBeenCalled()
      expect(screen.getByTestId('app-notice-countdown').style.animationPlayState).toBe('paused')
      fireEvent.pointerLeave(screen.getByTestId('app-notice'))
      act(() => vi.advanceTimersByTime(2999))
      expect(onExpire).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(1))
      expect(onExpire).toHaveBeenCalledWith('n')
    })

    // A keyboard user tabbing to "Undo trim" has the focus inside the card: the toast must
    // not expire under them while they are about to press the action.
    it('holds a toast with an action open while the focus is inside it', () => {
      const onExpire = vi.fn()
      render(
        <ToastStack
          toasts={[
            toast({
              id: 'u',
              testid: 'undo',
              duration: 4000,
              action: { label: 'Undo', onAction: vi.fn() },
            }),
          ]}
          onExpire={onExpire}
          onClose={vi.fn()}
        />,
      )
      act(() => screen.getByTestId('undo-action').focus())
      act(() => vi.advanceTimersByTime(10_000))
      expect(onExpire).not.toHaveBeenCalled()
      act(() => screen.getByTestId('undo-action').blur())
      act(() => vi.advanceTimersByTime(4000))
      expect(onExpire).toHaveBeenCalledWith('u')
    })

    it('leaves a toast without a duration on screen indefinitely', () => {
      const onExpire = vi.fn()
      render(<ToastStack toasts={[toast({ id: 'p' })]} onExpire={onExpire} onClose={vi.fn()} />)
      act(() => vi.advanceTimersByTime(60_000))
      expect(onExpire).not.toHaveBeenCalled()
    })

    // The exit fades the card, but the SPACE it held used to vanish only at unmount —
    // every surviving toast jumped a full card height in one frame. The wrapper row
    // collapses in step with the fade, so neighbours settle instead of jumping.
    it('collapses the leaving card’s row so surviving toasts settle, not jump', () => {
      const two = [toast({ id: 'a', testid: 'app-notice' }), toast({ id: 'b', testid: 'b-toast' })]
      const { rerender } = render(<ToastStack toasts={two} onExpire={vi.fn()} onClose={vi.fn()} />)
      const wrapper = screen.getByTestId('app-notice').parentElement?.parentElement
      expect(wrapper?.className).toContain('grid-rows-[1fr]')
      rerender(<ToastStack toasts={[two[1]]} onExpire={vi.fn()} onClose={vi.fn()} />)
      expect(wrapper?.className).toContain('grid-rows-[0fr]')
      expect(screen.getByTestId('b-toast').parentElement?.parentElement?.className).toContain(
        'grid-rows-[1fr]',
      )
    })

    // Entry has to mirror the exit: a new row born at 1fr pushed every card above it up a
    // full height in one frame. @starting-style opens the row from 0fr on mount (jsdom
    // cannot evaluate it, so this only guards the variant). A leaving row must not carry it.
    it('opens a new card’s row from zero so the cards above rise, not jump', () => {
      const two = [toast({ id: 'a', testid: 'a-toast' }), toast({ id: 'b', testid: 'b-toast' })]
      const { rerender } = render(<ToastStack toasts={two} onExpire={vi.fn()} onClose={vi.fn()} />)
      rerender(<ToastStack toasts={[two[1]]} onExpire={vi.fn()} onClose={vi.fn()} />)
      const slotOf = (id: string) =>
        screen.getAllByTestId('toast-slot').find((s) => s.querySelector(`[data-testid="${id}"]`))
      const leavingSlot = slotOf('a-toast') as HTMLElement
      const liveSlot = slotOf('b-toast') as HTMLElement
      expect(liveSlot.className).toContain('starting:grid-rows-[0fr]')
      expect(leavingSlot.className).not.toContain('starting:grid-rows-[0fr]')
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

  describe('swipe to dismiss, like a Mac notification slid off towards its edge', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
    })
    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    const card = () => screen.getByTestId('swipe-toast')
    const drag = (steps: number, deltaX: number, everyMs: number, deltaY = 0) => {
      for (let i = 0; i < steps; i++) {
        fireEvent.wheel(card(), { deltaX, deltaY })
        act(() => vi.advanceTimersByTime(everyMs))
      }
    }
    const letGo = () => act(() => vi.advanceTimersByTime(500))
    const renderCard = (onClose = vi.fn()) => {
      render(
        <ToastStack
          toasts={[toast({ id: 's', testid: 'swipe-toast' })]}
          onExpire={vi.fn()}
          onClose={onClose}
        />,
      )
      return onClose
    }

    it('closes the toast through onClose on a long swipe to the right', () => {
      const onClose = renderCard()
      drag(8, -30, 8)
      letGo()
      expect(onClose).toHaveBeenCalledWith('s')
    })

    it('closes it on a short quick flick, because how fast the hand moved says where it was going', () => {
      const onClose = renderCard()
      drag(3, -20, 8)
      letGo()
      expect(onClose).toHaveBeenCalledWith('s')
    })

    it('closes as soon as the swipe crosses 40% of the card, without waiting out the trackpad momentum', () => {
      const onClose = renderCard()
      for (let i = 0; i < 7; i++) fireEvent.wheel(card(), { deltaX: -20 })
      expect(onClose).toHaveBeenCalledWith('s')
    })

    it('swallows the momentum tail of a swipe that closed a card, so it cannot sweep away the card that slides in under the pointer', () => {
      const onClose = vi.fn()
      render(
        <ToastStack
          toasts={[
            toast({ id: 'a', testid: 'first-toast' }),
            toast({ id: 'b', testid: 'swipe-toast' }),
          ]}
          onExpire={vi.fn()}
          onClose={onClose}
        />,
      )
      for (let i = 0; i < 7; i++)
        fireEvent.wheel(screen.getByTestId('first-toast'), { deltaX: -20 })
      expect(onClose).toHaveBeenCalledWith('a')
      for (let i = 0; i < 7; i++) fireEvent.wheel(card(), { deltaX: -20 })
      drag(10, -20, 50)
      letGo()
      expect(onClose).not.toHaveBeenCalledWith('b')
      for (let i = 0; i < 7; i++) fireEvent.wheel(card(), { deltaX: -20 })
      expect(onClose).toHaveBeenCalledWith('b')
    })

    it('gives a keyed toast re-pushed during the swipe exit a visible card that swipes again', () => {
      const keyed = (id: string) => [toast({ id, key: 'new-tracks', testid: 'swipe-toast' })]
      const { rerender } = render(
        <ToastStack toasts={keyed('t1')} onExpire={vi.fn()} onClose={vi.fn()} />,
      )
      drag(8, -30, 8)
      letGo()
      rerender(<ToastStack toasts={[]} onExpire={vi.fn()} onClose={vi.fn()} />)
      act(() => vi.advanceTimersByTime(50))
      rerender(<ToastStack toasts={keyed('t2')} onExpire={vi.fn()} onClose={vi.fn()} />)
      expect(card().style.transform).toBe('')
      expect(card().style.opacity).toBe('')
      fireEvent.wheel(card(), { deltaX: -20 })
      expect(card().style.transform).toBe('translateX(20px)')
    })

    it('springs back without closing when a short distance is covered slowly', () => {
      const onClose = renderCard()
      drag(3, -10, 100)
      letGo()
      expect(onClose).not.toHaveBeenCalled()
      expect(['', 'translateX(0px)']).toContain(card().style.transform)
    })

    it('ignores a vertical swipe, which is the long error message scrolling', () => {
      const onClose = renderCard()
      fireEvent.wheel(card(), { deltaX: -5, deltaY: 40 })
      expect(card().style.transform).toBe('')
      drag(8, -10, 8, 60)
      letGo()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('never closes on a swipe to the left, away from the edge the toast sits on', () => {
      const onClose = renderCard()
      drag(8, 60, 8)
      const slid = Number.parseFloat(card().style.transform.replace('translateX(', ''))
      expect(slid).toBeLessThan(0)
      expect(slid).toBeGreaterThan(-100)
      letGo()
      expect(onClose).not.toHaveBeenCalled()
      expect(['', 'translateX(0px)']).toContain(card().style.transform)
    })

    it('follows the fingers one to one, with no transition lagging behind them', () => {
      renderCard()
      fireEvent.wheel(card(), { deltaX: -20 })
      fireEvent.wheel(card(), { deltaX: -20 })
      fireEvent.wheel(card(), { deltaX: -20 })
      expect(card().style.transform).toBe('translateX(60px)')
      expect(card().style.transition).toBe('none')
    })

    it('slides the swiped card on from where it is, since the leave keyframes would jump it back to the start', () => {
      function Live() {
        const [toasts, setToasts] = useState([toast({ id: 's', testid: 'swipe-toast' })])
        return (
          <ToastStack
            toasts={toasts}
            onExpire={vi.fn()}
            onClose={(id) => setToasts((all) => all.filter((t) => t.id !== id))}
          />
        )
      }
      render(<Live />)
      for (let i = 0; i < 7; i++) fireEvent.wheel(card(), { deltaX: -20 })
      expect(card()).toHaveAttribute('aria-hidden', 'true')
      expect(card().className).not.toContain('animate-toast-leave')
      expect(card().style.transform).toBe('translateX(324px)')
    })

    it('collapses the row of a swiped card without clipping its sideways exit, which would cut it off mid-slide', () => {
      function Live() {
        const [toasts, setToasts] = useState([toast({ id: 's', testid: 'swipe-toast' })])
        return (
          <ToastStack
            toasts={toasts}
            onExpire={vi.fn()}
            onClose={(id) => setToasts((all) => all.filter((t) => t.id !== id))}
          />
        )
      }
      render(<Live />)
      for (let i = 0; i < 7; i++) fireEvent.wheel(card(), { deltaX: -20 })
      const wrapper = screen.getByTestId('toast-slot').firstElementChild as HTMLElement
      expect(wrapper.className).toContain('overflow-y-clip')
      expect(wrapper.className).not.toMatch(/\boverflow-(hidden|clip|x-hidden|x-clip)\b/)
    })
  })
})
