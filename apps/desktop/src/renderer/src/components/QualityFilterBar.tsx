import {
  AudioLines,
  Check,
  CircleCheckBig,
  List,
  type LucideIcon,
  Plus,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { QualityFilter, qualityCounts } from '../lib/triage'
import { Tooltip } from './Tooltip'

// One Lucide glyph per list-filter chip, kept visually consistent with the toolbar.
const FILTER_ICONS: Record<QualityFilter, LucideIcon> = {
  all: List,
  suspect: TriangleAlert,
  good: CircleCheckBig,
  unanalyzed: AudioLines,
  unconverted: RefreshCw,
  automatched: Sparkles,
  inLibrary: Check,
  notInLibrary: Plus,
}

interface Props {
  // The sticky filter header, measured by App when paging the scroll position.
  filterRef: React.RefObject<HTMLDivElement | null>
  value: QualityFilter
  onChange: (mode: QualityFilter) => void
  tally: ReturnType<typeof qualityCounts>
  trackCount: number
  visibleCount: number
  // 1-based position of the selected row within the current view, or null.
  selectedPosition: number | null
}

// The sidebar's quality-triage chip bar: one chip per filter bucket (with the
// provenance and Apple Music chips appearing only once they have something to show),
// plus the "54/200" position pill. Presentational — App owns the filter state and the
// tallies and hands them in.
export function QualityFilterBar({
  filterRef,
  value,
  onChange,
  tally,
  trackCount,
  visibleCount,
  selectedPosition,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div ref={filterRef} data-testid="quality-filter" className="flex gap-0.5 px-1.5 py-2">
      {(
        [
          'all',
          'unanalyzed',
          'suspect',
          'good',
          'unconverted',
          // Provenance chip, shown only once something has been auto-filled so the
          // bar isn't cluttered with a permanently-empty filter when auto-match is off.
          ...(tally.automatched > 0 ? (['automatched'] as const) : []),
          // Apple Music library chips, shown only once the snapshot has resolved a
          // verdict for at least one track — which also keeps them off Windows, where
          // there is no library to read. "Not in library" leads: it's the actionable
          // bucket, the tracks still worth importing.
          ...(tally.inLibrary + tally.notInLibrary > 0
            ? (['notInLibrary', 'inLibrary'] as const)
            : []),
        ] as const
      ).map((mode) => {
        const count = mode === 'all' ? trackCount : tally[mode as keyof typeof tally]
        const active = value === mode
        const name = tr(`sidebar.filter.${mode}`)
        const Icon = FILTER_ICONS[mode]
        // Color-coded dot draws the eye to buckets that need attention: amber for
        // suspect (likely fake), accent for the still-to-convert backlog.
        const dot =
          mode === 'suspect' && tally.suspect > 0
            ? 'bg-warn'
            : mode === 'unconverted' && tally.unconverted > 0
              ? 'bg-[var(--color-accent)]'
              : null
        // The selected-track position and the "all" count share a denominator
        // when the whole library is in view (the total would show twice), so the
        // position folds into the all chip and the separate pill drops out. A
        // filter/search narrows the view to a different size, where the two are
        // distinct numbers again and the pill returns.
        const showPositionHere =
          mode === 'all' && selectedPosition !== null && visibleCount === trackCount
        const countLabel = showPositionHere ? `${selectedPosition}/${count}` : count
        return (
          <button
            key={mode}
            type="button"
            data-testid={`quality-filter-${mode}`}
            aria-pressed={active}
            aria-label={name}
            onClick={() => onChange(mode)}
            className={`press group relative flex shrink-0 items-center gap-0.5 rounded-md px-1 py-1 text-xs font-medium ${
              active
                ? 'bg-[var(--color-accent-soft)] text-fg'
                : 'text-fg-dim hover:bg-[var(--color-panel-2)]'
            }`}
          >
            <span className="relative">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {dot && (
                <span className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${dot}`} />
              )}
            </span>
            <span className="min-w-[2ch] text-center tabular-nums opacity-70">{countLabel}</span>
            <Tooltip
              label={
                showPositionHere
                  ? tr('sidebar.position', { current: selectedPosition, total: count })
                  : name
              }
            />
          </button>
        )
      })}
      {selectedPosition !== null && visibleCount !== trackCount && (
        <span
          data-testid="track-position"
          title={tr('sidebar.position', { current: selectedPosition, total: visibleCount })}
          className="ml-auto self-center pr-0.5 pl-1 text-xs tabular-nums text-fg-faint"
        >
          {selectedPosition}/{visibleCount}
        </span>
      )}
    </div>
  )
}
