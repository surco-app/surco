import { Check, Copy, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
const PILE_WIDTH_PX = 240
const PILE_MARGIN_PX = 12
const PILE_PEEK_PX = 7
const PILE_SHRINK = 0.05
const PILE_SHOWN = 3
const PILE_GAP_PX = 6
const PLAYER_CLEARANCE_PX = 8

// Where the pile stands: beside the source rail at the bottom of the window, and above the
// mini-player when that is open under it, since both live in the same corner.
function usePileAnchor(watching: boolean): { left: number; bottom: number } | undefined {
  const [anchor, setAnchor] = useState<{ left: number; bottom: number }>()
  useLayoutEffect(() => {
    if (!watching) return
    const rail = document.querySelector('[data-toast-anchor]')
    const column = document.querySelector('[data-toast-lift-within]')
    const resized =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
    let lifting: Element | null = null
    const measure = (): void => {
      const left = (rail ? Math.round(rail.getBoundingClientRect().right) : 0) + PILE_MARGIN_PX
      const player = document.querySelector<HTMLElement>('[data-toast-lift]')
      if (player !== lifting) {
        if (lifting) resized?.unobserve(lifting)
        if (player) resized?.observe(player)
        lifting = player
      }
      const box = player?.getBoundingClientRect()
      const under = box !== undefined && box.left < left + PILE_WIDTH_PX && box.right > left
      // The card slides in on a transform, so where it rests is read from the layout, not
      // from where it is drawn mid-slide.
      const restsAt =
        (player?.offsetParent?.getBoundingClientRect().top ?? 0) + (player?.offsetTop ?? 0)
      const bottom = under
        ? Math.round(window.innerHeight - restsAt) + PLAYER_CLEARANCE_PX
        : PILE_MARGIN_PX
      setAnchor((was) => (was?.left === left && was.bottom === bottom ? was : { left, bottom }))
    }
    measure()
    window.addEventListener('resize', measure)
    if (rail) resized?.observe(rail)
    const mounted = column ? new MutationObserver(measure) : null
    if (column) mounted?.observe(column, { childList: true })
    return () => {
      window.removeEventListener('resize', measure)
      resized?.disconnect()
      mounted?.disconnect()
    }
  }, [watching])
  return anchor
}

// The single home for every transient notification: notices, failures, update prompts and
// new-track prompts. They pile up beside the source rail at the bottom left, newest in front, so a status line and an
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
  const anchor = usePileAnchor(toasts.length > 0)
  // Hovering the pile or tabbing into it spreads it into a list, so every notice can be read
  // and reached; left alone it folds back to the newest one with the older ones peeking.
  const [spread, setSpread] = useState(false)
  const slots = useRef(new Map<string, HTMLDivElement>())
  const [heights, setHeights] = useState<Record<string, number>>({})
  useLayoutEffect(() => {
    for (const key of placed.current.keys()) if (!slots.current.has(key)) placed.current.delete(key)
    const next: Record<string, number> = {}
    for (const [key, slot] of slots.current)
      next[key] = (slot.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0
    setHeights((was) => {
      const keys = Object.keys(next)
      const same = keys.length === Object.keys(was).length && keys.every((k) => was[k] === next[k])
      return same ? was : next
    })
  })
  const placed = useRef(new Map<string, React.CSSProperties>())
  const shown = [...cards].reverse()
  const standing = shown.filter(({ toast, leaving }) => !leaving && !(modalOpen && !toast.action))
  const keyOf = (toast: Toast): string => toast.key ?? toast.id
  const frontHeight = standing[0] ? (heights[keyOf(standing[0].toast)] ?? 0) : 0
  const listHeight = standing.reduce(
    (sum, { toast }, i) => sum + (heights[keyOf(toast)] ?? 0) + (i > 0 ? PILE_GAP_PX : 0),
    0,
  )
  const pileHeight = spread
    ? listHeight
    : frontHeight + Math.min(Math.max(standing.length - 1, 0), PILE_SHOWN - 1) * PILE_PEEK_PX
  let climbed = 0
  // The container renders even when empty: a live region must exist BEFORE content
  // arrives or screen readers miss the first toast. Empty it has zero height, so the
  // fixed corner div never intercepts a click.
  return (
    // data-above-modals keeps the pile live while a dialog makes the rest of the app
    // inert: a toast's action (Undo) has to stay pressable with a modal open.
    // biome-ignore lint/a11y/noStaticElementInteractions: the pile spreads for the pointer and for keyboard focus alike, and every control in it is a real button.
    <div
      aria-live="polite"
      data-above-modals
      data-testid="toast-pile"
      data-spread={spread || undefined}
      style={{
        left: anchor?.left ?? PILE_MARGIN_PX,
        bottom: anchor?.bottom ?? PILE_MARGIN_PX,
        width: PILE_WIDTH_PX,
        height: pileHeight,
      }}
      className="fixed z-50 transition-[bottom,height] duration-200 ease-standard motion-reduce:transition-none"
      onPointerEnter={() => setSpread(true)}
      onPointerLeave={() => setSpread(false)}
      onFocus={() => setSpread(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setSpread(false)
      }}
      onWheelCapture={(e) => {
        if (!swallowingSwipeTail.current || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
        e.stopPropagation()
        waitOutSwipeTail()
      }}
    >
      {shown.map(({ toast, leaving }) => {
        const key = keyOf(toast)
        const stepAside = modalOpen && !toast.action && !leaving
        const at = standing.findIndex((c) => keyOf(c.toast) === key)
        const behind = at > 0 && !spread
        let place = placed.current.get(key)
        if (at >= 0) {
          const depth = Math.min(at, PILE_SHOWN - 1)
          const rise = spread ? climbed : depth * PILE_PEEK_PX
          place = {
            transform: `translateY(${-rise}px) scale(${spread ? 1 : 1 - depth * PILE_SHRINK})`,
            opacity: spread || at < PILE_SHOWN ? undefined : 0,
            height: behind ? frontHeight : undefined,
            zIndex: shown.length - at,
          }
          placed.current.set(key, place)
          climbed += (heights[key] ?? 0) + PILE_GAP_PX
        }
        return (
          // Every card stands on the same spot and is moved by transform, so the older ones
          // tuck behind the newest instead of pushing the pile taller. One behind borrows the
          // front card's height and shows only its top edge.
          <div
            key={key}
            ref={(el) => {
              if (el) slots.current.set(key, el)
              else slots.current.delete(key)
            }}
            data-testid="toast-slot"
            data-behind={behind || undefined}
            aria-hidden={stepAside || undefined}
            inert={behind || undefined}
            style={{ ...place, ...(stepAside ? { visibility: 'hidden' } : null) }}
            className={`absolute bottom-0 left-0 w-full origin-bottom rounded-xl transition-[transform,opacity,height] duration-200 ease-standard motion-reduce:transition-none ${
              behind ? 'overflow-hidden' : ''
            } ${stepAside || leaving ? 'pointer-events-none' : ''}`}
          >
            <ToastCard
              toast={toast}
              leaving={leaving}
              behind={behind}
              held={(modalOpen && !toast.action) || spread}
              onExpire={onExpire}
              onClose={onClose}
              onSwipeClose={waitOutSwipeTail}
            />
          </div>
        )
      })}
    </div>
  )
}

function ToastCard({
  toast,
  leaving,
  behind,
  held,
  onExpire,
  onClose,
  onSwipeClose,
}: {
  toast: Toast
  // The card has left the queue and is playing its exit — inert while it fades.
  leaving: boolean
  // Tucked behind the newest notice: only its top edge shows, so what it says is hidden.
  behind: boolean
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
      className={`${leaving ? `${exitTo === undefined ? 'animate-toast-leave ' : ''}pointer-events-none` : 'animate-toast-in'} ${behind ? '[&>*]:opacity-0' : ''} relative flex w-full overflow-hidden ${align} gap-1.5 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-0.5 pl-2.5 pr-0.5 shadow-[var(--shadow-float)]`}
    >
      <span
        data-testid={toast.testid ? `${toast.testid}-message` : undefined}
        className={`max-h-[40vh] min-w-0 flex-1 overflow-y-auto whitespace-pre-line break-words py-0.5 text-xs ${
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
          className="press shrink-0 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-2 py-0.5 text-xs font-medium hover:bg-[var(--color-line-strong)]"
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
          className="press relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-muted after:absolute after:-inset-1.5 after:content-[''] hover:bg-[var(--color-hover)] hover:text-fg"
        >
          {copied ? (
            <Check className="h-3 w-3 text-good" aria-hidden="true" />
          ) : (
            <Copy className="h-3 w-3" aria-hidden="true" />
          )}
        </button>
      )}
      <button
        type="button"
        data-testid={toast.testid ? `${toast.testid}-dismiss` : undefined}
        aria-label={tr('common.close')}
        onClick={() => onClose(toast.id)}
        className="press relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-muted after:absolute after:-inset-1.5 after:content-[''] hover:bg-[var(--color-hover)] hover:text-fg"
      >
        <X className="h-3 w-3" aria-hidden="true" />
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
