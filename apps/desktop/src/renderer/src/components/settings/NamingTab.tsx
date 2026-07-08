import type React from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../../shared/types'
import { FIELD_DEFS } from '../../lib/fields'
import { renderOutputName, renderTitle } from '../../lib/outputName'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { FieldInsertMenu } from '../FieldInsertMenu'

// A representative track so the filename preview shows real-looking output
// instead of empty braces, and every token has something to render. All values
// belong to the same fictional Dj Vixent release so the preview reads as ONE
// coherent track, never a mash-up of unrelated names.
const SAMPLE_META: TrackMetadata = {
  title: 'Take me into the sky',
  artist: 'Dj Vixent',
  album: 'Take me into the sky',
  albumArtist: 'Dj Vixent',
  year: '2026',
  genre: 'Hard Dance',
  grouping: 'Bases',
  comment: 'Vinyl rip',
  trackNumber: '03',
  discNumber: '1',
  bpm: '128',
  key: '8A',
  publisher: 'Surco',
  catalogNumber: 'SRC001',
  remixArtist: 'Dj Vixent',
  discogsReleaseId: '2406512',
  rating: '5',
  composer: 'Dj Vixent',
  isrc: 'ES-SRC-26-00031',
  mixName: 'Original Remix',
  originalYear: '1998',
  compilation: '1',
}

// Every metadata field is a legal {token}, including rating — it lives outside
// FIELD_DEFS (the editor draws it as the stars row, not a text field), so it's
// appended here rather than added to the registry.
const TOKEN_KEYS = [...FIELD_DEFS.map((f) => f.key), 'rating']

// One pattern editor — label, format input with the editor-style ⋯ token menu, and
// a live preview — shared by the file name and the title format so both teach the
// same tokens the same way. The menu reuses FieldInsertMenu with each field's
// literal {token} as the insertable value; an empty `value` keeps its case
// transforms self-filtered out, leaving a pure token list.
function FormatField({
  id,
  label,
  value,
  placeholder,
  hint,
  preview,
  previewTestId,
  dropUp,
  onChange,
}: {
  id: string
  label: string
  value: string
  placeholder: string
  hint: React.ReactNode
  // The rendered sample, or undefined to omit the preview line (empty title format).
  preview: string | undefined
  previewTestId: string
  // Passed through to the token menu: the title format sits at the bottom of the
  // modal's scroll body, where a drop-down menu would clip.
  dropUp?: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg-muted">
        {label}
      </label>
      <span className="group relative block">
        <input
          ref={inputRef}
          id={id}
          data-testid={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 pr-8 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <FieldInsertMenu
          fieldName={id}
          sources={TOKEN_KEYS.map((key) => ({
            key,
            label: tr(`fields.${key}`),
            value: `{${key}}`,
          }))}
          value=""
          dropUp={dropUp}
          inputRef={inputRef}
          onChange={onChange}
        />
      </span>
      {hint}
      {preview !== undefined && (
        <p className="mt-3 text-xs text-fg-dim">
          {tr('settings.preview')}{' '}
          <span data-testid={previewTestId} className="font-mono text-fg-muted">
            {preview}
          </span>
        </p>
      )}
    </>
  )
}

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
}

export function NamingTab({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()

  return (
    <>
      <FormatField
        id="settings-filename-format"
        label={tr('settings.filenameFormat')}
        value={synced.filenameFormat}
        placeholder="{artist} - {title}"
        hint={
          <p className="mt-2 text-xs text-fg-dim">
            {tr('settings.filenameFolderHint')}{' '}
            <span className="font-mono text-fg-muted">
              {'{discogsReleaseId}/{artist} - {title}'}
            </span>
          </p>
        }
        preview={`${renderOutputName(synced.filenameFormat, SAMPLE_META) || '—'}.${synced.outputFormat}`}
        previewTestId="settings-format-preview"
        onChange={(v) => patch('filenameFormat', v)}
      />

      <div className="mt-5 space-y-3 border-t border-[var(--color-line)] pt-5">
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

      <div className="mt-5 border-t border-[var(--color-line)] pt-5">
        <FormatField
          id="settings-title-format"
          label={tr('settings.titleFormat')}
          value={synced.titleFormat}
          placeholder="({trackNumber}) {title}"
          hint={<p className="mt-2 text-xs text-fg-dim">{tr('settings.titleFormatHint')}</p>}
          preview={
            synced.titleFormat.trim() !== ''
              ? renderTitle(synced.titleFormat, SAMPLE_META) || '—'
              : undefined
          }
          previewTestId="settings-title-format-preview"
          dropUp
          onChange={(v) => patch('titleFormat', v)}
        />
      </div>
    </>
  )
}
