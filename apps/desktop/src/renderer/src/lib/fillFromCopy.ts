import type { TrackMetadata } from '../../../shared/types'

const KEPT_FROM_FILE = new Set(['title', 'artist', 'encodedBy', 'custom'])

const isBlank = (value: unknown): boolean => typeof value !== 'string' || value.trim() === ''

export function fillFromCopy(meta: TrackMetadata, copy: TrackMetadata): TrackMetadata | null {
  const filled: Record<string, unknown> = { ...meta }
  let changed = false
  for (const [key, value] of Object.entries(copy)) {
    if (KEPT_FROM_FILE.has(key) || isBlank(value) || !isBlank(filled[key])) continue
    filled[key] = value
    changed = true
  }
  const custom = { ...meta.custom }
  for (const [key, value] of Object.entries(copy.custom ?? {})) {
    if (isBlank(value) || !isBlank(custom[key])) continue
    custom[key] = value
    changed = true
  }
  if (!changed) return null
  return { ...(filled as unknown as TrackMetadata), ...(copy.custom ? { custom } : {}) }
}
