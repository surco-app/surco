import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatFileSize } from '../../lib/properties'
import { PathField } from '../PathField'
import { SettingsField, SettingsHint, SettingsLabel, SettingsSection } from './SettingsPrimitives'

interface Props {
  configDir: string | null
  defaultDir: string | null
  onChangeConfigDir: () => void
  onResetConfigDir: () => void
  onExportSettings: () => void
  onImportSettings: () => void
  settingsFileError: string
}

export function AdvancedTab({
  configDir,
  defaultDir,
  onChangeConfigDir,
  onResetConfigDir,
  onExportSettings,
  onImportSettings,
  settingsFileError,
}: Props): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()

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
    <SettingsSection first>
      <div className="flex flex-col gap-5">
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
          {settingsFileError && (
            <p role="alert" data-testid="settings-file-error" className="text-sm text-danger">
              {settingsFileError}
            </p>
          )}
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
                      size: formatFileSize(cacheStats.bytes, i18n.language),
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
  )
}
