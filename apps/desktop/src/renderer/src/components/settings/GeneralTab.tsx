import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LanguagePref, PlaylistSource, ThemePref } from '../../../../shared/types'
import { isMacOS, isStoreBuild } from '../../lib/platform'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchLocal, PatchSynced } from '../../lib/settingsTabs'
import { SegmentedControl } from '../SegmentedControl'
import {
  SettingsCheckboxField,
  SettingsField,
  SettingsHint,
  SettingsSection,
} from './SettingsPrimitives'

const THEMES: ThemePref[] = ['system', 'light', 'dark']
const LANGUAGES: LanguagePref[] = ['system', 'en', 'es', 'de', 'fr', 'pt-BR', 'ja']
const SOURCES: PlaylistSource[] = ['appleMusic', 'rekordbox', 'engine', 'traktor']

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
  local: LocalDraft
  patchLocal: PatchLocal
  onPreviewTheme: (theme: ThemePref) => void
}

export function GeneralTab({
  synced,
  patch,
  local,
  patchLocal,
  onPreviewTheme,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()

  const [rekordboxFound, setRekordboxFound] = useState<boolean | null>(null)
  useEffect(() => {
    window.api.rekordboxAvailable().then(setRekordboxFound)
  }, [])
  const [engineFound, setEngineFound] = useState<boolean | null>(null)
  useEffect(() => {
    window.api.engineAvailable().then(setEngineFound)
  }, [])
  const [traktorFound, setTraktorFound] = useState<boolean | null>(null)
  useEffect(() => {
    window.api.traktorAvailable().then(setTraktorFound)
  }, [])
  const unavailable: Record<PlaylistSource, boolean> = {
    appleMusic: !isMacOS(),
    rekordbox: rekordboxFound !== true,
    engine: engineFound !== true,
    traktor: traktorFound !== true,
  }
  const reason: Record<PlaylistSource, string | undefined> = {
    appleMusic: unavailable.appleMusic ? tr('settings.sourceAppleMusicUnavailable') : undefined,
    rekordbox: rekordboxFound === false ? tr('settings.sourceRekordboxUnavailable') : undefined,
    engine: engineFound === false ? tr('settings.sourceEngineUnavailable') : undefined,
    traktor: traktorFound === false ? tr('settings.sourceTraktorUnavailable') : undefined,
  }

  return (
    <>
      <SettingsSection first>
        <div className="flex flex-col gap-5">
          <SettingsField label={tr('settings.theme')}>
            <SegmentedControl
              options={THEMES}
              value={synced.theme}
              onChange={(id) => {
                patch('theme', id)
                onPreviewTheme(id)
              }}
              testidPrefix="settings-theme"
              compact
              label={tr('settings.theme')}
              labelFor={(id) => tr(`settings.themes.${id}`)}
            />
          </SettingsField>

          <SettingsField label={tr('settings.language')}>
            <SegmentedControl
              options={LANGUAGES}
              value={synced.language}
              onChange={(id) => patch('language', id)}
              testidPrefix="settings-language"
              compact
              fill
              label={tr('settings.language')}
              labelFor={(id) => (id === 'ja' ? '日本語' : tr(`settings.languages.${id}`))}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      {/* Its own section, with the rule and eyebrow every other block on this tab has:
        dropped in bare it sat under the settings-folder hint and read as an option OF
        that folder, when it is about which builds this machine installs. Machine-bound
        (see settings.ts), so it stages through patchLocal — a synced flag would drag a
        tester's laptop channel onto the machine he plays gigs from. */}
      <SettingsSection eyebrow={tr('settings.sourcesTitle')}>
        <div className="flex flex-col gap-3">
          {SOURCES.map((source) => (
            <SettingsCheckboxField
              key={source}
              testid={`settings-source-${source}`}
              checked={!synced.hiddenSources.includes(source)}
              onChange={(shown) =>
                patch(
                  'hiddenSources',
                  shown
                    ? synced.hiddenSources.filter((s) => s !== source)
                    : [...synced.hiddenSources, source],
                )
              }
              label={tr(`settings.source.${source}`)}
              hint={reason[source]}
              disabled={unavailable[source]}
            />
          ))}
          <SettingsHint data-testid="settings-sources-hint">
            {tr('settings.sourcesHint')}
          </SettingsHint>
        </div>
      </SettingsSection>

      <SettingsSection eyebrow={tr('settings.updates')}>
        <SettingsCheckboxField
          testid="settings-beta-updates"
          checked={local.betaUpdates}
          onChange={(v) => patchLocal('betaUpdates', v)}
          label={tr('settings.betaUpdates')}
          hint={tr(isStoreBuild() ? 'settings.betaUpdatesStoreHint' : 'settings.betaUpdatesHint')}
          disabled={isStoreBuild()}
        />
      </SettingsSection>
    </>
  )
}
