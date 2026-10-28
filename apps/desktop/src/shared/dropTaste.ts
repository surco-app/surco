import { nearestBeat } from './cueRules'
import {
  DROP_MODEL,
  type DropInput,
  type DropModel,
  type DropPicking,
  dropCandidates,
  pickDrops,
} from './dropDetect'
import { predictTrees, type TreeNode, trainTrees } from './dropTrees'

export const MIN_TASTE_TRACKS = 30
const MAX_TASTE_TRACKS = 600
const CHECK_SHARE = 3
const TUNE = { trees: 30, depth: 3, minLeaf: 20 }
const PICKINGS: DropPicking[] = [-2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1].flatMap((threshold) =>
  [8, 16, 24, 32].flatMap((spacingBars) =>
    [1, 2, 3, 4, 99].map((maxDrops) => ({ threshold, spacingBars, maxDrops })),
  ),
)

export interface TasteTrack {
  key: string
  candidates: { bar: number; features: number[] }[]
  drops: number[]
}

export interface DropTaste {
  trees: TreeNode[][]
  picking: DropPicking
}

export interface TasteRates {
  found: number
  right: number
}

export interface TasteCheck {
  tracks: number
  checked: number
  before: TasteRates
  after: TasteRates
}

export interface TunedTaste {
  taste: DropTaste | null
  check: TasteCheck
}

function hashOf(text: string): number {
  let h = 2166136261
  for (const c of text) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

export function barIndexOf(grid: DropInput['grid'], ms: number): number {
  const beat = nearestBeat(
    grid.map((b) => b.ms),
    ms,
  )
  let bars = 0
  for (let i = 0; i <= beat; i++) if (grid[i].beat === 1) bars++
  return bars - 1
}

export function tasteTrackOf(key: string, input: DropInput, drops: number[]): TasteTrack | null {
  const candidates = dropCandidates(input).map((c) => ({ bar: c.bar, features: c.features }))
  const bars = [...new Set(drops.map((ms) => barIndexOf(input.grid, ms)))].filter((b) => b >= 0)
  return candidates.length > 0 && bars.length > 0 ? { key, candidates, drops: bars } : null
}

type Scored = { drops: number[]; scored: { bar: number; ms: number; score: number }[] }

const scoredOf = (tracks: TasteTrack[], model: DropModel): Scored[] =>
  tracks.map((t) => ({
    drops: t.drops,
    scored: t.candidates.map((c) => ({
      bar: c.bar,
      ms: c.bar,
      score: predictTrees(model, c.features),
    })),
  }))

function ratesOf(tracks: Scored[], picking: DropPicking): TasteRates & { f1: number } {
  let drops = 0
  let hit = 0
  let offered = 0
  let right = 0
  for (const t of tracks) {
    const bars = pickDrops(t.scored, picking)
    drops += t.drops.length
    offered += bars.length
    hit += t.drops.filter((b) => bars.includes(b)).length
    right += bars.filter((b) => t.drops.includes(b)).length
  }
  const found = drops ? hit / drops : 0
  const precision = offered ? right / offered : 0
  const f1 = found + precision ? (2 * found * precision) / (found + precision) : 0
  return { found, right: precision, f1 }
}

function calibrate(tracks: Scored[], fallback: DropPicking): DropPicking {
  let best = { picking: fallback, f1: ratesOf(tracks, fallback).f1 }
  for (const picking of PICKINGS) {
    const { f1 } = ratesOf(tracks, picking)
    if (f1 > best.f1) best = { picking, f1 }
  }
  return best.picking
}

function tune(tracks: TasteTrack[], base: DropModel): DropModel {
  const rows: number[][] = []
  const labels: number[] = []
  for (const t of tracks)
    for (const c of t.candidates) {
      rows.push(c.features)
      labels.push(t.drops.includes(c.bar) ? 1 : 0)
    }
  const trained = trainTrees(rows, labels, { ...TUNE, from: base })
  return { ...trained, picking: calibrate(scoredOf(tracks, trained), base.picking) }
}

const plain = ({ found, right }: TasteRates): TasteRates => ({ found, right })

export function tuneDropTaste(all: TasteTrack[], base: DropModel = DROP_MODEL): TunedTaste | null {
  const tracks = all
    .filter((t) => t.drops.length > 0 && t.candidates.length > 0)
    .sort((a, b) => hashOf(a.key) - hashOf(b.key))
    .slice(0, MAX_TASTE_TRACKS)
  if (tracks.length < MIN_TASTE_TRACKS) return null
  const isCheck = (t: TasteTrack): boolean => hashOf(`${t.key}#check`) % 10 < CHECK_SHARE
  const learn = tracks.filter((t) => !isCheck(t))
  const check = scoredOf(tracks.filter(isCheck), base)
  const tried = tune(learn, base)
  const before = ratesOf(check, base.picking)
  const after = ratesOf(scoredOf(tracks.filter(isCheck), tried), tried.picking)
  const better = after.f1 > before.f1
  const final = better ? tune(tracks, base) : null
  return {
    taste: final ? { trees: final.trees.slice(base.trees.length), picking: final.picking } : null,
    check: {
      tracks: tracks.length,
      checked: check.length,
      before: plain(before),
      after: plain(better ? after : before),
    },
  }
}

export function modelWithTaste(taste: DropTaste | null, base: DropModel = DROP_MODEL): DropModel {
  return taste
    ? { base: base.base, trees: [...base.trees, ...taste.trees], picking: taste.picking }
    : base
}
