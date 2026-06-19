import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { LanguagePref, ThemePref } from '../../../../shared/types'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { SegmentedControl } from '../SegmentedControl'

const THEMES: ThemePref[] = ['system', 'light', 'dark']
const LANGUAGES: LanguagePref[] = ['system', 'en', 'es']

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
    </>
  )
}
