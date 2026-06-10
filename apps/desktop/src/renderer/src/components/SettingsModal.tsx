import {
  ChartColumn,
  Heart,
  Image,
  Keyboard,
  List,
  type LucideIcon,
  RefreshCw,
  SlidersHorizontal,
  SquarePen,
  Tag,
} from 'lucide-react'
import type React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { findConflicts, resolveBindings, SHORTCUT_DEFAULTS } from '../../../shared/shortcutDefaults'
import { chordEquals, eventToChord } from '../../../shared/shortcuts'
import type { OutputFormat, Settings, ThemePref, TrackMetadata } from '../../../shared/types'
import { FieldsEditor } from './FieldsEditor'
import { DESTINATIONS, fromDestination, toDestination } from '../lib/destination'
import { FIELD_DEFS } from '../lib/fields'
import { insertToken } from '../lib/insertToken'
import { renderOutputName } from '../lib/outputName'
import { formatShortcut } from '../lib/shortcuts'
import { formatTimeSaved, MANUAL_SECONDS_PER_CONVERSION, timeSavedSeconds } from '../lib/stats'
import { NormalizeControls } from './NormalizeControls'
import { Tooltip } from './Tooltip'
import { useFocusTrap } from './useFocusTrap'

// PayPal hosted donate button (no backend needed); target=_blank routes through
// the window-open handler, which hands the URL to the system browser.
export const DONATE_URL = 'https://www.paypal.com/donate/?hosted_button_id=2WXQ5XRQTPA5S'

const THEMES: ThemePref[] = ['system', 'light', 'dark']
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
  initialTab?: Tab
}

type Tab =
  | 'general'
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
  conversion: RefreshCw,
  naming: Tag,
  editor: SquarePen,
  fields: List,
  artwork: Image,
  shortcuts: Keyboard,
  stats: ChartColumn,
}

