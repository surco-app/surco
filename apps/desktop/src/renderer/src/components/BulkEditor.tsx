import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../shared/types'
import { BULK_FIELDS, commonValue } from '../lib/bulkEdit'
import type { TrackItem } from '../types'

interface Props {
  tracks: TrackItem[]
  onChangeMeta: (patch: Partial<TrackMetadata>) => void
}

// Shown in place of the single-track editor when more than one track is selected. It
// edits only the release-level fields they share: a field where the tracks agree shows
// that value, one where they differ shows a "multiple values" hint and stays blank, so
// typing overwrites every selected track but leaving it alone preserves their differences.
export function BulkEditor({ tracks, onChangeMeta }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div className="@container flex h-full flex-col overflow-y-auto p-6" data-testid="bulk-editor">
      <header className="mb-5">
        <h2 className="text-sm font-semibold text-fg">{tr('bulk.title', { count: tracks.length })}</h2>
        <p className="mt-1 text-xs text-fg-dim">{tr('bulk.hint')}</p>
      </header>
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
    </div>
  )
}
