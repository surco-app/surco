import { Info, X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  message: string
  onDismiss: () => void
}

// A neutral, non-blocking notice for harmless background outcomes — e.g. "some dropped
// files were already in the list and skipped". Distinct from ErrorToast (which is red,
// for failures); App auto-dismisses it so it stays out of the way. Bottom-left, like
// the error toast, since the two never need to show at once.
export function NoticeToast({ message, onDismiss }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div
      role="status"
      data-testid="app-notice"
      className="animate-pop fixed bottom-5 left-5 z-50 flex max-w-md items-center gap-3 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-3 pl-4 pr-3 shadow-lg"
    >
      <Info className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
      <span className="text-sm text-fg">{message}</span>
      <button
        type="button"
        data-testid="app-notice-dismiss"
        aria-label={tr('common.close')}
        onClick={onDismiss}
        className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
