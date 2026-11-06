import {
  Asterisk,
  AudioLines,
  CircleAlert,
  CircleCheckBig,
  CircleFadingArrowUp,
  Copy as CopyIcon,
  Disc3,
  Eye,
  FileAudio,
  FileX2,
  FlagOff,
  Gauge,
  Grid2x2X,
  Hourglass,
  ImageMinus,
  ImageOff,
  KeyRound,
  List,
  ListChecks,
  ListMusic,
  ListPlus,
  type LucideIcon,
  Magnet,
  PencilLine,
  RefreshCw,
  Scissors,
  ShieldAlert,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Store,
  Trash2,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { LibrarySource } from '../lib/librarySource'
import { EMPTY_FILTER, type FilterSelection, type qualityCounts } from '../lib/triage'
import { FilterBar, FilterPanes, type PaneOption, type PaneSection } from './FilterBar'
import { Tooltip } from './Tooltip'

// The selectable bucket modes, one row each, grouped by the dimension they belong to.
type QualityMode = 'unanalyzed' | 'suspect' | 'damaged' | 'good'
type ConversionMode =
  | 'unsaved'
  | 'unconverted'
  | 'failed'
  | 'mismatch'
  | 'skipped'
  | 'automatched'
  | 'matchReview'
  | 'matchedDiscogs'
  | 'matchedBandcamp'
type LibraryMode = 'inLibrary' | 'notInLibrary' | 'betterThanLibrary'
type DuplicatesMode = 'duplicates'
type AttentionMode =
  | 'silence'
  | 'clipping'
  | 'noCues'
  | 'offGrid'
  | 'badGrid'
  | 'unanalysedRekordbox'
  | 'unanalysedEngine'
type TagsMode = 'missingRequired' | 'noCover' | 'smallCover' | 'noBpm' | 'noKey'
type Mode = QualityMode | ConversionMode | LibraryMode | DuplicatesMode | AttentionMode | TagsMode

const QUALITY_MODES: QualityMode[] = ['unanalyzed', 'suspect', 'damaged', 'good']
const CONVERSION_MODES: ConversionMode[] = [
  'unsaved',
  'unconverted',
  'failed',
  'mismatch',
  'skipped',
  'automatched',
  'matchReview',
  'matchedDiscogs',
  'matchedBandcamp',
]
const MATCH_MODES: Mode[] = ['automatched', 'matchReview', 'matchedDiscogs', 'matchedBandcamp']
const STATUS_MODES: Mode[] = CONVERSION_MODES.filter((m) => !MATCH_MODES.includes(m))
const TAGS_MODES: TagsMode[] = ['missingRequired', 'noCover', 'smallCover', 'noBpm', 'noKey']
const LIBRARY_MODES: LibraryMode[] = ['notInLibrary', 'inLibrary']
const DUPLICATES_MODES: DuplicatesMode[] = ['duplicates']
const ATTENTION_MODES: AttentionMode[] = [
  'silence',
  'clipping',
  'noCues',
  'offGrid',
  'badGrid',
  'unanalysedRekordbox',
  'unanalysedEngine',
]

// One Lucide glyph per quality/provenance/library bucket, kept consistent with the toolbar.
// Per-format buckets are a separate axis and all share the audio-file glyph.
const FILTER_ICONS: Record<Mode | 'all', LucideIcon> = {
  all: List,
  suspect: TriangleAlert,
  damaged: FileX2,
  good: CircleCheckBig,
  unanalyzed: AudioLines,
  unconverted: RefreshCw,
  failed: CircleAlert,
  mismatch: ShieldAlert,
  skipped: SkipForward,
  automatched: Sparkles,
  matchReview: Eye,
  matchedDiscogs: Disc3,
  matchedBandcamp: Store,
  inLibrary: ListMusic,
  notInLibrary: ListPlus,
  betterThanLibrary: CircleFadingArrowUp,
  duplicates: CopyIcon,
  silence: Scissors,
  clipping: Zap,
  noCues: FlagOff,
  offGrid: Magnet,
  badGrid: Grid2x2X,
  unanalysedRekordbox: Hourglass,
  unanalysedEngine: Hourglass,
  missingRequired: Asterisk,
  unsaved: PencilLine,
  noCover: ImageOff,
  smallCover: ImageMinus,
  noBpm: Gauge,
  noKey: KeyRound,
}

type Tally = ReturnType<typeof qualityCounts>

type SectionKey =
  | 'status'
  | 'quality'
  | 'tags'
  | 'match'
  | 'attention'
  | 'library'
  | 'format'
  | 'duplicates'

interface Measure {
  offered: boolean
  done: number
  total: number
}

// Which selection axis a bucket row toggles. Lets one handler flip the right field and one
// check read the right field, so a pick from each section can coexist.
function axisOf(mode: Mode): keyof Omit<FilterSelection, 'format'> {
  if ((QUALITY_MODES as string[]).includes(mode)) return 'quality'
  if ((CONVERSION_MODES as string[]).includes(mode)) return 'conversion'
  if (mode === 'duplicates') return 'duplicates'
  if ((ATTENTION_MODES as string[]).includes(mode)) return 'attention'
  if ((TAGS_MODES as string[]).includes(mode)) return 'tags'
  return 'library'
}

// The attention dot draws the eye to buckets that hold a problem, always in amber. Null for
// the rest.
//
// Deliberately unlabelled, and not a colour-only signal despite looking like one: the dot
// appears exactly when the bucket's count is above zero, and that count is rendered as
// text on the same row. A screen reader already hears "Suspect, 12"; the dot repeats it
// for the eye, so giving it its own accessible name would only say the number twice.
function attentionDot(mode: Mode, tally: Tally): string | null {
  if (mode === 'suspect' && tally.suspect > 0) return 'bg-warn'
  if (mode === 'damaged' && tally.damaged > 0) return 'bg-warn'
  // The retouch buckets exist to be worked through, so they carry the same amber
  // nudge as suspect while anything is left in them.
  if (mode === 'silence' && tally.silence > 0) return 'bg-warn'
  if (mode === 'clipping' && tally.clipping > 0) return 'bg-warn'
  if (mode === 'noCues' && tally.noCues > 0) return 'bg-warn'
  if (mode === 'offGrid' && tally.offGrid > 0) return 'bg-warn'
  if (mode === 'badGrid' && tally.badGrid > 0) return 'bg-warn'
  if (mode === 'missingRequired' && tally.missingRequired > 0) return 'bg-warn'
  if (mode === 'mismatch' && tally.mismatch > 0) return 'bg-warn'
  return null
}

interface Props {
  // Optional ref on the filter bar. Keyboard paging now measures the whole sticky header
  // (in TrackListHeader) rather than this bar alone, so it's usually left unset.
  filterRef?: React.RefObject<HTMLDivElement | null>
  // Which library the membership buckets read (the conversion destination's), so their
  // labels name the right one — "In Engine DJ" when conversions land there.
  librarySource: LibrarySource
  gridMeasure?: Measure
  // The comparison of each file with the copy Apple Music already holds, which the
  // better-than-the-library bucket reads. Offered only when some track has one.
  libraryMeasure?: Measure
  // The combined selection — one choice per axis (quality / conversion / library / format),
  // all ANDed. The bar toggles a single axis per click and leaves the menu open, so picking
  // one from each section stacks the filters instead of replacing the previous choice.
  value: FilterSelection
  onChange: (next: FilterSelection) => void
  tally: Tally
  // The distinct source formats present, each with its count — only populated for a mixed
  // crate so a single-format list grows no format section.
  formats: { format: string; count: number }[]
  facets: { tally: Tally; formats: Record<string, number> }
  trackCount: number
  visibleCount: number
  // 1-based position of the selected row within the current view, or null.
  selectedPosition: number | null
  // How many rows are selected. Above one the counter shows "N selected" instead of a
  // position, so a multi-select shows its size where the single-track position usually sits.
  selectedCount: number
  // Scrolls the selected row into view — the position counter clicks through to it, so a
  // number the DJ can see becomes a way back to the row it counts.
  onRevealSelected: () => void
  // Moves every flagged rip to the Trash (after App's confirm). Surfaced as a one-click button
  // only while the suspect bucket is the active filter and holds fakes, so the destructive
  // action appears exactly when the DJ is looking at the fakes it would purge.
  onTrashSuspects: () => void
  onReviewIncomplete?: () => void
  // Controls that share the filter row — the track sort and its direction toggle — sitting
  // beside the filter trigger so the search box above can take the full width.
  children?: React.ReactNode
}

// The sidebar's quality-triage filter: a single dropdown (so a wide crate's many buckets
// and large counts can never overflow the narrow, resizable sidebar the way a row of
// chips did), plus the always-visible "x/total" position counter. Each dimension is an
// independent axis — picking a bucket toggles only its axis and keeps the menu open, so a
// DJ can layer one choice from each section ("not in Apple Music" + "good" + "WAV") in one
// pass. The buckets — with the provenance and Apple Music ones appearing only once they
// have something to show — list inside the menu, each with its icon, count and attention
// dot. Presentational: App owns the selection, the tallies and the counts and hands them
// in. Mirrors Select's interaction (focus the active option on open, Escape/backdrop close,
// arrow keys move).
export function QualityFilterBar({
  filterRef,
  librarySource,
  value,
  onChange,
  tally,
  formats,
  facets,
  trackCount,
  visibleCount,
  selectedPosition,
  selectedCount,
  onRevealSelected,
  onTrashSuspects,
  onReviewIncomplete,
  gridMeasure,
  libraryMeasure,
  children,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The library buckets are shared mode strings; only their display names depend on
  // which library is active, so the swap lives here rather than forking the modes.
  const filterLabel = (mode: string): string =>
    librarySource === 'engineDj' && (mode === 'inLibrary' || mode === 'notInLibrary')
      ? tr(`sidebar.filter.${mode}Engine`)
      : tr(`sidebar.filter.${mode}`)

  const progressOf = (measure: Measure | undefined) =>
    measure && measure.total > 0 && measure.done < measure.total
      ? {
          text: `${Math.floor((measure.done / measure.total) * 100)} %`,
          title: tr('sidebar.filter.gridMeasuring', {
            done: measure.done,
            total: measure.total,
          }),
        }
      : undefined
  const progress: Partial<Record<Mode, ReturnType<typeof progressOf>>> = {
    badGrid: progressOf(gridMeasure),
    betterThanLibrary: progressOf(libraryMeasure),
  }
  const sectionLabel = (key: SectionKey): string =>
    key === 'library' && librarySource === 'engineDj'
      ? tr('sidebar.filter.section.libraryEngine')
      : key === 'duplicates'
        ? tr('sidebar.filter.duplicates')
        : tr(`sidebar.filter.section.${key}`)
  const countOf = (mode: Mode): number => facets.tally[mode as keyof Tally]
  const isActive = (mode: Mode): boolean => value[axisOf(mode)] === mode
  // Toggle one axis and close, like a native select. The axes are still independent — the
  // reopened menu shows the current ticks — so layering a second axis is one reopen away,
  // while the common single-filter pick closes the moment it's made.
  function toggle(mode: Mode, close: () => void): void {
    const axis = axisOf(mode)
    onChange({ ...value, [axis]: isActive(mode) ? null : mode })
    close()
  }

  function toggleFormat(format: string, close: () => void): void {
    onChange({ ...value, format: value.format === format ? null : format })
    close()
  }

  // Clears every axis at once, so it's a true "show everything" reset rather than only
  // resetting one dimension and leaving the others quietly applied.
  function clearAll(close: () => void): void {
    onChange(EMPTY_FILTER)
    close()
  }

  // What the closed trigger shows. With nothing active it's a bare "All"; with exactly one
  // axis it surfaces that bucket (icon, label, count) so the user sees what's filtering
  // without opening; with several it collapses to a generic "Filters" badge counting the
  // tracks that survive the combined filter (the per-axis counts are absolute, so none of
  // them would describe the intersection).
  const activeChips: { Icon: LucideIcon; label: string; count: number }[] = []
  if (value.quality)
    activeChips.push({
      Icon: FILTER_ICONS[value.quality],
      label: tr(`sidebar.filter.${value.quality}`),
      count: countOf(value.quality),
    })
  if (value.conversion)
    activeChips.push({
      Icon: FILTER_ICONS[value.conversion],
      label: tr(`sidebar.filter.${value.conversion}`),
      count: countOf(value.conversion),
    })
  if (value.library)
    activeChips.push({
      Icon: FILTER_ICONS[value.library],
      label: filterLabel(value.library),
      count: countOf(value.library),
    })
  if (value.duplicates)
    activeChips.push({
      Icon: FILTER_ICONS.duplicates,
      label: tr('sidebar.filter.duplicates'),
      count: countOf('duplicates'),
    })
  if (value.attention)
    activeChips.push({
      Icon: FILTER_ICONS[value.attention],
      label: tr(`sidebar.filter.${value.attention}`),
      count: countOf(value.attention),
    })
  if (value.tags)
    activeChips.push({
      Icon: FILTER_ICONS[value.tags],
      label: tr(`sidebar.filter.${value.tags}`),
      count: countOf(value.tags),
    })
  if (value.format)
    activeChips.push({
      Icon: FileAudio,
      label: value.format,
      count: facets.formats[value.format] ?? 0,
    })

  const trigger =
    activeChips.length === 0
      ? { Icon: List, label: tr('sidebar.filter.all'), count: trackCount }
      : activeChips.length === 1
        ? activeChips[0]
        : { Icon: SlidersHorizontal, label: tr('sidebar.filter.multiple'), count: visibleCount }
  // Keep the suspect nudge on the trigger even when another filter is active, so a crate
  // full of likely-fake rips still flags itself now that the buckets are hidden in a menu.
  const triggerDot = tally.suspect > 0 ? 'bg-warn' : null

  const modeOption = (mode: Mode, close: () => void): PaneOption => ({
    id: mode,
    Icon: FILTER_ICONS[mode],
    dot: attentionDot(mode, facets.tally),
    label: filterLabel(mode),
    progress: progress[mode],
    count: countOf(mode),
    selected: isActive(mode),
    onPick: () => toggle(mode, close),
  })
  // Every section is always there and lists every one of its filters, an empty one dimmed,
  // so a filter is found where it was last time instead of turning up only once some track
  // lands in it. The one exception is the library section, which needs a library to read.
  const sections = (close: () => void): PaneSection[] => {
    const of = (key: SectionKey, modes: Mode[]): PaneSection => ({
      key,
      label: sectionLabel(key),
      options: modes.map((m) => modeOption(m, close)),
    })
    return [
      of('status', STATUS_MODES),
      of('quality', QUALITY_MODES),
      of('tags', TAGS_MODES),
      of('match', MATCH_MODES),
      of('attention', ATTENTION_MODES),
      ...(librarySource ? [of('library', [...LIBRARY_MODES, 'betterThanLibrary'])] : []),
      {
        key: 'format',
        label: sectionLabel('format'),
        empty: tr('sidebar.filter.oneFormat'),
        options: formats.map((f) => ({
          id: `ext:${f.format}`,
          Icon: FileAudio,
          label: f.format,
          count: facets.formats[f.format] ?? 0,
          selected: value.format === f.format,
          onPick: () => toggleFormat(f.format, close),
        })),
      },
      of('duplicates', DUPLICATES_MODES),
    ]
  }

  return (
    <FilterBar
      testid="quality-filter"
      filterRef={filterRef}
      trigger={{ ...trigger, dot: triggerDot }}
      listLabel={tr('sidebar.filter.label')}
      options={(close) => (
        <FilterPanes
          testid="quality-filter"
          sections={sections(close)}
          sectionsLabel={tr('sidebar.filter.label')}
          shown={tr('sidebar.filter.shown', { visible: visibleCount, total: trackCount })}
          clearLabel={tr('sidebar.filter.clear')}
          canClear={activeChips.length > 0}
          onClear={() => clearAll(close)}
        />
      )}
      counterTestId="track"
      visibleCount={visibleCount}
      selectedPosition={selectedPosition}
      selectedCount={selectedCount}
      onRevealSelected={onRevealSelected}
    >
      {children}
      {value.quality === 'suspect' && tally.suspect > 0 && (
        <button
          type="button"
          data-testid="trash-suspects"
          aria-label={tr('sidebar.filter.trashSuspects', { count: tally.suspect })}
          onClick={onTrashSuspects}
          className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-dim outline-none hover:bg-[var(--color-hover)] hover:text-warn"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          <Tooltip label={tr('sidebar.filter.trashSuspects', { count: tally.suspect })} />
        </button>
      )}
      {value.tags === 'missingRequired' && onReviewIncomplete && (
        <button
          type="button"
          data-testid="review-incomplete"
          aria-label={tr('sidebar.filter.reviewIncomplete')}
          onClick={onReviewIncomplete}
          className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-dim outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-accent)]"
        >
          <ListChecks className="h-4 w-4" aria-hidden="true" />
          <Tooltip label={tr('sidebar.filter.reviewIncomplete')} />
        </button>
      )}
    </FilterBar>
  )
}
