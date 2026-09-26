import type React from 'react'
import { useTranslation } from 'react-i18next'
import { autoMatchAvailable } from '../../../shared/autoMatch'
import type { Settings } from '../../../shared/types'
import { SettingsCheckboxField } from './settings/SettingsPrimitives'

// The auto-match toggle, shared by Settings and the onboarding wizard. The readiness
// rule and the three hint branches (ready / missing source / missing token) are baked
// in on purpose: the wizard once carried its own two-branch copy, which told a user
// with zero sources to add a token — for a field that only renders while Discogs is on.
export function AutoMatchControl({
  checked,
  onChange,
  searchProviders,
  discogsToken,
  beatportUsername,
  testid,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  searchProviders: Settings['searchProviders']
  discogsToken: string
  beatportUsername?: string
  testid: string
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const autoReady = autoMatchAvailable({ searchProviders, discogsToken, beatportUsername })
  const onlyUnconnectedBeatport =
    !beatportUsername &&
    searchProviders.length > 0 &&
    searchProviders.every((p) => p === 'beatport')
  return (
    <SettingsCheckboxField
      testid={testid}
      checked={checked && autoReady}
      onChange={onChange}
      disabled={!autoReady}
      label={tr('settings.autoMatch')}
      hint={
        searchProviders.length === 0
          ? tr('settings.autoMatchNeedsSource')
          : autoReady
            ? tr('settings.autoMatchHint')
            : onlyUnconnectedBeatport
              ? tr('errors.beatportNotConnected')
              : tr('settings.autoMatchNeedsToken')
      }
    />
  )
}
