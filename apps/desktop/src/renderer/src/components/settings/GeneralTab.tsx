import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LanguagePref, ThemePref } from '../../../../shared/types'
import { formatFileSize } from '../../lib/properties'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchLocal, PatchSynced } from '../../lib/settingsTabs'
import { PathField } from '../PathField'
import { SegmentedControl } from '../SegmentedControl'
import {
  SettingsCheckboxField,
  SettingsField,
  SettingsHint,
  SettingsLabel,
  SettingsSection,
} from './SettingsPrimitives'

const THEMES: ThemePref[] = ['system', 'light', 'dark']
const LANGUAGES: LanguagePref[] = ['system', 'en', 'es', 'de', 'fr', 'pt-BR']

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
  local: LocalDraft
  patchLocal: PatchLocal
  onPreviewTheme: (theme: ThemePref) => void
  configDir: string | null
  defaultDir: string | null
  onChangeConfigDir: () => void
  onResetConfigDir: () => void
  onExportSettings: () => void
  onImportSettings: () => void
}

export function GeneralTab({
  synced,
  patch,
  local,
  patchLocal,
  onPreviewTheme,
  configDir,
  defaultDir,
  onChangeConfigDir,
  onResetConfigDir,
  onExportSettings,
  onImportSettings,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()

  // The cache lives on disk independently of Settings, so the tab loads its own size
  // on mount and re-reads it after a clear — no need to thread it through the modal.
  const [cacheStats, setCacheStats] = useState<{ files: number; bytes: number } | null>(null)
  const [clearing, setClearing] = useState(false)
  useEffect(() => {
    window.api.cacheStats().then(setCacheStats)
  }, [])
  const clearCache = useCallback(async () => {
    setClearing(true)
    await window.api.clearCache()
    setCacheStats(await window.api.cacheStats())
    setClearing(false)
  }, [])

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
              label={tr('settings.language')}
              labelFor={(id) => tr(`settings.languages.${id}`)}
            />
          </SettingsField>

          <SettingsField label={tr('settings.configDir')} hint={tr('settings.configDirHint')}>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <PathField
                  value={configDir ?? defaultDir ?? tr('settings.configDirDefault')}
                  onChange={onChangeConfigDir}
                  testid="settings-config-dir"
                />
              </div>
              {configDir && (
                <button
                  type="button"
                  data-testid="settings-config-dir-reset"
                  onClick={onResetConfigDir}
                  className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
                >
                  {tr('settings.configDirReset')}
                </button>
              )}
            </div>
          </SettingsField>

          <SettingsField label={tr('settings.backup')} hint={tr('settings.backupHint')}>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="settings-export"
                onClick={onExportSettings}
                className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
              >
                {tr('settings.exportConfig')}
              </button>
              <button
                type="button"
                data-testid="settings-import"
                onClick={() => {
                  if (window.confirm(tr('settings.importConfirm'))) onImportSettings()
                }}
                className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
              >
                {tr('settings.importConfig')}
              </button>
            </div>
          </SettingsField>

          {/* The size is said once, beside the name: it used to sit in a box that looked
              editable and again in the hint under it. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <SettingsLabel>{tr('settings.cache')}</SettingsLabel>
              <span data-testid="settings-cache-stats" className="text-xs tabular-nums text-fg-dim">
                {cacheStats &&
                  (cacheStats.files > 0
                    ? tr('settings.cacheCount', {
                        count: cacheStats.files,
                        size: formatFileSize(cacheStats.bytes),
                      })
                    : tr('settings.cacheEmpty'))}
              </span>
            </div>
            <button
              type="button"
              data-testid="settings-cache-clear"
              onClick={clearCache}
              disabled={clearing || cacheStats?.files === 0}
              className="press self-start rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {tr('settings.cacheClear')}
            </button>
            <SettingsHint>{tr('settings.cacheHint')}</SettingsHint>
          </div>

          <SettingsField label={tr('settings.log')} hint={tr('settings.logHint')}>
            <button
              type="button"
              data-testid="settings-log-reveal"
              onClick={() => window.api.revealLog()}
              className="press self-start rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
            >
              {tr('settings.logReveal')}
            </button>
          </SettingsField>
        </div>
      </SettingsSection>

      {/* Its own section, with the rule and eyebrow every other block on this tab has:
        dropped in bare it sat under the settings-folder hint and read as an option OF
        that folder, when it is about which builds this machine installs. Machine-bound
        (see settings.ts), so it stages through patchLocal — a synced flag would drag a
        tester's laptop channel onto the machine he plays gigs from. */}
      <SettingsSection eyebrow={tr('settings.updates')}>
        <SettingsCheckboxField
          testid="settings-beta-updates"
          checked={local.betaUpdates}
          onChange={(v) => patchLocal('betaUpdates', v)}
          label={tr('settings.betaUpdates')}
          hint={tr('settings.betaUpdatesHint')}
        />
      </SettingsSection>
    </>
  )
}
