import type { FlowPhrase, PhraseKind } from './cueFlows'
import { nearestBeat } from './cueRules'
import dropModel from './dropModel.json'
import { predictTrees, type TreesModel } from './dropTrees'

export interface DropInput {
  grid: { ms: number; beat: number }[]
  phrases: FlowPhrase[]
  words: Uint16Array
}

export interface DropCandidate {
  bar: number
  ms: number
  quietBars: number
  features: number[]
}

export interface DropProposal {
  ms: number
  sure: boolean
  quietBars: number
}

export interface DropPicking {
  threshold: number
  spacingBars: number
  maxDrops: number
}

export interface DropModel extends TreesModel {
  picking: DropPicking
}

export const DROP_MODEL = dropModel as DropModel

export const SURE_SCORE = 1

const ENTRIES_PER_MS = 150 / 1000
const KINDS: PhraseKind[] = ['chorus', 'up', 'down', 'intro', 'outro']
const QUIET = 0.6
const SILENT = 0.4
const JUMP = 0.25
const LONGEST_RUN = 32

interface Bar {
  all: number
  low: number
  high: number
  quarters: number[]
}

function quantile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(p * (sorted.length - 1))] || 1
}

function mean(values: number[], from: number, to: number): number {
  let sum = 0
  let count = 0
  for (let k = Math.max(0, from); k < to && k < values.length; k++) {
    sum += values[k]
    count++
  }
  return count ? sum / count : 0
}

function quietRun(values: number[], bar: number, level: number): number {
  let run = 0
  for (let j = bar - 1; j >= 0 && values[j] < level; j--) run++
  return Math.min(LONGEST_RUN, run)
}

function runBelow(values: number[], bar: number, level: number): number {
  return Math.log1p(quietRun(values, bar, level))
}

function measure(words: Uint16Array, from: number, to: number): number[] {
  let all = 0
  let low = 0
  let high = 0
  let quietest = 31
  let count = 0
  for (let i = from; i < to && i < words.length; i++) {
    const w = words[i]
    const height = (w >> 2) & 31
    all += height
    low += height * ((w >> 13) & 7)
    high += height * ((w >> 7) & 7)
    quietest = Math.min(quietest, height)
    count++
  }
  const n = count || 1
  return [all / n, low / n / 7, high / n / 7, quietest]
}

function barsOf(downbeats: number[], words: Uint16Array): Bar[] {
  const span = (downbeats[downbeats.length - 1] - downbeats[0]) / (downbeats.length - 1)
  return downbeats.map((ms, k) => {
    const from = Math.floor(ms * ENTRIES_PER_MS)
    const to = Math.floor((downbeats[k + 1] ?? ms + span) * ENTRIES_PER_MS)
    const [all, low, high] = measure(words, from, to)
    const quarters = [0, 1, 2, 3].flatMap((s) =>
      measure(
        words,
        from + Math.floor(((to - from) * s) / 4),
        from + Math.floor(((to - from) * (s + 1)) / 4),
      ),
    )
    return { all, low, high, quarters }
  })
}

function shapeOf(values: number[], k: number): number[] {
  return [
    values[k],
    mean(values, k, k + 4),
    mean(values, k, k + 8),
    values[k - 1] ?? 0,
    mean(values, k - 2, k),
    mean(values, k - 4, k),
    mean(values, k - 8, k),
    mean(values, k - 16, k),
    runBelow(values, k, QUIET),
    runBelow(values, k, SILENT),
    mean(values, k, k + 8) - mean(values, k - 8, k),
    mean(values, k, k + 4) - mean(values, k - 4, k),
    values[k] - (values[k - 1] ?? 0),
  ]
}

function loudnessOf(values: number[]): (k: number) => number[] {
  const sections = values.map((_, k) => mean(values, k, k + 8))
  const top = Math.max(0, ...sections) || 1
  return (k) => {
    const next = sections[k]
    let louderBefore = 0
    for (let j = 0; j < k; j++)
      if (sections[j] >= next * 0.97 && mean(values, j - 4, j) < QUIET * next) louderBefore++
    return [
      next / top,
      mean(values, k, k + 16) / top,
      mean(values, k - 16, k) / top,
      Math.min(louderBefore, 8),
    ]
  }
}

