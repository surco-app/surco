import type React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../shared/types'
import { BULK_FIELDS, commonValue } from '../lib/bulkEdit'
import type { ReleaseMetaPatch } from '../lib/release'
import type { TrackItem } from '../types'
import { AlbumMatch } from './AlbumMatch'

interface Props {
  tracks: TrackItem[]
  onChangeMeta: (patch: Partial<TrackMetadata>) => void
  onApplyCover: (coverUrl: string, coverPath: string) => void
  onApplyMatches: (patches: { id: string; patch: ReleaseMetaPatch }[]) => void
}

// Shown in place of the single-track editor when more than one track is selected. It
// edits only the release-level fields they share: a field where the tracks agree shows
// that value, one where they differ shows a "multiple values" hint and stays blank, so
// typing overwrites every selected track but leaving it alone preserves their differences.
// A dropped image is applied to the whole selection at once — the album-cover case.
export function BulkEditor({
  tracks,
  onChangeMeta,
  onApplyCover,
  onApplyMatches,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [coverDragging, setCoverDragging] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)
  // Show the artwork the tracks already share as a preview; when they differ (or have
  // none) fall back to the placeholder, since there is no single cover to show.
  const sharedCover =
    tracks.length > 0 && tracks.every((t) => t.coverUrl === tracks[0].coverUrl)
      ? tracks[0].coverUrl
      : undefined

  function applyImageFile(file: File | undefined): void {
    if (!file || !file.type.startsWith('image/')) return
    onApplyCover(URL.createObjectURL(file), window.api.getPathForFile(file))
  }

  function onCoverDrop(e: React.DragEvent): void {
    e.preventDefault()
    setCoverDragging(false)
    applyImageFile(Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/')))
  }

  return (
    <div className="@container flex h-full flex-col overflow-y-auto p-6" data-testid="bulk-editor">
      <header className="mb-5">
        <h2 className="text-sm font-semibold text-fg">{tr('bulk.title', { count: tracks.length })}</h2>
        <p className="mt-1 text-xs text-fg-dim">{tr('bulk.hint')}</p>
      </header>
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        data-testid="bulk-cover-input"
        className="hidden"
        onChange={(e) => {
          applyImageFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <button
        type="button"
        data-testid="bulk-cover-drop"
        onClick={() => coverInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setCoverDragging(true)
        }}
        onDragLeave={() => setCoverDragging(false)}
        onDrop={onCoverDrop}
        className={`mb-5 flex w-full shrink-0 items-center gap-4 rounded-xl border border-dashed p-3 text-left transition-colors ${
          coverDragging
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
            : 'border-[var(--color-line)] hover:border-[var(--color-line-strong)]'
        }`}
      >
        {sharedCover ? (
          <img
            src={sharedCover}
            alt=""
            className="h-16 w-16 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-[var(--color-panel-2)] text-fg-faint">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
              className="h-6 w-6"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.5-3.5L9 20" />
            </svg>
          </span>
        )}
        <span className={`text-xs ${coverDragging ? 'text-[var(--color-accent)]' : 'text-fg-faint'}`}>
          {coverDragging ? tr('bulk.coverDropActive') : tr('bulk.coverDrop')}
        </span>
      </button>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 @[26rem]:grid-cols-2">
        {BULK_FIELDS.map((key) => {
          const shared = commonValue(tracks, key)
          return (
            <label key={key} className="block">
              <span className="mb-1 block text-xs font-medium text-fg-dim">
                {tr(`fields.${key}`)}
              </span>
              <input
                data-testid={`bulk-field-${key}`}
                value={shared ?? ''}
                placeholder={shared === undefined ? tr('bulk.mixed') : ''}
                onChange={(e) => onChangeMeta({ [key]: e.target.value })}
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            </label>
          )
        })}
      </div>
      <AlbumMatch files={tracks} onApply={onApplyMatches} />
    </div>
  )
}
