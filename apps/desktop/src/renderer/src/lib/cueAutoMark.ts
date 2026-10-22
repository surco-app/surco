import type { QueryClient } from '@tanstack/react-query'
import { nearestBeat } from '../../../shared/cueRules'
import { type DropInput, detectDrops } from '../../../shared/dropDetect'
import { isEngineContent } from '../../../shared/engineContent'
import {
  cueDropInputQuery,
  cueWaveDetailQuery,
  queuedCuesQuery,
  trackCuesQuery,
} from '../hooks/useTrackCues'
import { type AutoMark, cueDraftKey, keepAutoMark, keptDraft } from './cueSession'

export function withoutCallInBar(
  proposed: number[],
  cues: { ms: number; kind: number }[],
  grid: { ms: number; beat: number }[],
): number[] {
  const beats = grid.map((b) => b.ms)
  const barAt = (ms: number) =>
    grid.slice(0, nearestBeat(beats, ms) + 1).filter((b) => b.beat === 1).length
  const calls = cues.filter((c) => c.kind === 0).map((c) => barAt(c.ms))
  return proposed.filter((ms) => !calls.includes(barAt(ms)))
}

export function dropsOnGrid(input: DropInput, grid: { ms: number }[]): number[] {
  const beats = grid.map((b) => b.ms)
  return detectDrops(input).map((ms) => beats[nearestBeat(beats, ms)])
}

async function dropInputOf(
  client: QueryClient,
  contentId: string,
  read: { grid: DropInput['grid']; phrases: DropInput['phrases'] },
): Promise<DropInput | null> {
  if (isEngineContent(contentId))
    return client.fetchQuery(cueDropInputQuery(contentId)).catch(() => null)
  const words = await client.fetchQuery(cueWaveDetailQuery(contentId)).catch(() => null)
  return words ? { grid: read.grid, phrases: read.phrases, words } : null
}

async function autoMarkOne(client: QueryClient, contentId: string): Promise<AutoMark> {
  const read = await client.fetchQuery(trackCuesQuery(contentId)).catch(() => null)
  if (!read?.analysed || read.grid.length === 0) return { kind: 'unanalysed' }
  const input = await dropInputOf(client, contentId, read)
  if (!input) return { kind: 'unanalysed' }
  const queued = await client.fetchQuery(queuedCuesQuery(contentId))
  const cues =
    keptDraft(contentId, cueDraftKey(contentId, read.fingerprint, queued))?.cues ??
    (queued && queued.fingerprint === read.fingerprint ? queued.wanted : read.cues)
  const found = dropsOnGrid(input, read.grid)
  if (found.length === 0) return { kind: 'none' }
  const open = withoutCallInBar(found, cues, read.grid)
  return open.length === 0 ? { kind: 'marked' } : { kind: 'proposed', ms: open }
}

export async function autoMarkTracks(client: QueryClient, contentIds: string[]): Promise<void> {
  for (const [i, contentId] of contentIds.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 0))
    keepAutoMark(contentId, await autoMarkOne(client, contentId))
  }
}