export function dropCandidates(input: DropInput): DropCandidate[] {
  const beats = input.grid.map((b) => b.ms)
  const downIndex = input.grid.flatMap((b, i) => (b.beat === 1 ? [i] : []))
  if (downIndex.length < 2) return []
  const downbeats = downIndex.map((i) => beats[i])
  const barOf = (ms: number): number => {
    const beat = nearestBeat(beats, ms)
    return downIndex.filter((d) => d <= beat).length - 1
  }
  const bars = barsOf(downbeats, input.words)
  const n = bars.length
  const scale = (pick: (b: Bar) => number): { raw: number; values: number[] } => {
    const raw = quantile(bars.map(pick), 0.75)
    return { raw, values: bars.map((b) => pick(b) / raw) }
  }
  const low = scale((b) => b.low)
  const all = scale((b) => b.all)
  const high = scale((b) => b.high)
  const channels = [low.values, all.values, high.values]
  const loudness = channels.map(loudnessOf)
  const kindAt = new Map<number, PhraseKind>()
  for (const p of input.phrases) {
    const bar = barOf(p.ms)
    if (bar >= 0) kindAt.set(bar, p.kind)
  }
  const phraseBars = new Set(input.phrases.flatMap((p) => [barOf(p.ms), barOf(p.ms) + 1]))
  const starts = [...kindAt.keys()].sort((a, b) => a - b)
  const quarterScale = [all.raw, low.raw, high.raw, all.raw]
  const quartersOf = (bar: Bar | undefined): number[] =>
    bar ? bar.quarters.map((v, i) => v / quarterScale[i % 4]) : Array(16).fill(0)
  const out: DropCandidate[] = []
  let heardBass = false
  for (let k = 0; k < n; k++) {
    const jumps = low.values[k] - (low.values[k - 1] ?? 0) > JUMP
    if (phraseBars.has(k) || jumps) {
      const lastStart = starts.filter((s) => s <= k).pop()
      const sincePhrase = lastStart === undefined ? k : k - lastStart
      const kind = kindAt.get(k)
      const before = kindAt.get(k - 1)
      const features = [
        ...channels.flatMap((values) => shapeOf(values, k)),
        ...KINDS.map((x) => (kind === x ? 1 : 0)),
        before === 'chorus' ? 1 : 0,
        before === 'up' ? 1 : 0,
        kind === undefined && before === undefined && !kindAt.has(k + 1) ? 1 : 0,
        sincePhrase % 16 === 0 ? 1 : 0,
        sincePhrase % 8 === 0 ? 1 : 0,
        sincePhrase % 4 === 0 ? 1 : 0,
        k % 16 === 0 ? 1 : 0,
        k % 8 === 0 ? 1 : 0,
        k / n,
        k < 8 ? 1 : 0,
        n - k < 16 ? 1 : 0,
        heardBass ? 0 : 1,
        ...quartersOf(bars[k - 1]),
        ...quartersOf(bars[k]),
        ...loudness.flatMap((of) => of(k)),
      ]
      out.push({ bar: k, ms: downbeats[k], quietBars: quietRun(low.values, k, QUIET), features })
    }
    if (mean(low.values, k, k + 4) > 0.7) heardBass = true
  }
  return out
}

export function pickDrops(
  scored: { bar: number; ms: number; score: number }[],
  picking: DropPicking,
): number[] {
  const ordered = [...scored].sort((a, b) => b.score - a.score || a.bar - b.bar)
  const picked: { bar: number; ms: number }[] = []
  for (const c of ordered) {
    if (c.score < picking.threshold || picked.length >= picking.maxDrops) break
    if (picked.some((p) => Math.abs(p.bar - c.bar) < picking.spacingBars)) continue
    picked.push(c)
  }
  if (picked.length === 0 && ordered.length > 0) picked.push(ordered[0])
  return picked.map((p) => p.ms)
}

export function dropProposals(input: DropInput, model: DropModel = DROP_MODEL): DropProposal[] {
  const scored = dropCandidates(input).map((c) => ({
    bar: c.bar,
    ms: c.ms,
    quietBars: c.quietBars,
    score: predictTrees(model, c.features),
  }))
  return pickDrops(scored, model.picking).map((ms) => {
    const c = scored.find((s) => s.ms === ms) as (typeof scored)[number]
    return { ms, sure: c.score >= SURE_SCORE, quietBars: c.quietBars }
  })
}

export function detectDrops(input: DropInput, model: DropModel = DROP_MODEL): number[] {
  return dropProposals(input, model).map((p) => p.ms)
}
