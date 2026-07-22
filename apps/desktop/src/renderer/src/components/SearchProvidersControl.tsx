import type React from 'react'
import { useTranslation } from 'react-i18next'
import { SEARCH_PROVIDERS } from '../../../shared/defaults'
import type { Settings } from '../../../shared/types'

// The catalog-source checkboxes, shared by Settings and the onboarding wizard. The list
// is baked in for the same reason the format picker's is: each surface once declared its
// own copy, so a source added to one could silently never reach the other.
export function SearchProvidersControl({
  value,
  onChange,
  testid,
  testidPrefix,
}: {
  value: Settings['searchProviders']
  onChange: (value: Settings['searchProviders']) => void
  testid: string
  // Each checkbox's data-testid is `${testidPrefix}-${provider}`.
  testidPrefix: string
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2" data-testid={testid}>
      {SEARCH_PROVIDERS.map((p) => (
        <label key={p} className="flex cursor-pointer items-center gap-2">
          <input
            data-testid={`${testidPrefix}-${p}`}
            type="checkbox"
            checked={value.includes(p)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))
            }
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          <span className="text-sm">{tr(`settings.provider.${p}`)}</span>
        </label>
      ))}
    </div>
  )
}
