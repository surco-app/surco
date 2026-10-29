import { Search, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { findConflicts, resolveBindings } from '../../../shared/shortcutDefaults'
import type { PlaylistLibrary, Settings, ThemePref } from '../../../shared/types'
import { useScrollAffordance } from '../hooks/useScrollAffordance'
import { DONATE_URL } from '../lib/donate'
import { mainErrorMessage } from '../lib/ipcError'
import {
  buildSettingsPatch,
  type LocalDraft,
  pickLocal,
  pickSynced,
  type SyncedDraft,
} from '../lib/settingsDraft'
import { groupByTab, searchSettings } from '../lib/settingsSearch'
import { SETTINGS_SEARCH_INDEX } from '../lib/settingsSearchIndex'
import {
  SETTINGS_TAB_GROUPS,
  SETTINGS_TAB_ICONS,
  SETTINGS_TABS,
  type SettingsTab,
} from '../lib/settingsTabs'
import { FieldsEditor } from './FieldsEditor'
import { ModalShell } from './ModalShell'
import { AdvancedTab } from './settings/AdvancedTab'
import { ArtworkTab } from './settings/ArtworkTab'
import { ConversionTab } from './settings/ConversionTab'
import { CuesTab } from './settings/CuesTab'
import { DestinationTab } from './settings/DestinationTab'
import { EditorTab } from './settings/EditorTab'
import { GeneralTab } from './settings/GeneralTab'
import { LayoutTab } from './settings/LayoutTab'
import { NamingTab } from './settings/NamingTab'
import { ProcessingTab } from './settings/ProcessingTab'
import { SearchTab } from './settings/SearchTab'
import {
  SETTINGS_SEARCH_LISTBOX_ID,
  SettingsSearchResults,
  settingsSearchOptionId,
} from './settings/SettingsSearchResults'
import { ShortcutsTab } from './settings/ShortcutsTab'
import { StatsTab } from './settings/StatsTab'

export { DONATE_URL }

const SAVE_DELAY_MS = 300
const SEARCH_HIT_MS = 1500

interface Props {
  settings: Settings
  onClose: () => void
  onSave: (patch: Partial<Settings>) => void
  onPreviewTheme: (theme: ThemePref) => void
  // Moving the settings folder applies immediately and may adopt another machine's
  // prefs, so the app's settings state is replaced outside the Save flow.
  onSettingsReplaced: (next: Settings) => void
  initialTab?: SettingsTab
  playlistLibraries?: PlaylistLibrary[]
}

export function SettingsModal({
  settings,
  onClose,
  onSave,
  onPreviewTheme,
  onSettingsReplaced,
  initialTab,
  playlistLibraries,
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
  // The active tab's pill is one element that TRAVELS between rows — the vertical
  // sibling of the segmented control's sliding relief, so the two switch patterns in
  // the app tell the same story. Measured before paint so opening the modal shows the
  // pill already in place; the ResizeObserver re-measures when the sidebar's labels
  // change width under it (language switch, late font).
  const tablistRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const list = tablistRef.current
    const measure = (): void => {
      const btn = tabRefs.current[tab]
      if (btn) setPill({ top: btn.offsetTop, height: btn.offsetHeight })
    }
    measure()
    if (!list || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(list)
    return () => ro.disconnect()
  }, [tab])
  // The pill already says which tab is active, so the opening focus lands there without
  // the ring, as macOS Settings opens; the ring comes back on the first arrow key. A layout
  // effect so it runs before ModalShell's focus trap, which would focus the tab plainly.
  useLayoutEffect(() => {
    tablistRef.current
      ?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]')
      ?.focus({ focusVisible: false })
  }, [])
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const results = groupByTab(searchSettings(query, SETTINGS_SEARCH_INDEX, tr))
  const flatResults = results.flatMap((g) => g.hits)
  const searching = query.trim() !== ''
  const selectedHit = searching ? flatResults[selected] : undefined
  const selectedTab = selectedHit?.entry.tab
  const selectedId = selectedHit?.entry.id
  const selectedAnchor = selectedHit && (selectedHit.entry.anchor ?? selectedHit.entry.id)
  useEffect(() => {
    if (selectedTab) setTab(selectedTab)
  }, [selectedTab])
  useEffect(() => {
    const panel = bodyRef.current
    if (!panel || !selectedAnchor || selectedTab !== tab) return
    if (selectedId === `tabs.${tab}`) {
      panel.scrollTop = 0
      return
    }
    const anchor = panel.querySelector<HTMLElement>(`[data-search-id="${selectedAnchor}"]`)
    if (!anchor) return
    anchor.scrollIntoView({ block: 'center' })
    anchor.dataset.searchHit = 'true'
    const timer = setTimeout(() => delete anchor.dataset.searchHit, SEARCH_HIT_MS)
    return () => {
      clearTimeout(timer)
      delete anchor.dataset.searchHit
    }
  }, [tab, selectedTab, selectedId, selectedAnchor, bodyRef])
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape' && query !== '') {
      e.preventDefault()
      setQuery('')
      return
    }
    if (!searching) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const last = flatResults.length - 1
      setSelected((i) => Math.max(0, Math.min(last, i + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter' && selectedAnchor) {
      e.preventDefault()
      const scope =
        selectedId === `tabs.${tab}`
          ? bodyRef.current
          : bodyRef.current?.querySelector(`[data-search-id="${selectedAnchor}"]`)
      scope?.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]')?.focus()
    }
  }
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
  const draft = useRef({ synced, local })
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTo = useRef(onSave)
  saveTo.current = onSave
  const flushSave = useRef(() => {
    if (pendingSave.current === null) return
    clearTimeout(pendingSave.current)
    pendingSave.current = null
    const { synced, local } = draft.current
    const next = buildSettingsPatch(synced, local)
    if (findConflicts(resolveBindings(synced.shortcutOverrides)).length > 0) {
      delete next.shortcutOverrides
    }
    saveTo.current(next)
  }).current
  useEffect(() => flushSave, [flushSave])
  function edit(next: { synced: SyncedDraft; local: LocalDraft }): void {
    draft.current = next
    setSynced(next.synced)
    setLocal(next.local)
    if (pendingSave.current !== null) clearTimeout(pendingSave.current)
    pendingSave.current = setTimeout(flushSave, SAVE_DELAY_MS)
  }
  function reseed(next: Settings): void {
    draft.current = { ...draft.current, synced: pickSynced(next) }
    setSynced(draft.current.synced)
  }
  function patch<K extends keyof SyncedDraft>(key: K, value: SyncedDraft[K]): void {
    edit({ ...draft.current, synced: { ...draft.current.synced, [key]: value } })
  }
  function patchLocal<K extends keyof typeof local>(key: K, value: (typeof local)[K]): void {
    edit({ ...draft.current, local: { ...draft.current.local, [key]: value } })
  }
  function close(): void {
    flushSave()
    onClose()
  }

  async function changeTraktorNmlPath(): Promise<void> {
    const path = await window.api.pickTraktorNmlPath()
    if (path) patchLocal('traktorNmlPath', path)
  }

  // Autodetection only ever PROPOSES: the path varies by Traktor version and the
  // target user's real collection isn't even in the standard folder (his Documents
  // are in iCloud), so this never writes traktorNmlPath itself — only offers a
  // value the Traktor tab can show next to an "use this" action. Not proposed again once
  // a path is set, staged or saved: a returning user who picked one deliberately must not
  // see a stale proposal resurface.
  // With a path set, the proposal turns into the collection Traktor reads when it is not
  // that one (a Root Dir left on another version's folder): saved there, nothing would
  // ever reach Traktor.
  const [detectedNmlPath, setDetectedNmlPath] = useState<string | null>(null)
  useEffect(() => {
    if (local.traktorNmlPath) {
      window.api.traktorCollectionInUse(local.traktorNmlPath).then(setDetectedNmlPath)
      return
    }
    window.api.detectTraktorNmlPath().then(setDetectedNmlPath)
  }, [local.traktorNmlPath])

  function acceptDetectedNmlPath(): void {
    if (detectedNmlPath) patchLocal('traktorNmlPath', detectedNmlPath)
  }

  // rekordbox needs no proposal-and-accept dance: its collection is in one fixed place per
  // platform, so Settings only asks whether one is there — to enable the toggle and show
  // which file would be written to.
  const [rekordboxCollection, setRekordboxCollection] = useState('')
  useEffect(() => {
    window.api.rekordboxCollection().then(setRekordboxCollection)
  }, [])

  // Detected is not the same as fixed: a DJ whose collection lives outside the standard
  // location had no way to say so. The chosen path is staged like any other local setting
  // and shown straight away, so the field does not keep displaying the detected one.
  async function changeRekordboxDbPath(): Promise<void> {
    const path = await window.api.pickRekordboxDbPath()
    if (!path) return
    patchLocal('rekordboxDbPath', path)
    setRekordboxCollection(path)
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
    reseed(next)
    onPreviewTheme(next.theme)
  }

  async function changeConfigDir(): Promise<void> {
    const dir = await window.api.pickConfigDir()
    if (dir) await moveConfigDir(dir)
  }

  // Said beside the backup buttons, as ExportModal does: without it the click rejects
  // into the void and no file was written.
  const [settingsFileError, setSettingsFileError] = useState('')
  async function exportSettings(): Promise<void> {
    setSettingsFileError('')
    try {
      await window.api.exportSettings()
    } catch (e) {
      setSettingsFileError(
        tr('settings.exportFailed', { reason: mainErrorMessage(e, tr, String(e)) }),
      )
    }
  }

  async function importSettings(): Promise<void> {
    setSettingsFileError('')
    const result = await window.api.importSettings()
    if (!result) return
    if (!result.ok) {
      // main's reason is the JSON parser's English; the user needs to know only that this
      // file is not usable and nothing changed.
      setSettingsFileError(tr('settings.importFailed'))
      return
    }
    onSettingsReplaced(result.settings)
    reseed(result.settings)
    onPreviewTheme(result.settings.theme)
  }

  // Effective bindings shown in the Shortcuts tab, plus the clashes that block saving.
  const bindings = resolveBindings(synced.shortcutOverrides)
  const conflictIds = new Set(findConflicts(bindings).flat())

  return (
    <ModalShell
      onClose={close}
      backdropTestId="settings-backdrop"
      label={tr('header.settings')}
      align="top"
      className="flex h-[min(84vh,760px)] w-[780px] overflow-hidden rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)]"
    >
      {/* A vertical nav down the side reads like macOS System Settings and scales past the
          point a single centred row of ten tabs starts to crowd — every label gets its
          full width, and adding a tab costs a row, not horizontal space it doesn't have. */}
      <div className="flex w-[188px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-line)] bg-[var(--color-ink)] p-3">
        <label className="mb-2 flex h-8 shrink-0 items-center gap-2 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-2.5 focus-within:border-[var(--color-accent)]">
          <Search
            className="h-3.5 w-3.5 shrink-0 text-fg-faint"
            strokeWidth={2}
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            type="search"
            role="combobox"
            aria-expanded={searching}
            aria-controls={SETTINGS_SEARCH_LISTBOX_ID}
            aria-activedescendant={selectedId ? settingsSearchOptionId(selectedId) : undefined}
            data-testid="settings-search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={onSearchKeyDown}
            placeholder={tr('settings.searchField.placeholder')}
            aria-label={tr('settings.searchField.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none focus-visible:shadow-none placeholder:text-fg-faint"
          />
        </label>
        {searching && (
          <SettingsSearchResults
            query={query}
            groups={results}
            selected={selected}
            onSelect={setSelected}
          />
        )}
        <div
          ref={tablistRef}
          role="tablist"
          hidden={searching}
          aria-orientation="vertical"
          aria-label={tr('header.settings')}
          // relative z-0 fences a stacking context so the pill's -z-10 stays above this
          // column's own background instead of escaping behind it.
          className="relative z-0 flex flex-col gap-0.5"
        >
          {pill && (
            <div
              data-testid="settings-tab-indicator"
              aria-hidden="true"
              className="pointer-events-none absolute top-0 right-0 left-0 -z-10 rounded-lg bg-[var(--color-row-selected)] transition-[transform,height] duration-200 ease-[cubic-bezier(0.645,0.045,0.355,1)] motion-reduce:transition-none"
              style={{ transform: `translateY(${pill.top}px)`, height: pill.height }}
            />
          )}
          {SETTINGS_TAB_GROUPS.map((group) => (
            // A tablist may only own tabs, so the group wrapper and its heading are
            // presentational: the heading stays a visual divider and the arrows (and a
            // screen reader's tab count) walk one flat list.
            <div
              key={group.heading ?? 'main'}
              role="presentation"
              className="flex flex-col gap-0.5"
            >
              {group.heading && (
                <p
                  role="presentation"
                  className="mt-3 mb-1 px-3 text-[11px] font-medium text-fg-faint"
                >
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
                    // The button paints no background of its own — the sliding pill behind
                    // it does, in the same ink sidebar and selected-row fill as the track
                    // list, so Settings reads like the window it opens over. Text color
                    // shares the pill's 200ms so the two arrive together.
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-200 ${
                      tab === id
                        ? 'font-medium text-[var(--color-on-row-selected)]'
                        : 'text-fg-muted hover:text-fg'
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
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col p-6">
        <button
          type="button"
          data-testid="settings-close"
          aria-label={tr('common.close')}
          onClick={close}
          className="press absolute top-3 right-3 z-10 flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="relative flex min-h-[280px] flex-1 flex-col">
          <div
            ref={bodyRef}
            role="tabpanel"
            id="settings-tabpanel"
            aria-labelledby={`settings-tab-${tab}`}
            className="-mr-2 flex-1 overflow-x-hidden overflow-y-auto pr-2 [&_[data-search-hit=true]]:rounded-md [&_[data-search-hit=true]]:outline-1 [&_[data-search-hit=true]]:outline-offset-4 [&_[data-search-hit=true]]:outline-[var(--color-accent)] [&_[data-search-hit=true]]:outline-solid"
          >
            {tab === 'general' && (
              <GeneralTab
                synced={synced}
                patch={patch}
                local={local}
                patchLocal={patchLocal}
                onPreviewTheme={onPreviewTheme}
              />
            )}
            {tab === 'advanced' && (
              <AdvancedTab
                configDir={configDir}
                defaultDir={defaultDir}
                onChangeConfigDir={changeConfigDir}
                onResetConfigDir={() => moveConfigDir(null)}
                onExportSettings={exportSettings}
                onImportSettings={importSettings}
                settingsFileError={settingsFileError}
              />
            )}
            {tab === 'search' && (
              <SearchTab
                synced={synced}
                local={local}
                patch={patch}
                patchLocal={patchLocal}
                onBeatportChange={(next) => {
                  onSettingsReplaced(next)
                  patchLocal('beatportUsername', next.beatportUsername)
                }}
              />
            )}
            {tab === 'conversion' && <ConversionTab synced={synced} patch={patch} />}
            {tab === 'processing' && <ProcessingTab synced={synced} patch={patch} />}
            {tab === 'destination' && (
              <DestinationTab
                synced={synced}
                local={local}
                patch={patch}
                onOutputDirChange={(dir) => patchLocal('outputDir', dir)}
                onChangeEngineDir={(dir) => patchLocal('engineLibraryDir', dir)}
                onChangeTraktorNmlPath={changeTraktorNmlPath}
                rekordboxCollection={rekordboxCollection}
                onChangeRekordboxDbPath={() => void changeRekordboxDbPath()}
                detectedNmlPath={detectedNmlPath}
                onAcceptDetectedNmlPath={acceptDetectedNmlPath}
              />
            )}
            {tab === 'naming' && <NamingTab synced={synced} patch={patch} />}
            {tab === 'editor' && <EditorTab synced={synced} patch={patch} />}
            {tab === 'layout' && <LayoutTab synced={synced} patch={patch} />}
            {tab === 'artwork' && <ArtworkTab synced={synced} patch={patch} />}
            {tab === 'cues' && (
              <CuesTab synced={synced} patch={patch} rekordboxCollection={rekordboxCollection} />
            )}
            {tab === 'fields' && (
              <FieldsEditor
                visibleFields={synced.visibleFields}
                requiredFields={synced.requiredFields}
                importFields={synced.importFields}
                customFields={synced.customFields}
                onChangeVisible={(fields) => patch('visibleFields', fields)}
                onChangeRequired={(fields) => patch('requiredFields', fields)}
                onChangeImport={(fields) => patch('importFields', fields)}
                onChangeCustom={(fields) => patch('customFields', fields)}
                separators={{ genre: synced.genreSeparator, grouping: synced.groupingSeparator }}
                onChangeSeparator={(key, separator) =>
                  patch(key === 'genre' ? 'genreSeparator' : 'groupingSeparator', separator)
                }
                playlistLibraries={playlistLibraries}
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

        {conflictIds.size > 0 && tab !== 'shortcuts' && (
          <button
            type="button"
            data-testid="settings-shortcut-clash"
            onClick={() => setTab('shortcuts')}
            className="mt-4 shrink-0 self-start text-left text-xs text-warn underline-offset-2 hover:underline"
          >
            {tr('settings.shortcuts.conflictElsewhere')}
          </button>
        )}
      </div>
    </ModalShell>
  )
}
