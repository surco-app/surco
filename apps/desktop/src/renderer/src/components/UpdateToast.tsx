import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Shown once the main process reports a downloaded update. Restarting applies it
// immediately (quitAndInstall) instead of waiting for the user to quit the app.
export function UpdateToast(): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => window.api.onUpdateDownloaded(setVersion), [])

  if (!version) return null

  return (
    <div className="animate-pop fixed bottom-5 right-5 z-50 flex items-center gap-4 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-3 pl-4 pr-3 shadow-lg">
      <span className="text-sm">{tr('update.ready', { version })}</span>
      <button
        data-testid="update-restart"
        onClick={() => window.api.installUpdate()}
        className="press rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
      >
        {tr('update.restart')}
      </button>
    </div>
  )
}
