import type React from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFocusTrap } from './useFocusTrap'

interface Props {
  title: string
  message: string
  confirmLabel: string
  confirmDisabled?: boolean
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
  onConfirm,
  onClose,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)
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
        className="animate-pop relative z-10 w-[440px] rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
      >
        <h2 className="text-base font-semibold">{title}</h2>
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
            type="button"
            data-testid="confirm-ok"
            onClick={() => {
              onConfirm()
              onClose()
            }}
            disabled={confirmDisabled}
            className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
