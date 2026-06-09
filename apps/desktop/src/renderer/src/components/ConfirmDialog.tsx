import type React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFocusTrap } from './useFocusTrap'

interface Props {
  title: string
  message: string
  confirmLabel: string
  confirmDisabled?: boolean
  // Paints the confirm button red for irreversible actions (delete, clear), the macOS
  // convention that warns before the user commits.
  destructive?: boolean
  onConfirm: () => void
  onClose: () => void
}

// A plain confirm/cancel dialog for consequential bulk actions (e.g. overwriting tags
// across the whole list). Caller supplies the copy so the same shell explains whatever it
// is about to do; confirming runs the action and closes.
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmDisabled,
  destructive,
  onConfirm,
  onClose,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useFocusTrap(dialogRef)
  // Focus the default button so Enter confirms immediately and the keyboard default
  // matches the native macOS dialog convention (runs after useFocusTrap's first focus).
  useEffect(() => confirmRef.current?.focus(), [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        data-testid="confirm-backdrop"
        aria-label={tr('common.close')}
        onClick={onClose}
        className="animate-overlay absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="animate-pop relative z-10 w-[440px] rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
      >
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            onConfirm()
            onClose()
          }}
        >
          <h2 id="confirm-title" className="text-base font-semibold">
            {title}
          </h2>
          <p className="mt-2 text-sm text-fg-dim">{message}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              data-testid="confirm-cancel"
              onClick={onClose}
              className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-panel-2)]"
            >
              {tr('common.cancel')}
            </button>
            <button
              ref={confirmRef}
              type="submit"
              data-testid="confirm-ok"
              disabled={confirmDisabled}
              className={`press rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                destructive
                  ? 'bg-[var(--color-danger)] hover:brightness-110'
                  : 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
