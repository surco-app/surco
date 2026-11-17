import { ChevronRight } from 'lucide-react'
import type React from 'react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../shared/types'
import {
  type TagList,
  type TagListStates,
  tagListStates,
  tagListTags,
  tagsOf,
  toggleTagListAll,
} from '../lib/bulkEdit'
import { csvHas, toggleCsv } from '../lib/csv'
import type { TrackItem } from '../types'
import { SuggestionChips } from './SuggestionChips'

interface TagListBulkFieldProps {
  label: string
  list: TagList
  presets: string[]
  tracks: TrackItem[]
  onChangeTracks: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
}

interface TagOrder {
  selection: string
  summary: string[]
  rows: Record<string, string[]>
}

function tagOrder(
  selection: string,
  tags: string[],
  tracks: TrackItem[],
  list: TagList,
  stateOf: TagListStates,
): TagOrder {
  const rank = { all: 0, some: 1, none: 2 }
  return {
    selection,
    summary: [...tags].sort((a, b) => rank[stateOf(a)] - rank[stateOf(b)]),
    rows: Object.fromEntries(
      tracks.map((t) => {
        const carried = tagsOf(t, list)
        return [
          t.id,
          [...tags].sort(
            (a, b) => Number(carried.has(b.toLowerCase())) - Number(carried.has(a.toLowerCase())),
          ),
        ]
      }),
    ),
  }
}

function sortedAs(tags: string[], order: string[] | undefined): string[] {
  if (!order) return tags
  const at = (tag: string) => {
    const i = order.indexOf(tag)
    return i === -1 ? order.length : i
  }
  return [...tags].sort((a, b) => at(a) - at(b))
}

export function TagListBulkField({
  label,
  list,
  presets,
  tracks,
  onChangeTracks,
}: TagListBulkFieldProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const tags = tagListTags(presets, tracks, list)
  const selection = tracks.map((t) => t.id).join('\n')
  const stateOf = useMemo(() => tagListStates(tracks, list), [tracks, list])
  const [order, setOrder] = useState(() => tagOrder(selection, tags, tracks, list, stateOf))
  if (order.selection !== selection) setOrder(tagOrder(selection, tags, tracks, list, stateOf))
  const summaryTags = sortedAs(tags, order.summary)
  const varying = tags.filter((tag) => stateOf(tag) === 'some').length
  // Every row repeats the same chips, so each row is a group named by what it edits: the
  // summary by the field's label, a track's row by its number and title. min-w-0 undoes a
  // fieldset's min-content floor, which would stop the chip row and titles from shrinking.
  const baseId = useId()
  return (
    <div className="block" data-testid={`${list.key}-bulk`}>
      <fieldset aria-labelledby={`${baseId}-label`} className="min-w-0">
        <span
          id={`${baseId}-label`}
          className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-dim"
        >
          {label}
          <span className="font-normal text-fg-faint">· {tr('editor.groupingAllTracks')}</span>
        </span>
        <SuggestionChips
          suggestions={summaryTags}
          isOn={(tag) => stateOf(tag) === 'all'}
          isPartial={(tag) => stateOf(tag) === 'some'}
          partialLabel={(tag) => `${stateOf.count(tag)}/${tracks.length}`}
          addable
          onPick={(tag) => onChangeTracks(toggleTagListAll(tracks, list, tag))}
        />
      </fieldset>
      <div className="mt-2.5 ml-[5px] border-l-2 border-[var(--color-line-strong)] pl-2.5">
        <button
          type="button"
          data-testid={`${list.key}-per-track-toggle`}
          aria-expanded={open}
          aria-controls={`${baseId}-rows`}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 py-0.5 text-label text-fg-muted transition-colors hover:text-fg"
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-fg-faint transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          <span>{tr('editor.groupingPerTrack')}</span>
          <span className="ml-auto text-label text-fg-faint">
            {varying === 0
              ? tr('editor.groupingSame')
              : tr('editor.groupingVarying', { count: varying })}
          </span>
        </button>
        {open && (
          <div id={`${baseId}-rows`} className="mt-1.5 flex flex-col gap-[7px]">
            {tracks.map((t) => (
              <fieldset key={t.id} aria-labelledby={`${baseId}-${t.id}`} className="min-w-0">
                <div
                  id={`${baseId}-${t.id}`}
                  data-testid={`${list.key}-track-${t.id}`}
                  className="flex min-w-0 items-center gap-1.5 text-label text-fg-faint"
                >
                  {t.meta.trackNumber && (
                    <span className="shrink-0 rounded bg-[var(--color-panel-2)] px-1 py-px text-label font-semibold text-fg-dim">
                      {t.meta.trackNumber}
                    </span>
                  )}
                  <span className="truncate">{t.meta.title || t.listLabel}</span>
                </div>
                <SuggestionChips
                  scope={t.id}
                  dim
                  suggestions={sortedAs(tags, order.rows[t.id])}
                  isOn={(tag) => csvHas(t.meta[list.key] ?? '', tag, list.whole, list.separator)}
                  onPick={(tag) =>
                    onChangeTracks([
                      {
                        id: t.id,
                        meta: {
                          [list.key]: toggleCsv(
                            t.meta[list.key] ?? '',
                            tag,
                            list.whole,
                            list.separator,
                          ),
                        },
                      },
                    ])
                  }
                />
              </fieldset>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
