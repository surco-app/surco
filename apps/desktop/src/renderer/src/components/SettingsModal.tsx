import type React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat, Settings, ThemePref, TrackMetadata } from '../../../shared/types'
import { FIELD_DEFS, moveItem } from '../lib/fields'
import { insertToken } from '../lib/insertToken'
import { renderOutputName } from '../lib/outputName'

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
}

type Tab = 'general' | 'naming' | 'artwork' | 'fields'

// Ordered to mirror Meta's preferences flow: broad app settings, then what the
// editor shows, then artwork, then editing behavior.
const TABS: Tab[] = ['general', 'fields', 'artwork', 'naming']

const TAB_ICONS: Record<Tab, React.JSX.Element> = {
  general: (
    <>
      <line x1="4" y1="8" x2="20" y2="8" />
      <circle cx="9" cy="8" r="2.4" fill="var(--color-panel)" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="15" cy="16" r="2.4" fill="var(--color-panel)" />
    </>
  ),
  fields: (
    <>
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </>
  ),
  artwork: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.6" />
      <path d="m21 15-5-5L5 21" />
    </>
  ),
  naming: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
}

export function SettingsModal({ settings, onClose, onSave }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [tab, setTab] = useState<Tab>('general')
  const [theme, setTheme] = useState(settings.theme)
  const [token, setToken] = useState(settings.discogsToken)
  const [outputDir, setOutputDir] = useState(settings.outputDir)
  const [outputFormat, setOutputFormat] = useState(settings.outputFormat)
  const [addToAppleMusic, setAddToAppleMusic] = useState(settings.addToAppleMusic)
  const [filenameFormat, setFilenameFormat] = useState(settings.filenameFormat)
  const [grouping, setGrouping] = useState(settings.groupingPresets.join(', '))
  const [trimWhitespace, setTrimWhitespace] = useState(settings.trimWhitespace)
  const [zeroPadTrack, setZeroPadTrack] = useState(settings.zeroPadTrack)
  const [visibleFields, setVisibleFields] = useState(settings.visibleFields)
  const [requiredFields, setRequiredFields] = useState(settings.requiredFields)
  const [coverMaxSize, setCoverMaxSize] = useState(String(settings.coverMaxSize))
  const [coverSquare, setCoverSquare] = useState(settings.coverSquare)
  const [showSpectrum, setShowSpectrum] = useState(settings.showSpectrum)
  const formatRef = useRef<HTMLInputElement>(null)

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

  function save(): void {
    const groupingPresets = grouping
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
      filenameFormat: filenameFormat.trim() || '{artist} - {title}',
      groupingPresets,
      trimWhitespace,
      zeroPadTrack,
      visibleFields,
      requiredFields,
      coverMaxSize: Number.isFinite(max) && max >= 0 ? max : 1200,
      coverSquare,
      showSpectrum,
    })
    onClose()
  }

  return (
    <div
      className="animate-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-pop w-[560px] rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="-mx-6 -mt-6 mb-5 border-b border-[var(--color-line)] px-4 pt-5 pb-3">
          <div className="flex justify-center gap-1">
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                data-testid={`settings-tab-${id}`}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={`flex w-[4.5rem] flex-col items-center gap-1.5 rounded-lg px-1 py-2 text-xs transition-colors ${
                  tab === id
                    ? 'bg-[var(--color-field)] text-[var(--color-accent)]'
                    : 'text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg'
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-6 w-6"
                >
                  {TAB_ICONS[id]}
                </svg>
                {tr(`settings.tabs.${id}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-[280px]">
          {tab === 'general' && (
            <>
              <label className="mb-1.5 block text-sm font-medium text-fg-muted">
                {tr('settings.theme')}
              </label>
              <div className="mb-5 inline-flex gap-1 rounded-lg bg-[var(--color-field)] p-1">
                {THEMES.map((id) => (
                  <button
                    key={id}
                    data-testid={`settings-theme-${id}`}
                    aria-pressed={theme === id}
                    onClick={() => setTheme(id)}
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

              <label className="mb-1.5 block text-sm font-medium text-fg-muted">
                {tr('settings.discogsToken')}
              </label>
              <input
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

              <label className="mb-1.5 block text-sm font-medium text-fg-muted">
                {tr('settings.outputDir')}
              </label>
              <div className="mb-5 flex gap-2">
                <input
                  data-testid="settings-output"
                  value={outputDir}
                  readOnly
                  className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg-muted"
                />
                <button
                  onClick={changeDir}
                  className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
                >
                  {tr('common.change')}
                </button>
              </div>

              <label className="mb-1.5 block text-sm font-medium text-fg-muted">
                {tr('settings.outputFormat')}
              </label>
              <div className="inline-flex gap-1 rounded-lg bg-[var(--color-field)] p-1">
                {FORMATS.map((id) => (
                  <button
                    key={id}
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

              {isMac && (
                <>
                  <label
                    className={`flex items-center gap-3 ${
                      outputFormat === 'flac' ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                    }`}
                  >
                    <input
                      data-testid="settings-applemusic"
                      type="checkbox"
                      checked={addToAppleMusic && outputFormat !== 'flac'}
                      disabled={outputFormat === 'flac'}
                      onChange={(e) => setAddToAppleMusic(e.target.checked)}
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                    <span className="text-sm">{tr('settings.addToAppleMusic')}</span>
                  </label>
                  {outputFormat === 'flac' && (
                    <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.appleMusicFlacNote')}</p>
                  )}
                </>
              )}

              <div className={`${isMac ? 'mt-5 border-t border-[var(--color-line)] pt-5' : ''}`}>
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
            </>
          )}

          {tab === 'naming' && (
            <>
              <label className="mb-1.5 block text-sm font-medium text-fg-muted">
                {tr('settings.filenameFormat')}
              </label>
              <input
                ref={formatRef}
                data-testid="settings-filename-format"
                value={filenameFormat}
                onChange={(e) => setFilenameFormat(e.target.value)}
                placeholder="{artist} - {title}"
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <p className="mt-2.5 mb-1.5 text-xs text-fg-dim">{tr('settings.insertToken')}</p>
              <div className="flex flex-wrap gap-1.5">
                {FIELD_DEFS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    data-testid={`settings-token-${f.key}`}
                    onClick={() => addToken(f.key)}
                    title={`{${f.key}}`}
                    className="press rounded-full border border-[var(--color-line-strong)] px-2.5 py-0.5 text-[11px] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
                  >
                    {tr(`fields.${f.key}`)}
                  </button>
                ))}
              </div>
              <p className="mt-3 mb-5 text-xs text-fg-dim">
                {tr('settings.preview')}{' '}
                <span data-testid="settings-format-preview" className="font-mono text-fg-muted">
                  {renderOutputName(filenameFormat, SAMPLE_META) || '—'}.{outputFormat}
                </span>
              </p>

              <label className="mb-1.5 block text-sm font-medium text-fg-muted">
                {tr('settings.grouping')}
              </label>
              <input
                data-testid="settings-grouping"
                value={grouping}
                onChange={(e) => setGrouping(e.target.value)}
                placeholder="Bases, Cantaditas"
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.groupingHint')}</p>

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

          {tab === 'artwork' && (
            <>
              <label className="mb-1.5 block text-sm font-medium text-fg-muted">
                {tr('settings.coverMaxSize')}
              </label>
              <div className="mb-5 flex items-center gap-2">
                <input
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
            <div className="max-h-[340px] space-y-4 overflow-y-auto">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-dim">
                  {tr('settings.shown')}
                </p>
                <div className="space-y-1.5">
                  {visibleFields.map((key, i) => (
                    <div
                      key={key}
                      data-testid={`field-row-${key}`}
                      className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-1.5 pl-3 pr-2"
                    >
                      <span className="text-sm">{tr(`fields.${key}`)}</span>
                      <div className="flex items-center gap-1">
                        <button
                          data-testid={`field-required-${key}`}
                          aria-pressed={requiredFields.includes(key)}
                          onClick={() =>
                            setRequiredFields(
                              requiredFields.includes(key)
                                ? requiredFields.filter((k) => k !== key)
                                : [...requiredFields, key],
                            )
                          }
                          className={`mr-1 rounded px-2 py-0.5 text-xs ${
                            requiredFields.includes(key)
                              ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                              : 'text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg-muted'
                          }`}
                        >
                          {tr('settings.required')}
                        </button>
                        <button
                          onClick={() => setVisibleFields(moveItem(visibleFields, i, -1))}
                          disabled={i === 0}
                          className="rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-25"
                          aria-label={tr('settings.moveUp')}
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => setVisibleFields(moveItem(visibleFields, i, 1))}
                          disabled={i === visibleFields.length - 1}
                          className="rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-25"
                          aria-label={tr('settings.moveDown')}
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => {
                            setVisibleFields(visibleFields.filter((k) => k !== key))
                            setRequiredFields(requiredFields.filter((k) => k !== key))
                          }}
                          className="ml-1 rounded px-2 py-0.5 text-xs text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
                        >
                          {tr('settings.hide')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-dim">
                  {tr('settings.hidden')}
                </p>
                <div className="space-y-1.5">
                  {FIELD_DEFS.filter((d) => !visibleFields.includes(d.key)).map((d) => (
                    <div
                      key={d.key}
                      className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-1.5 pl-3 pr-2"
                    >
                      <span className="text-sm text-fg-muted">{tr(`fields.${d.key}`)}</span>
                      <button
                        onClick={() => setVisibleFields([...visibleFields, d.key])}
                        className="rounded px-2 py-0.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-panel-2)]"
                      >
                        {tr('settings.show')}
                      </button>
                    </div>
                  ))}
                  {FIELD_DEFS.every((d) => visibleFields.includes(d.key)) && (
                    <p className="text-xs text-fg-faint">{tr('settings.allVisible')}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="press rounded-lg px-4 py-2 text-sm text-fg-muted hover:text-fg"
          >
            {tr('common.cancel')}
          </button>
          <button
            data-testid="settings-save"
            onClick={save}
            className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            {tr('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
