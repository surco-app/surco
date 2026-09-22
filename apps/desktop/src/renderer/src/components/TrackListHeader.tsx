import type { TFunction } from 'i18next'
import {
  ArrowDownNarrowWide,
  ArrowDownUp,
  ArrowUpNarrowWide,
  CaseSensitive,
  Clock,
  FileAudio,
  FilePlus,
  ListMusic,
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
  selectedIds: string[]
  // 1-based position of the selected row, shown when exactly one row is selected.
  selectedPosition: number | null
  onAdd: () => void
  // Opens the Apple Music playlist picker. Undefined off macOS, where the button is not
  // rendered at all rather than shown disabled: nothing the user could configure would
  // make it work there.
  onImportApplePlaylist?: () => void
  scrollToSelected: () => void
  onTrashSuspects: () => void
}

// The track column's sticky header: search, the ways to fill the list, the quality/format
// filter and the sort control. The list-wide tools (select all, fill from name, find and
// replace, clear, move to Trash) live in the Tracks and File menus and the palette. Pure
// presentation — every handler is owned by App, which is where the
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
  selectedIds,
  selectedPosition,
  onAdd,
  onImportApplePlaylist,
  scrollToSelected,
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
        {/* Add files sits beside the search: it's what fills this column, so it
            belongs with the list rather than the global toolbar. */}
        <button
          type="button"
          data-testid="add-files"
          onClick={onAdd}
          aria-label={tr('header.add')}
          className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          <FilePlus className="h-4 w-4" aria-hidden="true" />
          <Tooltip label={tr('header.add')} hint={hintFor('add')} align="end" />
        </button>
        {/* Its sibling: the other way to fill this column, so it sits beside adding files
            rather than hiding in the palette once a list is loaded. */}
        {onImportApplePlaylist && (
          <button
            type="button"
            data-testid="import-apple-playlist"
            onClick={onImportApplePlaylist}
            aria-label={tr('commands.importApplePlaylist')}
            className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
          >
            <ListMusic className="h-4 w-4" aria-hidden="true" />
            <Tooltip label={tr('commands.importApplePlaylist')} align="end" />
          </button>
        )}
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
    </div>
  )
}
