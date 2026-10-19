import type { RekordboxPlaylistTarget, SourceNode } from '../../../shared/types'
import type { TrackItem } from '../types'

export interface PlaylistOption {
  id: string
  name: string
  path: string
}

export type Membership = Record<string, string[]>

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
  const taken = new Set(chosen.flatMap((t) => (t.id ? [t.id] : [])))
  const query = fold(text.trim())
  return options.filter((o) => !taken.has(o.id) && (query === '' || fold(o.name).includes(query)))
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

export function effectivePlaylists(
  track: TrackItem,
  membership: Membership | undefined,
  options: readonly PlaylistOption[] | undefined,
): RekordboxPlaylistTarget[] | undefined {
  if (!membership || !options) return undefined
  if (track.rekordboxPlaylists)
    return track.rekordboxPlaylists.map((t) => resolveTarget(t, options))
  const byId = new Map(options.map((o) => [o.id, o.name]))
  return (membership[rekordboxPathOf(track)] ?? []).flatMap((id) => {
    const name = byId.get(id)
    return name === undefined ? [] : [{ id, name }]
  })
}

export function isPlaylistsPending(
  track: TrackItem,
  membership: Membership | undefined,
  options: readonly PlaylistOption[] | undefined,
): boolean | undefined {
  if (!membership || !options) return undefined
  if (!track.rekordboxPlaylists) return false
  const want = track.rekordboxPlaylists.map((t) => resolveTarget(t, options))
  const held = new Set(membership[rekordboxPathOf(track)] ?? [])
  return want.length !== held.size || want.some((t) => !t.id || !held.has(t.id))
}

export function bulkPlaylistState(
  tracks: readonly TrackItem[],
  membership: Membership | undefined,
  options: readonly PlaylistOption[] | undefined,
): { target: RekordboxPlaylistTarget; state: 'all' | 'some' }[] | undefined {
  if (!membership || !options) return undefined
  const seen = new Map<string, { target: RekordboxPlaylistTarget; n: number }>()
  for (const t of tracks) {
    for (const target of effectivePlaylists(t, membership, options) ?? []) {
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

export function withTarget(
  tracks: readonly TrackItem[],
  membership: Membership | undefined,
  options: readonly PlaylistOption[] | undefined,
  target: RekordboxPlaylistTarget,
  on: boolean,
): { id: string; rekordboxPlaylists: RekordboxPlaylistTarget[] }[] | undefined {
  if (!membership || !options) return undefined
  return tracks.map((t) => {
    const rest = (effectivePlaylists(t, membership, options) ?? []).filter(
      (x) => targetKey(x) !== targetKey(target),
    )
    return { id: t.id, rekordboxPlaylists: on ? [...rest, target] : rest }
  })
}
