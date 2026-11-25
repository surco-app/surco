import { ALL_TRACKS_ID } from '../../../shared/allTracks'
import { autoMatchAvailable, usableProviders } from '../../../shared/autoMatch'
import type { DjProgram } from '../../../shared/djProgram'
import { MATCHING_ID } from '../../../shared/matching'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import { TO_REVIEW_ID } from '../../../shared/toReview'
import type { PlaylistSource, Settings, SourcePlaylistEntry } from '../../../shared/types'
import type { SourceBrowser } from '../hooks/useSourceBrowser'
import type { TrackItem } from '../types'
import type { LibrarySource } from './librarySource'
import { canEdit, type SourceEdit } from './sourcePrograms'
import type { FilterSelection, TrackSort } from './triage'

// The crate narrowed to one playlist and put in the playlist's order. The crate itself is
// untouched — every loaded track keeps its edits whichever playlist is on screen — so this
// is a view, applied before the filters and sort the list already has.
//
// Paths are compared composed: the NAS stores names decomposed while Surco works composed
// (same rule as appleMusicPlaylists.entryForFile). A track is also found by its output: a
// conversion that is not in place repoints the rekordbox row at the new file. A track
// loaded from a path wins over one that converted into it, so outputs go in first and
// inputs overwrite them.
//
// Separators are kept one by one, each under its own key (its playlist row), so each can be
// dragged and removed; one in a run or after the last row is not folded away. Each shown
// track also knows its first row in the playlist, every row it has there, and its
// collection entry: a drag moves all its rows, a copy links that entry. It also knows the
// file that row names, which is not the track's own path when the track converted into it.
export interface PlaylistScope {
  tracks: TrackItem[]
  ids: readonly string[]
  pathOf: ReadonlyMap<string, string>
  rowPathOf: ReadonlyMap<string, string>
  separatorBefore: ReadonlyMap<string, readonly string[]>
  trailingSeparators: readonly string[]
  linkOf: ReadonlyMap<string, string>
  linksOf: ReadonlyMap<string, readonly string[]>
  contentOf: ReadonlyMap<string, string>
  addedOf: ReadonlyMap<string, number>
}

interface ComposedPaths {
  input: string
  output: string | undefined
  moved: string[]
}

const composedPaths = new WeakMap<TrackItem, ComposedPaths>()

function composed(t: TrackItem): ComposedPaths {
  let paths = composedPaths.get(t)
  if (!paths) {
    paths = {
      input: t.inputPath.normalize('NFC'),
      output: t.outputPath?.normalize('NFC'),
      moved: (t.movedFrom ?? []).map((p) => p.normalize('NFC')),
    }
    composedPaths.set(t, paths)
  }
  return paths
}

interface LaidOutFrom {
  entries: readonly SourcePlaylistEntry[]
  ids: readonly (string | undefined)[]
  paths: readonly (string | undefined)[]
}

const laidOutFrom = new WeakMap<PlaylistScope, LaidOutFrom>()

function sameLayout(a: LaidOutFrom, b: LaidOutFrom): boolean {
  return (
    a.entries === b.entries &&
    a.ids.length === b.ids.length &&
    a.ids.every((id, i) => id === b.ids[i] && a.paths[i] === b.paths[i])
  )
}

export function rowKeys(tracks: readonly { id: string }[]): string[] {
  const times = new Map<string, number>()
  return tracks.map((t) => {
    const n = times.get(t.id) ?? 0
    times.set(t.id, n + 1)
    return n === 0 ? t.id : `${t.id}~${n}`
  })
}

export function playlistPositions(
  all: readonly { id: string }[],
  shown: readonly { id: string }[],
): (number | undefined)[] {
  let next = 0
  return shown.map((row) => {
    for (let i = next; i < all.length; i++) {
      if (all[i].id === row.id) {
        next = i + 1
        return i + 1
      }
    }
    return undefined
  })
}

export function distinctById<T extends { id: string }>(tracks: T[]): T[] {
  const seen = new Set<string>()
  const distinct = tracks.filter((t) => !seen.has(t.id) && !!seen.add(t.id))
  return distinct.length === tracks.length ? tracks : distinct
}

