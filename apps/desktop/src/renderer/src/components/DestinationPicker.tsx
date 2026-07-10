import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { Destination } from '../lib/destination'

interface Props {
  // The choices on offer — the caller filters (onboarding drops the destructive
  // 'overwrite'; Settings drops the Apple options off macOS).
  destinations: readonly Destination[]
  value: Destination
  onChange: (d: Destination) => void
  // FLAC can't go to Apple Music, so its options pin to the folder while it's the
  // chosen format. Overwrite rewrites the source in place and stays valid.
  flacOnly: boolean
  // Each option's data-testid is `${testidPrefix}-${destination}`.
  testidPrefix: string
  radioName: string
  // Extra controls rendered under an option's row while it is the selected one — the
  // output-folder field under 'folder', mirroring how Engine DJ reveals its own fields.
  // Rendered outside the <label> so clicking an input inside never toggles the radio.
  details?: Partial<Record<Destination, React.ReactNode>>
}

// The "where do conversions go" radiogroup, shared by Settings and onboarding so the
// two renderings of the same choice can't drift.
export function DestinationPicker({
  destinations,
  value,
  onChange,
  flacOnly,
  testidPrefix,
  radioName,
  details,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div role="radiogroup" aria-label={tr('settings.destination')} className="flex flex-col gap-2">
      {destinations.map((d) => {
        const disabled = flacOnly && d === 'appleMusic'
        return (
          <div key={d} className="flex flex-col gap-2">
            <label
              className={`flex items-start gap-3 ${
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              }`}
            >
              <input
                data-testid={`${testidPrefix}-${d}`}
                type="radio"
                name={radioName}
                checked={value === d}
                disabled={disabled}
                onChange={() => onChange(d)}
                className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              />
              <span className="text-sm">
                {tr(`settings.destinations.${d}`)}
                {d === 'appleMusic' && (
                  <span className="block text-xs text-fg-dim">
                    {tr('settings.destinationAppleMusicHint')}
                  </span>
                )}
                {d === 'engineDj' && (
                  <span className="block text-xs text-fg-dim">
                    {tr('settings.destinationEngineDjHint')}
                  </span>
                )}
                {d === 'beside' && (
                  <span className="block text-xs text-fg-dim">
                    {tr('settings.destinationBesideHint')}
                  </span>
                )}
                {d === 'overwrite' && (
                  <span className="block text-xs text-fg-dim">
                    {tr('settings.destinationOverwriteHint')}
                  </span>
                )}
              </span>
            </label>
            {value === d && details?.[d] && <div className="pl-7">{details[d]}</div>}
          </div>
        )
      })}
    </div>
  )
}
