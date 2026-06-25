import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LanguagePref, ThemePref } from '../../../../shared/types'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { SegmentedControl } from '../SegmentedControl'

const THEMES: ThemePref[] = ['system', 'light', 'dark']
const LANGUAGES: LanguagePref[] = ['system', 'en', 'es']

// Bytes as the rounded KB/MB/GB the cache hint shows — one decimal under 10 of a
// unit (so "8.4 MB" reads, "128 MB" stays clean), plain bytes below 1 KB.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
  onPreviewTheme: (theme: ThemePref) => void
  configDir: string | null
  defaultDir: string | null
  onChangeConfigDir: () => void
  onResetConfigDir: () => void
}

export function GeneralTab({
  synced,
  patch,
  onPreviewTheme,
  configDir,
  defaultDir,
  onChangeConfigDir,
  onResetConfigDir,
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
      <span className="mb-1.5 block text-sm font-medium text-fg-muted">{tr('settings.theme')}</span>
      <SegmentedControl
        options={THEMES}
        value={synced.theme}
        onChange={(id) => {
          patch('theme', id)
          onPreviewTheme(id)
        }}
        testidPrefix="settings-theme"
        labelFor={(id) => tr(`settings.themes.${id}`)}
        className="mb-5"
      />

      <span className="mb-1.5 block text-sm font-medium text-fg-muted">
        {tr('settings.language')}
      </span>
      <SegmentedControl
        options={LANGUAGES}
        value={synced.language}
        onChange={(id) => patch('language', id)}
        testidPrefix="settings-language"
        labelFor={(id) => tr(`settings.languages.${id}`)}
        className="mb-5"
      />

      <span className="mb-1.5 block text-sm font-medium text-fg-muted">
        {tr('settings.configDir')}
      </span>
      <div className="flex gap-2">
        <input
          data-testid="settings-config-dir"
          value={configDir ?? defaultDir ?? tr('settings.configDirDefault')}
          readOnly
          className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg-muted"
        />
        <button
          type="button"
          data-testid="settings-config-dir-change"
          onClick={onChangeConfigDir}
          className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
        >
          {tr('common.change')}
        </button>
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
      <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.configDirHint')}</p>

      <span className="mb-1.5 block text-sm font-medium text-fg-muted">{tr('settings.cache')}</span>
      <div className="flex gap-2">
        <input
          data-testid="settings-cache-stats"
          value={
            cacheStats
              ? `${cacheStats.files} · ${formatBytes(cacheStats.bytes)}`
              : tr('settings.configDirDefault')
          }
          readOnly
          className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg-muted"
        />
        <button
          type="button"
          data-testid="settings-cache-clear"
          onClick={clearCache}
          disabled={clearing || cacheStats?.files === 0}
          className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {tr('settings.cacheClear')}
        </button>
      </div>
      <p className="mt-1.5 mb-5 text-xs text-fg-dim">
        {cacheStats && cacheStats.files > 0
          ? tr('settings.cacheHint', { count: cacheStats.files, size: formatBytes(cacheStats.bytes) })
          : tr('settings.cacheHintEmpty')}
      </p>
    </>
  )
}
