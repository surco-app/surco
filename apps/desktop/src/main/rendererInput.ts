import type { WindowSnapshot } from '../shared/diagnostics'
import type { Settings } from '../shared/types'

type StatKey = keyof Settings['stats']

const STAT_KEYS: readonly string[] = [
  'imported',
  'listened',
  'analyzed',
  'discogsMatches',
  'bandcampMatches',
  'deezerMatches',
  'beatportMatches',
  'musicbrainzMatches',
  'itunesMatches',
] satisfies StatKey[]

export function statBumpOf(key: unknown, by: unknown): { key: StatKey; by: number } | null {
  if (typeof key !== 'string' || !STAT_KEYS.includes(key)) return null
  return { key: key as StatKey, by: typeof by === 'number' ? by : 1 }
}

export function windowSnapshotOf(input: unknown): WindowSnapshot | null {
  const s = input as Record<string, unknown> | null
  if (typeof s !== 'object' || s === null) return null
  if (
    typeof s.heapUsedMb !== 'number' ||
    typeof s.heapLimitMb !== 'number' ||
    typeof s.listTracks !== 'number'
  )
    return null
  return {
    heapUsedMb: s.heapUsedMb,
    heapLimitMb: s.heapLimitMb,
    listTracks: s.listTracks,
    source: typeof s.source === 'string' ? s.source : null,
    sourceTracks: typeof s.sourceTracks === 'number' ? s.sourceTracks : null,
  }
}
