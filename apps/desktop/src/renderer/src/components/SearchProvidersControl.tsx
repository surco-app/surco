import type React from 'react'
import { useTranslation } from 'react-i18next'
import { SEARCH_PROVIDERS } from '../../../shared/defaults'
import type { SearchProviderId, Settings } from '../../../shared/types'

// The catalog-source checkboxes, shared by Settings and the onboarding wizard. The list
// is baked in for the same reason the format picker's is: each surface once declared its
// own copy, so a source added to one could silently never reach the other.
//
// With `details`, the sources become a list: one row per source with what it brings, and
// its setup (a token, an account) under its own checkbox, dimmed while the source is off.
export function SearchProvidersControl({
  value,
  onChange,
  testid,
  testidPrefix,
  details,
}: {
  value: Settings['searchProviders']
  onChange: (value: Settings['searchProviders']) => void
  testid: string
  // Each checkbox's data-testid is `${testidPrefix}-${provider}`, each row's
  // `${testidPrefix}-row-${provider}`.
  testidPrefix: string
  details?: Partial<Record<SearchProviderId, React.ReactNode>>
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const toggle = (p: SearchProviderId, on: boolean): void =>
    onChange(on ? [...value, p] : value.filter((x) => x !== p))
  if (!details) {
    return (
      <div className="flex flex-wrap gap-x-5 gap-y-2" data-testid={testid}>
        {SEARCH_PROVIDERS.map((p) => (
          <label key={p} className="flex cursor-pointer items-center gap-2">
            <input
              data-testid={`${testidPrefix}-${p}`}
              type="checkbox"
              checked={value.includes(p)}
              onChange={(e) => toggle(p, e.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
            />
            <span className="text-sm">{tr(`settings.provider.${p}`)}</span>
          </label>
        ))}
      </div>
    )
  }
  return (
    <div data-testid={testid} className="rounded-lg border border-[var(--color-line)]">
      {SEARCH_PROVIDERS.map((p) => (
        <div
          key={p}
          data-testid={`${testidPrefix}-row-${p}`}
          className="border-t border-[var(--color-line)] px-3.5 py-3 first:border-t-0"
        >
          <div className="flex items-center gap-x-3">
            <label className="flex w-36 shrink-0 cursor-pointer items-center gap-3">
              <input
                data-testid={`${testidPrefix}-${p}`}
                type="checkbox"
                checked={value.includes(p)}
                onChange={(e) => toggle(p, e.target.checked)}
                className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
              />
              <span className="text-sm">{tr(`settings.provider.${p}`)}</span>
            </label>
            <span className="min-w-0 text-xs text-fg-dim">
              {tr(`settings.providerDescription.${p}`)}
            </span>
          </div>
          {details[p] && (
            <div className={`mt-3 pl-7 ${value.includes(p) ? '' : 'opacity-50'}`}>{details[p]}</div>
          )}
        </div>
      ))}
    </div>
  )
}
