import { ChevronRight } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
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
  const [open, setOpen] = useState(false)
  const tags = groupingTags(presets, tracks)
  const rank = { all: 0, some: 1, none: 2 }
  const summaryTags = [...tags].sort(
    (a, b) => rank[groupingTagState(tracks, a)] - rank[groupingTagState(tracks, b)],
  )
  const varying = tags.filter((tag) => groupingTagState(tracks, tag) === 'some').length
  return (
    <div className="block" data-testid="grouping-bulk">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-dim">
        {label}
        <span className="font-normal text-fg-faint">· {tr('editor.groupingAllTracks')}</span>
      </span>
      <SuggestionChips
        suggestions={summaryTags}
        isOn={(tag) => groupingTagState(tracks, tag) === 'all'}
        isPartial={(tag) => groupingTagState(tracks, tag) === 'some'}
        onPick={(tag) => onChangeTracks(toggleGroupingAll(tracks, tag))}
      />
      <div className="mt-2.5 ml-[5px] border-l-2 border-[var(--color-line-strong)] pl-2.5">
        <button
          type="button"
          data-testid="grouping-per-track-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 py-0.5 text-[11px] text-fg-muted transition-colors hover:text-fg"
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-fg-faint transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          <span>{tr('editor.groupingPerTrack', { count: tracks.length })}</span>
          <span className="ml-auto text-[10px] text-fg-faint">
            {varying === 0
              ? tr('editor.groupingSame')
              : tr('editor.groupingVarying', { count: varying })}
          </span>
        </button>
        {open && (
          <div className="mt-1.5 flex flex-col gap-[7px]">
            {tracks.map((t) => (
              <div key={t.id} className="min-w-0">
                <div
                  data-testid={`grouping-track-${t.id}`}
                  className="flex min-w-0 items-center gap-1.5 text-[10px] text-fg-faint"
                >
                  {t.meta.trackNumber && (
                    <span className="shrink-0 rounded bg-[var(--color-panel-2)] px-1 py-px text-[8.5px] font-semibold text-fg-dim">
                      {t.meta.trackNumber}
                    </span>
                  )}
                  <span className="truncate">{t.meta.title || t.listLabel}</span>
                </div>
                <SuggestionChips
                  scope={t.id}
                  dim
                  suggestions={[...tags].sort(
                    (a, b) =>
                      Number(csvHas(t.meta.grouping ?? '', b)) -
                      Number(csvHas(t.meta.grouping ?? '', a)),
                  )}
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
        )}
      </div>
    </div>
  )
}
