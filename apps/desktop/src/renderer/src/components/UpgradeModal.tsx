import type React from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { LicenseSnapshot } from '../../../shared/license'
import { LicensePanel } from './LicensePanel'
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

// The upgrade screen: modal chrome around the shared LicensePanel, with the reason the
// wall appeared shown as its lede.
export function UpgradeModal({ snapshot, reason, onClose, onChanged }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)

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
        <LicensePanel
          snapshot={snapshot}
          onChanged={onChanged}
          onClose={onClose}
          lede={tr(`upgrade.reason.${reason}`)}
        />
      </div>
    </div>
  )
}
