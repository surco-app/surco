import { X } from 'lucide-react'
import type React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { Toast } from '../lib/toastQueue'

// The single home for every transient notification: notices, failures, update prompts and
// new-track prompts. They stack bottom-right, newest at the bottom, so a status line and an
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
}): React.JSX.Element | null {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onExpire={onExpire} onClose={onClose} />
      ))}
    </div>
  )
}

function ToastCard({
  toast,
  onExpire,
  onClose,
}: {
  toast: Toast
  onExpire: (id: string) => void
  onClose: (id: string) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()

  // A duration arms a one-shot timer; re-running only when the id changes keeps a re-render
  // (e.g. a language switch) from restarting the countdown of an already-aged toast.
  useEffect(() => {
    if (!toast.duration) return
    const handle = setTimeout(() => onExpire(toast.id), toast.duration)
    return () => clearTimeout(handle)
  }, [toast.id, toast.duration, onExpire])

  const danger = toast.tone === 'danger'
  // Single-line toasts read best vertically centred; only a long, scrollable error message
  // (no action, danger tone) pins to the top so its ✕ stays reachable as the body grows.
  const align = danger && !toast.action ? 'items-start' : 'items-center'
  return (
    <div
      role={danger ? 'alert' : 'status'}
      data-testid={toast.testid}
      className={`animate-pop relative flex max-w-md overflow-hidden ${align} gap-3 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-3 pl-4 pr-3 shadow-lg`}
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
          className="press shrink-0 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        data-testid={toast.testid ? `${toast.testid}-dismiss` : undefined}
        aria-label={tr('common.close')}
        onClick={() => onClose(toast.id)}
        className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
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
