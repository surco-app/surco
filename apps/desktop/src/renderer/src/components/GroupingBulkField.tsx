import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../shared/types'
import { groupingTagState, groupingTags, toggleGroupingAll } from '../lib/bulkEdit'
import { csvHas, toggleCsv } from '../lib/csv'
import type { TrackItem } from '../types'
import { SuggestionChips } from './SuggestionChips'

interface GroupingBulkFieldProps {
  label: string
  presets: string[]
  tracks: TrackItem[]
  onChangeTracks: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
}

export function GroupingBulkField({
  label,
  presets,
  tracks,
  onChangeTracks,
}: GroupingBulkFieldProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const tags = groupingTags(presets, tracks)
  return (
    <div className="block" data-testid="grouping-bulk">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-dim">
        {label}
        <span className="font-normal text-fg-faint">· {tr('editor.groupingAllTracks')}</span>
      </span>
      <SuggestionChips
        suggestions={tags}
        isOn={(tag) => groupingTagState(tracks, tag) === 'all'}
        isPartial={(tag) => groupingTagState(tracks, tag) === 'some'}
        onPick={(tag) => onChangeTracks(toggleGroupingAll(tracks, tag))}
      />
      <div className="mt-3 flex flex-col gap-2.5 border-t border-[var(--color-line)] pt-3">
        {tracks.map((t) => (
          <div key={t.id} className="min-w-0">
            <div
              data-testid={`grouping-track-${t.id}`}
              className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg-dim"
            >
              {t.meta.trackNumber && (
                <span className="shrink-0 rounded bg-[var(--color-panel-2)] px-1.5 py-px text-[9px] font-semibold text-fg-muted">
                  {t.meta.trackNumber}
                </span>
              )}
              <span className="truncate">{t.meta.title || t.listLabel}</span>
            </div>
            <SuggestionChips
              scope={t.id}
              suggestions={tags}
              isOn={(tag) => csvHas(t.meta.grouping ?? '', tag)}
              onPick={(tag) =>
                onChangeTracks([
                  { id: t.id, meta: { grouping: toggleCsv(t.meta.grouping ?? '', tag) } },
                ])
              }
            />
          </div>
        ))}
      </div>
    </div>
  )
}
