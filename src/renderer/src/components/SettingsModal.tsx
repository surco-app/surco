import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Settings } from '../../../shared/types'
import { FIELD_DEFS, moveItem } from '../lib/fields'

interface Props {
  settings: Settings
  onClose: () => void
  onSave: (patch: Partial<Settings>) => void
}

type Tab = 'general' | 'naming' | 'artwork' | 'fields'

const TABS: Tab[] = ['general', 'naming', 'artwork', 'fields']

export function SettingsModal({ settings, onClose, onSave }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [tab, setTab] = useState<Tab>('general')
  const [token, setToken] = useState(settings.discogsToken)
  const [outputDir, setOutputDir] = useState(settings.outputDir)
  const [addToAppleMusic, setAddToAppleMusic] = useState(settings.addToAppleMusic)
  const [filenameFormat, setFilenameFormat] = useState(settings.filenameFormat)
  const [grouping, setGrouping] = useState(settings.groupingPresets.join(', '))
  const [trimWhitespace, setTrimWhitespace] = useState(settings.trimWhitespace)
  const [zeroPadTrack, setZeroPadTrack] = useState(settings.zeroPadTrack)
  const [visibleFields, setVisibleFields] = useState(settings.visibleFields)
  const [requiredFields, setRequiredFields] = useState(settings.requiredFields)
  const [coverMaxSize, setCoverMaxSize] = useState(String(settings.coverMaxSize))
  const [coverSquare, setCoverSquare] = useState(settings.coverSquare)

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
      discogsToken: token.trim(),
      outputDir,
      addToAppleMusic,
      filenameFormat: filenameFormat.trim() || '{artist} - {title}',
      groupingPresets,
      trimWhitespace,
      zeroPadTrack,
      visibleFields,
      requiredFields,
      coverMaxSize: Number.isFinite(max) && max >= 0 ? max : 1200,
      coverSquare
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[560px] rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex justify-center">
          <div className="inline-flex gap-1 rounded-lg bg-[var(--color-ink)] p-1">
            {TABS.map((id) => (
              <button
                key={id}
                data-testid={`settings-tab-${id}`}
                onClick={() => setTab(id)}
                className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                  tab === id
                    ? 'bg-[var(--color-panel-2)] text-neutral-100'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {tr(`settings.tabs.${id}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-[280px]">
          {tab === 'general' && (
            <>
              <label className="mb-1.5 block text-sm font-medium text-neutral-300">
                {tr('settings.discogsToken')}
              </label>
              <input
                data-testid="settings-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={tr('settings.tokenPlaceholder')}
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <p className="mt-1.5 mb-5 text-xs text-neutral-500">
                {tr('settings.tokenHelp')}{' '}
                <a
                  href="https://www.discogs.com/settings/developers"
                  className="text-[var(--color-accent)] hover:underline"
                >
                  discogs.com/settings/developers
                </a>
              </p>

              <label className="mb-1.5 block text-sm font-medium text-neutral-300">
                {tr('settings.outputDir')}
              </label>
              <div className="mb-5 flex gap-2">
                <input
                  data-testid="settings-output"
                  value={outputDir}
                  readOnly
                  className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm text-neutral-400"
                />
                <button
                  onClick={changeDir}
                  className="rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm hover:bg-[var(--color-panel-2)]"
                >
                  {tr('common.change')}
                </button>
              </div>

              <label className="flex cursor-pointer items-center gap-3">
                <input
                  data-testid="settings-applemusic"
                  type="checkbox"
                  checked={addToAppleMusic}
                  onChange={(e) => setAddToAppleMusic(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                <span className="text-sm">{tr('settings.addToAppleMusic')}</span>
              </label>
            </>
          )}

          {tab === 'naming' && (
            <>
              <label className="mb-1.5 block text-sm font-medium text-neutral-300">
                {tr('settings.filenameFormat')}
              </label>
              <input
                data-testid="settings-filename-format"
                value={filenameFormat}
                onChange={(e) => setFilenameFormat(e.target.value)}
                placeholder="{artist} - {title}"
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <p className="mt-1.5 mb-5 text-xs text-neutral-500">
                {tr('settings.tokensHint')} {'{artist}'} {'{title}'} {'{album}'} {'{albumArtist}'}{' '}
                {'{year}'} {'{genre}'} {'{grouping}'} {'{trackNumber}'}
              </p>

              <label className="mb-1.5 block text-sm font-medium text-neutral-300">
                {tr('settings.grouping')}
              </label>
              <input
                data-testid="settings-grouping"
                value={grouping}
                onChange={(e) => setGrouping(e.target.value)}
                placeholder="Bases, Cantaditas"
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <p className="mt-1.5 mb-5 text-xs text-neutral-500">{tr('settings.groupingHint')}</p>

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
              <label className="mb-1.5 block text-sm font-medium text-neutral-300">
                {tr('settings.coverMaxSize')}
              </label>
              <div className="mb-5 flex items-center gap-2">
                <input
                  data-testid="settings-cover-max"
                  type="number"
                  min={0}
                  value={coverMaxSize}
                  onChange={(e) => setCoverMaxSize(e.target.value)}
                  className="w-28 rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                />
                <span className="text-sm text-neutral-500">{tr('settings.coverMaxHint')}</span>
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
              <p className="mt-3 text-xs text-neutral-500">{tr('settings.coverHint')}</p>
            </>
          )}

          {tab === 'fields' && (
            <div className="max-h-[340px] space-y-4 overflow-y-auto">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {tr('settings.shown')}
                </p>
                <div className="space-y-1.5">
                  {visibleFields.map((key, i) => (
                    <div
                      key={key}
                      data-testid={`field-row-${key}`}
                      className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] py-1.5 pl-3 pr-2"
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
                                : [...requiredFields, key]
                            )
                          }
                          className={`mr-1 rounded px-2 py-0.5 text-xs ${
                            requiredFields.includes(key)
                              ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                              : 'text-neutral-500 hover:bg-[var(--color-panel-2)] hover:text-neutral-300'
                          }`}
                        >
                          {tr('settings.required')}
                        </button>
                        <button
                          onClick={() => setVisibleFields(moveItem(visibleFields, i, -1))}
                          disabled={i === 0}
                          className="rounded px-1.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-25"
                          aria-label={tr('settings.moveUp')}
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => setVisibleFields(moveItem(visibleFields, i, 1))}
                          disabled={i === visibleFields.length - 1}
                          className="rounded px-1.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-25"
                          aria-label={tr('settings.moveDown')}
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => {
                            setVisibleFields(visibleFields.filter((k) => k !== key))
                            setRequiredFields(requiredFields.filter((k) => k !== key))
                          }}
                          className="ml-1 rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-[var(--color-panel-2)] hover:text-neutral-100"
                        >
                          {tr('settings.hide')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {tr('settings.hidden')}
                </p>
                <div className="space-y-1.5">
                  {FIELD_DEFS.filter((d) => !visibleFields.includes(d.key)).map((d) => (
                    <div
                      key={d.key}
                      className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] py-1.5 pl-3 pr-2"
                    >
                      <span className="text-sm text-neutral-400">{tr(`fields.${d.key}`)}</span>
                      <button
                        onClick={() => setVisibleFields([...visibleFields, d.key])}
                        className="rounded px-2 py-0.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-panel-2)]"
                      >
                        {tr('settings.show')}
                      </button>
                    </div>
                  ))}
                  {FIELD_DEFS.every((d) => visibleFields.includes(d.key)) && (
                    <p className="text-xs text-neutral-600">{tr('settings.allVisible')}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200"
          >
            {tr('common.cancel')}
          </button>
          <button
            data-testid="settings-save"
            onClick={save}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
          >
            {tr('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
