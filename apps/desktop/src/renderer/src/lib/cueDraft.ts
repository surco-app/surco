import { type CueFlow, type FlowPhrase, MY_FLOW } from '../../../shared/cueFlows'
import {
  type ExistingCue,
  findDrops,
  flowOutcome,
  HOT_KINDS,
  nearestBeat,
  SAME_POSITION_MS,
  type StrongPart,
  type WantedCue,
} from '../../../shared/cueRules'
import { HOT_CUE_DEFAULT_INDEX } from '../../../shared/rekordboxCueColors'

export interface DraftCue extends WantedCue {
  key: string
}

export type DraftNotice = 'manual' | 'too-many' | null

export interface DraftSnapshot {
  cues: DraftCue[]
  flowId: string
  trimmed: number[]
  edited: string[]
}

export interface CueDraft {
  cues: DraftCue[]
  flowId: string
  past: DraftSnapshot[]
  selected: string | null
  notice: DraftNotice
  trimmed: number[]
  edited: string[]
  nextKey: number
}

export interface DraftContext {
  beats: number[]
  strong: StrongPart[]
  phrases: FlowPhrase[]
  flows: CueFlow[]
}

export type DraftAction =
  | { type: 'mark-drop'; ms: number }
  | { type: 'unmark-drop'; key: string }
  | { type: 'select'; key: string | null }
  | { type: 'move'; key: string; ms: number }
  | { type: 'remove'; key: string }
  | { type: 'recolour'; key: string; color: number }
  | { type: 'reletter'; key: string; kind: number }
  | { type: 'add-hot'; ms: number }
  | { type: 'add-call'; ms: number }
  | { type: 'apply-flow'; flowId: string }
  | { type: 'undo' }

const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME_POSITION_MS
const isHot = (c: { kind: number }): boolean => c.kind !== 0

export function startDraft(cues: WantedCue[], flowId: string): CueDraft {
  return {
    cues: cues.map((c, i) => ({ ...c, key: c.id ?? `n${i}` })),
    flowId,
    past: [],
    selected: null,
    notice: null,
    trimmed: [],
    edited: [],
    nextKey: cues.length,
  }
}

export function draftDrops(cues: WantedCue[]): number[] {
  return findDrops(
    cues.filter((c) => !isHot(c)).map((c) => c.ms),
    cues.filter(isHot).map((c) => c.ms),
  )
}

export function freeLetters(cues: WantedCue[], current?: number): number[] {
  return HOT_KINDS.filter((k) => k === current || !cues.some((c) => c.kind === k))
}

export function wantedOfDraft(cues: DraftCue[]): WantedCue[] {
  return cues.map(({ key: _key, ...c }) => c)
}

const needsGrid = (action: DraftAction): boolean =>
  action.type === 'mark-drop' ||
  action.type === 'add-hot' ||
  action.type === 'add-call' ||
  action.type === 'move'

const flowById = (ctx: DraftContext, id: string): CueFlow =>
  ctx.flows.find((f) => f.id === id) ?? MY_FLOW

const snap = (ctx: DraftContext, ms: number): number => ctx.beats[nearestBeat(ctx.beats, ms)]

function commit(state: CueDraft, cues: DraftCue[], over: Partial<CueDraft> = {}): CueDraft {
  return {
    ...state,
    notice: null,
    trimmed: [],
    ...over,
    cues,
    past: [
      ...state.past,
      { cues: state.cues, flowId: state.flowId, trimmed: state.trimmed, edited: state.edited },
    ],
  }
}

function regenerate(
  state: CueDraft,
  ctx: DraftContext,
  drops: number[],
  flow: CueFlow,
  previousFlow: CueFlow,
): CueDraft {
  const existing: ExistingCue[] = state.cues.map((c) => ({
    id: c.key,
    ms: c.ms,
    kind: c.kind,
    color: c.color,
  }))
  const out = flowOutcome({
    existing,
    drops,
    previousDrops: draftDrops(state.cues),
    beats: ctx.beats,
    strong: ctx.strong,
    phrases: ctx.phrases,
    flow,
    previousFlow,
  })
  if (out.status === 'too-many') return { ...state, notice: 'too-many' }
  const byKey = new Map(state.cues.map((c) => [c.key, c]))
  let nextKey = state.nextKey
  const generated = out.wanted.map((w): DraftCue => {
    const was = w.id === undefined ? undefined : byKey.get(w.id)
    if (was) return { ...was, ms: w.ms, kind: w.kind, color: w.color }
    nextKey += 1
    return { key: `n${nextKey}`, ms: w.ms, kind: w.kind, color: w.color }
  })
  const cues = out.status === 'plan' ? keepEdited(state, generated) : generated
  if (cues === null) return { ...state, notice: 'too-many' }
  return commit(state, cues, {
    flowId: flow.id,
    nextKey,
    selected: null,
    notice: out.status === 'manual' ? 'manual' : null,
    trimmed: out.status === 'plan' ? out.trimmed : [],
  })
}

