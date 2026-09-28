import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Settings } from '../../../shared/types'
import { mainErrorMessage } from '../lib/ipcError'
import { SettingsLabel } from './settings/SettingsPrimitives'

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
        <span data-testid="beatport-connected" className="flex items-center gap-2 text-sm">
          <span
            data-testid="beatport-status"
            role="img"
            aria-label={tr('settings.beatportConnected')}
            className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-good)]"
          />
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
      {/* Connect closes the same row as the two fields it acts on, instead of a row of
          its own under them. */}
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
        <div>
          <SettingsLabel htmlFor="beatport-username" className="mb-2">
            {tr('settings.beatportUsername')}
          </SettingsLabel>
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
          <SettingsLabel htmlFor="beatport-password" className="mb-2">
            {tr('settings.beatportPassword')}
          </SettingsLabel>
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
        <button
          type="button"
          data-testid="beatport-connect"
          disabled={disabled || busy || !user.trim() || !password}
          onClick={() => run(() => window.api.beatportConnect(user, password))}
          className={BUTTON}
        >
          {busy ? tr('settings.beatportConnecting') : tr('settings.beatportConnect')}
        </button>
      </div>
      {error && (
        <p
          data-testid="beatport-error"
          role="alert"
          className="mt-2 text-xs text-[var(--color-danger)]"
        >
          {error}
        </p>
      )}
    </div>
  )
}
