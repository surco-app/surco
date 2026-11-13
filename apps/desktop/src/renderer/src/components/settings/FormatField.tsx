import type React from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { CustomField, TrackMetadata } from '../../../../shared/types'
import { labeledFields } from '../../lib/fields'
import { FieldInsertMenu } from '../FieldInsertMenu'
import { SettingsLabel } from './SettingsPrimitives'

// A representative track so the filename preview shows real-looking output
// instead of empty braces, and every token has something to render. All values
// belong to the same fictional Dj Vixent release so the preview reads as ONE
// coherent track, never a mash-up of unrelated names.
export const SAMPLE_META: TrackMetadata = {
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
  trackTotal: '12',
  discTotal: '2',
  copyright: '(P) 2026 Label',
  encodedBy: 'Dj Vixent',
  originalArtist: 'Three Drives',
  lyricist: 'Dj Vixent',
  conductor: 'Dj Vixent',
  mood: 'Dark',
  energy: '8',
  compilation: '1',
  style: 'Deep House',
  country: 'Spain',
  mediaType: 'Vinyl, 12"',
  // Shown as a sample like every other token, though a URL in a filename is a poor
  // choice: the separators are stripped by the same sanitiser every token goes through,
  // so it degrades to an unreadable run of text rather than breaking the path.
  discogsUrl: 'discogs.com/release/2406512',
  quality: 'Good',
}

// One pattern editor — label, format input with the editor-style ⋯ token menu, and
// a live preview — shared by the file name and the title format so both teach the
// same tokens the same way. The menu reuses FieldInsertMenu with each field's
// literal {token} as the insertable value; an empty `value` keeps its case
// transforms self-filtered out, leaving a pure token list.
export function FormatField({
  id,
  label,
  value,
  placeholder,
  hint,
  preview,
  previewTestId,
  customFields,
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
  customFields: readonly CustomField[]
  onChange: (value: string) => void
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  // Alphabetical by the LOCALIZED label: with 22 fields, the menu is a lookup list,
  // and scanning it only works when the order matches the language on screen (the
  // editor's insert menu instead mirrors the form's own field order).
  // Every field is a legal {token}, including rating — it lives outside FIELD_DEFS (the
  // editor draws it as the stars row, not a text field), so it's appended here.
  const sources = [
    ...labeledFields(customFields, tr),
    { key: 'rating', label: tr('fields.rating') },
  ]
    .map((f) => ({ ...f, value: `{${f.key}}` }))
    .sort((a, b) => a.label.localeCompare(b.label, i18n.language))

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
          className="w-full rounded-lg border border-[var(--color-input-border)] bg-[var(--color-field)] px-3 py-2 pr-8 text-sm outline-none focus:border-[var(--color-accent)]"
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
