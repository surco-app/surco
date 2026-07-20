import type { TFunction } from 'i18next'
import {
  ArrowDownNarrowWide,
  ArrowDownUp,
  ArrowUpNarrowWide,
  CaseSensitive,
  Clock,
  Crosshair,
  FileAudio,
  FilePlus,
  ListX,
  Replace,
  SquareCheckBig,
  Tag,
  Trash2,
  User,
} from 'lucide-react'
import type React from 'react'
import type { LibrarySource } from '../lib/librarySource'
import type { FilterSelection, TrackSort } from '../lib/triage'
import type { TrackItem } from '../types'
import { QualityFilterBar } from './QualityFilterBar'
import { SearchInput } from './SearchInput'
import { Select } from './Select'
import { Tooltip } from './Tooltip'

interface Props {
  tr: TFunction
  // The shortcut chord shown after each action's tooltip label, so a control's key is
  // discoverable on hover without a second visual style per call site.
  hintFor: (id: string) => string
  search: string
  setSearch: (v: string) => void
  trackSearchRef: React.RefObject<HTMLInputElement | null>
  qualityFilterRef: React.RefObject<HTMLDivElement | null>
  filterSelection: FilterSelection
  setFilterSelection: (next: FilterSelection) => void
  librarySource: LibrarySource
  // The per-bucket counts and the format list the filter bar offers.
  qualityTally: React.ComponentProps<typeof QualityFilterBar>['tally']
  formatTally: React.ComponentProps<typeof QualityFilterBar>['formats']
  sortBy: TrackSort
  setSortBy: (v: TrackSort) => void
  sortDir: 'asc' | 'desc'
  toggleSortDir: () => void
  tracks: TrackItem[]
  visibleTracks: TrackItem[]
  selectedId: string | null
  selectedIds: string[]
  // 1-based position of the selected row, shown when exactly one row is selected.
  selectedPosition: number | null
  onAdd: () => void
  onSelectAllTracks: () => void
  scrollToSelected: () => void
  onFillAll: () => void
  onFindReplace: () => void
  onClearAll: () => void
  onTrashSelected: () => void
  onTrashSuspects: () => void
}

