import { Check, Copy, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Toast } from '../lib/toastQueue'

// How long the copy button shows its "copied" check before reverting to the copy icon.
const COPIED_FEEDBACK_MS = 1500

// How long a dismissed card stays mounted for its leave animation — matches the CSS
// .animate-toast-leave duration, with the timer (not animationend) as the source of
// truth so a test environment that never fires animation events still drops the card.
const TOAST_LEAVE_MS = 200

// The single home for every transient notification: notices, failures, update prompts and
// new-track prompts. They stack bottom-right, newest at the bottom, so a status line and an
// action prompt coexist instead of fighting over a corner. Each card auto-dismisses if it
// carries a duration; prompts and failures stay until acted on.
export function ToastStack({
  toasts,
  overlayOpen = false,
  onExpire,
  onClose,
}: {
  toasts: Toast[]
  // A centred modal claims the bottom-right corner with its Cancel/Save bar. While one is
  // open the stack moves to the bottom-left so a toast never sits over the primary action.
  overlayOpen?: boolean
  // Bookkeeping removal for the auto-dismiss timer (no side effects).
  onExpire: (id: string) => void
  // The user clicked ✕ — remove the card and run the toast's own onDismiss.
  onClose: (id: string) => void
}): React.JSX.Element {
  // Dismissed cards linger briefly in a leaving state so the exit can animate — an
  // instant unmount reads as a rendering glitch now that toasts expire on their own.
  // A keyed re-push (the new-tracks count updating in place) swaps ids in the queue,
  // so a fresh card's key evicts its leaving twin at once: a count update must never
  // flash two cards.
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
  // The container renders even when empty: a live region must exist BEFORE content
  // arrives or screen readers miss the first toast. Empty it has zero size, so the
  // fixed corner div never intercepts a click.
  return (
    <div
      aria-live="polite"
      className={`fixed bottom-5 z-50 flex flex-col gap-2 ${overlayOpen ? 'left-5' : 'right-5'}`}
    >
      {cards.map(({ toast, leaving }) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          leaving={leaving}
          onExpire={onExpire}
          onClose={onClose}
        />
      ))}
    </div>
  )
}

function ToastCard({
  toast,
  leaving,
  onExpire,
  onClose,
}: {
  toast: Toast
  // The card has left the queue and is playing its exit — inert while it fades.
  leaving: boolean
  onExpire: (id: string) => void
  onClose: (id: string) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const onCopy = () => {
    void window.api.copyText(toast.message)
    setCopied(true)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
  }

  // A duration arms a one-shot timer; re-running only when the id changes keeps a re-render
  // (e.g. a language switch) from restarting the countdown of an already-aged toast. A
  // leaving card is already dismissed, so it must not re-arm and expire a second time.
  useEffect(() => {
    if (!toast.duration || leaving) return
    const handle = setTimeout(() => onExpire(toast.id), toast.duration)
    return () => clearTimeout(handle)
  }, [toast.id, toast.duration, leaving, onExpire])

  const danger = toast.tone === 'danger'
  // Single-line toasts read best vertically centred; only a long, scrollable error message
  // (no action, danger tone) pins to the top so its ✕ stays reachable as the body grows.
  const align = danger && !toast.action ? 'items-start' : 'items-center'
  return (
    <div
      role={danger ? 'alert' : 'status'}
      aria-hidden={leaving || undefined}
      data-testid={toast.testid}
      className={`${leaving ? 'animate-toast-leave pointer-events-none' : 'animate-pop'} relative flex max-w-md overflow-hidden ${align} gap-3 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-3 pl-4 pr-3 shadow-lg`}
    >
      <span
        data-testid={toast.testid ? `${toast.testid}-message` : undefined}
        className={`max-h-[40vh] overflow-y-auto whitespace-pre-line text-sm ${
          danger ? 'text-danger' : 'text-fg'
        }`}
      >
        {toast.message}
      </span>
      {toast.action && (
        <button
          type="button"
          data-testid={toast.testid ? `${toast.testid}-action` : undefined}
          onClick={toast.action.onAction}
          className="press shrink-0 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-line-strong)]"
        >
          {toast.action.label}
        </button>
      )}
      {danger && (
        <button
          type="button"
          data-testid={toast.testid ? `${toast.testid}-copy` : undefined}
          aria-label={tr('common.copy')}
          onClick={onCopy}
          className="press relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted after:absolute after:-inset-1.5 after:content-[''] hover:bg-[var(--color-panel-2)] hover:text-fg"
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
        className="press relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted after:absolute after:-inset-1.5 after:content-[''] hover:bg-[var(--color-panel-2)] hover:text-fg"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      {toast.duration && (
        <span
          aria-hidden="true"
          data-testid={toast.testid ? `${toast.testid}-countdown` : undefined}
          className="animate-toast-countdown absolute inset-x-0 bottom-0 h-0.5 bg-[var(--color-accent)]/60"
          style={{ animationDuration: `${toast.duration}ms` }}
        />
      )}
    </div>
  )
}
