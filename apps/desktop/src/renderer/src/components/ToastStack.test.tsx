// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { Toast, ToastRow } from '../lib/toastQueue'
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

  describe('the pile', () => {
    const tall = 32
    const three = [
      toast({ id: 'a', testid: 'first', message: 'first' }),
      toast({ id: 'b', testid: 'second', message: 'second', duration: 6000 }),
      toast({ id: 'c', testid: 'third', message: 'third' }),
    ]
    const marked = (attr: string, rect: Partial<DOMRect>): HTMLElement => {
      const el = document.createElement('div')
      el.setAttribute(attr, '')
      el.getBoundingClientRect = () => rect as DOMRect
      document.body.append(el)
      return el
    }
    const pile = () => screen.getByTestId('toast-pile')
    const slots = () => screen.getAllByTestId('toast-slot')
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(tall)
    })
    afterEach(() => {
      vi.restoreAllMocks()
      for (const el of document.body.querySelectorAll(
        '[data-toast-anchor], [data-toast-lift], [data-toast-lift-within]',
      ))
        el.remove()
    })
    const show = (toasts: Toast[] = three) =>
      render(<ToastStack toasts={toasts} onExpire={vi.fn()} onClose={vi.fn()} />)

    it('stands beside the source rail at the bottom left, the corner that holds nothing but the Backups button, and gives every notice one width', () => {
      marked('data-toast-anchor', { right: 76 })
      show()
      expect(pile().style.left).toBe('88px')
      expect(pile().style.bottom).toBe('12px')
      expect(pile().style.width).toBe('272px')
    })

    it('climbs above where the mini-player rests when it is open under the pile, even while the player is still sliding in from below', () => {
      marked('data-toast-anchor', { right: 76 })
      const player = marked('data-toast-lift', { left: 84, right: 460, top: 900 })
      const column = document.createElement('div')
      column.getBoundingClientRect = () => ({ top: 60 }) as DOMRect
      Object.defineProperty(player, 'offsetParent', { value: column })
      Object.defineProperty(player, 'offsetTop', { value: 440 })
      show()
      expect(pile().style.bottom).toBe(`${window.innerHeight - 500 + 8}px`)
    })

    // Changing source mounts the list column again, and the player opens inside the new one:
    // a pile that only watched the first column stayed down and was drawn over the player.
    it('climbs above a player that opens in a list column mounted after the notice came up', async () => {
      marked('data-toast-anchor', { right: 76 })
      const first = marked('data-toast-lift-within', {})
      show()
      expect(pile().style.bottom).toBe('12px')
      first.remove()
      const column = marked('data-toast-lift-within', { top: 60 })
      const player = document.createElement('div')
      player.setAttribute('data-toast-lift', '')
      player.getBoundingClientRect = () => ({ left: 84, right: 460, top: 500 }) as DOMRect
      Object.defineProperty(player, 'offsetParent', { value: column })
      Object.defineProperty(player, 'offsetTop', { value: 440 })
      column.append(player)
      await waitFor(() => expect(pile().style.bottom).toBe(`${window.innerHeight - 500 + 8}px`))
    })

    it('stays at the bottom when the mini-player is open somewhere the pile does not reach', () => {
      marked('data-toast-anchor', { right: 76 })
      marked('data-toast-lift', { left: 400, right: 780, top: 500 })
      show()
      expect(pile().style.bottom).toBe('12px')
    })

    it('keeps the close button at the far end of the card however short the message, so it is always in the same place', () => {
      show([toast({ id: 'a', testid: 'short', message: 'ok' })])
      expect(screen.getByTestId('short').lastElementChild).toBe(screen.getByTestId('short-dismiss'))
    })

    it('tucks the older notices behind the newest with only their top edge showing, so five notices take the room of one', () => {
      show([...three, toast({ id: 'd', message: 'fourth' })])
      const [front, second, third, fourth] = slots()
      expect(front).toHaveTextContent('fourth')
      expect(front.style.transform).toBe('translateY(0px) scale(1)')
      expect(front).not.toHaveAttribute('data-behind')
      expect(second.style.transform).toBe('translateY(-7px) scale(0.95)')
      expect(second.style.height).toBe(`${tall}px`)
      expect(second).toHaveAttribute('data-behind')
      expect(second).toHaveAttribute('inert')
      expect(third.style.transform).toBe('translateY(-14px) scale(0.9)')
      expect(fourth.style.transform).toBe('translateY(-14px) scale(0.9)')
      expect(fourth.style.opacity).toBe('0')
      expect(pile().style.height).toBe(`${tall + 14}px`)
    })

    it('spreads into a list under the pointer, so each notice can be read and reached, then folds back', () => {
      show()
      fireEvent.pointerEnter(pile())
      const [front, second, third] = slots()
      expect(front.style.transform).toBe('translateY(0px) scale(1)')
      expect(second.style.transform).toBe(`translateY(-${tall + 6}px) scale(1)`)
      expect(third.style.transform).toBe(`translateY(-${2 * (tall + 6)}px) scale(1)`)
      for (const slot of slots()) {
        expect(slot).not.toHaveAttribute('data-behind')
        expect(slot).not.toHaveAttribute('inert')
      }
      expect(pile().style.height).toBe(`${3 * tall + 12}px`)
      fireEvent.pointerLeave(pile())
      expect(slots()[1]).toHaveAttribute('data-behind')
    })

    it('spreads when the keyboard enters it too, and folds once focus leaves', () => {
      show()
      const close = screen.getByTestId('third-dismiss')
      fireEvent.focus(close)
      expect(pile()).toHaveAttribute('data-spread', 'true')
      fireEvent.blur(close, { relatedTarget: document.body })
      expect(pile()).not.toHaveAttribute('data-spread')
    })

    it('leaves a dismissed notice where it stood while it fades and moves the rest up at once, so the pile settles instead of jumping', () => {
      const { rerender } = show()
      const leaving = slots()[1]
      expect(leaving).not.toHaveAttribute('data-leaving')
      expect(leaving.style.transform).toBe('translateY(-7px) scale(0.95)')
      rerender(<ToastStack toasts={[three[0], three[2]]} onExpire={vi.fn()} onClose={vi.fn()} />)
      expect(leaving.style.transform).toBe('translateY(-7px) scale(0.95)')
      expect(leaving).toHaveAttribute('data-leaving', 'true')
      const first = slots().find((slot) => slot.textContent?.includes('first')) as HTMLElement
      expect(first.style.transform).toBe('translateY(-7px) scale(0.95)')
    })
  })

  it('puts the newest toast first, in front of the pile', () => {
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

  it('keeps every queued toast in the pile so a notice and a prompt coexist', () => {
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

  describe('a notice with rows', () => {
    const row = (title: string, over: Partial<ToastRow> = {}): ToastRow => ({
      icon: 'list',
      tone: 'warn',
      title,
      sub: `${title} tracks`,
      ...over,
    })

    // One paragraph per track filled the window. What landed is one line, each reason one
    // row, and an action sits on the row it acts on, never beside a text that is not its own.
    it('says what landed on one line and each reason on its own row, with the action on the row it acts on', () => {
      const go = vi.fn()
      render(
        <ToastStack
          toasts={[
            toast({
              testid: 'edit',
              message: 'Done in rekordbox · 6 tracks',
              rows: [
                row('3 tracks not changed in Warm Up', {
                  sub: 'It changed in rekordbox · A, B, C',
                }),
                row('16 cues off', { icon: 'cue', action: { label: 'Go to cue', onAction: go } }),
              ],
            }),
          ]}
          onExpire={vi.fn()}
          onClose={vi.fn()}
        />,
      )
      expect(screen.getByTestId('edit-message')).toHaveTextContent('Done in rekordbox · 6 tracks')
      const rows = screen.getAllByTestId('edit-row')
      expect(rows).toHaveLength(2)
      expect(rows[0]).toHaveTextContent('3 tracks not changed in Warm Up')
      expect(rows[0]).toHaveTextContent('It changed in rekordbox · A, B, C')
      expect(within(rows[0]).queryByRole('button')).toBeNull()
      fireEvent.click(within(rows[1]).getByRole('button', { name: 'Go to cue' }))
      expect(go).toHaveBeenCalledTimes(1)
    })

    it('shows three reasons and folds the rest behind a count, so a long batch keeps the card short', () => {
      render(
        <ToastStack
          toasts={[toast({ testid: 'edit', rows: ['a', 'b', 'c', 'd', 'e'].map((t) => row(t)) })]}
          onExpire={vi.fn()}
          onClose={vi.fn()}
        />,
      )
      expect(screen.getAllByTestId('edit-row')).toHaveLength(3)
      fireEvent.click(screen.getByRole('button', { name: '2 more' }))
      expect(screen.getAllByTestId('edit-row')).toHaveLength(5)
      expect(screen.queryByRole('button', { name: '2 more' })).toBeNull()
    })
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

  // A notice that leaves on its own, where closing it means the same as letting it go, has
  // no use for a ✕: it would be a third control next to Undo and the swipe for the same
  // thing. One that stays, or whose ✕ is an answer of its own (the session offer declines
  // for good, while letting it go only hides it), keeps the ✕ or could never be answered.
  it('offers the ✕ only where closing does something that waiting would not', () => {
    const settle = vi.fn()
    render(
      <ToastStack
        toasts={[
          toast({ id: 'a', testid: 'plain', duration: 4000 }),
          toast({ id: 'b', testid: 'undo', duration: 6000, onDismiss: settle, onExpire: settle }),
          toast({
            id: 'c',
            testid: 'offer',
            duration: 6000,
            onDismiss: vi.fn(),
            onExpire: vi.fn(),
          }),
          toast({ id: 'd', testid: 'stays' }),
          toast({ id: 'e', testid: 'error', tone: 'danger' }),
        ]}
        onExpire={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('plain-dismiss')).toBeNull()
    expect(screen.queryByTestId('undo-dismiss')).toBeNull()
    expect(screen.getByTestId('offer-dismiss')).toBeInTheDocument()
    expect(screen.getByTestId('stays-dismiss')).toBeInTheDocument()
    expect(screen.getByTestId('error-dismiss')).toBeInTheDocument()
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

    it('keeps the hidden notice mounted instead of display-none while a dialog is open, so it comes back as it was', () => {
      const toasts = [toast({ id: 'n', testid: 'notice', message: 'saved', duration: 6000 })]
      const { rerender } = render(withModal(false, toasts))
      const card = screen.getByTestId('notice')
      const slot = screen.getByTestId('toast-slot')
      rerender(withModal(true, toasts))
      expect(slot).not.toHaveAttribute('hidden')
      expect(slot).not.toBeVisible()
      expect(screen.getByTestId('notice')).toBe(card)
      rerender(withModal(false, toasts))
      expect(slot).not.toHaveAttribute('hidden')
      expect(slot).toBeVisible()
      expect(screen.getByTestId('notice')).toBe(card)
    })

    // Spread, the pile shows every notice for reading; none may expire under the pointer
    // while the user reads one of the others.
    it('holds every notice in a spread pile and lets the clocks run again once it folds', () => {
      const onExpire = vi.fn()
      render(
        <ToastStack
          toasts={[toast({ id: 'a', duration: 4000 }), toast({ id: 'b', duration: 4000 })]}
          onExpire={onExpire}
          onClose={vi.fn()}
        />,
      )
      fireEvent.pointerEnter(screen.getByTestId('toast-pile'))
      act(() => vi.advanceTimersByTime(10_000))
      expect(onExpire).not.toHaveBeenCalled()
      fireEvent.pointerLeave(screen.getByTestId('toast-pile'))
      act(() => vi.advanceTimersByTime(4000))
      expect(onExpire).toHaveBeenCalledWith('a')
      expect(onExpire).toHaveBeenCalledWith('b')
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
      expect(card().style.transform).toBe('translateX(324px)')
    })
  })
})
