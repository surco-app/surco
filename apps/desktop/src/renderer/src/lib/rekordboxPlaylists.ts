import type {
  PlaylistLibrary,
  RekordboxPlaylistTarget,
  RekordboxQueueWritten,
  SourceNode,
} from '../../../shared/types'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'

export interface PlaylistOption {
  id: string
  name: string
  path: string
}

export type Membership = Record<string, string[]>

const EDIT_KEYS = {
  rekordbox: { wanted: 'rekordboxPlaylists', base: 'rekordboxPlaylistsBase' },
  traktor: { wanted: 'traktorPlaylists', base: 'traktorPlaylistsBase' },
  engine: { wanted: 'enginePlaylists', base: 'enginePlaylistsBase' },
} as const

type EditKey = (typeof EDIT_KEYS)[PlaylistLibrary]['wanted' | 'base']

const wantedOf = (t: TrackItem, library: PlaylistLibrary) => t[EDIT_KEYS[library].wanted]
const baseOf = (t: TrackItem, library: PlaylistLibrary) => t[EDIT_KEYS[library].base]

export function playlistOptions(tree: readonly SourceNode[]): PlaylistOption[] {
  const out: PlaylistOption[] = []
  const walk = (nodes: readonly SourceNode[], trail: string[]): void => {
    for (const node of nodes) {
      if (node.kind === 'folder') walk(node.children ?? [], [...trail, node.name])
      else out.push({ id: node.id, name: node.name, path: trail.join(' › ') })
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
  const byId = namesOf(options)
  return (membership[rekordboxPathOf(track)] ?? []).flatMap((id) => {
    const name = byId.get(id)
    return name === undefined ? [] : [{ id, name }]
  })
}

export function bulkPlaylistState(
  tracks: readonly TrackItem[],
  membership: Membership | undefined,
  options: readonly PlaylistOption[] | undefined,
  library: PlaylistLibrary = 'rekordbox',
): { target: RekordboxPlaylistTarget; state: 'all' | 'some' }[] | undefined {
  if (!membership || !options) return undefined
  const seen = new Map<string, { target: RekordboxPlaylistTarget; n: number }>()
  for (const t of tracks) {
    for (const target of effectivePlaylists(t, membership, options, library) ?? []) {
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

export type PlaylistsEdit = Partial<Pick<TrackItem, EditKey>>

export function playlistsEdit(
  track: TrackItem,
  membership: Membership,
  next: RekordboxPlaylistTarget[],
  library: PlaylistLibrary = 'rekordbox',
): PlaylistsEdit {
  const keys = EDIT_KEYS[library]
  return {
    [keys.wanted]: next,
    [keys.base]: baseOf(track, library) ?? membership[rekordboxPathOf(track)] ?? [],
  }
}

export function withTarget(
  tracks: readonly TrackItem[],
  membership: Membership | undefined,
  options: readonly PlaylistOption[] | undefined,
  target: RekordboxPlaylistTarget,
  on: boolean,
  library: PlaylistLibrary = 'rekordbox',
): ({ id: string } & PlaylistsEdit)[] | undefined {
  if (!membership || !options) return undefined
  return tracks
    .filter((t) => library === 'rekordbox' || rekordboxPathOf(t) in membership)
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
  const cleared: TrackItem = {
    ...t,
    [EDIT_KEYS[library].wanted]: undefined,
    [EDIT_KEYS[library].base]: undefined,
  }
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