export function playlistView(
  tracks: TrackItem[],
  entries: SourcePlaylistEntry[],
  previous: PlaylistScope | null = null,
  { repeats = false }: { repeats?: boolean } = {},
): PlaylistScope {
  const byPath = new Map<string, TrackItem>()
  for (const t of tracks) for (const p of composed(t).moved) byPath.set(p, t)
  for (const t of tracks) {
    const output = composed(t).output
    if (output) byPath.set(output, t)
  }
  for (const t of tracks) byPath.set(composed(t).input, t)
  const shown: TrackItem[] = []
  const seen = new Map<string, number>()
  const separatorBefore = new Map<string, string[]>()
  const linkOf = new Map<string, string>()
  const linksOf = new Map<string, string[]>()
  const contentOf = new Map<string, string>()
  const rowPathOf = new Map<string, string>()
  const addedOf = new Map<string, number>()
  const rowIds: (string | undefined)[] = []
  const rowPaths: (string | undefined)[] = []
  let pending: string[] = []
  // A separator with no row id of its own is keyed by the row it follows and its place in
  // that run, so a row added elsewhere does not rename it.
  let after = ''
  const runs = new Map<string, number>()
  entries.forEach((e) => {
    if (e.separator) {
      const n = runs.get(after) ?? 0
      runs.set(after, n + 1)
      pending.push(e.linkId ?? `sep-${after}-${n}`)
      return
    }
    after = e.path ?? ''
    const t = e.path ? byPath.get(e.path.normalize('NFC')) : undefined
    rowIds.push(t?.id)
    rowPaths.push(t?.inputPath)
    if (t && e.linkId) linksOf.set(t.id, [...(linksOf.get(t.id) ?? []), e.linkId])
    if (!t) return
    const times = seen.get(t.id) ?? 0
    if (times > 0 && !repeats) return
    seen.set(t.id, times + 1)
    shown.push(t)
    const key = times === 0 ? t.id : `${t.id}~${times}`
    if (times === 0 && e.linkId) linkOf.set(t.id, e.linkId)
    if (times === 0 && e.contentId) contentOf.set(t.id, e.contentId)
    if (times === 0 && e.path) rowPathOf.set(t.id, e.path)
    const added = e.meta.addedAt ?? Date.parse(e.meta.dateAdded ?? '')
    if (times === 0 && Number.isFinite(added)) addedOf.set(t.id, added)
    if (pending.length) separatorBefore.set(key, pending)
    pending = []
  })
  const from = { entries, ids: rowIds, paths: rowPaths }
  const before = previous && laidOutFrom.get(previous)
  const view =
    previous && before && sameLayout(before, from)
      ? { ...previous, tracks: shown, addedOf }
      : {
          tracks: shown,
          ids: shown.map((t) => t.id),
          pathOf: new Map(shown.map((t) => [t.id, t.inputPath])),
          rowPathOf,
          separatorBefore,
          trailingSeparators: pending,
          linkOf,
          linksOf,
          contentOf,
          addedOf,
        }
  laidOutFrom.set(view, from)
  return view
}

// Whether a track belongs to the open playlist, by the same path rules as playlistView, for
// the background sweeps: they work on the playlist on screen, not on every playlist the
// working list has gathered on the way.
export function playlistMembership(
  entries: readonly SourcePlaylistEntry[],
): (track: TrackItem) => boolean {
  const paths = new Set(
    entries.flatMap((e) => (e.path && !e.separator ? [e.path.normalize('NFC')] : [])),
  )
  return (t) => {
    const { input, output, moved } = composed(t)
    return paths.has(input) || (!!output && paths.has(output)) || moved.some((p) => paths.has(p))
  }
}

