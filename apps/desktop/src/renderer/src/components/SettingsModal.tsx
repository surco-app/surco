import {
  ChartColumn,
  Heart,
  Image,
  Keyboard,
  List,
  type LucideIcon,
  RefreshCw,
  Search,
  SlidersHorizontal,
  SquarePen,
  Tag,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { findConflicts, resolveBindings, SHORTCUT_DEFAULTS } from '../../../shared/shortcutDefaults'
import { chordEquals, eventToChord } from '../../../shared/shortcuts'
import { autoMatchAvailable } from '../../../shared/autoMatch'
import { DISCOGS_FORMATS } from '../../../shared/defaults'
import type {
  LanguagePref,
  OutputFormat,
  Settings,
  ThemePref,
  TrackMetadata,
} from '../../../shared/types'
import { DESTINATIONS, fromDestination, toDestination } from '../lib/destination'
import { DONATE_URL } from '../lib/donate'
import { FIELD_DEFS } from '../lib/fields'
import { insertToken } from '../lib/insertToken'
import { renderOutputName } from '../lib/outputName'
import { formatShortcut } from '../lib/shortcuts'
import { formatTimeSaved, MANUAL_SECONDS_PER_CONVERSION, timeSavedSeconds } from '../lib/stats'
import { DestinationPicker } from './DestinationPicker'
import { FieldsEditor } from './FieldsEditor'
import { ModalShell } from './ModalShell'
import { NormalizeControls } from './NormalizeControls'
import { SegmentedControl } from './SegmentedControl'
import { Tooltip } from './Tooltip'

export { DONATE_URL }

const THEMES: ThemePref[] = ['system', 'light', 'dark']
const LANGUAGES: LanguagePref[] = ['system', 'en', 'es']
const FORMATS: OutputFormat[] = ['aiff', 'mp3', 'wav', 'flac']

// A representative track so the filename preview shows real-looking output
// instead of empty braces, and every token has something to render.
const SAMPLE_META: TrackMetadata = {
  title: 'Take me into the sky',
  artist: 'Dj Vixent',
  album: 'Take me into the sky',
  albumArtist: 'Dj Vixent',
  year: '2026',
  genre: 'Hard Dance',
  grouping: 'Bases',
  comment: '',
  trackNumber: '03',
  discNumber: '1',
  bpm: '128',
  key: '8A',
  publisher: 'Surco',
  catalogNumber: 'SRC001',
  remixArtist: '',
}

// Apple Music automation only exists on macOS, so the toggle is meaningless on
// other platforms where a track simply finishes in the output folder.
const isMac = window.api.platform === 'darwin'

interface Props {
  settings: Settings
  onClose: () => void
  onSave: (patch: Partial<Settings>) => void
  onPreviewTheme: (theme: ThemePref) => void
  // Moving the settings folder applies immediately and may adopt another machine's
  // prefs, so the app's settings state is replaced outside the Save flow.
  onSettingsReplaced: (next: Settings) => void
  initialTab?: Tab
}

type Tab =
  | 'general'
  | 'search'
  | 'conversion'
  | 'naming'
  | 'editor'
  | 'artwork'
  | 'fields'
  | 'shortcuts'
  | 'stats'

// Ordered to mirror Meta's preferences flow: broad app settings, then what the
// editor shows, then artwork, then editing behavior. Stats trails last as the one
// read-only, informational tab.
// Ordered by workflow: app setup, then output, then per-track editing prefs, then results.
const TABS: Tab[] = [
  'general',
  'search',
  'conversion',
  'naming',
  'editor',
  'fields',
  'artwork',
  'shortcuts',
  'stats',
]

const TAB_ICONS: Record<Tab, LucideIcon> = {
  general: SlidersHorizontal,
  search: Search,
  conversion: RefreshCw,
  naming: Tag,
  editor: SquarePen,
  fields: List,
  artwork: Image,
  shortcuts: Keyboard,
  stats: ChartColumn,
}

// The catalog sources offered as search-provider checkboxes (Settings → Search).
const SEARCH_PROVIDERS: Settings['searchProviders'] = ['discogs', 'bandcamp']

// The synced staged fields in their editable forms (presets as comma text, the cover
// cap as a string), derived from Settings in one place so seeding and the config-dir
// re-seed can never disagree on the field list.
interface SyncedDraft {
  theme: Settings['theme']
  language: Settings['language']
  outputFormat: Settings['outputFormat']
  addToAppleMusic: boolean
  keepOutputCopy: boolean
  overwriteOriginal: boolean
  filenameFormat: string
  grouping: string
  genre: string
  trimWhitespace: boolean
  zeroPadTrack: boolean
  visibleFields: string[]
  requiredFields: string[]
  coverMaxSize: string
  coverSquare: boolean
  replaceLowResCover: boolean
  showSpectrum: boolean
  showLoudness: boolean
  keyNotation: Settings['keyNotation']
  normalize: Settings['normalize']
  shortcutOverrides: Settings['shortcutOverrides']
  discogsFormats: string[]
  searchProviders: Settings['searchProviders']
}

function pickSynced(s: Settings): SyncedDraft {
  return {
    theme: s.theme,
    language: s.language,
    outputFormat: s.outputFormat,
    discogsFormats: s.discogsFormats,
    searchProviders: s.searchProviders,
    addToAppleMusic: s.addToAppleMusic,
    keepOutputCopy: s.keepOutputCopy,
    overwriteOriginal: s.overwriteOriginal,
    filenameFormat: s.filenameFormat,
    grouping: s.groupingPresets.join(', '),
    genre: s.genrePresets.join(', '),
    trimWhitespace: s.trimWhitespace,
    zeroPadTrack: s.zeroPadTrack,
    visibleFields: s.visibleFields,
    requiredFields: s.requiredFields,
    coverMaxSize: String(s.coverMaxSize),
    coverSquare: s.coverSquare,
    replaceLowResCover: s.replaceLowResCover,
    showSpectrum: s.showSpectrum,
    showLoudness: s.showLoudness,
    keyNotation: s.keyNotation,
    normalize: s.normalize,
    shortcutOverrides: s.shortcutOverrides,
  }
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
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general')
  // Roving-tabindex navigation for the tablist: arrows (and Home/End) move the
  // selection and focus together, wrapping around, per the ARIA tabs pattern.
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})
  function onTabKeyDown(e: React.KeyboardEvent, idx: number): void {
    const last = TABS.length - 1
    let next = -1
    if (e.key === 'ArrowRight') next = idx === last ? 0 : idx + 1
    else if (e.key === 'ArrowLeft') next = idx === 0 ? last : idx - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    if (next === -1) return
    e.preventDefault()
    const id = TABS[next]
    setTab(id)
    tabRefs.current[id]?.focus()
  }
  // Every staged field lives in one of two objects instead of a useState per field, so
  // the three places that must agree on the field list (seeding, the config-dir
  // re-seed, and save) all read the same shape and can never drift apart.
  const [synced, setSynced] = useState<SyncedDraft>(() => pickSynced(settings))
  // Machine-local fields (local.token, output folder, auto-match) aren't moved by a
  // config-dir switch, so their staged edits survive one.
  const [local, setLocal] = useState(() => ({
    token: settings.discogsToken,
    outputDir: settings.outputDir,
    autoMatch: settings.autoMatch,
  }))
  function patch<K extends keyof SyncedDraft>(key: K, value: SyncedDraft[K]): void {
    setSynced((p) => ({ ...p, [key]: value }))
  }
  function patchLocal<K extends keyof typeof local>(key: K, value: (typeof local)[K]): void {
    setLocal((p) => ({ ...p, [key]: value }))
  }
  // The command whose next keystroke is being recorded, or null when idle.
  const [recording, setRecording] = useState<string | null>(null)
  const formatRef = useRef<HTMLInputElement>(null)

  // Drops the local.token where the caret last sat (or over the selection), then
  // restores focus and caret past it so the user can keep typing separators.
  function addToken(key: string): void {
    const el = formatRef.current
    const start = el?.selectionStart ?? synced.filenameFormat.length
    const end = el?.selectionEnd ?? synced.filenameFormat.length
    const { value, caret } = insertToken(synced.filenameFormat, start, end, key)
    patch('filenameFormat', value)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  async function changeDir(): Promise<void> {
    const dir = await window.api.pickOutputDir()
    if (dir) patchLocal('outputDir', dir)
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

  // FLAC can't go to Apple Music, so the destination is pinned to the output folder
  // while it's the format. Otherwise the two booleans map onto the single radio choice.
  const flacOnly = synced.outputFormat === 'flac'
  // The token and format filter only act on Discogs results, so they're grouped under a
  // Discogs heading and disabled when Discogs isn't a chosen source.
  const discogsOn = synced.searchProviders.includes('discogs')
  // Auto-match is a global search setting (it can apply Bandcamp matches too), gated only on
  // having a source — plus a Discogs token when Discogs is one of them.
  const autoReady = autoMatchAvailable({
    searchProviders: synced.searchProviders,
    discogsToken: local.token,
  })
  const destination = toDestination(
    synced.addToAppleMusic,
    synced.keepOutputCopy,
    flacOnly,
    synced.overwriteOriginal,
  )
  function chooseDestination(d: (typeof DESTINATIONS)[number]): void {
    const next = fromDestination(d)
    patch('addToAppleMusic', next.addToAppleMusic)
    patch('keepOutputCopy', next.keepOutputCopy)
    patch('overwriteOriginal', next.overwriteOriginal)
  }

  function save(): void {
    const { grouping, genre, coverMaxSize, filenameFormat, ...rest } = synced
    const max = parseInt(coverMaxSize, 10)
    onSave({
      ...rest,
      discogsToken: local.token.trim(),
      outputDir: local.outputDir,
      filenameFormat: synced.filenameFormat.trim() || '{artist} - {title}',
      groupingPresets: synced.grouping
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean),
      genrePresets: synced.genre
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean),
      coverMaxSize: Number.isFinite(max) && max >= 0 ? max : 1200,
      // Auto-match needs a local.token to run, so a local.token-less save can't leave it enabled.
      autoMatch: local.token.trim() !== '' && local.autoMatch,
    })
    onClose()
  }

  // Effective bindings shown in the Shortcuts tab, plus the clashes that block saving.
  const bindings = resolveBindings(synced.shortcutOverrides)
  const conflictIds = new Set(findConflicts(bindings).flat())

  // A command id is kebab-case ('find-replace'); its i18n title lives under the
  // camelCase key (commands.findReplace).
  const commandTitle = (id: string): string =>
    tr(`commands.${id.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())}`)

  // Records the next keystroke as the binding for `id`. A lone modifier press is ignored
  // (wait for the full chord), Escape cancels, and ⌘K stays reserved for the palette.
  function captureChord(id: string, e: React.KeyboardEvent): void {
    if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setRecording(null)
      return
    }
    const chord = eventToChord(e, isMac)
    if (!chord || chordEquals(chord, ['mod', 'k'])) return
    patch('shortcutOverrides', { ...synced.shortcutOverrides, [id]: chord })
    setRecording(null)
  }

  function resetRow(id: string): void {
    const rest = { ...synced.shortcutOverrides }
    delete rest[id]
    patch('shortcutOverrides', rest)
  }

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
          {TABS.map((id, idx) => {
            const Icon = TAB_ICONS[id]
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
          <>
            <span className="mb-1.5 block text-sm font-medium text-fg-muted">
              {tr('settings.theme')}
            </span>
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
                onClick={changeConfigDir}
                className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
              >
                {tr('common.change')}
              </button>
              {configDir && (
                <button
                  type="button"
                  data-testid="settings-config-dir-reset"
                  onClick={() => moveConfigDir(null)}
                  className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
                >
                  {tr('settings.configDirReset')}
                </button>
              )}
            </div>
            <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.configDirHint')}</p>
          </>
        )}

        {tab === 'search' && (
          <>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-dim">
              {tr('settings.searchProviders')}
            </p>
            <p className="mb-3 text-xs text-fg-dim">{tr('settings.searchProvidersHint')}</p>
            <div
              className="mb-6 flex flex-wrap gap-x-5 gap-y-2"
              data-testid="settings-search-providers"
            >
              {SEARCH_PROVIDERS.map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-2">
                  <input
                    data-testid={`settings-provider-${p}`}
                    type="checkbox"
                    checked={synced.searchProviders.includes(p)}
                    onChange={(e) =>
                      patch(
                        'searchProviders',
                        e.target.checked
                          ? [...synced.searchProviders, p]
                          : synced.searchProviders.filter((x) => x !== p),
                      )
                    }
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="text-sm">{tr(`settings.provider.${p}`)}</span>
                </label>
              ))}
            </div>

            <div className="mt-6 border-t border-[var(--color-line)] pt-5">
              <label
                className={`flex items-center gap-3 ${
                  autoReady ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                }`}
              >
                <input
                  data-testid="settings-auto-match"
                  type="checkbox"
                  checked={local.autoMatch && autoReady}
                  disabled={!autoReady}
                  onChange={(e) => patchLocal('autoMatch', e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                <span className="text-sm">{tr('settings.autoMatch')}</span>
              </label>
              <p className="mt-1.5 text-xs text-fg-dim">
                {synced.searchProviders.length === 0
                  ? tr('settings.autoMatchNeedsSource')
                  : autoReady
                    ? tr('settings.autoMatchHint')
                    : tr('settings.autoMatchNeedsToken')}
              </p>
            </div>

            <div className="mt-6 border-t border-[var(--color-line)] pt-5">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-dim">
                {tr('settings.discogsSection')}
              </p>
              {!discogsOn && (
                <p data-testid="settings-discogs-disabled" className="mb-4 text-xs text-fg-dim">
                  {tr('settings.discogsDisabledHint')}
                </p>
              )}
              <div className={discogsOn ? '' : 'opacity-50'}>
                <label
                  htmlFor="settings-token"
                  className="mb-1.5 block text-sm font-medium text-fg-muted"
                >
                  {tr('settings.discogsToken')}
                </label>
                <input
                  id="settings-token"
                  data-testid="settings-token"
                  value={local.token}
                  disabled={!discogsOn}
                  onChange={(e) => patchLocal('token', e.target.value)}
                  placeholder={tr('settings.tokenPlaceholder')}
                  className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] disabled:cursor-not-allowed"
                />
                <p className="mt-1.5 mb-5 text-xs text-fg-dim">
                  {tr('settings.tokenWhy')} {tr('settings.tokenHelp')}{' '}
                  <a
                    href="https://www.discogs.com/settings/developers"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-accent)] hover:underline"
                  >
                    discogs.com/settings/developers
                  </a>
                </p>

                <p className="mb-1.5 text-sm font-medium text-fg-muted">
                  {tr('settings.discogsFormats')}
                </p>
                <p className="mb-3 text-xs text-fg-dim">{tr('settings.discogsFormatsHint')}</p>
                <div
                  className="flex flex-wrap gap-x-5 gap-y-2"
                  data-testid="settings-discogs-formats"
                >
                  {DISCOGS_FORMATS.map((f) => (
                    <label
                      key={f}
                      className={`flex items-center gap-2 ${discogsOn ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                    >
                      <input
                        data-testid={`settings-format-${f}`}
                        type="checkbox"
                        checked={synced.discogsFormats.includes(f)}
                        disabled={!discogsOn}
                        onChange={(e) =>
                          patch(
                            'discogsFormats',
                            e.target.checked
                              ? [...synced.discogsFormats, f]
                              : synced.discogsFormats.filter((x) => x !== f),
                          )
                        }
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                      <span className="text-sm">{tr(`settings.format.${f}`)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'conversion' && (
          <>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-dim">
              {tr('settings.outputSection')}
            </p>

            <label
              htmlFor="settings-output"
              className="mb-1.5 block text-sm font-medium text-fg-muted"
            >
              {tr('settings.outputDir')}
            </label>
            <div className="mb-5 flex gap-2">
              <input
                id="settings-output"
                data-testid="settings-output"
                value={local.outputDir}
                readOnly
                className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg-muted"
              />
              <button
                type="button"
                onClick={changeDir}
                className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
              >
                {tr('common.change')}
              </button>
            </div>

            <span className="mb-1.5 block text-sm font-medium text-fg-muted">
              {tr('settings.outputFormat')}
            </span>
            <SegmentedControl
              options={FORMATS}
              value={synced.outputFormat}
              onChange={(id) => patch('outputFormat', id)}
              testidPrefix="settings-format"
              labelFor={(id) => tr(`settings.formats.${id}`)}
            />
            <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.outputFormatHint')}</p>

            <span className="mb-1.5 block text-sm font-medium text-fg-muted">
              {tr('settings.destination')}
            </span>
            <DestinationPicker
              destinations={DESTINATIONS.filter(
                (d) => isMac || (d !== 'appleMusic' && d !== 'both'),
              )}
              value={destination}
              onChange={chooseDestination}
              flacOnly={flacOnly}
              testidPrefix="settings-destination"
              radioName="destination"
            />
            {isMac && flacOnly && (
              <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.appleMusicFlacNote')}</p>
            )}

            <p className="mt-5 mb-1.5 border-t border-[var(--color-line)] pt-5 text-sm font-medium text-fg-muted">
              {tr('normalize.title')}
            </p>
            <p className="mb-3 text-xs text-fg-dim">{tr('normalize.hint')}</p>
            <NormalizeControls value={synced.normalize} onChange={(n) => patch('normalize', n)} />
          </>
        )}

        {tab === 'naming' && (
          <>
            <label
              htmlFor="settings-filename-format"
              className="mb-1.5 block text-sm font-medium text-fg-muted"
            >
              {tr('settings.filenameFormat')}
            </label>
            <input
              ref={formatRef}
              id="settings-filename-format"
              data-testid="settings-filename-format"
              value={synced.filenameFormat}
              onChange={(e) => patch('filenameFormat', e.target.value)}
              placeholder="{artist} - {title}"
              className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <p className="mt-2 text-xs text-fg-dim">
              {tr('settings.filenameFolderHint')}{' '}
              <span className="font-mono text-fg-muted">
                {'{discogsReleaseId}/{artist} - {title}'}
              </span>
            </p>
            <p className="mt-2.5 mb-1.5 text-xs text-fg-dim">{tr('settings.insertToken')}</p>
            <div className="flex flex-wrap gap-1.5">
              {FIELD_DEFS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  data-testid={`settings-token-${f.key}`}
                  onClick={() => addToken(f.key)}
                  className="press rounded-full border border-[var(--color-line-strong)] px-2.5 py-0.5 text-[11px] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
                >
                  {tr(`fields.${f.key}`)}
                  <Tooltip label={`{${f.key}}`} />
                </button>
              ))}
            </div>
            <p className="mt-3 mb-5 text-xs text-fg-dim">
              {tr('settings.preview')}{' '}
              <span data-testid="settings-format-preview" className="font-mono text-fg-muted">
                {renderOutputName(synced.filenameFormat, SAMPLE_META) || '—'}.{synced.outputFormat}
              </span>
            </p>

            <div className="space-y-3 border-t border-[var(--color-line)] pt-5">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  data-testid="settings-trim"
                  type="checkbox"
                  checked={synced.trimWhitespace}
                  onChange={(e) => patch('trimWhitespace', e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                <span className="text-sm">{tr('settings.trimWhitespace')}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  data-testid="settings-zeropad"
                  type="checkbox"
                  checked={synced.zeroPadTrack}
                  onChange={(e) => patch('zeroPadTrack', e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                <span className="text-sm">{tr('settings.zeroPadTrack')}</span>
              </label>
            </div>
          </>
        )}

        {tab === 'editor' && (
          <>
            <label
              htmlFor="settings-grouping"
              className="mb-1.5 block text-sm font-medium text-fg-muted"
            >
              {tr('settings.grouping')}
            </label>
            <input
              id="settings-grouping"
              data-testid="settings-grouping"
              value={synced.grouping}
              onChange={(e) => patch('grouping', e.target.value)}
              placeholder={tr('settings.groupingPlaceholder')}
              className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.groupingHint')}</p>

            <label
              htmlFor="settings-genre"
              className="mb-1.5 block text-sm font-medium text-fg-muted"
            >
              {tr('settings.genre')}
            </label>
            <input
              id="settings-genre"
              data-testid="settings-genre"
              value={synced.genre}
              onChange={(e) => patch('genre', e.target.value)}
              placeholder="Hard Dance, Techno"
              className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.genreHint')}</p>

            <div className="space-y-3 border-t border-[var(--color-line)] pt-5">
              <div>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    data-testid="settings-show-spectrum"
                    type="checkbox"
                    checked={synced.showSpectrum}
                    onChange={(e) => patch('showSpectrum', e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="text-sm">{tr('settings.showSpectrum')}</span>
                </label>
                <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.showSpectrumHint')}</p>
              </div>
              <div>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    data-testid="settings-show-loudness"
                    type="checkbox"
                    checked={synced.showLoudness}
                    onChange={(e) => patch('showLoudness', e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="text-sm">{tr('settings.showLoudness')}</span>
                </label>
                <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.showLoudnessHint')}</p>
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-medium text-fg-muted">
                  {tr('settings.keyNotation')}
                </span>
                <SegmentedControl
                  options={['camelot', 'musical'] as const}
                  value={synced.keyNotation}
                  onChange={(id) => patch('keyNotation', id)}
                  testidPrefix="settings-key-notation"
                  labelFor={(id) => tr(`settings.keyNotations.${id}`)}
                />
                <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.keyNotationHint')}</p>
              </div>
            </div>
          </>
        )}

        {tab === 'artwork' && (
          <>
            <label
              htmlFor="settings-cover-max"
              className="mb-1.5 block text-sm font-medium text-fg-muted"
            >
              {tr('settings.coverMaxSize')}
            </label>
            <div className="mb-5 flex items-center gap-2">
              <input
                id="settings-cover-max"
                data-testid="settings-cover-max"
                type="number"
                min={0}
                value={synced.coverMaxSize}
                onChange={(e) => patch('coverMaxSize', e.target.value)}
                // An invalid cap (blank, negative, garbage) used to save silently
                // as the default; clamping on blur shows the figure in effect.
                onBlur={() => {
                  const max = parseInt(synced.coverMaxSize, 10)
                  if (!Number.isFinite(max) || max < 0) patch('coverMaxSize', '1200')
                }}
                className="w-28 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <span className="text-sm text-fg-dim">{tr('settings.coverMaxHint')}</span>
            </div>

            <label className="flex cursor-pointer items-center gap-3">
              <input
                data-testid="settings-cover-square"
                type="checkbox"
                checked={synced.coverSquare}
                onChange={(e) => patch('coverSquare', e.target.checked)}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              <span className="text-sm">{tr('settings.coverSquare')}</span>
            </label>
            <p className="mt-3 text-xs text-fg-dim">{tr('settings.coverHint')}</p>

            <label className="mt-5 flex cursor-pointer items-center gap-3">
              <input
                data-testid="settings-replace-lowres"
                type="checkbox"
                checked={synced.replaceLowResCover}
                onChange={(e) => patch('replaceLowResCover', e.target.checked)}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              <span className="text-sm">{tr('settings.replaceLowRes')}</span>
            </label>
            <p className="mt-3 text-xs text-fg-dim">{tr('settings.replaceLowResHint')}</p>
          </>
        )}

        {tab === 'fields' && (
          <FieldsEditor
            visibleFields={synced.visibleFields}
            requiredFields={synced.requiredFields}
            onChangeVisible={(fields) => patch('visibleFields', fields)}
            onChangeRequired={(fields) => patch('requiredFields', fields)}
          />
        )}

        {tab === 'shortcuts' && (
          <div className="min-h-[280px]">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-fg-dim">{tr('settings.shortcuts.intro')}</p>
              <button
                type="button"
                data-testid="shortcuts-reset-all"
                onClick={() => patch('shortcutOverrides', {})}
                className="press shrink-0 text-xs text-fg-muted hover:text-fg"
              >
                {tr('settings.shortcuts.resetAll')}
              </button>
            </div>
            <div>
              {SHORTCUT_DEFAULTS.map((def) => {
                const chord = bindings.get(def.id) ?? []
                const overridden = def.id in synced.shortcutOverrides
                const isRecording = recording === def.id
                return (
                  <div
                    key={def.id}
                    data-testid={`shortcut-row-${def.id}`}
                    className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] py-2 last:border-b-0"
                  >
                    <span className="text-sm text-fg">{commandTitle(def.id)}</span>
                    <div className="flex items-center gap-2">
                      {overridden && (
                        <button
                          type="button"
                          data-testid={`shortcut-reset-${def.id}`}
                          onClick={() => resetRow(def.id)}
                          className="press text-sm text-fg-faint hover:text-fg"
                        >
                          ↺
                          <Tooltip label={tr('settings.shortcuts.reset')} />
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid={`shortcut-record-${def.id}`}
                        onClick={() => setRecording(isRecording ? null : def.id)}
                        onKeyDown={isRecording ? (e) => captureChord(def.id, e) : undefined}
                        onBlur={() => isRecording && setRecording(null)}
                        aria-pressed={isRecording}
                        className={`press min-w-[6rem] rounded-md border px-2.5 py-1 text-center font-mono text-xs ${
                          isRecording
                            ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                            : conflictIds.has(def.id)
                              ? 'border-danger text-danger'
                              : 'border-[var(--color-line-strong)] text-fg-muted hover:text-fg'
                        }`}
                      >
                        {isRecording
                          ? tr('settings.shortcuts.recording')
                          : chord.length
                            ? formatShortcut(chord, isMac)
                            : tr('settings.shortcuts.unbound')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            {conflictIds.size > 0 && (
              <p data-testid="shortcuts-conflict" className="mt-3 text-xs text-danger">
                {tr('settings.shortcuts.conflict')}
              </p>
            )}
          </div>
        )}

        {tab === 'stats' && (
          <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
            {settings.conversionCount > 0 ? (
              <>
                <p
                  data-testid="stats-count"
                  className="text-6xl font-semibold tabular-nums text-fg"
                >
                  {settings.conversionCount}
                </p>
                <p className="mt-1 text-sm text-fg-muted">{tr('settings.stats.count')}</p>
                <p data-testid="stats-time-saved" className="mt-7 text-lg text-fg">
                  {tr('settings.stats.timeSaved', {
                    time: formatTimeSaved(timeSavedSeconds(settings.conversionCount)),
                  })}
                </p>
                <p className="mt-1 text-xs text-fg-dim">
                  {tr('settings.stats.perTrack', {
                    minutes: MANUAL_SECONDS_PER_CONVERSION / 60,
                  })}
                </p>
              </>
            ) : (
              <p data-testid="stats-empty" className="max-w-xs text-sm text-fg-muted">
                {tr('settings.stats.empty')}
              </p>
            )}
            <p className="mt-8 text-sm text-fg-muted">{tr('settings.stats.donate')}</p>
            <a
              data-testid="stats-donate"
              href={DONATE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="press mt-3 inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
            >
              <Heart size={14} />
              {tr('settings.stats.donateCta')}
            </a>
          </div>
        )}
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
