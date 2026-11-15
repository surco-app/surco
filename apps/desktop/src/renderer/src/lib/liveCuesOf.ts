import type { LiveCues } from '../../../shared/types'

const LIVE_CUES_CHUNK = 500

export interface LiveCuesRead {
  reads: Record<string, LiveCues>
  failed: Set<string>
}

export async function liveCuesOf(contentIds: string[]): Promise<LiveCuesRead> {
  const reads: Record<string, LiveCues> = {}
  const failed = new Set<string>()
  for (let i = 0; i < contentIds.length; i += LIVE_CUES_CHUNK) {
    const chunk = contentIds.slice(i, i + LIVE_CUES_CHUNK)
    try {
      Object.assign(reads, await window.api.cues.liveCues(chunk))
    } catch {
      for (const id of chunk) failed.add(id)
    }
  }
  return { reads, failed }
}