export function SettingsModal({
  settings,
  onClose,
  onSave,
  onPreviewTheme,
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
  const [theme, setTheme] = useState(settings.theme)
  const [token, setToken] = useState(settings.discogsToken)
  const [outputDir, setOutputDir] = useState(settings.outputDir)
  const [outputFormat, setOutputFormat] = useState(settings.outputFormat)
  const [addToAppleMusic, setAddToAppleMusic] = useState(settings.addToAppleMusic)
  const [keepOutputCopy, setKeepOutputCopy] = useState(settings.keepOutputCopy)
  const [overwriteOriginal, setOverwriteOriginal] = useState(settings.overwriteOriginal)
  const [filenameFormat, setFilenameFormat] = useState(settings.filenameFormat)
  const [grouping, setGrouping] = useState(settings.groupingPresets.join(', '))
  const [genre, setGenre] = useState(settings.genrePresets.join(', '))
  const [trimWhitespace, setTrimWhitespace] = useState(settings.trimWhitespace)
  const [zeroPadTrack, setZeroPadTrack] = useState(settings.zeroPadTrack)
  const [visibleFields, setVisibleFields] = useState(settings.visibleFields)
  const [requiredFields, setRequiredFields] = useState(settings.requiredFields)
  const [coverMaxSize, setCoverMaxSize] = useState(String(settings.coverMaxSize))
  const [coverSquare, setCoverSquare] = useState(settings.coverSquare)
  const [showSpectrum, setShowSpectrum] = useState(settings.showSpectrum)
  const [autoMatch, setAutoMatch] = useState(settings.autoMatch)
  const [showLoudness, setShowLoudness] = useState(settings.showLoudness)
  const [keyNotation, setKeyNotation] = useState(settings.keyNotation)
  const [normalize, setNormalize] = useState(settings.normalize)
  const [shortcutOverrides, setShortcutOverrides] = useState(settings.shortcutOverrides)
  // The command whose next keystroke is being recorded, or null when idle.
  const [recording, setRecording] = useState<string | null>(null)
  const formatRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)

  // Drops the token where the caret last sat (or over the selection), then
  // restores focus and caret past it so the user can keep typing separators.
  function addToken(key: string): void {
    const el = formatRef.current
    const start = el?.selectionStart ?? filenameFormat.length
    const end = el?.selectionEnd ?? filenameFormat.length
    const { value, caret } = insertToken(filenameFormat, start, end, key)
    setFilenameFormat(value)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  async function changeDir(): Promise<void> {
    const dir = await window.api.pickOutputDir()
    if (dir) setOutputDir(dir)
  }

  // FLAC can't go to Apple Music, so the destination is pinned to the output folder
  // while it's the format. Otherwise the two booleans map onto the single radio choice.
  const flacOnly = outputFormat === 'flac'
  const destination = toDestination(addToAppleMusic, keepOutputCopy, flacOnly, overwriteOriginal)
  function chooseDestination(d: (typeof DESTINATIONS)[number]): void {
    const next = fromDestination(d)
    setAddToAppleMusic(next.addToAppleMusic)
    setKeepOutputCopy(next.keepOutputCopy)
    setOverwriteOriginal(next.overwriteOriginal)
  }

  function save(): void {
    const groupingPresets = grouping
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)
    const genrePresets = genre
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)
    const max = parseInt(coverMaxSize, 10)
    onSave({
      theme,
      discogsToken: token.trim(),
      outputDir,
      outputFormat,
      addToAppleMusic,
      keepOutputCopy,
      overwriteOriginal,
      filenameFormat: filenameFormat.trim() || '{artist} - {title}',
      groupingPresets,
      genrePresets,
      trimWhitespace,
      zeroPadTrack,
      visibleFields,
      requiredFields,
      coverMaxSize: Number.isFinite(max) && max >= 0 ? max : 1200,
      coverSquare,
      showSpectrum,
      // Auto-match needs a token to run, so a token-less save can't leave it enabled.
      autoMatch: token.trim() !== '' && autoMatch,
      showLoudness,
      keyNotation,
      normalize,
      shortcutOverrides,
    })
    onClose()
  }

  // Effective bindings shown in the Shortcuts tab, plus the clashes that block saving.
  const bindings = resolveBindings(shortcutOverrides)
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
    setShortcutOverrides({ ...shortcutOverrides, [id]: chord })
    setRecording(null)
  }

  function resetRow(id: string): void {
    const rest = { ...shortcutOverrides }
    delete rest[id]
    setShortcutOverrides(rest)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh]">
      <button
        type="button"
        data-testid="settings-backdrop"
        aria-label={tr('common.close')}
        onClick={onClose}
        className="animate-overlay absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={tr('header.settings')}
        className="animate-pop relative z-10 flex max-h-[84vh] w-[560px] flex-col rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
      >
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <div className="-mx-6 -mt-6 mb-5 shrink-0 border-b border-[var(--color-line)] px-4 pt-5 pb-3">
            <div
              role="tablist"
              aria-label={tr('header.settings')}
              className="flex justify-center gap-0.5"
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
                <div className="mb-5 inline-flex gap-1 rounded-lg bg-[var(--color-field)] p-1">
                  {THEMES.map((id) => (
                    <button
                      key={id}
                      type="button"
                      data-testid={`settings-theme-${id}`}
                      aria-pressed={theme === id}
                      onClick={() => {
                        setTheme(id)
                        onPreviewTheme(id)
                      }}
                      className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                        theme === id
                          ? 'bg-[var(--color-panel-2)] text-fg'
                          : 'text-fg-muted hover:text-fg'
                      }`}
                    >
                      {tr(`settings.themes.${id}`)}
                    </button>
                  ))}
                </div>

                <label
                  htmlFor="settings-token"
                  className="mb-1.5 block text-sm font-medium text-fg-muted"
                >
                  {tr('settings.discogsToken')}
                </label>
                <input
                  id="settings-token"
                  data-testid="settings-token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={tr('settings.tokenPlaceholder')}
                  className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                />
                <p className="mt-1.5 mb-5 text-xs text-fg-dim">
                  {tr('settings.tokenHelp')}{' '}
                  <a
                    href="https://www.discogs.com/settings/developers"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-accent)] hover:underline"
                  >
                    discogs.com/settings/developers
                  </a>
                </p>

                <div className="border-t border-[var(--color-line)] pt-5">
                  <label
                    className={`flex items-center gap-3 ${
                      token.trim() ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                    }`}
                  >
                    <input
                      data-testid="settings-auto-match"
                      type="checkbox"
                      checked={autoMatch && token.trim() !== ''}
                      disabled={token.trim() === ''}
                      onChange={(e) => setAutoMatch(e.target.checked)}
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                    <span className="text-sm">{tr('settings.autoMatch')}</span>
                  </label>
                  <p className="mt-1.5 text-xs text-fg-dim">
                    {token.trim()
                      ? tr('settings.autoMatchHint')
                      : tr('settings.autoMatchNeedsToken')}
                  </p>
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
                    value={outputDir}
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
                <div className="inline-flex gap-1 rounded-lg bg-[var(--color-field)] p-1">
                  {FORMATS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      data-testid={`settings-format-${id}`}
                      aria-pressed={outputFormat === id}
                      onClick={() => setOutputFormat(id)}
                      className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                        outputFormat === id
                          ? 'bg-[var(--color-panel-2)] text-fg'
                          : 'text-fg-muted hover:text-fg'
                      }`}
                    >
                      {tr(`settings.formats.${id}`)}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.outputFormatHint')}</p>

                <span className="mb-1.5 block text-sm font-medium text-fg-muted">
                  {tr('settings.destination')}
                </span>
                <div
                  role="radiogroup"
                  aria-label={tr('settings.destination')}
                  className="flex flex-col gap-2"
                >
                  {DESTINATIONS.map((d) => {
                    // Apple Music destinations only exist on macOS; folder and overwrite
                    // are platform-independent and always offered.
                    if (!isMac && (d === 'appleMusic' || d === 'both')) return null
                    // FLAC pins only the Apple Music options to the folder; overwrite
                    // rewrites the source in place and is valid for any format.
                    const disabled = flacOnly && (d === 'appleMusic' || d === 'both')
                    return (
                      <label
                        key={d}
                        className={`flex items-start gap-3 ${
                          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                        }`}
                      >
                        <input
                          data-testid={`settings-destination-${d}`}
                          type="radio"
                          name="destination"
                          checked={destination === d}
                          disabled={disabled}
                          onChange={() => chooseDestination(d)}
                          className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                        />
                        <span className="text-sm">
                          {tr(`settings.destinations.${d}`)}
                          {d === 'appleMusic' && (
                            <span className="block text-xs text-fg-dim">
                              {tr('settings.destinationAppleMusicHint')}
                            </span>
                          )}
                          {d === 'overwrite' && (
                            <span className="block text-xs text-fg-dim">
                              {tr('settings.destinationOverwriteHint')}
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>
                {isMac && flacOnly && (
                  <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.appleMusicFlacNote')}</p>
                )}

                <p className="mt-5 mb-1.5 border-t border-[var(--color-line)] pt-5 text-sm font-medium text-fg-muted">
                  {tr('normalize.title')}
                </p>
                <p className="mb-3 text-xs text-fg-dim">{tr('normalize.hint')}</p>
                <NormalizeControls value={normalize} onChange={setNormalize} />
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
                  value={filenameFormat}
                  onChange={(e) => setFilenameFormat(e.target.value)}
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
                    {renderOutputName(filenameFormat, SAMPLE_META) || '—'}.{outputFormat}
                  </span>
                </p>

                <div className="space-y-3 border-t border-[var(--color-line)] pt-5">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      data-testid="settings-trim"
                      type="checkbox"
                      checked={trimWhitespace}
                      onChange={(e) => setTrimWhitespace(e.target.checked)}
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                    <span className="text-sm">{tr('settings.trimWhitespace')}</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      data-testid="settings-zeropad"
                      type="checkbox"
                      checked={zeroPadTrack}
                      onChange={(e) => setZeroPadTrack(e.target.checked)}
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
                  value={grouping}
                  onChange={(e) => setGrouping(e.target.value)}
                  placeholder="Bases, Cantaditas"
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
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
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
                        checked={showSpectrum}
                        onChange={(e) => setShowSpectrum(e.target.checked)}
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
                        checked={showLoudness}
                        onChange={(e) => setShowLoudness(e.target.checked)}
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
                    <div className="inline-flex gap-1 rounded-lg bg-[var(--color-field)] p-1">
                      {(['camelot', 'musical'] as const).map((id) => (
                        <button
                          key={id}
                          type="button"
                          data-testid={`settings-key-notation-${id}`}
                          aria-pressed={keyNotation === id}
                          onClick={() => setKeyNotation(id)}
                          className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                            keyNotation === id
                              ? 'bg-[var(--color-panel-2)] text-fg'
                              : 'text-fg-muted hover:text-fg'
                          }`}
                        >
                          {tr(`settings.keyNotations.${id}`)}
                        </button>
                      ))}
                    </div>
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
                    value={coverMaxSize}
                    onChange={(e) => setCoverMaxSize(e.target.value)}
                    className="w-28 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                  <span className="text-sm text-fg-dim">{tr('settings.coverMaxHint')}</span>
                </div>

                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    data-testid="settings-cover-square"
                    type="checkbox"
                    checked={coverSquare}
                    onChange={(e) => setCoverSquare(e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="text-sm">{tr('settings.coverSquare')}</span>
                </label>
                <p className="mt-3 text-xs text-fg-dim">{tr('settings.coverHint')}</p>
              </>
            )}

            {tab === 'fields' && (
              <FieldsEditor
                visibleFields={visibleFields}
                requiredFields={requiredFields}
                onChangeVisible={setVisibleFields}
                onChangeRequired={setRequiredFields}
              />
            )}

            {tab === 'shortcuts' && (
              <div className="min-h-[280px]">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs text-fg-dim">{tr('settings.shortcuts.intro')}</p>
                  <button
                    type="button"
                    data-testid="shortcuts-reset-all"
                    onClick={() => setShortcutOverrides({})}
                    className="press shrink-0 text-xs text-fg-muted hover:text-fg"
                  >
                    {tr('settings.shortcuts.resetAll')}
                  </button>
                </div>
                <div>
                  {SHORTCUT_DEFAULTS.map((def) => {
                    const chord = bindings.get(def.id) ?? []
                    const overridden = def.id in shortcutOverrides
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
        </form>
      </div>
    </div>
  )
}
