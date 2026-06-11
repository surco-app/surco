import { X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  message: string
  onDismiss: () => void
}

// Surfaces a background failure (a rejected IPC call, an unhandled rejection) that
// would otherwise vanish into the devtools console and read as success. Bottom-left,
// so it can coexist with the update toast in the opposite corner.
export function ErrorToast({ message, onDismiss }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div
      role="alert"
      data-testid="app-error"
      className="animate-pop fixed bottom-5 left-5 z-50 flex max-w-md items-center gap-3 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-3 pl-4 pr-3 shadow-lg"
    >
      <span className="text-sm text-danger">{message}</span>
      <button
        type="button"
        data-testid="app-error-dismiss"
        aria-label={tr('common.close')}
        onClick={onDismiss}
        className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
