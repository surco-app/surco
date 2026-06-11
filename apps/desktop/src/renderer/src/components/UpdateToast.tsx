import { X } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Shown once the main process reports a downloaded update. Restarting applies it
// immediately (quitAndInstall) instead of waiting for the user to quit the app.
export function UpdateToast(): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const [version, setVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      window.api.onUpdateDownloaded((v) => {
        setVersion(v)
        // electron-updater retries after a failed download; a success supersedes the
        // stale error so the toast stops reporting a failure it recovered from.
        setError(null)
      }),
    [],
  )
  useEffect(() => window.api.onUpdateError(setError), [])

  if (!version && !error) return null

  return (
    <div className="animate-pop fixed bottom-5 right-5 z-50 flex items-center gap-4 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-3 pl-4 pr-3 shadow-lg">
      {error ? (
        <>
          <span data-testid="update-error" className="text-sm text-[var(--color-danger)]">
            {tr('update.failed', { error })}
          </span>
          <button
            type="button"
            data-testid="update-error-dismiss"
            aria-label={tr('common.close')}
            onClick={() => setError(null)}
            className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          <span className="text-sm">{tr('update.ready', { version })}</span>
          <button
            type="button"
            data-testid="update-restart"
            onClick={() => window.api.installUpdate()}
            className="press rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            {tr('update.restart')}
          </button>
        </>
      )}
    </div>
  )
}
