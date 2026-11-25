import type {
  PlaylistLibrary,
  RekordboxPlaylistTarget,
  RekordboxQueueWritten,
  SourceNode,
  SourcePlaylistEntry,
} from '../../../shared/types'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { pathKey } from './pathKey'
import { SOURCE_PROGRAMS } from './sourcePrograms'

export interface PlaylistOption {
  id: string
  name: string
  path: string
}

export type Membership = Record<string, string[]>

const wantedOf = (t: TrackItem, library: PlaylistLibrary) => t.playlists?.[library]?.targets
const baseOf = (t: TrackItem, library: PlaylistLibrary) => t.playlists?.[library]?.base

export function playlistOptions(tree: readonly SourceNode[]): PlaylistOption[] {
  const out: PlaylistOption[] = []
  const walk = (nodes: readonly SourceNode[], trail: string[]): void => {
    for (const node of nodes) {
      if (node.kind === 'playlist' && !node.smart)
        out.push({ id: node.id, name: node.name, path: trail.join(' › ') })
      walk(node.children ?? [], [...trail, node.name])
    }
  }
  walk(tree, [])
  return out
}

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()

export function targetKey(target: RekordboxPlaylistTarget): string {
  return target.id ?? `new:${target.name}`
}

export function matchingOptions(
  options: readonly PlaylistOption[],
  text: string,
  chosen: readonly RekordboxPlaylistTarget[],
): PlaylistOption[] {
  const taken = new Set(
    chosen.flatMap((t) => {
      const id = resolveTarget(t, options).id
      return id ? [id] : []
    }),
  )
  const words = fold(text).split(/\s+/).filter(Boolean)
  return options.filter((o) => {
    if (taken.has(o.id)) return false
    const haystack = fold(`${o.path} ${o.name}`)
    return words.every((w) => haystack.includes(w))
  })
}

export function canCreate(
  options: readonly PlaylistOption[],
  text: string,
  chosen: readonly RekordboxPlaylistTarget[],
): boolean {
  const name = text.trim()
  return (
    name !== '' &&
    !options.some((o) => o.name === name) &&
    !chosen.some((t) => !t.id && t.name === name)
  )
}

export function rekordboxPathOf(track: Pick<TrackItem, 'inputPath' | 'outputPath'>): string {
  return track.outputPath || track.inputPath
}

function resolveTarget(
  target: RekordboxPlaylistTarget,
  options: readonly PlaylistOption[],
): RekordboxPlaylistTarget {
  if (target.id) return target
  const root = options.find((o) => o.path === '' && o.name === target.name)
  return root ? { id: root.id, name: root.name } : target
}

const namesById = new WeakMap<readonly PlaylistOption[], Map<string, string>>()

function namesOf(options: readonly PlaylistOption[]): Map<string, string> {
  let byId = namesById.get(options)
  if (!byId) {
    byId = new Map(options.map((o) => [o.id, o.name]))
    namesById.set(options, byId)
  }
  return byId
}

export function effectivePlaylists(
  track: TrackItem,
  membership: Membership | undefined,
  options: readonly PlaylistOption[] | undefined,
  library: PlaylistLibrary = 'rekordbox',
): RekordboxPlaylistTarget[] | undefined {
  if (!membership || !options) return undefined
  const wanted = wantedOf(track, library)
  if (wanted) return wanted.map((t) => resolveTarget(t, options))
  return playlistsOfPath(rekordboxPathOf(track), membership, options)
}

export function playlistsOfPath(
  path: string,
  membership: Membership,
  options: readonly PlaylistOption[],
): RekordboxPlaylistTarget[] {
  const byId = namesOf(options)
  return (membership[path] ?? []).flatMap((id) => {
    const name = byId.get(id)
    return name === undefined ? [] : [{ id, name }]
  })
}

export function linkIdsOf(
  entries: readonly SourcePlaylistEntry[],
  paths: readonly string[],
): string[] {
  const keys = new Set(paths.map(pathKey))
  return entries.flatMap((e) =>
    !e.separator && e.linkId !== undefined && e.path !== null && keys.has(pathKey(e.path))
      ? [e.linkId]
      : [],
  )
}

export function linkAfter(
  entries: readonly SourcePlaylistEntry[],
  linkIds: readonly string[],
): string | null {
  const removed = new Set(linkIds)
  const last = entries.findLastIndex((e) => e.linkId !== undefined && removed.has(e.linkId))
  if (last < 0) return null
  const next = entries.slice(last + 1).find((e) => e.linkId !== undefined && !removed.has(e.linkId))
  return next?.linkId ?? null
}

