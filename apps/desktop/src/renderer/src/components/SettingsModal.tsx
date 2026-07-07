import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { findConflicts, resolveBindings } from '../../../shared/shortcutDefaults'
import type { Settings, ThemePref } from '../../../shared/types'
import { DONATE_URL } from '../lib/donate'
import {
  buildSettingsPatch,
  type LocalDraft,
  pickSynced,
  type SyncedDraft,
} from '../lib/settingsDraft'
import { SETTINGS_TAB_ICONS, SETTINGS_TABS, type SettingsTab } from '../lib/settingsTabs'
import { FieldsEditor } from './FieldsEditor'
import { ModalShell } from './ModalShell'
import { ArtworkTab } from './settings/ArtworkTab'
import { ConversionTab } from './settings/ConversionTab'
import { DestinationTab } from './settings/DestinationTab'
import { EditorTab } from './settings/EditorTab'
import { GeneralTab } from './settings/GeneralTab'
import { NamingTab } from './settings/NamingTab'
import { SearchTab } from './settings/SearchTab'
import { ShortcutsTab } from './settings/ShortcutsTab'
import { type ListStats, StatsTab } from './settings/StatsTab'

export { DONATE_URL }

interface Props {
  settings: Settings
  onClose: () => void
  onSave: (patch: Partial<Settings>) => void
  onPreviewTheme: (theme: ThemePref) => void
  // Moving the settings folder applies immediately and may adopt another machine's
  // prefs, so the app's settings state is replaced outside the Save flow.
  onSettingsReplaced: (next: Settings) => void
  // The loaded list's cleanup progress for the Stats tab, tallied by App.
  listStats: ListStats
  initialTab?: SettingsTab
}

