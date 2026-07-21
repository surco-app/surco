import type React from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../../shared/types'
import { FIELD_DEFS } from '../../lib/fields'
import { renderOutputName, renderTitle } from '../../lib/outputName'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { FieldInsertMenu } from '../FieldInsertMenu'
import {
  SettingsCheckboxField,
  SettingsGroup,
  SettingsLabel,
  SettingsSection,
} from './SettingsPrimitives'

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
  mood: 'Dark',
  energy: '8',
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
  onChange: (value: string) => void
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  // Alphabetical by the LOCALIZED label: with 22 fields, the menu is a lookup list,
  // and scanning it only works when the order matches the language on screen (the
  // editor's insert menu instead mirrors the form's own field order).
  const sources = TOKEN_KEYS.map((key) => ({
    key,
    label: tr(`fields.${key}`),
    value: `{${key}}`,
  })).sort((a, b) => a.label.localeCompare(b.label, i18n.language))

  return (
    <>
      <SettingsLabel htmlFor={id} className="mb-2">
        {label}
      </SettingsLabel>
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
          sources={sources}
          value=""
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
      <SettingsSection first>
        <FormatField
          id="settings-title-format"
          label={tr('settings.titleFormat')}
          value={synced.titleFormat}
          placeholder="({trackNumber}) {title} ({year})"
          hint={<p className="mt-2 text-xs leading-relaxed text-fg-dim">{tr('settings.titleFormatHint')}</p>}
          preview={
            synced.titleFormat.trim() !== ''
              ? renderTitle(synced.titleFormat, SAMPLE_META) || '—'
              : undefined
          }
          previewTestId="settings-title-format-preview"
          onChange={(v) => patch('titleFormat', v)}
        />
      </SettingsSection>

      <SettingsSection>
        <FormatField
          id="settings-filename-format"
          label={tr('settings.filenameFormat')}
          value={synced.filenameFormat}
          placeholder="{artist} - {title}"
          hint={
            <p className="mt-2 text-xs leading-relaxed text-fg-dim">
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
      </SettingsSection>

      <SettingsSection>
        <SettingsGroup>
          <SettingsCheckboxField
            testid="settings-auto-apply-filename"
            checked={synced.autoApplyFilename}
            onChange={(v) => patch('autoApplyFilename', v)}
            label={tr('settings.autoApplyFilename')}
            hint={tr('settings.autoApplyFilenameHint')}
          />
          <SettingsCheckboxField
            testid="settings-trim"
            checked={synced.trimWhitespace}
            onChange={(v) => patch('trimWhitespace', v)}
            label={tr('settings.trimWhitespace')}
          />
          <SettingsCheckboxField
            testid="settings-zeropad"
            checked={synced.zeroPadTrack}
            onChange={(v) => patch('zeroPadTrack', v)}
            label={tr('settings.zeroPadTrack')}
          />
        </SettingsGroup>
      </SettingsSection>
    </>
  )
}
