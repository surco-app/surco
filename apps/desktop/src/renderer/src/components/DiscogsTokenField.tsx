import type React from 'react'
import { useTranslation } from 'react-i18next'

// The Discogs personal-token field, shared by Settings and the onboarding wizard so the
// label, placeholder and why/how hint stay one copy — the wizard used to drop the "why"
// line, which is what convinces a new user the field is worth leaving the wizard for.
export function DiscogsTokenField({
  value,
  onChange,
  testid,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  // Doubles as the input's id, keeping the label attached wherever it's mounted.
  testid: string
  disabled?: boolean
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div>
      <label htmlFor={testid} className="mb-2 block text-sm font-medium text-fg-muted">
        {tr('settings.discogsToken')}
      </label>
      <input
        id={testid}
        data-testid={testid}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={tr('settings.tokenPlaceholder')}
        className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] disabled:cursor-not-allowed"
      />
      <p className="mt-2 text-xs leading-relaxed text-fg-dim">
        {tr('settings.tokenWhy')} {tr('settings.tokenHelp')}{' '}
        <a
          href="https://www.discogs.com/settings/developers"
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-accent)] hover:underline"
        >
          discogs.com/settings/developers
        </a>
      </p>
    </div>
  )
}
