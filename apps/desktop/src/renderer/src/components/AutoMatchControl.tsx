import type React from 'react'
import { useTranslation } from 'react-i18next'
import { autoMatchAvailable } from '../../../shared/autoMatch'
import type { Settings } from '../../../shared/types'

// The auto-match toggle, shared by Settings and the onboarding wizard. The readiness
// rule and the three hint branches (ready / missing source / missing token) are baked
// in on purpose: the wizard once carried its own two-branch copy, which told a user
// with zero sources to add a token — for a field that only renders while Discogs is on.
export function AutoMatchControl({
  checked,
  onChange,
  searchProviders,
  discogsToken,
  testid,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  searchProviders: Settings['searchProviders']
  discogsToken: string
  testid: string
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const autoReady = autoMatchAvailable({ searchProviders, discogsToken })
  return (
    <label
      className={`flex items-center gap-3 ${
        autoReady ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
      }`}
    >
      <input
        data-testid={testid}
        type="checkbox"
        checked={checked && autoReady}
        disabled={!autoReady}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--color-accent)]"
      />
      <span className="text-sm">
        {tr('settings.autoMatch')}
        <span className="mt-0.5 block text-xs leading-relaxed text-fg-dim">
          {searchProviders.length === 0
            ? tr('settings.autoMatchNeedsSource')
            : autoReady
              ? tr('settings.autoMatchHint')
              : tr('settings.autoMatchNeedsToken')}
        </span>
      </span>
    </label>
  )
}
