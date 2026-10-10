import type { TFunction } from 'i18next'
import {
  ArrowDownNarrowWide,
  ArrowDownUp,
  ArrowUpNarrowWide,
  CaseSensitive,
  Clock,
  Crosshair,
  Ellipsis,
  FileAudio,
  FilePlus,
  ListMinus,
  ListMusic,
  ListOrdered,
  ListX,
  type LucideIcon,
  Replace,
  SpellCheck,
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
import { useSplitMenu } from './SplitButton'
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
  // Opens the Apple Music playlist picker. Undefined off macOS, where the button is not
  // rendered at all rather than shown disabled: nothing the user could configure would
  // make it work there.
  onImportApplePlaylist?: () => void
  onSelectAllTracks: () => void
  scrollToSelected: () => void
  onFillAll: () => void
  onFindReplace: () => void
  onReviewList: () => void
  canReviewList: boolean
  onClearAll: () => void
  onRemoveSelected: () => void
  onTrashSelected: () => void
  onTrashSuspects: () => void
}

function MenuAction({
  testid,
  icon: Icon,
  label,
  hint,
  danger,
  disabled,
  onClick,
}: {
  testid: string
  icon: LucideIcon
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--color-hover)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
        danger ? 'text-danger' : 'text-fg'
      }`}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {hint && (
        <span aria-hidden="true" className="shrink-0 pl-3 text-fg-faint">
          {hint}
        </span>
      )}
    </button>
  )
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
  onImportApplePlaylist,
  onSelectAllTracks,
  scrollToSelected,
  onFillAll,
  onFindReplace,
  onReviewList,
  canReviewList,
  onClearAll,
  onRemoveSelected,
  onTrashSelected,
  onTrashSuspects,
}: Props): React.JSX.Element {
  const { open, setOpen, ref: moreRef, toggleRef, menuRef, onMenuKeyDown } = useSplitMenu()

  function run(action: () => void): void {
    setOpen(false)
    action()
  }

  return (
    // The ref measures the WHOLE sticky header (search + filter + sort), not just the filter
    // bar: keyboard paging offsets the selected row by this height so it lands clear of the
    // header. Measuring only the filter bar left the row tucked under the search/sort rows
    // above it — cut off at the top. offsetHeight re-reads on every page, so it tracks the
    // header's real height at any window size.
    <div
      ref={qualityFilterRef}
      className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-ink)]"
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
          bare
          value={sortBy}
          onChange={(v) => setSortBy(v as TrackSort)}
          label={tr('sidebar.sort.label')}
          options={[
            { value: 'import', label: tr('sidebar.sort.import'), icon: ArrowDownUp },
            { value: 'name', label: tr('sidebar.sort.name'), icon: CaseSensitive },
            { value: 'artist', label: tr('sidebar.sort.artist'), icon: User },
            { value: 'duration', label: tr('sidebar.sort.duration'), icon: Clock },
            { value: 'format', label: tr('sidebar.sort.format'), icon: FileAudio },
            { value: 'trackNumber', label: tr('sidebar.sort.trackNumber'), icon: ListOrdered },
          ]}
        />
        {sortBy !== 'import' && (
          <button
            type="button"
            data-testid="track-sort-direction"
            // A toggle: the name holds still and aria-pressed says whether it's on. A label
            // that swapped with the state read back as the opposite of the order shown.
            aria-pressed={sortDir === 'desc'}
            aria-label={tr('sidebar.sort.descending')}
            onClick={toggleSortDir}
            className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-dim outline-none hover:bg-[var(--color-hover)] hover:text-fg"
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
      {/* Quieter than the tracks they act on: faint 14px glyphs, so the eye lands on the
          list first and finds the tools when it looks for them. */}
      <div className="relative flex items-center gap-0.5 px-1.5 pb-1.5">
        {/* Add files leads the list's own action row: it's what fills this column,
            so it belongs with the list rather than the global toolbar. */}
        <button
          type="button"
          data-testid="add-files"
          onClick={onAdd}
          aria-label={tr('header.add')}
          className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint outline-none transition-colors hover:bg-[var(--color-hover)] hover:text-fg"
        >
          <FilePlus className="h-3.5 w-3.5" aria-hidden="true" />
          <Tooltip label={tr('header.add')} hint={hintFor('add')} />
        </button>
        {/* Its sibling: the other way to fill this column, so it sits beside adding files
            rather than hiding in the palette once a list is loaded. */}
        {onImportApplePlaylist && (
          <button
            type="button"
            data-testid="import-apple-playlist"
            onClick={onImportApplePlaylist}
            aria-label={tr('commands.importApplePlaylist')}
            className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint outline-none transition-colors hover:bg-[var(--color-hover)] hover:text-fg"
          >
            <ListMusic className="h-3.5 w-3.5" aria-hidden="true" />
            <Tooltip label={tr('commands.importApplePlaylist')} />
          </button>
        )}
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
              className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint outline-none transition-colors hover:bg-[var(--color-hover)] hover:text-fg"
            >
              <SquareCheckBig className="h-3.5 w-3.5" aria-hidden="true" />
              <Tooltip label={tr('header.selectAll')} hint={hintFor('select-all')} />
            </button>
            {selectedId && (
              <button
                type="button"
                data-testid="reveal-selected"
                onClick={scrollToSelected}
                aria-label={tr('header.revealSelected')}
                className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint outline-none transition-colors hover:bg-[var(--color-hover)] hover:text-fg"
              >
                <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                <Tooltip label={tr('header.revealSelected')} />
              </button>
            )}
            <span className="flex-1" />
            <button
              type="button"
              data-testid="remove-selected"
              onClick={onRemoveSelected}
              disabled={!selectedId && selectedIds.length === 0}
              aria-label={tr('trackList.context.remove')}
              className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint outline-none transition-colors hover:bg-[var(--color-hover)] hover:text-fg disabled:opacity-40"
            >
              <ListMinus className="h-3.5 w-3.5" aria-hidden="true" />
              <Tooltip label={tr('trackList.context.remove')} />
            </button>
            <div ref={moreRef} className="shrink-0">
              <button
                type="button"
                data-testid="list-actions-more"
                ref={toggleRef}
                onClick={() => setOpen((v) => !v)}
                aria-label={tr('header.moreActions')}
                aria-haspopup="menu"
                aria-expanded={open}
                className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint outline-none transition-colors hover:bg-[var(--color-hover)] hover:text-fg aria-expanded:bg-[var(--color-hover)] aria-expanded:text-fg"
              >
                <Ellipsis className="h-3.5 w-3.5" aria-hidden="true" />
                <Tooltip label={tr('header.moreActions')} />
              </button>
              {open && (
                <div
                  ref={menuRef}
                  role="menu"
                  aria-label={tr('header.moreActions')}
                  onKeyDown={onMenuKeyDown}
                  className="animate-pop-flat absolute top-full right-1.5 z-50 w-max max-w-[calc(100%-0.75rem)] origin-top-right rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)]"
                >
                  <MenuAction
                    testid="list-review-open"
                    icon={SpellCheck}
                    label={tr('header.menu.review')}
                    hint={hintFor('list-review')}
                    disabled={!canReviewList}
                    onClick={() => run(onReviewList)}
                  />
                  <MenuAction
                    testid="fill-all"
                    icon={Tag}
                    label={tr('header.menu.fill')}
                    hint={hintFor('fill-all')}
                    onClick={() => run(onFillAll)}
                  />
                  <MenuAction
                    testid="open-find-replace"
                    icon={Replace}
                    label={tr('header.menu.findReplace')}
                    hint={hintFor('find-replace')}
                    onClick={() => run(onFindReplace)}
                  />
                  <hr className="my-1 h-px border-0 bg-[var(--color-line)]" />
                  <MenuAction
                    testid="trash-selected"
                    icon={Trash2}
                    label={tr('header.menu.trash')}
                    danger
                    disabled={!selectedId && selectedIds.length === 0}
                    onClick={() => run(onTrashSelected)}
                  />
                  <MenuAction
                    testid="clear-all"
                    icon={ListX}
                    label={tr('header.menu.clear')}
                    danger
                    onClick={() => run(onClearAll)}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