function keepEdited(state: CueDraft, generated: DraftCue[]): DraftCue[] | null {
  const edited = state.cues.filter((c) => state.edited.includes(c.key))
  if (edited.length === 0) return generated
  const kept = generated.map((c) => edited.find((e) => e.key === c.key) ?? c)
  for (const e of edited) {
    if (kept.some((c) => c.key === e.key)) continue
    const pair = pairOf(state.cues, e)
    kept.push(e)
    if (pair && !kept.some((c) => c.key === pair.key)) kept.push(pair)
  }
  const held = new Set(edited.filter(isHot).map((e) => e.kind))
  const free = HOT_KINDS.filter((k) => !held.has(k))
  const others = kept
    .filter((c) => isHot(c) && !state.edited.includes(c.key))
    .sort((a, b) => a.ms - b.ms)
  if (others.length > free.length) return null
  const letter = new Map(others.map((c, i) => [c.key, free[i]]))
  return kept.map((c) => (letter.has(c.key) ? { ...c, kind: letter.get(c.key) as number } : c))
}

function pairOf(cues: DraftCue[], target: DraftCue): DraftCue | undefined {
  return isHot(target) ? cues.find((c) => !isHot(c) && near(c.ms, target.ms)) : undefined
}

export function reduceDraft(state: CueDraft, action: DraftAction, ctx: DraftContext): CueDraft {
  const flow = flowById(ctx, state.flowId)
  if (action.type === 'select') return { ...state, selected: action.key }
  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1]
    if (!previous) return state
    return {
      ...state,
      cues: previous.cues,
      flowId: previous.flowId,
      trimmed: previous.trimmed,
      edited: previous.edited,
      past: state.past.slice(0, -1),
      selected: null,
      notice: null,
    }
  }
  if (needsGrid(action) && ctx.beats.length === 0) return state
  if (action.type === 'mark-drop') {
    const ms = snap(ctx, action.ms)
    if (draftDrops(state.cues).some((d) => near(d, ms))) return state
    return regenerate(state, ctx, [...draftDrops(state.cues), ms], flow, flow)
  }
  if (action.type === 'apply-flow')
    return regenerate(state, ctx, draftDrops(state.cues), flowById(ctx, action.flowId), flow)
  if (action.type === 'add-hot' || action.type === 'add-call') {
    const ms = snap(ctx, action.ms)
    const hot = action.type === 'add-hot'
    const kind = hot ? freeLetters(state.cues).at(0) : 0
    if (kind === undefined || state.cues.some((c) => isHot(c) === hot && near(c.ms, ms)))
      return state
    const key = `n${state.nextKey + 1}`
    const cue: DraftCue = { key, ms, kind, color: hot ? HOT_CUE_DEFAULT_INDEX : null }
    return commit(state, [...state.cues, cue], { nextKey: state.nextKey + 1, selected: key })
  }
  const target = state.cues.find((c) => c.key === action.key)
  if (!target) return state
  if (action.type === 'unmark-drop') {
    const drops = draftDrops(state.cues)
    if (!drops.some((d) => near(d, target.ms))) return state
    return regenerate(
      state,
      ctx,
      drops.filter((d) => !near(d, target.ms)),
      flow,
      flow,
    )
  }
  if (action.type === 'remove') {
    const pair = pairOf(state.cues, target)
    return commit(
      state,
      state.cues.filter((c) => c.key !== target.key && c.key !== pair?.key),
      { selected: null },
    )
  }
  if (action.type === 'recolour') {
    if (!isHot(target)) return state
    return commit(
      state,
      state.cues.map((c) => (c.key === target.key ? { ...c, color: action.color } : c)),
      { edited: [...state.edited, target.key] },
    )
  }
  if (action.type === 'reletter') {
    if (!isHot(target) || !freeLetters(state.cues).includes(action.kind)) return state
    return commit(
      state,
      state.cues.map((c) => (c.key === target.key ? { ...c, kind: action.kind } : c)),
      { edited: [...state.edited, target.key] },
    )
  }
  const ms = snap(ctx, action.ms)
  const pair = pairOf(state.cues, target)
  const moving = new Set([target.key, pair?.key])
  const taken = (hot: boolean): boolean =>
    state.cues.some((c) => !moving.has(c.key) && isHot(c) === hot && near(c.ms, ms))
  const ontoDrop = isHot(target) && !pair && state.cues.some((c) => !isHot(c) && near(c.ms, ms))
  if (near(ms, target.ms) || taken(isHot(target)) || (pair && taken(false)) || ontoDrop)
    return state
  return commit(
    state,
    state.cues.map((c) => (moving.has(c.key) ? { ...c, ms } : c)),
    { edited: [...state.edited, target.key] },
  )
}
