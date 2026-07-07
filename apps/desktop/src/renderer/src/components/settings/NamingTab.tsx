import type React from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../../shared/types'
import { FIELD_DEFS } from '../../lib/fields'
import { insertToken } from '../../lib/insertToken'
import { renderOutputName } from '../../lib/outputName'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { Tooltip } from '../Tooltip'

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

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
}

export function NamingTab({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const formatRef = useRef<HTMLInputElement>(null)

  // Drops the token where the caret last sat (or over the selection), then
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

  return (
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
        <span className="font-mono text-fg-muted">{'{discogsReleaseId}/{artist} - {title}'}</span>
      </p>
      <p className="mt-2.5 mb-1.5 text-xs text-fg-dim">{tr('settings.insertToken')}</p>
      <div className="flex flex-wrap gap-1.5">
        {/* Every metadata field is a legal {token}, including rating — it lives outside
            FIELD_DEFS (the editor draws it as the stars row, not a text field), so it's
            appended here rather than added to the registry. */}
        {[...FIELD_DEFS.map((f) => f.key), 'rating'].map((key) => (
          <button
            key={key}
            type="button"
            data-testid={`settings-token-${key}`}
            onClick={() => addToken(key)}
            className="press rounded-full border border-[var(--color-line-strong)] px-2.5 py-0.5 text-[11px] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
          >
            {tr(`fields.${key}`)}
            <Tooltip label={`{${key}}`} />
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
        <label className="flex cursor-pointer items-start gap-3">
          <input
            data-testid="settings-auto-apply-filename"
            type="checkbox"
            checked={synced.autoApplyFilename}
            onChange={(e) => patch('autoApplyFilename', e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
          />
          <span className="text-sm">
            {tr('settings.autoApplyFilename')}
            <span className="mt-0.5 block text-xs text-fg-dim">
              {tr('settings.autoApplyFilenameHint')}
            </span>
          </span>
        </label>
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
  )
}
