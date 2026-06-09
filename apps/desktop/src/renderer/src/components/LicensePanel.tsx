import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LicenseSnapshot } from '../../../shared/license'

interface Props {
  snapshot: LicenseSnapshot
  // Re-read the entitlement after the license changes so the app locks/unlocks
  // features without a restart.
  onChanged: () => void
  // Provided when the panel lives inside the upgrade modal: activating or deactivating
  // dismisses it. Omitted in the Settings tab, where it just refreshes in place.
  onClose?: () => void
  // Optional context line shown above the paywall (the reason the modal opened).
  lede?: string
}

function Check(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0 text-[var(--color-accent)]"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

// The license body shared by the upgrade modal and Settings → License: a manage view
// for an active Pro license, otherwise the paywall (usage meter, price, buy, activate).
export function LicensePanel({ snapshot, onChanged, onClose, lede }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [key, setKey] = useState(snapshot.key)
  const [email, setEmail] = useState(snapshot.email)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = snapshot.status === 'active'
  const features = tr('upgrade.features', { returnObjects: true }) as string[]
  // Free-tier usage, derived from the snapshot. remainingConversions is null when
  // unlimited (Pro or beta), in which case there's no meter to show.
  const total = snapshot.freeMonthlyConversions
  const remaining = snapshot.remainingConversions
  const used = remaining === null ? 0 : Math.max(0, total - remaining)

  async function activate(): Promise<void> {
    setBusy(true)
    setError(null)
    const res = await window.api.activateLicense(key, email)
    setBusy(false)
    if (res.ok) {
      onChanged()
      onClose?.()
      return
    }
    setError(tr(`upgrade.errors.${res.reason}`, { defaultValue: tr('upgrade.errors.generic') }))
  }

  async function deactivate(): Promise<void> {
    setBusy(true)
    await window.api.deactivateLicense()
    setBusy(false)
    onChanged()
    onClose?.()
  }

  if (active) {
    return (
      <div>
        <h2 className="text-base font-semibold">{tr('upgrade.active.title')}</h2>
        <p className="mt-2 text-sm text-fg-dim">
          {tr('upgrade.active.body', { email: snapshot.email })}
        </p>
        <div className="mt-6 flex justify-between gap-2">
          <button
            type="button"
            data-testid="license-deactivate"
            onClick={deactivate}
            disabled={busy}
            className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-panel-2)] disabled:opacity-50"
          >
            {tr('upgrade.active.deactivate')}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
            >
              {tr('common.close')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">{tr('upgrade.title')}</h2>
        <div className="text-sm text-fg-dim">
          <span className="text-lg font-bold text-[var(--color-fg)]">€{snapshot.proPriceEur}</span>{' '}
          {tr('upgrade.oneTime')}
        </div>
      </div>
      {lede && <p className="mt-2 text-sm text-fg-dim">{lede}</p>}

      {remaining !== null && (
        <div data-testid="license-usage" className="mt-4">
          <div className="flex items-center justify-between text-xs text-fg-dim">
            <span>{tr('upgrade.usage.title')}</span>
            <span className="tabular-nums">
              {used} / {total}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-panel-2)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)]"
              style={{ width: `${total > 0 ? Math.min(100, (used / total) * 100) : 0}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-fg-dim">
            {tr('upgrade.usage.left', { count: remaining })}
          </p>
        </div>
      )}

      {snapshot.betaMode && (
        <p
          data-testid="upgrade-beta-note"
          className="mt-3 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-xs text-fg-dim"
        >
          {tr('upgrade.betaNote')}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <Check />
            {f}
          </li>
        ))}
      </ul>

      {/* No sales during the beta: everyone is already Pro, so the buy button and
          activation form would be misleading. The banner above explains why. */}
      {!snapshot.betaMode && (
        <>
          <button
            type="button"
            data-testid="license-buy"
            onClick={() => window.api.buyLicense()}
            className="press mt-5 w-full rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)]"
          >
            {tr('upgrade.buy')}
          </button>

          <div className="mt-5 border-t border-[var(--color-line-strong)] pt-4">
            <p className="text-xs font-medium text-fg-dim">{tr('upgrade.haveKey')}</p>
            <input
              type="text"
              data-testid="license-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={tr('upgrade.keyPlaceholder')}
              className="mt-2 w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <input
              type="email"
              data-testid="license-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={tr('upgrade.emailPlaceholder')}
              className="mt-2 w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            {error && (
              <p data-testid="license-error" className="mt-2 text-xs text-[var(--color-danger)]">
                {error}
              </p>
            )}
            <button
              type="button"
              data-testid="license-activate"
              onClick={activate}
              disabled={busy || !key.trim()}
              className="press mt-3 w-full rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-panel-2)] disabled:opacity-50"
            >
              {tr('upgrade.activate')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
