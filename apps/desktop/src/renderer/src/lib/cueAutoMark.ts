import type { QueryClient } from '@tanstack/react-query'
import { autoCue, type DropInput, type DropProposal, type DropTaste } from '../../../shared/autoCue'
import type { CueFlow } from '../../../shared/cueFlows'
import { MANUAL_CUE_FLOW } from '../../../shared/cueFlows'
import type { CueQuantize } from '../../../shared/cueQuantize'
import { nearestBeat } from '../../../shared/cueRules'
import {
  cueDropInputQuery,
  cueProfileQuery,
  cueWaveDetailQuery,
  queuedCuesQuery,
  trackCuesQuery,
} from '../hooks/useTrackCues'
import { type DraftAction, reduceDraft, startDraft, wantedOfDraft } from './cueDraft'
import { cueProgramOf } from './cuePrograms'
import {
  type AutoMark,
  autoMarkOf,
  cueDraftKey,
  forgetAutoMark,
  keepAutoMark,
  keepDraft,
  keepDrafts,
  keptDraftOn,
  unsavedCueTracks,
} from './cueSession'
import { quantizePoints } from './cueWave'
import { liveCuesOf } from './liveCuesOf'

export function withoutCallInBar(
  proposed: DropProposal[],
  cues: { ms: number; kind: number }[],
  grid: { ms: number; beat: number }[],
): DropProposal[] {
  const beats = grid.map((b) => b.ms)
  const barAt = (ms: number) =>
    grid.slice(0, nearestBeat(beats, ms) + 1).filter((b) => b.beat === 1).length
  const calls = cues.filter((c) => c.kind === 0).map((c) => barAt(c.ms))
  return proposed.filter((p) => !calls.includes(barAt(p.ms)))
}

export function dropsOnGrid(
  input: DropInput,
  grid: { ms: number }[],
  taste: DropTaste | null = null,
): DropProposal[] {
  const beats = grid.map((b) => b.ms)
  return autoCue.dropProposals(input, taste).map((p) => ({
    ...p,
    ms: beats[nearestBeat(beats, p.ms)],
  }))
}

export async function learnedTaste(client: QueryClient) {
  const read = await client.fetchQuery(cueProfileQuery).catch(() => null)
  return read?.profile?.taste ?? null
}

export async function dropInputOf(
  client: QueryClient,
  contentId: string,
  read: { grid: DropInput['grid']; phrases: DropInput['phrases'] },
): Promise<DropInput | null> {
  if (cueProgramOf(contentId).readsAudio)
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
    keptDraftOn(contentId, read, queued)?.cues ??
    (queued && queued.fingerprint === read.fingerprint ? queued.wanted : read.cues)
  const found = dropsOnGrid(input, read.grid, await learnedTaste(client))
  if (found.length === 0) return { kind: 'none' }
  const open = withoutCallInBar(found, cues, read.grid)
  return open.length === 0 ? { kind: 'marked' } : { kind: 'proposed', proposals: open }
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
  onlySure: boolean,
): Promise<boolean> {
  const mark = autoMarkOf(target.contentId)
  if (mark?.kind !== 'proposed') return false
  const taken = mark.proposals.filter((p) => p.sure || !onlySure)
  const left = mark.proposals.filter((p) => !taken.includes(p))
  if (taken.length === 0) return false
  const read = await client.fetchQuery(trackCuesQuery(target.contentId)).catch(() => null)
  if (!read?.analysed || read.grid.length === 0) return false
  const queued = await client.fetchQuery(queuedCuesQuery(target.contentId))
  const fresh = queued !== null && queued.fingerprint === read.fingerprint
  const baseline = fresh
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
    slots: cueProgramOf(target.contentId).slots,
  }
  const kept =
    keptDraftOn(target.contentId, read, queued) ??
    startDraft(
      baseline,
      settings.activeCueFlow,
      read.cues.filter((c) => c.loop).map((c) => c.id),
    )
  const flowed = manual
    ? kept
    : reduceDraft(kept, { type: 'use-flow', flowId: settings.activeCueFlow }, ctx)
  const open = withoutCallInBar(taken, flowed.cues, read.grid)
  const actions: DraftAction[] = open.map(({ ms }) =>
    manual ? { type: 'add-call', ms } : { type: 'mark-drop', ms },
  )
  const accepted = reduceDraft(flowed, { type: 'batch', actions }, ctx)
  if (left.length > 0) keepAutoMark(target.contentId, { kind: 'proposed', proposals: left })
  else forgetAutoMark(target.contentId)
  if (JSON.stringify(wantedOfDraft(accepted.cues)) === JSON.stringify(baseline)) return false
  keepDraft(
    target.contentId,
    draftKey,
    accepted,
    { path: target.path, label: target.label, fingerprint: read.fingerprint },
    fresh ? queued : null,
  )
  return true
}