export function SettingsModal({
  settings,
  onClose,
  onSave,
  onPreviewTheme,
  onSettingsReplaced,
  listStats,
  initialTab,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general')
  // Roving-tabindex navigation for the tablist: arrows (and Home/End) move the
  // selection and focus together, wrapping around, per the ARIA tabs pattern.
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({})
  function onTabKeyDown(e: React.KeyboardEvent, idx: number): void {
    const last = SETTINGS_TABS.length - 1
    let next = -1
    if (e.key === 'ArrowRight') next = idx === last ? 0 : idx + 1
    else if (e.key === 'ArrowLeft') next = idx === 0 ? last : idx - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    if (next === -1) return
    e.preventDefault()
    const id = SETTINGS_TABS[next]
    setTab(id)
    tabRefs.current[id]?.focus()
  }
  // Every staged field lives in one of two objects instead of a useState per field, so
  // the three places that must agree on the field list (seeding, the config-dir
  // re-seed, and save) all read the same shape and can never drift apart.
  const [synced, setSynced] = useState<SyncedDraft>(() => pickSynced(settings))
  // Machine-local fields (local.token, output folder, auto-match) aren't moved by a
  // config-dir switch, so their staged edits survive one.
  const [local, setLocal] = useState<LocalDraft>(() => ({
    token: settings.discogsToken,
    outputDir: settings.outputDir,
    engineLibraryDir: settings.engineLibraryDir,
    autoMatch: settings.autoMatch,
  }))
  function patch<K extends keyof SyncedDraft>(key: K, value: SyncedDraft[K]): void {
    setSynced((p) => ({ ...p, [key]: value }))
  }
  function patchLocal<K extends keyof typeof local>(key: K, value: (typeof local)[K]): void {
    setLocal((p) => ({ ...p, [key]: value }))
  }

  async function changeDir(): Promise<void> {
    const dir = await window.api.pickOutputDir()
    if (dir) patchLocal('outputDir', dir)
  }

  async function changeEngineDir(): Promise<void> {
    const dir = await window.api.pickEngineLibraryDir()
    if (dir) patchLocal('engineLibraryDir', dir)
  }

  // Where settings.json lives — null is the app default. Loaded on open because it
  // isn't part of Settings (it's the pointer that says where Settings are read from).
  const [configDir, setConfigDir] = useState<string | null>(null)
  // The app-default location, shown in the field when no custom folder is set so the user
  // sees the real path instead of an opaque "default folder" label.
  const [defaultDir, setDefaultDir] = useState<string | null>(null)
  useEffect(() => {
    window.api.getConfigDir().then(setConfigDir)
    window.api.defaultConfigDir().then(setDefaultDir)
  }, [])

  async function moveConfigDir(dir: string | null): Promise<void> {
    const next = await window.api.setConfigDir(dir)
    setConfigDir(dir)
    onSettingsReplaced(next)
    // A folder switch can adopt another machine's prefs, so every staged synced field
    // re-reads what is now in effect — otherwise a later Save would clobber the adopted
    // values with this modal's stale copies. One call covers them all by construction.
    setSynced(pickSynced(next))
    onPreviewTheme(next.theme)
  }

  async function changeConfigDir(): Promise<void> {
    const dir = await window.api.pickConfigDir()
    if (dir) await moveConfigDir(dir)
  }

  function save(): void {
    onSave(buildSettingsPatch(synced, local))
    onClose()
  }

  // Effective bindings shown in the Shortcuts tab, plus the clashes that block saving.
  const bindings = resolveBindings(synced.shortcutOverrides)
  const conflictIds = new Set(findConflicts(bindings).flat())

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="settings-backdrop"
      label={tr('header.settings')}
      align="top"
      onSubmit={save}
      className="flex max-h-[84vh] w-[680px] flex-col rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
    >
      <div className="-mx-6 -mt-6 mb-5 shrink-0 border-b border-[var(--color-line)] px-4 pt-5 pb-3">
        <div
          role="tablist"
          aria-label={tr('header.settings')}
          className="flex justify-center gap-2"
        >
          {SETTINGS_TABS.map((id, idx) => {
            const Icon = SETTINGS_TAB_ICONS[id]
            return (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el
                }}
                type="button"
                role="tab"
                id={`settings-tab-${id}`}
                data-testid={`settings-tab-${id}`}
                aria-selected={tab === id}
                aria-controls="settings-tabpanel"
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={(e) => onTabKeyDown(e, idx)}
                className={`flex w-[4.5rem] flex-col items-center gap-1.5 rounded-lg px-1 py-2 text-xs transition-colors ${
                  tab === id
                    ? 'bg-[var(--color-field)] text-[var(--color-accent)]'
                    : 'text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg'
                }`}
              >
                <Icon className="h-6 w-6" strokeWidth={1.7} aria-hidden="true" />
                {tr(`settings.tabs.${id}`)}
              </button>
            )
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id="settings-tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        className="-mr-2 min-h-[280px] flex-1 overflow-y-auto pr-2"
      >
        {tab === 'general' && (
          <GeneralTab
            synced={synced}
            patch={patch}
            onPreviewTheme={onPreviewTheme}
            configDir={configDir}
            defaultDir={defaultDir}
            onChangeConfigDir={changeConfigDir}
            onResetConfigDir={() => moveConfigDir(null)}
          />
        )}
        {tab === 'search' && (
          <SearchTab synced={synced} local={local} patch={patch} patchLocal={patchLocal} />
        )}
        {tab === 'conversion' && <ConversionTab synced={synced} patch={patch} />}
        {tab === 'destination' && (
          <DestinationTab
            synced={synced}
            local={local}
            patch={patch}
            onChangeDir={changeDir}
            onChangeEngineDir={changeEngineDir}
          />
        )}
        {tab === 'naming' && <NamingTab synced={synced} patch={patch} />}
        {tab === 'editor' && <EditorTab synced={synced} patch={patch} />}
        {tab === 'artwork' && <ArtworkTab synced={synced} patch={patch} />}
        {tab === 'fields' && (
          <FieldsEditor
            visibleFields={synced.visibleFields}
            requiredFields={synced.requiredFields}
            onChangeVisible={(fields) => patch('visibleFields', fields)}
            onChangeRequired={(fields) => patch('requiredFields', fields)}
          />
        )}
        {tab === 'shortcuts' && (
          <ShortcutsTab
            synced={synced}
            patch={patch}
            bindings={bindings}
            conflictIds={conflictIds}
          />
        )}
        {tab === 'stats' && <StatsTab settings={settings} listStats={listStats} />}
      </div>

      <div className="mt-6 flex shrink-0 justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="press rounded-lg px-4 py-2 text-sm text-fg-muted hover:text-fg"
        >
          {tr('common.cancel')}
        </button>
        <button
          type="submit"
          data-testid="settings-save"
          disabled={conflictIds.size > 0}
          className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
        >
          {tr('common.save')}
        </button>
      </div>
    </ModalShell>
  )
}
