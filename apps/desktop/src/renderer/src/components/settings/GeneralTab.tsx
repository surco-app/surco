import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type DjProgram, RAIL_PROGRAMS } from '../../../../shared/djProgram'
import type { Density, LanguagePref, PlaylistSource, ThemePref } from '../../../../shared/types'
import { isMacOS, isStoreBuild, offeredHere } from '../../lib/platform'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchLocal, PatchSynced } from '../../lib/settingsTabs'
import { SOURCE_READ } from '../../lib/sourcePrograms'
import { SegmentedControl } from '../SegmentedControl'
import { Select } from '../Select'
import { CheckboxRow } from './CheckboxRow'
import {
  SettingsCheckboxField,
  SettingsField,
  SettingsHint,
  SettingsSection,
} from './SettingsPrimitives'

const THEMES: ThemePref[] = ['system', 'light', 'dark']
const DENSITIES: Density[] = ['normal', 'compact']
const LANGUAGES: LanguagePref[] = ['system', 'en', 'es', 'de', 'fr', 'pt-BR', 'ja', 'ca']
const SOURCES: PlaylistSource[] = ['appleMusic', ...RAIL_PROGRAMS]

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

  const [found, setFound] = useState<Partial<Record<DjProgram, boolean>>>({})
  useEffect(() => {
    for (const p of RAIL_PROGRAMS)
      SOURCE_READ[p].available().then((ok) => setFound((was) => ({ ...was, [p]: ok })))
  }, [])
  const unavailable: Record<PlaylistSource, boolean> = {
    appleMusic: !isMacOS(),
    rekordbox: found.rekordbox !== true,
    engine: found.engine !== true,
    traktor: found.traktor !== true,
    serato: found.serato !== true,
    virtualdj: found.virtualdj !== true,
  }
  const reason: Record<PlaylistSource, string | undefined> = {
    appleMusic: unavailable.appleMusic ? tr('settings.sourceAppleMusicUnavailable') : undefined,
    rekordbox: found.rekordbox === false ? tr('settings.sourceRekordboxUnavailable') : undefined,
    engine: found.engine === false ? tr('settings.sourceEngineUnavailable') : undefined,
    traktor: found.traktor === false ? tr('settings.sourceTraktorUnavailable') : undefined,
    serato: found.serato === false ? tr('settings.sourceSeratoUnavailable') : undefined,
    virtualdj: found.virtualdj === false ? tr('settings.sourceVirtualdjUnavailable') : undefined,
  }

  return (
    <>
      <SettingsSection first>
        <div className="flex flex-col gap-5">
          <SettingsField label={tr('settings.theme')} searchId="theme">
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

          <SettingsField
            label={tr('settings.density')}
            hint={tr('settings.densityHint')}
            searchId="density"
          >
            <SegmentedControl
              options={DENSITIES}
              value={synced.density}
              onChange={(id) => patch('density', id)}
              testidPrefix="settings-density"
              compact
              label={tr('settings.density')}
              labelFor={(id) => tr(`settings.densities.${id}`)}
            />
          </SettingsField>

          <SettingsField label={tr('settings.language')} searchId="language">
            <Select
              testid="settings-language"
              label={tr('settings.language')}
              value={synced.language}
              onChange={(id) => patch('language', id as LanguagePref)}
              options={LANGUAGES.map((id) => ({
                value: id,
                label: id === 'ja' ? '日本語' : tr(`settings.languages.${id}`),
              }))}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      {/* Its own section, with the rule and eyebrow every other block on this tab has:
        dropped in bare it sat under the settings-folder hint and read as an option OF
        that folder, when it is about which builds this machine installs. Machine-bound
        (see settings.ts), so it stages through patchLocal — a synced flag would drag a
        tester's laptop channel onto the machine he plays gigs from. */}
      <SettingsSection eyebrow={tr('settings.sourcesTitle')} searchId="sourcesTitle">
        <div className="flex flex-col gap-3">
          {SOURCES.filter((s) => s === 'appleMusic' || offeredHere(s)).map((source) => (
            <CheckboxRow
              key={source}
              testid={`settings-source-${source}`}
              checked={!synced.hiddenSources.includes(source) && !reason[source]}
              onChange={(shown) =>
                patch(
                  'hiddenSources',
                  shown
                    ? synced.hiddenSources.filter((s) => s !== source)
                    : [...synced.hiddenSources, source],
                )
              }
              label={tr(`settings.source.${source}`)}
              note={reason[source]}
              disabled={unavailable[source]}
            />
          ))}
          <SettingsHint data-testid="settings-sources-hint">
            {tr('settings.sourcesHint')}
          </SettingsHint>
        </div>
      </SettingsSection>

      <SettingsSection eyebrow={tr('settings.updates')} searchId="updates">
        <div className="flex flex-col gap-3">
          <SettingsCheckboxField
            testid="settings-auto-updates"
            checked={local.autoUpdates}
            onChange={(v) => patchLocal('autoUpdates', v)}
            label={tr('settings.autoUpdates')}
            searchId="autoUpdates"
            hint={tr(isStoreBuild() ? 'settings.autoUpdatesStoreHint' : 'settings.autoUpdatesHint')}
            disabled={isStoreBuild()}
          />
          <button
            type="button"
            data-testid="settings-check-updates"
            onClick={() => void window.api.checkForUpdates()}
            disabled={isStoreBuild()}
            className="press ml-7 self-start rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {tr('settings.checkUpdates')}
          </button>
          <SettingsCheckboxField
            testid="settings-beta-updates"
            checked={local.betaUpdates}
            onChange={(v) => patchLocal('betaUpdates', v)}
            label={tr('settings.betaUpdates')}
            searchId="betaUpdates"
            hint={tr(isStoreBuild() ? 'settings.betaUpdatesStoreHint' : 'settings.betaUpdatesHint')}
            disabled={isStoreBuild()}
          />
        </div>
      </SettingsSection>
    </>
  )
}
