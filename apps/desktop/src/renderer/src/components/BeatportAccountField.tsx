import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Settings } from '../../../shared/types'
import { mainErrorMessage } from '../lib/ipcError'

const INPUT =
  'w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] disabled:cursor-not-allowed'
const BUTTON =
  'press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)] disabled:cursor-not-allowed disabled:opacity-50'

export function BeatportAccountField({
  username,
  disabled,
  onChange,
}: {
  username: string
  disabled: boolean
  onChange: (settings: Settings) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<Settings>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onChange(await action())
      setPassword('')
    } catch (e) {
      setError(mainErrorMessage(e, tr, tr('errors.beatportUnavailable')))
    } finally {
      setBusy(false)
    }
  }

  if (username) {
    return (
      <div className="flex items-center justify-between gap-4">
        <span data-testid="beatport-connected" className="text-sm">
          {tr('settings.beatportConnectedAs', { username })}
        </span>
        <button
          type="button"
          data-testid="beatport-disconnect"
          disabled={busy}
          onClick={() => run(() => window.api.beatportDisconnect())}
          className={BUTTON}
        >
          {tr('settings.beatportDisconnect')}
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="beatport-username"
            className="mb-2 block text-sm font-medium text-fg-muted"
          >
            {tr('settings.beatportUsername')}
          </label>
          <input
            id="beatport-username"
            data-testid="beatport-username"
            autoComplete="username"
            value={user}
            disabled={disabled}
            onChange={(e) => setUser(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label
            htmlFor="beatport-password"
            className="mb-2 block text-sm font-medium text-fg-muted"
          >
            {tr('settings.beatportPassword')}
          </label>
          <input
            id="beatport-password"
            data-testid="beatport-password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={disabled}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          data-testid="beatport-connect"
          disabled={disabled || busy || !user.trim() || !password}
          onClick={() => run(() => window.api.beatportConnect(user, password))}
          className={BUTTON}
        >
          {busy ? tr('settings.beatportConnecting') : tr('settings.beatportConnect')}
        </button>
        {error && (
          <p
            data-testid="beatport-error"
            role="alert"
            className="text-xs text-[var(--color-danger)]"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
