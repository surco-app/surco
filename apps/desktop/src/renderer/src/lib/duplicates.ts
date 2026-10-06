import type { TrackItem } from '../types'
import { splitActs } from './musicSpelling'
import { foldText } from './normalizeText'

export interface RecordingItem {
  id: string
  artist: string
  title: string
  durationSec?: number
}

export interface DuplicateGroup {
  key: string
  kind: 'duplicate' | 'version'
  ids: string[]
}

export const SAME_RECORDING_SEC = 5

const FEATURING = /[([]\s*(?:feat|ft|featuring)\.?\s[^)\]]*[)\]]/gi
const ORIGINAL = /[([]\s*original(?:\s+(?:mix|version))?\s*[)\]]/gi

// Uses the same foldText the matcher and search use, so what the app considers "the
// same track" never disagrees between features. Rows missing either field have no key:
// a fresh drop's untagged rows would otherwise read as one giant duplicate set. foldText
// turns "&" into "and", so a spelled-out "and" splits the acts the same way.
export function recordingKey(artist: string, title: string): string | null {
  const acts = [
    ...new Set(
      splitActs(artist)
        .flatMap((act) => foldText(act).split(' and '))
        .filter(Boolean),
    ),
  ].sort()
  const core = foldText(title.replace(FEATURING, '').replace(ORIGINAL, ''))
  if (acts.length === 0 || !core) return null
  return `${acts.join('+')}|${core}`
}

// Single-link clusters by length: a third copy 2 s off the second still joins the first.
function byLength(items: RecordingItem[]): RecordingItem[][] {
  const sorted = [...items].sort((a, b) => (a.durationSec ?? 0) - (b.durationSec ?? 0))
  const clusters: RecordingItem[][] = []
  for (const item of sorted) {
    const last = clusters.at(-1)
    const prev = last?.at(-1)
    if (
      last &&
      prev &&
      Math.abs((item.durationSec ?? 0) - (prev.durationSec ?? 0)) <= SAME_RECORDING_SEC
    )
      last.push(item)
    else clusters.push([item])
  }
  return clusters
}

export function duplicateGroups(items: RecordingItem[]): DuplicateGroup[] {
  const byKey = new Map<string, RecordingItem[]>()
  for (const item of items) {
    const key = recordingKey(item.artist, item.title)
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), item])
  }
  const groups: DuplicateGroup[] = []
  for (const [key, members] of byKey) {
    if (members.length < 2) continue
    const known = members.filter((m) => m.durationSec !== undefined)
    if (known.length === 0) {
      groups.push({ key, kind: 'duplicate', ids: members.map((m) => m.id) })
      continue
    }
    const clusters = byLength(known)
    for (const c of clusters)
      if (c.length > 1) groups.push({ key, kind: 'duplicate', ids: c.map((m) => m.id) })
    if (clusters.length > 1 || known.length < members.length)
      groups.push({ key: `${key}|version`, kind: 'version', ids: members.map((m) => m.id) })
  }
  return groups
}

export function duplicateIds(tracks: TrackItem[]): Set<string> {
  const groups = duplicateGroups(
    tracks.map((t) => ({
      id: t.id,
      artist: t.meta.artist ?? '',
      title: t.meta.title ?? '',
      durationSec: t.duration,
    })),
  )
  return new Set(groups.filter((g) => g.kind === 'duplicate').flatMap((g) => g.ids))
}
