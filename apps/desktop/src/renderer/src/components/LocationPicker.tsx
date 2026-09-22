import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { Location } from '../lib/destination'

const HINTS: Partial<Record<Location, string>> = {
  beside: 'settings.destinationBesideHint',
  overwrite: 'settings.destinationOverwriteHint',
}

export function LocationPicker({
  locations,
  value,
  onChange,
  testidPrefix,
  radioName,
  folderDetail,
}: {
  locations: readonly Location[]
  value: Location
  onChange: (location: Location) => void
  testidPrefix: string
  radioName: string
  folderDetail: React.ReactNode
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div role="radiogroup" aria-label={tr('settings.location')} className="flex flex-col gap-4">
      {locations.map((location) => (
        <div key={location} className="flex flex-col">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              data-testid={`${testidPrefix}-${location}`}
              type="radio"
              name={radioName}
              checked={value === location}
              onChange={() => onChange(location)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-sm">
              {tr(`settings.destinations.${location}`)}
              {HINTS[location] && (
                <span className="mt-0.5 block text-xs leading-relaxed text-fg-dim">
                  {tr(HINTS[location])}
                </span>
              )}
            </span>
          </label>
          {location === 'folder' && <div className="pt-2 pl-7">{folderDetail}</div>}
        </div>
      ))}
    </div>
  )
}