export function bulkPlaylistState(
  tracks: readonly TrackItem[],
  membership: Membership | undefined,
  options: readonly PlaylistOption[] | undefined,
  library: PlaylistLibrary = 'rekordbox',
  copyPathOf?: (t: TrackItem) => string | undefined,
): { target: RekordboxPlaylistTarget; state: 'all' | 'some' }[] | undefined {
  if (!membership || !options) return undefined
  const seen = new Map<string, { target: RekordboxPlaylistTarget; n: number }>()
  for (const t of tracks) {
    const copy = copyPathOf?.(t)
    const lists = copy
      ? playlistsOfPath(copy, membership, options)
      : (effectivePlaylists(t, membership, options, library) ?? [])
    for (const target of lists) {
      const entry = seen.get(targetKey(target)) ?? { target, n: 0 }
      entry.n += 1
      seen.set(targetKey(target), entry)
    }
  }
  return [...seen.values()].map(({ target, n }) => ({
    target,
    state: n === tracks.length ? 'all' : 'some',
  }))
}

export type PlaylistsEdit = Pick<TrackItem, 'playlists'>

export function playlistsEdit(
  track: TrackItem,
  membership: Membership,
  next: RekordboxPlaylistTarget[],
  library: PlaylistLibrary = 'rekordbox',
): PlaylistsEdit {
  return {
    playlists: {
      [library]: {
        targets: next,
        base: baseOf(track, library) ?? membership[rekordboxPathOf(track)] ?? [],
      },
    },
  }
}

export function withTarget(
  tracks: readonly TrackItem[],
  membership: Membership | undefined,
  options: readonly PlaylistOption[] | undefined,
  target: RekordboxPlaylistTarget,
  on: boolean,
  library: PlaylistLibrary = 'rekordbox',
  copyPathOf?: (t: TrackItem) => string | undefined,
): ({ id: string } & PlaylistsEdit)[] | undefined {
  if (!membership || !options) return undefined
  // A track on its copy is written to the program at once, so nothing is staged for it.
  return tracks
    .filter((t) => !copyPathOf?.(t))
    .filter((t) => SOURCE_PROGRAMS[library].addsUncollected || rekordboxPathOf(t) in membership)
    .map((t) => {
      const rest = (effectivePlaylists(t, membership, options, library) ?? []).filter(
        (x) => targetKey(x) !== targetKey(target),
      )
      return {
        id: t.id,
        ...playlistsEdit(t, membership, on ? [...rest, target] : rest, library),
      }
    })
}

function withoutPlaylistEdit(t: TrackItem, library: PlaylistLibrary): TrackItem {
  const before = trackSignature(t)
  const { [library]: _, ...playlists } = t.playlists ?? {}
  const cleared: TrackItem = { ...t, playlists }
  const after = trackSignature(cleared)
  return {
    ...cleared,
    ...(t.processedSignature === before && { processedSignature: after }),
    ...(t.diskSignature === before && { diskSignature: after }),
  }
}

export function discardPlaylistEdits(
  tracks: TrackItem[],
  paths: string[],
  library: PlaylistLibrary = 'rekordbox',
): TrackItem[] {
  const discarded = new Set(paths)
  return tracks.map((t) =>
    !wantedOf(t, library) || !discarded.has(rekordboxPathOf(t))
      ? t
      : withoutPlaylistEdit(t, library),
  )
}

function sameTargets(a: RekordboxPlaylistTarget[], b: RekordboxPlaylistTarget[]): boolean {
  const keys = new Set(a.map(targetKey))
  return keys.size === new Set(b.map(targetKey)).size && b.every((t) => keys.has(targetKey(t)))
}

export function clearWrittenPlaylists(
  tracks: TrackItem[],
  written: RekordboxQueueWritten[],
  library: PlaylistLibrary = 'rekordbox',
): TrackItem[] {
  const wantedBy = new Map(written.map((w) => [w.path, w.wanted]))
  return tracks.map((t) => {
    const wanted = wantedBy.get(rekordboxPathOf(t))
    const staged = wantedOf(t, library)
    return staged && wanted && sameTargets(staged, wanted) ? withoutPlaylistEdit(t, library) : t
  })
}
