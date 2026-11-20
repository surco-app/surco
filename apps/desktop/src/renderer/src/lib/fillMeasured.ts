import type { BpmResult, KeyNotation, KeyResult, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'

interface Measured {
  bpm: (path: string) => BpmResult | null | undefined
  key: (path: string) => KeyResult | null | undefined
}

export function fillMeasuredPatches(
  tracks: TrackItem[],
  measured: Measured,
  keyNotation: KeyNotation,
): { id: string; meta: Partial<TrackMetadata> }[] {
  const patches: { id: string; meta: Partial<TrackMetadata> }[] = []
  for (const t of tracks) {
    const meta: Partial<TrackMetadata> = {}
    const bpm = measured.bpm(t.inputPath)
    if (bpm && !t.meta.bpm?.trim()) meta.bpm = String(Math.round(bpm.bpm))
    const key = measured.key(t.inputPath)
    if (key && !t.meta.key?.trim()) meta.key = keyNotation === 'camelot' ? key.camelot : key.name
    if (Object.keys(meta).length) patches.push({ id: t.id, meta })
  }
  return patches
}
