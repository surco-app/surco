import type React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LicenseSnapshot } from '../../../shared/license'
import { useFocusTrap } from './useFocusTrap'

// Why the upgrade screen was opened, so the lede can name the wall the user hit.
// 'manage' is the manual open (command palette) with no wall in front of it.
export type UpgradeReason = 'limit' | 'batch' | 'export' | 'manage'

interface Props {
  snapshot: LicenseSnapshot
  reason: UpgradeReason
  onClose: () => void
  // Called after the license changes (activated/deactivated) so the app re-reads
  // its entitlement and unlocks/locks features without a restart.
  onChanged: () => void
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

export function UpgradeModal({ snapshot, reason, onClose, onChanged }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)

  const [key, setKey] = useState(snapshot.key)
  const [email, setEmail] = useState(snapshot.email)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A real, server-validated license (not just the beta unlock) — drives the
  // "manage" view with the deactivate control.
  const active = snapshot.status === 'active'
  const features = tr('upgrade.features', { returnObjects: true }) as string[]

  async function activate(): Promise<void> {
    setBusy(true)
    setError(null)
    const res = await window.api.activateLicense(key, email)
    setBusy(false)
    if (res.ok) {
      onChanged()
      onClose()
      return
    }
    setError(tr(`upgrade.errors.${res.reason}`, { defaultValue: tr('upgrade.errors.generic') }))
  }

  async function deactivate(): Promise<void> {
    setBusy(true)
    await window.api.deactivateLicense()
    setBusy(false)
    onChanged()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        data-testid="upgrade-backdrop"
        aria-label={tr('common.close')}
        onClick={onClose}
        className="animate-overlay absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        data-testid="upgrade-modal"
        className="animate-pop relative z-10 w-[460px] rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
      >
        {active ? (
          <>
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
              <button
                type="button"
                onClick={onClose}
                className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
              >
                {tr('common.close')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold">{tr('upgrade.title')}</h2>
              <div className="text-sm text-fg-dim">
                <span className="text-lg font-bold text-[var(--color-fg)]">
                  €{snapshot.proPriceEur}
                </span>{' '}
                {tr('upgrade.oneTime')}
              </div>
            </div>
            <p className="mt-2 text-sm text-fg-dim">{tr(`upgrade.reason.${reason}`)}</p>
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
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-panel-2)]"
                >
                  {tr('common.cancel')}
                </button>
                <button
                  type="button"
                  data-testid="license-activate"
                  onClick={activate}
                  disabled={busy || !key.trim()}
                  className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
                >
                  {tr('upgrade.activate')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
