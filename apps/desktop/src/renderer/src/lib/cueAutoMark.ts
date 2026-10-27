import type { QueryClient } from '@tanstack/react-query'
import type { CueFlow } from '../../../shared/cueFlows'
import { MANUAL_CUE_FLOW } from '../../../shared/cueFlows'
import type { CueQuantize } from '../../../shared/cueQuantize'
import { ALL_SLOTS, nearestBeat } from '../../../shared/cueRules'
import { type DropInput, detectDrops } from '../../../shared/dropDetect'
import { isEngineContent } from '../../../shared/engineContent'
import { isTraktorContent, TRAKTOR_SLOTS } from '../../../shared/traktorContent'
import {
  cueDropInputQuery,
  cueWaveDetailQuery,
  queuedCuesQuery,
  trackCuesQuery,
} from '../hooks/useTrackCues'
import { type DraftAction, reduceDraft, startDraft, wantedOfDraft } from './cueDraft'
import {
  type AutoMark,
  autoMarkOf,
  cueDraftKey,
  forgetAutoMark,
  keepAutoMark,
  keepDraft,
  keptDraft,
} from './cueSession'
import { quantizePoints } from './cueWave'

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
  if (isEngineContent(contentId) || isTraktorContent(contentId))
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

export interface AutoMarkTarget {
  contentId: string
  path: string
  label: string
}

export interface AutoMarkSettings {
  cueFlows: CueFlow[]
  activeCueFlow: string
  cueQuantize: CueQuantize
  cueLettersByTime: boolean
}

// Accepting every proposal from the list does to each track what the editor's accept does:
// start from the unsaved draft or what the library holds, keep the DJ's loops locked, place
// the chosen flow on each break, and leave the result as an unsaved draft for Save.
async function acceptOne(
  client: QueryClient,
  target: AutoMarkTarget,
  settings: AutoMarkSettings,
): Promise<boolean> {
  const mark = autoMarkOf(target.contentId)
  if (mark?.kind !== 'proposed') return false
  const read = await client.fetchQuery(trackCuesQuery(target.contentId)).catch(() => null)
  if (!read?.analysed || read.grid.length === 0) return false
  const queued = await client.fetchQuery(queuedCuesQuery(target.contentId))
  const baseline =
    queued && queued.fingerprint === read.fingerprint
      ? queued.wanted
      : read.cues.map(({ id, ms, kind, color }) => ({ id, ms, kind, color }))
  const draftKey = cueDraftKey(target.contentId, read.fingerprint, queued)
  const manual = settings.activeCueFlow === MANUAL_CUE_FLOW
  const ctx = {
    beats: read.grid.map((b) => b.ms),
    snapTo: quantizePoints(read.grid, settings.cueQuantize),
    strong: read.strong,
    phrases: read.phrases,
    flows: settings.cueFlows,
    lettersByTime: settings.cueLettersByTime,
    slots: isTraktorContent(target.contentId) ? TRAKTOR_SLOTS : ALL_SLOTS,
  }
  const kept =
    keptDraft(target.contentId, draftKey) ??
    startDraft(
      baseline,
      settings.activeCueFlow,
      read.cues.filter((c) => c.loop).map((c) => c.id),
    )
  const flowed = manual
    ? kept
    : reduceDraft(kept, { type: 'use-flow', flowId: settings.activeCueFlow }, ctx)
  const open = withoutCallInBar(mark.ms, flowed.cues, read.grid)
  const actions: DraftAction[] = open.map((ms) =>
    manual ? { type: 'add-call', ms } : { type: 'mark-drop', ms },
  )
  const accepted = reduceDraft(flowed, { type: 'batch', actions }, ctx)
  forgetAutoMark(target.contentId)
  if (JSON.stringify(wantedOfDraft(accepted.cues)) === JSON.stringify(baseline)) return false
  keepDraft(target.contentId, draftKey, accepted, {
    path: target.path,
    label: target.label,
    fingerprint: read.fingerprint,
  })
  return true
}

export async function acceptAutoMarks(
  client: QueryClient,
  targets: AutoMarkTarget[],
  settings: AutoMarkSettings,
): Promise<number> {
  let accepted = 0
  for (const target of targets) if (await acceptOne(client, target, settings)) accepted += 1
  return accepted
}
