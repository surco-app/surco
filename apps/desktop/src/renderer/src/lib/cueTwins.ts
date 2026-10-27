import type { QueryClient } from '@tanstack/react-query'
import type { CueFlow } from '../../../shared/cueFlows'
import { ALL_SLOTS, SAME_POSITION_MS } from '../../../shared/cueRules'
import { isEngineContent } from '../../../shared/engineContent'
import { isTraktorContent, TRAKTOR_SLOTS } from '../../../shared/traktorContent'
import type { CueLibrary, LibraryTracks, SaveCuesRequest, TrackCues } from '../../../shared/types'
import { queuedCuesQuery, trackCuesQuery } from '../hooks/useTrackCues'
import {
  type CueDraft,
  type DraftContext,
  draftPoints,
  reduceDraft,
  startDraft,
  wantedOfDraft,
} from './cueDraft'
import { unsavedCueTracks } from './cueSession'
import { quantizePoints } from './cueWave'

export interface TwinSource {
  contentId: string
  path: string
  label: string
  flowId: string
  points: number[]
}

export interface TwinSettings {
  cueFlows: CueFlow[]
  cueLettersByTime: boolean
  cueFlowToRekordbox: boolean
  cueFlowToTraktor: boolean
  cueFlowToEngine: boolean
}

export type TwinPlan =
  | {
      library: CueLibrary
      contentId: string
      status: 'planned'
      hot: number
      calls: number
      request: SaveCuesRequest
    }
  | { library: CueLibrary; contentId: string; status: 'unsaved' }

const LIBRARIES: CueLibrary[] = ['rekordbox', 'traktor', 'engine']

export function libraryOf(contentId: string): CueLibrary {
  if (isTraktorContent(contentId)) return 'traktor'
  return isEngineContent(contentId) ? 'engine' : 'rekordbox'
}

const wanted = (library: CueLibrary, settings: TwinSettings): boolean =>
  library === 'rekordbox'
    ? settings.cueFlowToRekordbox
    : library === 'traktor'
      ? settings.cueFlowToTraktor
      : settings.cueFlowToEngine

const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME_POSITION_MS

// The breaks the DJ marked with a flow since the cues were last saved: the flow's points in
// the draft that a cue the flow placed sits on. Cues read back from a library carry no
// origin, so neither saved breaks nor CALLs placed by hand count.
export function carriedPoints(draft: CueDraft, ctx: DraftContext): number[] {
  const placed = draft.cues.filter((c) => draft.origin[c.key])
  return draftPoints(draft, ctx).filter((p) => placed.some((c) => near(c.ms, p)))
}

// A break lands on the other program's nearest beat, never its nearest bar: the programs can
// count the bar from different beats, and the bar would move every cue by a beat or more.
function contextOf(read: TrackCues, library: CueLibrary, settings: TwinSettings): DraftContext {
  return {
    beats: read.grid.map((b) => b.ms),
    snapTo: quantizePoints(read.grid, 'beat'),
    strong: read.strong,
    phrases: read.phrases,
    flows: settings.cueFlows,
    lettersByTime: settings.cueLettersByTime,
    slots: library === 'traktor' ? TRAKTOR_SLOTS : ALL_SLOTS,
  }
}

async function planOne(
  client: QueryClient,
  source: TwinSource,
  library: CueLibrary,
  contentId: string,
  settings: TwinSettings,
): Promise<TwinPlan | null> {
  const read = await client.fetchQuery(trackCuesQuery(contentId)).catch(() => null)
  if (!read?.analysed || read.grid.length === 0) return null
  const queued = await client.fetchQuery(queuedCuesQuery(contentId))
  const baseline =
    queued && queued.fingerprint === read.fingerprint
      ? queued.wanted
      : read.cues.map(({ id, ms, kind, color }) => ({ id, ms, kind, color }))
  const ctx = contextOf(read, library, settings)
  const start = startDraft(
    baseline,
    source.flowId,
    read.cues.filter((c) => c.loop).map((c) => c.id),
  )
  const placed = reduceDraft(
    reduceDraft(start, { type: 'use-flow', flowId: source.flowId }, ctx),
    { type: 'batch', actions: source.points.map((ms) => ({ type: 'mark-drop' as const, ms })) },
    ctx,
  )
  const result = wantedOfDraft(placed.cues)
  const added = result.filter(
    (c) => !baseline.some((b) => (b.kind === 0) === (c.kind === 0) && near(b.ms, c.ms)),
  )
  const hot = added.filter((c) => c.kind !== 0).length
  const calls = library === 'rekordbox' ? added.length - hot : 0
  if (hot + calls === 0) return null
  return {
    library,
    contentId,
    status: 'planned',
    hot,
    calls,
    request: {
      contentId,
      path: source.path,
      label: source.label,
      fingerprint: read.fingerprint,
      wanted: result,
    },
  }
}

// What placing the flow on the same breaks does to the same file in each other program the
// DJ chose, worked out on that program's own grid and cues. A track left unsaved there is
// the DJ's work in progress, so it is only reported unless named in `overwrite`.
export async function twinPlans(
  client: QueryClient,
  source: TwinSource,
  settings: TwinSettings,
  overwrite: ReadonlySet<string> = new Set(),
): Promise<TwinPlan[]> {
  if (source.points.length === 0) return []
  const own = libraryOf(source.contentId)
  const twins = await client
    .fetchQuery({
      queryKey: ['cue-twins', source.path],
      queryFn: () => window.api.rekordboxCueTwins(source.path),
      staleTime: Number.POSITIVE_INFINITY,
    })
    .catch((): LibraryTracks => ({}))
  const plans: TwinPlan[] = []
  for (const library of LIBRARIES) {
    const contentId = twins[library]
    if (library === own || !contentId || !wanted(library, settings)) continue
    if (unsavedCueTracks().has(contentId) && !overwrite.has(contentId)) {
      plans.push({ library, contentId, status: 'unsaved' })
      continue
    }
    const plan = await planOne(client, source, library, contentId, settings)
    if (plan) plans.push(plan)
  }
  return plans
}

export interface DraftToCarry {
  contentId: string
  path: string
  label: string
  draft: CueDraft
}

// The same for drafts saved together, each on its own grid. A track that is one of them is
// saved with its own draft, so no other draft's flow is planned over it, and a track two
// drafts reach is planned once, by the first.
export async function twinPlansOf(
  client: QueryClient,
  drafts: DraftToCarry[],
  settings: TwinSettings,
  overwrite: ReadonlySet<string> = new Set(),
): Promise<TwinPlan[]> {
  const saving = new Set(drafts.map((d) => d.contentId))
  const plans: TwinPlan[] = []
  for (const { contentId, path, label, draft } of drafts) {
    const read = await client.fetchQuery(trackCuesQuery(contentId)).catch(() => null)
    if (!read?.analysed || read.grid.length === 0) continue
    const points = carriedPoints(draft, contextOf(read, libraryOf(contentId), settings))
    const source = { contentId, path, label, flowId: draft.generatedBy, points }
    for (const plan of await twinPlans(client, source, settings, overwrite)) {
      if (saving.has(plan.contentId)) continue
      saving.add(plan.contentId)
      plans.push(plan)
    }
  }
  return plans
}