export function blocksWith<T extends { id: string }>(
  tracks: readonly T[],
  separatorBefore: ReadonlyMap<string, readonly string[]> | undefined,
  test: (track: T) => boolean,
  shown: (track: T) => boolean = () => true,
): { rows: T[]; separatorBefore: Map<string, readonly string[]> } {
  const blocks: { rows: T[]; breaks: readonly string[] | undefined }[] = []
  const keys = rowKeys(tracks)
  tracks.forEach((t, i) => {
    const breaks = separatorBefore?.get(keys[i])
    if (blocks.length === 0 || breaks) blocks.push({ rows: [], breaks })
    blocks[blocks.length - 1].rows.push(t)
  })
  const kept = blocks
    .map((block) => ({ ...block, rows: block.rows.filter(shown) }))
    .filter((block) => block.rows.some(test))
  const rows = kept.flatMap((block) => block.rows)
  const shownKeys = rowKeys(rows)
  const shownBreaks = new Map<string, readonly string[]>()
  let at = 0
  kept.forEach((block, i) => {
    if (i > 0 && block.breaks) shownBreaks.set(shownKeys[at], block.breaks)
    at += block.rows.length
  })
  return { rows, separatorBefore: shownBreaks }
}

export function blocksOf<T extends { id: string }>(
  tracks: readonly T[],
  separatorBefore: ReadonlyMap<string, readonly string[]> | undefined,
  chosen: ReadonlySet<string>,
): T[] {
  const picked = blocksWith(tracks, separatorBefore, (t) => chosen.has(t.id)).rows
  return distinctById(picked.length > 0 ? picked : [...tracks])
}

export interface ListScopeContext {
  playlistScope: PlaylistScope | null
  pickedSort: TrackSort
  browser: Pick<SourceBrowser, 'source' | 'playlist' | 'entries'>
  checkedPlaylist: string | null
  scopeRows: TrackItem[]
  filesView: TrackItem[]
  tracks: TrackItem[]
  showListPositions: boolean
  autoAnalyze: boolean | undefined
  analyzeAsked: boolean
  filterSelection: FilterSelection
  librarySource: LibrarySource
  sourceProgram: DjProgram | null
  selectedTracks: TrackItem[]
}

export interface ListScope {
  hasAddedDates: boolean
  sortBy: TrackSort
  listedCount: number
  filesAway: boolean
  openPlaylistId: string
  numberedTracks: TrackItem[] | undefined
  measuringGrid: boolean
  comparesLibraryCopy: boolean
  measuringLibrary: boolean
  cuesOpen: boolean
  batchCuesShown: boolean
}

export function listScopeFlags({
  playlistScope,
  pickedSort,
  browser,
  checkedPlaylist,
  scopeRows,
  filesView,
  tracks,
  showListPositions,
  autoAnalyze,
  analyzeAsked,
  filterSelection,
  librarySource,
  sourceProgram,
  selectedTracks,
}: ListScopeContext): ListScope {
  const hasAddedDates = (playlistScope?.addedOf.size ?? 0) > 0
  const sortBy = pickedSort === 'dateAdded' && !hasAddedDates ? 'import' : pickedSort
  const listedCount = browser.source ? tracks.length : filesView.length
  const filesAway =
    browser.source !== null &&
    browser.playlist !== null &&
    checkedPlaylist === `${browser.source}:${browser.playlist.id}` &&
    scopeRows.length === 0 &&
    (browser.entries?.some((e) => !e.separator) ?? false)
  // Keyed on the playlist once its rows are applied, not when it is picked: while its
  // entries load the list is empty, and the order must follow on arrival.
  const openPlaylistId = playlistScope ? (browser.playlist?.id ?? '') : ''
  const numberedTracks =
    showListPositions &&
    sortBy === 'import' &&
    browser.playlist?.id !== MATCHING_ID &&
    browser.playlist?.id !== TO_REVIEW_ID
      ? (playlistScope?.tracks ?? (browser.source ? undefined : filesView))
      : undefined
  // The grids and the comparison with the library copy are part of the analysis: they run
  // with it, by themselves when every import is analysed, else once Analyze is pressed. Picking
  // their filter still starts them, for a list nobody analysed yet.
  const measureAll = Boolean(autoAnalyze) || analyzeAsked
  const measuringGrid = filterSelection.attention === 'badGrid' || measureAll
  const comparesLibraryCopy = browser.source === null && librarySource === 'appleMusic'
  const measuringLibrary = filterSelection.library === 'betterThanLibrary' || measureAll
  const cuesOpen = sourceProgram !== null && browser.playlist !== null && playlistScope !== null
  const batchCuesShown = cuesOpen && selectedTracks.length > 1
  return {
    hasAddedDates,
    sortBy,
    listedCount,
    filesAway,
    openPlaylistId,
    numberedTracks,
    measuringGrid,
    comparesLibraryCopy,
    measuringLibrary,
    cuesOpen,
    batchCuesShown,
  }
}