// The track column's sticky header: search, the quality/format filter, the sort control and
// the list actions. Pure presentation — every handler is owned by App, which is where the
// state they act on lives. Split out of App because it was 175 lines of markup wedged into
// a component that already had plenty to do; nothing here decides anything.
export function TrackListHeader({
  tr,
  hintFor,
  search,
  setSearch,
  trackSearchRef,
  qualityFilterRef,
  filterSelection,
  setFilterSelection,
  librarySource,
  qualityTally,
  formatTally,
  sortBy,
  setSortBy,
  sortDir,
  toggleSortDir,
  tracks,
  visibleTracks,
  selectedId,
  selectedIds,
  selectedPosition,
  onAdd,
  onSelectAllTracks,
  scrollToSelected,
  onFillAll,
  onFindReplace,
  onClearAll,
  onTrashSelected,
  onTrashSuspects,
}: Props): React.JSX.Element {
  return (
    // The ref measures the WHOLE sticky header (search + filter + sort), not just the filter
    // bar: keyboard paging offsets the selected row by this height so it lands clear of the
    // header. Measuring only the filter bar left the row tucked under the search/sort rows
    // above it — cut off at the top. offsetHeight re-reads on every page, so it tracks the
    // header's real height at any window size.
    <div
      ref={qualityFilterRef}
      className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-panel)]"
    >
      <div className="flex items-center gap-1.5 px-1.5 pt-2">
        <SearchInput
          className="flex-1"
          testid="track-search"
          inputRef={trackSearchRef}
          value={search}
          onChange={setSearch}
          onClear={() => setSearch('')}
          onKeyDown={(e) => {
            // Escape clears a running filter, then a second press (or one on an
            // empty field) drops focus back to the list — a quick way out of a search.
            if (e.key !== 'Escape') return
            if (search) {
              e.stopPropagation()
              setSearch('')
            } else {
              e.currentTarget.blur()
            }
          }}
          ariaLabel={tr('sidebar.search.placeholder')}
          placeholder={tr('sidebar.search.placeholder')}
          clearLabel={tr('sidebar.search.clear')}
        />
      </div>
      <QualityFilterBar
        librarySource={librarySource}
        value={filterSelection}
        onChange={setFilterSelection}
        tally={qualityTally}
        formats={formatTally}
        trackCount={tracks.length}
        visibleCount={visibleTracks.length}
        selectedPosition={selectedPosition}
        selectedCount={selectedIds.length}
        onRevealSelected={scrollToSelected}
        onTrashSuspects={onTrashSuspects}
      >
        <Select
          testid="track-sort"
          value={sortBy}
          onChange={(v) => setSortBy(v as TrackSort)}
          label={tr('sidebar.sort.label')}
          options={[
            { value: 'import', label: tr('sidebar.sort.import'), icon: ArrowDownUp },
            { value: 'name', label: tr('sidebar.sort.name'), icon: CaseSensitive },
            { value: 'artist', label: tr('sidebar.sort.artist'), icon: User },
            { value: 'duration', label: tr('sidebar.sort.duration'), icon: Clock },
            { value: 'format', label: tr('sidebar.sort.format'), icon: FileAudio },
          ]}
        />
        {sortBy !== 'import' && (
          <button
            type="button"
            data-testid="track-sort-direction"
            aria-pressed={sortDir === 'desc'}
            aria-label={tr(
              sortDir === 'asc' ? 'sidebar.sort.ascending' : 'sidebar.sort.descending',
            )}
            onClick={toggleSortDir}
            className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-field)] text-fg-dim outline-none hover:text-fg focus:border-[var(--color-accent)]"
          >
            {sortDir === 'asc' ? (
              <ArrowDownNarrowWide className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ArrowUpNarrowWide className="h-4 w-4" aria-hidden="true" />
            )}
            <Tooltip
              label={tr(sortDir === 'asc' ? 'sidebar.sort.ascending' : 'sidebar.sort.descending')}
            />
          </button>
        )}
      </QualityFilterBar>
      {/* List actions get their own row under the filter/sort, not squeezed into
          it — crammed beside the filter they pushed the "All" quality dropdown out
          of sight. They operate on these rows, so they live in the list header (not
          the global toolbar where it wasn't clear which column they touched). */}
      <div className="flex items-center gap-0.5 px-1.5 pb-2">
        {/* Add files leads the list's own action row: it's what fills this column,
            so it belongs with the list rather than the global toolbar. */}
        <button
          type="button"
          data-testid="add-files"
          onClick={onAdd}
          aria-label={tr('header.add')}
          className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          <FilePlus className="h-4 w-4" aria-hidden="true" />
          <Tooltip label={tr('header.add')} hint={hintFor('add')} />
        </button>
        {tracks.length > 0 && (
          <>
            <span
              aria-hidden="true"
              className="mx-0.5 h-5 w-px shrink-0 self-center bg-[var(--color-line)]"
            />
            <button
              type="button"
              data-testid="select-all"
              onClick={onSelectAllTracks}
              aria-label={tr('header.selectAll')}
              className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
            >
              <SquareCheckBig className="h-4 w-4" aria-hidden="true" />
              <Tooltip label={tr('header.selectAll')} hint={hintFor('select-all')} />
            </button>
            {selectedId && (
              <button
                type="button"
                data-testid="reveal-selected"
                onClick={scrollToSelected}
                aria-label={tr('header.revealSelected')}
                className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
              >
                <Crosshair className="h-4 w-4" aria-hidden="true" />
                <Tooltip label={tr('header.revealSelected')} />
              </button>
            )}
            <button
              type="button"
              data-testid="fill-all"
              onClick={onFillAll}
              aria-label={tr('header.fillFromName')}
              className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
            >
              <Tag className="h-4 w-4" aria-hidden="true" />
              <Tooltip label={tr('header.fillFromName')} hint={hintFor('fill-all')} />
            </button>
            <button
              type="button"
              data-testid="open-find-replace"
              onClick={onFindReplace}
              aria-label={tr('commands.findReplace')}
              className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
            >
              <Replace className="h-4 w-4" aria-hidden="true" />
              <Tooltip label={tr('commands.findReplace')} hint={hintFor('find-replace')} />
            </button>
            {/* The destructive pair sits apart at the far end, mildest first:
                  clear the list (rows only), then move the selection to the
                  Trash (real files). */}
            <span className="flex-1" />
            <button
              type="button"
              data-testid="clear-all"
              onClick={onClearAll}
              aria-label={tr('header.clearAll')}
              className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-danger"
            >
              <ListX className="h-4 w-4" aria-hidden="true" />
              <Tooltip label={tr('header.clearAll')} />
            </button>
            <button
              type="button"
              data-testid="trash-selected"
              onClick={onTrashSelected}
              aria-label={tr('commands.trashSelected')}
              className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-danger"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <Tooltip label={tr('commands.trashSelected')} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
