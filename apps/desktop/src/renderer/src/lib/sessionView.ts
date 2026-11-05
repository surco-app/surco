import type { AppStore } from './appStore'
import type {
  AttentionFilter,
  ConversionFilter,
  DuplicatesFilter,
  FilterSelection,
  LibraryFilter,
  QualityFilter,
  SortDir,
  TagsFilter,
  TrackSort,
} from './triage'

// The list view a reopened session brings back with its tracks, down to the track the user
// had reached.
export interface SessionView {
  selectedPath: string | null
  playback: SessionPlayback | null
  search: string
  sortBy: TrackSort
  sortDir: SortDir
  filters: FilterSelection
}

export interface SessionPlayback {
  path: string
  time: number
}

type AppState = ReturnType<AppStore['getState']>

export function sessionViewOf(
  state: AppState,
  selectedPath: string | null,
  playback: SessionPlayback | null,
): SessionView {
  return {
    selectedPath,
    playback,
    search: state.search,
    sortBy: state.sortBy,
    sortDir: state.sortDir,
    filters: {
      quality: state.qualityFilter,
      conversion: state.conversionFilter,
      library: state.libraryFilter,
      duplicates: state.duplicatesFilter,
      attention: state.attentionFilter,
      tags: state.tagsFilter,
      format: state.formatFilter,
    },
  }
}

export function viewPatch(view: SessionView): Partial<AppState> {
  return {
    search: view.search,
    sortBy: view.sortBy,
    sortDir: view.sortDir,
    qualityFilter: view.filters.quality,
    conversionFilter: view.filters.conversion,
    libraryFilter: view.filters.library,
    duplicatesFilter: view.filters.duplicates,
    attentionFilter: view.filters.attention,
    tagsFilter: view.filters.tags,
    formatFilter: view.filters.format,
  }
}

// Records rather than lists, so a value added to one of the unions fails to compile here
// until the reopen learns it too.
const SORTS: Record<TrackSort, true> = {
  import: true,
  name: true,
  artist: true,
  duration: true,
  format: true,
  trackNumber: true,
  bpm: true,
  key: true,
  year: true,
  quality: true,
}
const QUALITY: Record<QualityFilter, true> = {
  suspect: true,
  good: true,
  unanalyzed: true,
  damaged: true,
}
const CONVERSION: Record<ConversionFilter, true> = {
  unsaved: true,
  mismatch: true,
  unconverted: true,
  failed: true,
  skipped: true,
  automatched: true,
  matchReview: true,
  matchedDiscogs: true,
  matchedBandcamp: true,
}
const LIBRARY: Record<LibraryFilter, true> = {
  inLibrary: true,
  notInLibrary: true,
  betterThanLibrary: true,
}
const DUPLICATES: Record<DuplicatesFilter, true> = { duplicates: true }
const ATTENTION: Record<AttentionFilter, true> = {
  silence: true,
  clipping: true,
  noCues: true,
  offGrid: true,
  badGrid: true,
  unanalysedRekordbox: true,
  unanalysedEngine: true,
}
const TAGS: Record<TagsFilter, true> = {
  missingRequired: true,
  noCover: true,
  smallCover: true,
  noBpm: true,
  noKey: true,
}

function known<T extends string>(table: Record<T, true>, value: unknown): T | null {
  return typeof value === 'string' && Object.hasOwn(table, value) ? (value as T) : null
}

function parsePlayback(raw: unknown): SessionPlayback | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { path, time } = raw as Record<string, unknown>
  if (typeof path !== 'string' || typeof time !== 'number') return null
  return Number.isFinite(time) && time >= 0 ? { path, time } : null
}

export function parseSessionView(raw: unknown): SessionView | null {
  if (typeof raw !== 'object' || raw === null) return null
  const view = raw as Record<string, unknown>
  const filters =
    typeof view.filters === 'object' && view.filters !== null
      ? (view.filters as Record<string, unknown>)
      : {}
  return {
    selectedPath: typeof view.selectedPath === 'string' ? view.selectedPath : null,
    playback: parsePlayback(view.playback),
    search: typeof view.search === 'string' ? view.search : '',
    sortBy: known(SORTS, view.sortBy) ?? 'import',
    sortDir: view.sortDir === 'desc' ? 'desc' : 'asc',
    filters: {
      quality: known(QUALITY, filters.quality),
      conversion: known(CONVERSION, filters.conversion),
      library: known(LIBRARY, filters.library),
      duplicates: known(DUPLICATES, filters.duplicates),
      attention: known(ATTENTION, filters.attention),
      tags: known(TAGS, filters.tags),
      format: typeof filters.format === 'string' ? filters.format : null,
    },
  }
}
