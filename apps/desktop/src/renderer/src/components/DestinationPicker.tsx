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
  // output-folder field under 'folder', the library/playlist fields under 'engineDj'.
  // Rendered outside the <label> so clicking an input inside never toggles the radio.
  // Kept mounted and collapsed (grid-rows 0fr + inert) rather than unmounted, so the
  // reveal/hide can transition instead of popping; inert keeps the hidden inputs out
  // of the tab order and the accessibility tree while they animate.
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
    <>
      <div
        role="radiogroup"
        aria-label={tr('settings.destination')}
        className="flex flex-col gap-4"
      >
        {destinations.map((d) => {
          const disabled = flacOnly && d === 'appleMusic'
          return (
            <div key={d} className="flex flex-col">
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
                    <span className="mt-0.5 block text-xs leading-relaxed text-fg-dim">
                      {tr('settings.destinationAppleMusicHint')}
                    </span>
                  )}
                  {d === 'engineDj' && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-fg-dim">
                      {tr('settings.destinationEngineDjHint')}
                    </span>
                  )}
                  {d === 'beside' && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-fg-dim">
                      {tr('settings.destinationBesideHint')}
                    </span>
                  )}
                  {d === 'overwrite' && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-fg-dim">
                      {tr('settings.destinationOverwriteHint')}
                    </span>
                  )}
                </span>
              </label>
              {details?.[d] && (
                <div
                  inert={value !== d || undefined}
                  className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                    value === d ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  {/* The row's spacing lives INSIDE the overflow clip (pt-2, not the
                    parent's gap), so a collapsed detail contributes zero height. */}
                  <div className="overflow-hidden">
                    <div className="pt-2 pl-7">{details[d]}</div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {/* The greyed-out Apple Music radio alone doesn't say WHY — this names the FLAC
        limitation. Rendered here (not by each caller) so the disabled state and its
        explanation can't drift apart; destinations already encode "Apple Music offered". */}
      {flacOnly && destinations.includes('appleMusic') && (
        <p className="mt-2 text-xs leading-relaxed text-fg-dim">
          {tr('settings.appleMusicFlacNote')}
        </p>
      )}
    </>
  )
}