export interface ToolbarScopeContext {
  source: PlaylistSource | null
  visibleTracks: TrackItem[]
  selectedTracks: TrackItem[]
  scopeTracks: TrackItem[]
  settings: Settings | null
  eligibleCount: number
  batching: boolean
}

export interface ToolbarScope {
  autoMatchButtonTracks: TrackItem[]
  needsToken: boolean
  tokenMissing: boolean
  canProcessAll: boolean
}

export function toolbarScopeFlags({
  source,
  visibleTracks,
  selectedTracks,
  scopeTracks,
  settings,
  eligibleCount,
  batching,
}: ToolbarScopeContext): ToolbarScope {
  const autoMatchButtonTracks = source === null ? visibleTracks : selectedTracks
  // Auto-match is on but the provider can't run (no Discogs token): the sweep silently does
  // nothing, so the toolbar button turns into a live "add a token" fix instead of a greyed
  // dead end. Only with tracks loaded — nothing to match on an empty list.
  const needsToken =
    scopeTracks.length > 0 && !!settings?.autoMatch && !autoMatchAvailable(settings)
  const tokenMissing =
    !!settings && !autoMatchAvailable(settings) && usableProviders(settings).includes('discogs')
  const canProcessAll = eligibleCount > 0 && !batching
  return { autoMatchButtonTracks, needsToken, tokenMissing, canProcessAll }
}

export interface OpenPlaylistEditsContext {
  editableSource: DjProgram | null
  sourceProgram: DjProgram | null
  sourceEdit: SourceEdit | null
  browser: Pick<SourceBrowser, 'playlist'>
  playlistScope: PlaylistScope | null
  cuesOpen: boolean
  openSmart: boolean
  selectedContentId: string | undefined
  sortBy: TrackSort
  search: string
  filterActive: boolean
}

export interface OpenPlaylistEdits {
  editableOpen: boolean
  cuesMarkable: boolean
  crateOpen: boolean
  inRekordbox: boolean
  otherOpen: boolean
  readsRekordboxCollection: boolean
  removablePlaylist: SourceBrowser['playlist']
  reorderEnabled: boolean
}

export function openPlaylistEditsOf({
  editableSource,
  sourceProgram,
  sourceEdit,
  browser,
  playlistScope,
  cuesOpen,
  openSmart,
  selectedContentId,
  sortBy,
  search,
  filterActive,
}: OpenPlaylistEditsContext): OpenPlaylistEdits {
  // Organising the open crate of an editable library. Every action sends one edit; what the
  // library holds afterwards is re-read and shown (useRekordboxEdits).
  const editableOpen =
    editableSource !== null && browser.playlist !== null && playlistScope !== null
  const crateOpen =
    editableOpen &&
    !openSmart &&
    browser.playlist?.id !== RECENTLY_ADDED_ID &&
    browser.playlist?.id !== ALL_TRACKS_ID &&
    browser.playlist?.id !== MATCHING_ID &&
    browser.playlist?.id !== TO_REVIEW_ID
  const inRekordbox = sourceProgram === 'rekordbox'
  const otherOpen =
    sourceProgram !== null && !inRekordbox && browser.playlist !== null && playlistScope !== null
  return {
    editableOpen,
    cuesMarkable: cuesOpen && sourceProgram !== null,
    crateOpen,
    inRekordbox,
    otherOpen,
    readsRekordboxCollection:
      otherOpen ||
      (inRekordbox && (Boolean(selectedContentId) || browser.playlist?.id === MATCHING_ID)),
    removablePlaylist:
      editableSource && crateOpen && canEdit(sourceEdit, 'remove') ? browser.playlist : null,
    // Reordering only means something in the playlist's own order with nothing hidden: under
    // another sort, a search or a filter, a drop would land among rows the user cannot see.
    reorderEnabled:
      crateOpen && sortBy === 'import' && !search && !filterActive && canEdit(sourceEdit, 'move'),
  }
}
