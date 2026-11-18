import { Check, Copy, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalOpen } from '../lib/modalPresence'
import { coastDistance, releaseVelocity, type TrailPoint } from '../lib/momentum'
import { prefersReducedMotion } from '../lib/motion'
import type { Toast, ToastText } from '../lib/toastQueue'

// How long the copy button shows its "copied" check before reverting to the copy icon.
const COPIED_FEEDBACK_MS = 1500

// How long a dismissed card stays mounted for its leave animation — matches the CSS
// .animate-toast-leave duration, with the timer (not animationend) as the source of
// truth so a test environment that never fires animation events still drops the card.
const TOAST_LEAVE_MS = 200

const SWIPE_SETTLE_MS = 160
const SWIPE_CLOSE_SHARE = 0.4
const SWIPE_RESISTANCE = 0.2
const SWIPE_MIN_OPACITY = 0.4
const SWIPE_EXIT_GAP_PX = 24

// The single home for every transient notification: notices, failures, update prompts and
// new-track prompts. They stack top-right, newest on top, so a status line and an
// action prompt coexist instead of fighting over a corner. Each card auto-dismisses if it
// carries a duration; prompts and failures stay until acted on.
export function ToastStack({
  toasts,
  onExpire,
  onClose,
}: {
  toasts: Toast[]
  // Bookkeeping removal for the auto-dismiss timer (no side effects).
  onExpire: (id: string) => void
  // The user clicked ✕ — remove the card and run the toast's own onDismiss.
  onClose: (id: string) => void
}): React.JSX.Element {
  const modalOpen = useModalOpen()
  // Dismissed cards linger briefly in a leaving state so the exit can animate — an
  // instant unmount reads as a rendering glitch now that toasts expire on their own.
  // A keyed re-push (the new-tracks count updating in place) swaps ids in the queue,
  // so a fresh card's key evicts its leaving twin at once and takes over the same
  // React key: the card stays mounted, only its text and countdown restart, so a
  // count update never flashes two cards nor replays the entrance.
  const [cards, setCards] = useState<{ toast: Toast; leaving: boolean }[]>([])
  useEffect(() => {
    setCards((prev) => {
      const live = new Map(toasts.map((t) => [t.id, t]))
      const liveKeys = new Set(toasts.map((t) => t.key).filter(Boolean))
      const kept = prev
        .filter((c) => live.has(c.toast.id) || !(c.toast.key && liveKeys.has(c.toast.key)))
        .map((c) => {
          const now = live.get(c.toast.id)
          return now ? { toast: now, leaving: false } : c.leaving ? c : { ...c, leaving: true }
        })
      const known = new Set(prev.map((c) => c.toast.id))
      const added = toasts
        .filter((t) => !known.has(t.id))
        .map((t) => ({ toast: t, leaving: false }))
      return [...kept, ...added]
    })
  }, [toasts])
  // One drop timer per leaving card; the map keeps a re-render from re-arming a timer
  // that is already counting, and unmount clears whatever is still pending.
  const dropTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    for (const c of cards) {
      if (!c.leaving || dropTimers.current.has(c.toast.id)) continue
      const id = c.toast.id
      dropTimers.current.set(
        id,
        setTimeout(() => {
          dropTimers.current.delete(id)
          setCards((prev) => prev.filter((x) => x.toast.id !== id))
        }, TOAST_LEAVE_MS),
      )
    }
  }, [cards])
  useEffect(() => {
    const timers = dropTimers.current
    return () => {
      for (const handle of timers.values()) clearTimeout(handle)
    }
  }, [])
  const swipeTailRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const swallowingSwipeTail = useRef(false)
  const waitOutSwipeTail = (): void => {
    swallowingSwipeTail.current = true
    clearTimeout(swipeTailRef.current)
    swipeTailRef.current = setTimeout(() => {
      swallowingSwipeTail.current = false
    }, SWIPE_SETTLE_MS)
  }
  useEffect(() => () => clearTimeout(swipeTailRef.current), [])
  // The container renders even when empty: a live region must exist BEFORE content
  // arrives or screen readers miss the first toast. Empty it has zero size, so the
  // fixed corner div never intercepts a click.
  return (
    // Spacing lives INSIDE each collapsing wrapper (pb-2 on the inner div), not as a
    // container gap: a gap would survive the row collapse and leave an 8px jump the
    // moment the card unmounts. Padding below the bottom card falls outside anything
    // visible, so the stack sits exactly where it always has.
    // data-above-modals keeps the stack live while a dialog makes the rest of the app
    // inert: a toast's action (Undo) has to stay pressable with a modal open.
    <div
      aria-live="polite"
      data-above-modals
      className="fixed top-14 right-5 z-50 flex flex-col"
      onWheelCapture={(e) => {
        if (!swallowingSwipeTail.current || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
        e.stopPropagation()
        waitOutSwipeTail()
      }}
    >
      {[...cards].reverse().map(({ toast, leaving }) => {
        const stepAside = modalOpen && !toast.action && !leaving
        return (
          // The card's exit only fades it — the SPACE it held used to vanish at unmount,
          // jumping every surviving toast a full card height in one frame. The grid row
          // tweens 1fr→0fr alongside the fade (same 200ms as TOAST_LEAVE_MS), so the
          // stack settles smoothly; a transition, so a mid-collapse re-push retargets.
          <div
            key={toast.key ?? toast.id}
            data-testid="toast-slot"
            aria-hidden={stepAside || undefined}
            style={stepAside ? { visibility: 'hidden' } : undefined}
            className={`grid transition-[grid-template-rows] duration-200 ease-standard motion-reduce:transition-none ${
              stepAside
                ? 'pointer-events-none grid-rows-[0fr] transition-none'
                : leaving
                  ? 'grid-rows-[0fr]'
                  : 'grid-rows-[1fr] starting:grid-rows-[0fr]'
            }`}
          >
            {/* overflow-y-clip only while collapsing — kept on, it would clip the
              card's shadow for its whole life. min-h-0 lets the row actually shrink. */}
            <div className={`min-h-0 pb-2 ${leaving ? 'overflow-y-clip' : ''}`}>
              <ToastCard
                toast={toast}
                leaving={leaving}
                held={modalOpen && !toast.action}
                onExpire={onExpire}
                onClose={onClose}
                onSwipeClose={waitOutSwipeTail}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ToastCard({
  toast,
  leaving,
  held,
  onExpire,
  onClose,
  onSwipeClose,
}: {
  toast: Toast
  // The card has left the queue and is playing its exit — inert while it fades.
  leaving: boolean
  held: boolean
  onExpire: (id: string) => void
  onClose: (id: string) => void
  onSwipeClose: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const text = (value: ToastText): string =>
    typeof value === 'string' ? value : tr(value.key, value.values)
  const message = text(toast.message)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const onCopy = () => {
    void window.api.copyText(toast.copyText ? text(toast.copyText) : message)
    setCopied(true)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
  }

  // WCAG 2.2.1: the clock stops while the pointer rests on the card or the focus is inside
  // it, so a slow reader or a keyboard user heading for the action never loses the toast.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused || held
  const remaining = useRef(toast.duration ?? 0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a keyed re-push keeps this card mounted under a new id, and that new id is a fresh deadline, so the clock must restart on it.
  useEffect(() => {
    remaining.current = toast.duration ?? 0
  }, [toast.id, toast.duration])

  // A duration arms a one-shot timer for whatever time is left; re-running only when the id
  // or the pause changes keeps a re-render (e.g. a language switch) from restarting the
  // countdown of an already-aged toast. A leaving card is already dismissed, so it must not
  // re-arm and expire a second time.
  useEffect(() => {
    if (!toast.duration || leaving || paused) return
    const started = Date.now()
    const handle = setTimeout(() => onExpire(toast.id), remaining.current)
    return () => {
      clearTimeout(handle)
      remaining.current -= Date.now() - started
    }
  }, [toast.id, toast.duration, leaving, paused, onExpire])

  const cardRef = useRef<HTMLDivElement>(null)
  const [swipe, setSwipe] = useState({ x: 0, opacity: 1 })
  const [tracking, setTracking] = useState(false)
  const [exitTo, setExitTo] = useState<number>()
  const swipeRef = useRef(0)
  const trailRef = useRef<TrailPoint[]>([])
  const flingRef = useRef(0)
  const settleRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(settleRef.current), [])
  useEffect(() => {
    if (leaving) clearTimeout(settleRef.current)
  }, [leaving])
  const swipedId = useRef(toast.id)
  useEffect(() => {
    if (swipedId.current === toast.id) return
    swipedId.current = toast.id
    clearTimeout(settleRef.current)
    swipeRef.current = 0
    trailRef.current = []
    setSwipe({ x: 0, opacity: 1 })
    setTracking(false)
    setExitTo(undefined)
  }, [toast.id])
  const moveSwipe = (px: number): void => {
    swipeRef.current = px
    const width = cardRef.current?.offsetWidth ?? 0
    setSwipe({
      x: px < 0 ? px * SWIPE_RESISTANCE : px,
      opacity: px > 0 && width > 0 ? 1 - (1 - SWIPE_MIN_OPACITY) * Math.min(px / width, 1) : 1,
    })
  }
  const closeBySwipe = (width: number): void => {
    setTracking(false)
    trailRef.current = []
    if (!prefersReducedMotion()) setExitTo(width + SWIPE_EXIT_GAP_PX)
    onSwipeClose()
    onClose(toast.id)
  }
  const onSwipeWheel = (e: React.WheelEvent): void => {
    if (leaving || exitTo !== undefined || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    setTracking(true)
    moveSwipe(swipeRef.current - e.deltaX)
    const now = performance.now()
    trailRef.current.push({ at: swipeRef.current, t: now })
    flingRef.current = releaseVelocity(trailRef.current, now)
    clearTimeout(settleRef.current)
    const width = cardRef.current?.offsetWidth ?? 0
    if (width > 0 && swipeRef.current >= width * SWIPE_CLOSE_SHARE) {
      closeBySwipe(width)
      return
    }
    settleRef.current = setTimeout(() => {
      if (swipeRef.current + coastDistance(flingRef.current) >= width * SWIPE_CLOSE_SHARE) {
        closeBySwipe(width)
        return
      }
      setTracking(false)
      trailRef.current = []
      moveSwipe(0)
    }, SWIPE_SETTLE_MS)
  }

  const danger = toast.tone === 'danger'
  // Single-line toasts read best vertically centred; only a long, scrollable error message
  // (no action, danger tone) pins to the top so its ✕ stays reachable as the body grows.
  const align = danger && !toast.action ? 'items-start' : 'items-center'
  return (
    // No status/alert role here: the stack container is the one live region, and a role on
    // the card nested a second one inside it, so every toast was read twice.
    <div
      ref={cardRef}
      aria-hidden={leaving || undefined}
      data-testid={toast.testid}
      onWheel={onSwipeWheel}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
      }}
      style={{
        transform:
          exitTo !== undefined
            ? `translateX(${exitTo}px)`
            : swipe.x !== 0
              ? `translateX(${swipe.x}px)`
              : undefined,
        opacity: exitTo !== undefined ? 0 : swipe.opacity < 1 ? swipe.opacity : undefined,
        transition: tracking
          ? 'none'
          : exitTo !== undefined
            ? 'transform var(--duration-state) var(--ease-standard), opacity var(--duration-state) var(--ease-standard)'
            : 'transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard)',
      }}
      className={`${leaving ? `${exitTo === undefined ? 'animate-toast-leave ' : ''}pointer-events-none` : 'animate-toast-in'} relative flex max-w-md overflow-hidden ${align} gap-3 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-3 pl-4 pr-3 shadow-[var(--shadow-float)]`}
    >
      <span
        data-testid={toast.testid ? `${toast.testid}-message` : undefined}
        className={`max-h-[40vh] overflow-y-auto whitespace-pre-line break-words text-sm ${
          danger ? 'text-danger' : 'text-fg'
        }`}
      >
        {message}
      </span>
      {toast.action && (
        <button
          type="button"
          data-testid={toast.testid ? `${toast.testid}-action` : undefined}
          onClick={toast.action.onAction}
          className="press shrink-0 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-line-strong)]"
        >
          {text(toast.action.label)}
        </button>
      )}
      {danger && (
        <button
          type="button"
          data-testid={toast.testid ? `${toast.testid}-copy` : undefined}
          aria-label={tr('common.copy')}
          onClick={onCopy}
          className="press relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted after:absolute after:-inset-1.5 after:content-[''] hover:bg-[var(--color-hover)] hover:text-fg"
        >
          {copied ? (
            <Check className="h-4 w-4 text-good" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      )}
      <button
        type="button"
        data-testid={toast.testid ? `${toast.testid}-dismiss` : undefined}
        aria-label={tr('common.close')}
        onClick={() => onClose(toast.id)}
        className="press relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted after:absolute after:-inset-1.5 after:content-[''] hover:bg-[var(--color-hover)] hover:text-fg"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      {toast.duration && (
        <span
          key={toast.id}
          aria-hidden="true"
          data-testid={toast.testid ? `${toast.testid}-countdown` : undefined}
          className="animate-toast-countdown absolute inset-x-0 bottom-0 h-0.5 bg-[var(--color-accent)]/60"
          style={{
            animationDuration: `${toast.duration}ms`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      )}
    </div>
  )
}
