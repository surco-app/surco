import type { TrackItem } from '../types'
import { foldText } from './normalizeText'

// The ids of every track sharing a folded artist+title with another row — the same
// song arriving twice as different files (a FLAC and an MP3, two rips). Uses the same
// foldText the matcher and search use, so what the app considers "the same track"
// never disagrees between features. Tracks missing either field are never grouped:
// a fresh drop's untagged rows would otherwise read as one giant duplicate set.
export function duplicateIds(tracks: TrackItem[]): Set<string> {
  const byKey = new Map<string, string[]>()
  for (const t of tracks) {
    const artist = foldText(t.meta.artist ?? '')
    const title = foldText(t.meta.title ?? '')
    if (!artist || !title) continue
    const key = `${artist}|${title}`
    const ids = byKey.get(key)
    if (ids) ids.push(t.id)
    else byKey.set(key, [t.id])
  }
  const out = new Set<string>()
  for (const ids of byKey.values()) {
    if (ids.length > 1) for (const id of ids) out.add(id)
  }
  return out
}