export async function acceptAutoMarks(
  client: QueryClient,
  targets: AutoMarkTarget[],
  settings: AutoMarkSettings,
  { onlySure = false }: { onlySure?: boolean } = {},
): Promise<number> {
  let accepted = 0
  for (const target of targets)
    if (await acceptOne(client, target, settings, onlySure)) accepted += 1
  return accepted
}

export interface ClearedCues {
  hot: number
  calls: number
  loops: number
  unsaved: number
  cleared: string[]
}

const QUEUED_CHUNK = 500

export async function clearCueDrafts(
  client: QueryClient,
  targets: AutoMarkTarget[],
  settings: AutoMarkSettings,
): Promise<ClearedCues> {
  const result: ClearedCues = { hot: 0, calls: 0, loops: 0, unsaved: 0, cleared: [] }
  const { reads } = await liveCuesOf(targets.map((t) => t.contentId))
  const readable = targets.filter((t) => reads[t.contentId])
  const queuedOf = new Map<string, Awaited<ReturnType<typeof window.api.cues.queued>>>()
  for (let i = 0; i < readable.length; i += QUEUED_CHUNK) {
    const chunk = readable.slice(i, i + QUEUED_CHUNK)
    const answers = await Promise.all(
      chunk.map((t) => client.fetchQuery(queuedCuesQuery(t.contentId))),
    )
    chunk.forEach((t, at) => {
      queuedOf.set(t.contentId, answers[at])
    })
  }
  const drafts: Parameters<typeof keepDrafts>[0] = []
  for (const target of targets) {
    if (unsavedCueTracks().has(target.contentId)) {
      result.unsaved += 1
      continue
    }
    const read = reads[target.contentId]
    if (!read) continue
    const queued = queuedOf.get(target.contentId) ?? null
    const fresh = queued !== null && queued.fingerprint === read.fingerprint
    const baseline = fresh
      ? queued.wanted
      : read.cues.map(({ id, ms, kind, color }) => ({ id, ms, kind, color }))
    const loopIds = read.cues.filter((c) => c.loop).map((c) => c.id)
    const ctx = {
      beats: [],
      snapTo: quantizePoints([], settings.cueQuantize),
      strong: [],
      phrases: [],
      flows: settings.cueFlows,
      lettersByTime: settings.cueLettersByTime,
      slots: cueProgramOf(target.contentId).slots,
    }
    const cleared = reduceDraft(
      startDraft(baseline, settings.activeCueFlow, loopIds),
      { type: 'clear' },
      ctx,
    )
    const loose = baseline.filter((c) => !(c.id && loopIds.includes(c.id)))
    if (loose.length === 0) continue
    result.hot += loose.filter((c) => c.kind !== 0).length
    result.calls += loose.filter((c) => c.kind === 0).length
    result.loops += loopIds.length
    drafts.push({
      contentId: target.contentId,
      draftKey: cueDraftKey(target.contentId, read.fingerprint, queued),
      value: cleared,
      target: { path: target.path, label: target.label, fingerprint: read.fingerprint },
      base: fresh ? queued : null,
    })
    result.cleared.push(target.contentId)
  }
  keepDrafts(drafts)
  return result
}
