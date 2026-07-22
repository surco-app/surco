import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { findConflicts, resolveBindings } from '../../../shared/shortcutDefaults'
import type { Settings, ThemePref } from '../../../shared/types'
import { DONATE_URL } from '../lib/donate'
import {
  buildSettingsPatch,
  type LocalDraft,
  pickLocal,
  pickSynced,
  type SyncedDraft,
} from '../lib/settingsDraft'
import {
  SETTINGS_TAB_GROUPS,
  SETTINGS_TAB_ICONS,
  SETTINGS_TABS,
  type SettingsTab,
} from '../lib/settingsTabs'
import { useScrollAffordance } from '../hooks/useScrollAffordance'
import { FieldsEditor } from './FieldsEditor'
import { ModalShell } from './ModalShell'
import { ArtworkTab } from './settings/ArtworkTab'
import { ConversionTab } from './settings/ConversionTab'
import { DestinationTab } from './settings/DestinationTab'
import { EditorTab } from './settings/EditorTab'
import { GeneralTab } from './settings/GeneralTab'
import { LayoutTab } from './settings/LayoutTab'
import { NamingTab } from './settings/NamingTab'
import { ProcessingTab } from './settings/ProcessingTab'
import { SearchTab } from './settings/SearchTab'
import { ShortcutsTab } from './settings/ShortcutsTab'
import { StatsTab } from './settings/StatsTab'

export { DONATE_URL }

interface Props {
  settings: Settings
  onClose: () => void
  onSave: (patch: Partial<Settings>) => void
  onPreviewTheme: (theme: ThemePref) => void
  // Moving the settings folder applies immediately and may adopt another machine's
  // prefs, so the app's settings state is replaced outside the Save flow.
  onSettingsReplaced: (next: Settings) => void
  initialTab?: SettingsTab
}

export function SettingsModal({
  settings,
  onClose,
  onSave,
  onPreviewTheme,
  onSettingsReplaced,
  initialTab,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general')
  // A bottom fade cues that a tab scrolls — Conversion's normalization block sat below
  // the fold with no hint. Recomputed on `tab` so swapping to a shorter/taller tab
  // refreshes it without a scroll event.
  const { ref: bodyRef, moreBelow } = useScrollAffordance([tab])
  // Roving-tabindex navigation for the vertical tablist: Up/Down (and Home/End) move the
  // selection and focus together, wrapping around, per the ARIA tabs pattern. Left/Right
  // stay wired as aliases so muscle memory from the old horizontal row still works.
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({})
  function onTabKeyDown(e: React.KeyboardEvent, idx: number): void {
    const last = SETTINGS_TABS.length - 1
    let next = -1
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = idx === last ? 0 : idx + 1
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = idx === 0 ? last : idx - 1
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
  const [local, setLocal] = useState<LocalDraft>(() => pickLocal(settings))
  function patch<K extends keyof SyncedDraft>(key: K, value: SyncedDraft[K]): void {
    setSynced((p) => ({ ...p, [key]: value }))
  }
  function patchLocal<K extends keyof typeof local>(key: K, value: (typeof local)[K]): void {
    setLocal((p) => ({ ...p, [key]: value }))
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

  async function exportSettings(): Promise<void> {
    try {
      await window.api.exportSettings()
    } catch (e) {
      // Same surface a failed import uses: without it the click rejects into the void
      // and no file was written.
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function importSettings(): Promise<void> {
    const result = await window.api.importSettings()
    if (!result) return
    if (!result.ok) {
      window.alert(result.error)
      return
    }
    onSettingsReplaced(result.settings)
    setSynced(pickSynced(result.settings))
    onPreviewTheme(result.settings.theme)
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
      className="flex max-h-[84vh] w-[780px] overflow-hidden rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)]"
    >
      {/* A vertical nav down the side reads like macOS System Settings and scales past the
          point a single centred row of ten tabs starts to crowd — every label gets its
          full width, and adding a tab costs a row, not horizontal space it doesn't have. */}
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label={tr('header.settings')}
        className="flex w-[188px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--color-line)] bg-[var(--color-panel-2)] p-3"
      >
        {SETTINGS_TAB_GROUPS.map((group) => (
          <div key={group.heading ?? 'main'} className="flex flex-col gap-0.5">
            {group.heading && (
              <p className="mt-3 mb-1 px-3 text-[10px] font-medium uppercase tracking-wider text-fg-faint">
                {tr(`settings.tabGroups.${group.heading}`)}
              </p>
            )}
            {group.tabs.map((id) => {
              const Icon = SETTINGS_TAB_ICONS[id]
              // The keyboard handler walks the flat SETTINGS_TABS order, so the button
              // reports its index there, not its position within the group.
              const idx = SETTINGS_TABS.indexOf(id)
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
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    tab === id
                      ? // accent-soft (not field) so the selected tab reads against the panel-2
                        // sidebar in light too, where field and panel-2 are nearly the same grey.
                        'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                      : 'text-fg-muted hover:bg-[var(--color-panel)] hover:text-fg'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                  {tr(`settings.tabs.${id}`)}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-6">
      <div className="relative flex min-h-[280px] flex-1 flex-col">
      <div
        ref={bodyRef}
        role="tabpanel"
        id="settings-tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        className="-mr-2 flex-1 overflow-x-hidden overflow-y-auto pr-2"
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
            onExportSettings={exportSettings}
            onImportSettings={importSettings}
          />
        )}
        {tab === 'search' && (
          <SearchTab synced={synced} local={local} patch={patch} patchLocal={patchLocal} />
        )}
        {tab === 'conversion' && <ConversionTab synced={synced} patch={patch} />}
        {tab === 'processing' && <ProcessingTab synced={synced} patch={patch} />}
        {tab === 'destination' && (
          <DestinationTab
            synced={synced}
            local={local}
            patch={patch}
            onOutputDirChange={(dir) => patchLocal('outputDir', dir)}
            onChangeEngineDir={changeEngineDir}
          />
        )}
        {tab === 'naming' && <NamingTab synced={synced} patch={patch} />}
        {tab === 'editor' && <EditorTab synced={synced} patch={patch} />}
        {tab === 'layout' && <LayoutTab synced={synced} patch={patch} />}
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
        {tab === 'stats' && <StatsTab settings={settings} />}
      </div>
        {/* Fades the cut-off last line into the panel while there's more below, then
            clears at the end — the "keep scrolling" cue the faint scrollbar didn't give. */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 bottom-0 mr-2 h-10 bg-gradient-to-t from-[var(--color-panel)] to-transparent transition-opacity duration-200 ${
            moreBelow ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>

      <div className="-mx-6 mt-6 flex shrink-0 justify-end gap-2 border-t border-[var(--color-line)] px-6 pt-4">
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
          className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
        >
          {tr('common.save')}
        </button>
      </div>
      </div>
    </ModalShell>
  )
}
