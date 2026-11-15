import type { LiveCues } from '../../../shared/types'

const LIVE_CUES_CHUNK = 500

export async function liveCuesOf(contentIds: string[]): Promise<Record<string, LiveCues>> {
  const reads: Record<string, LiveCues> = {}
  for (let i = 0; i < contentIds.length; i += LIVE_CUES_CHUNK) {
    const chunk = contentIds.slice(i, i + LIVE_CUES_CHUNK)
    Object.assign(reads, await window.api.cues.liveCues(chunk).catch(() => ({})))
  }
  return reads
}
