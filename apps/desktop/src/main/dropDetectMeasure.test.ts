import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findDrops, nearestBeat, proposeDrops } from '../shared/cueRules'
import {
  DROP_MODEL,
  type DropCandidate,
  type DropModel,
  type DropPicking,
  detectDrops,
  dropCandidates,
  pickDrops,
} from '../shared/dropDetect'
import { predictTrees, type TreesModel, trainTrees } from '../shared/dropTrees'
import type { TrackCues } from '../shared/types'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readCueWaveDetail, readTrackCues } from './rekordboxCues'
import { openRekordboxDb, rekordboxRawKey } from './rekordboxDb'

const copy = process.env.SURCO_DROP_DETECT_DB
const modelOut = process.env.SURCO_DROP_DETECT_MODEL_OUT
const SCRATCH = '/private/tmp/claude-501/'
const FOLDS = 5
const TREES = { trees: 150, depth: 4, minLeaf: 50 }
const RUN_FEATURE = 8
const LOW_NOW = 0
const LOW_NEXT = 1

interface Track {
  id: string
  test: boolean
  fold: number
  grid: TrackCues['grid']
  strong: TrackCues['strong']
  phrases: TrackCues['phrases']
  words: Uint16Array
  mine: number[]
  candidates: DropCandidate[]
}

interface Tally {
  tracks: number
  drops: number
  hit: number
  near: number
  proposals: number
  right: number
  rightNear: number
  first: number
  firstNear: number
}

type Propose = (track: Track) => number[]

function hashOf(text: string): number {
  let h = 2166136261
  for (const c of text) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

function barOf(grid: Track['grid'], ms: number): number {
  const index = nearestBeat(
    grid.map((b) => b.ms),
    ms,
  )
  return grid.slice(0, index + 1).filter((b) => b.beat === 1).length
}

function tally(tracks: Track[], propose: Propose): Tally {
  const t: Tally = {
    tracks: 0,
    drops: 0,
    hit: 0,
    near: 0,
    proposals: 0,
    right: 0,
    rightNear: 0,
    first: 0,
    firstNear: 0,
  }
  for (const track of tracks) {
    const offered = propose(track).map((ms) => barOf(track.grid, ms))
    const mine = track.mine.map((ms) => barOf(track.grid, ms))
    const close = (bars: number[], bar: number): boolean => bars.some((b) => Math.abs(b - bar) <= 1)
    t.tracks++
    t.drops += mine.length
    t.proposals += offered.length
    t.hit += mine.filter((b) => offered.includes(b)).length
    t.near += mine.filter((b) => close(offered, b)).length
    t.right += offered.filter((b) => mine.includes(b)).length
    t.rightNear += offered.filter((b) => close(mine, b)).length
    if (offered.length > 0) {
      const gap = Math.abs(Math.min(...offered) - Math.min(...mine))
      if (gap === 0) t.first++
      if (gap <= 1) t.firstNear++
    }
  }
  return t
}

function rates(t: Tally) {
  const r = (x: number): number => Math.round(x * 1000) / 1000
  const recall = t.hit / t.drops
  const precision = t.proposals ? t.right / t.proposals : 0
  return {
    tracks: t.tracks,
    drops: t.drops,
    recall: r(recall),
    recallNearBar: r(t.near / t.drops),
    precision: r(precision),
    precisionNearBar: r(t.proposals ? t.rightNear / t.proposals : 0),
    proposalsPerTrack: r(t.proposals / t.tracks),
    firstDrop: r(t.first / t.tracks),
    firstDropNearBar: r(t.firstNear / t.tracks),
    f1: r(recall + precision ? (2 * recall * precision) / (recall + precision) : 0),
  }
}

function report(family: string, train: Track[], test: Track[], propose: Propose, extra = {}) {
  console.log(
    JSON.stringify({
      family,
      ...extra,
      train: rates(tally(train, propose)),
      test: rates(tally(test, propose)),
    }),
  )
}

function dropBars(track: Track): Set<number> {
  return new Set(track.mine.map((ms) => barOf(track.grid, ms) - 1))
}

function rowsOf(tracks: Track[]): { rows: number[][]; labels: number[] } {
  const rows: number[][] = []
  const labels: number[] = []
  for (const track of tracks) {
    const bars = dropBars(track)
    for (const c of track.candidates) {
      rows.push(c.features)
      labels.push(bars.has(c.bar) ? 1 : 0)
    }
  }
  return { rows, labels }
}

function scoredBy(model: TreesModel, track: Track) {
  return track.candidates.map((c) => ({
    bar: c.bar,
    ms: c.ms,
    score: predictTrees(model, c.features),
  }))
}

function bestPicking(tracks: Track[], models: Map<Track, TreesModel>): DropPicking {
  const scored = new Map(tracks.map((t) => [t, scoredBy(models.get(t) as TreesModel, t)]))
  let best: { picking: DropPicking; f1: number } | null = null
  for (const threshold of [-2.5, -2, -1.5, -1, -0.5, 0])
    for (const spacingBars of [8, 16, 24, 32])
      for (const maxDrops of [3, 4, 99]) {
        const picking = { threshold, spacingBars, maxDrops }
        const { f1 } = rates(tally(tracks, (t) => pickDrops(scored.get(t) ?? [], picking)))
        if (!best || f1 > best.f1) best = { picking, f1 }
      }
  return (best as { picking: DropPicking }).picking
}

function outOfFold(tracks: Track[]): Map<Track, TreesModel> {
  const models = new Map<Track, TreesModel>()
  for (let fold = 0; fold < FOLDS; fold++) {
    const { rows, labels } = rowsOf(tracks.filter((t) => t.fold !== fold))
    const model = trainTrees(rows, labels, TREES)
    for (const t of tracks) if (t.fold === fold) models.set(t, model)
  }
  return models
}

function breakdownRule(level: number, bars: number): Propose {
  return (track) =>
    pickDrops(
      track.candidates
        .filter((c) => c.features[LOW_NOW] >= level && c.features[LOW_NEXT] >= level)
        .map((c) => ({ bar: c.bar, ms: c.ms, score: c.features[RUN_FEATURE] })),
      { threshold: Math.log1p(bars), spacingBars: 16, maxDrops: 4 },
    )
}

async function loadTracks(path: string): Promise<Track[]> {
  const db =
    openRekordboxDb(path, { readonly: true }) ??
    openRekordboxDb(path, { readonly: true, key: await rekordboxRawKey(path) })
  if (!db) throw new Error('the copy did not open')
  const share = rekordboxShareDir(path)
  const ids = db
    .prepare('SELECT DISTINCT ContentID FROM djmdCue WHERE coalesce(rb_local_deleted, 0) = 0')
    .all() as { ContentID: string }[]
  const tracks: Track[] = []
  for (const { ContentID } of ids) {
    const id = String(ContentID)
    const read = readTrackCues(db, share, id, { wave: false })
    if (!read?.analysed) continue
    const mine = findDrops(
      read.cues.filter((c) => c.kind === 0).map((c) => c.ms),
      read.cues.filter((c) => c.kind !== 0).map((c) => c.ms),
    )
    const words = readCueWaveDetail(db, share, id)
    if (mine.length === 0 || !words) continue
    const input = { grid: read.grid, phrases: read.phrases, words }
    tracks.push({
      id,
      test: hashOf(id) % 10 >= 7,
      fold: hashOf(`${id}f`) % FOLDS,
      grid: read.grid,
      strong: read.strong,
      phrases: read.phrases,
      words,
      mine,
      candidates: dropCandidates(input),
    })
  }
  db.close()
  return tracks
}

describe.skipIf(!copy)('Drop detection against the drops the DJ marked', () => {
  it('measures each family on train and held-out test, on a copy only', async () => {
    const path = resolve(copy as string)
    expect(path.startsWith(SCRATCH) && !path.includes('/Library/Pioneer')).toBe(true)
    const tracks = await loadTracks(path)
    const train = tracks.filter((t) => !t.test)
    const test = tracks.filter((t) => t.test)

    report('rekordbox-chorus', train, test, (t) => proposeDrops(t.strong, []))

    let rule = { level: 0, bars: 0, f1: -1 }
    for (const level of [0.5, 0.6, 0.7, 0.8])
      for (const bars of [1, 2, 4, 8]) {
        const { f1 } = rates(tally(train, breakdownRule(level, bars)))
        if (f1 > rule.f1) rule = { level, bars, f1 }
      }
    report('breakdown-rule', train, test, breakdownRule(rule.level, rule.bars), {
      level: rule.level,
      bars: rule.bars,
    })

    if (modelOut) {
      const picking = bestPicking(train, outOfFold(train))
      const { rows, labels } = rowsOf(train)
      const model: DropModel = { ...trainTrees(rows, labels, TREES), picking }
      writeFileSync(modelOut, `${JSON.stringify(model)}\n`)
      const folds = outOfFold(tracks)
      const all = rates(
        tally(tracks, (t) => pickDrops(scoredBy(folds.get(t) as TreesModel, t), picking)),
      )
      console.log(JSON.stringify({ family: 'learned-trees-5fold-all', picking, all }))
    }

    report(
      'learned-trees',
      train,
      test,
      (t) => detectDrops({ grid: t.grid, phrases: t.phrases, words: t.words }),
      { picking: DROP_MODEL.picking, trees: DROP_MODEL.trees.length },
    )
    expect(tracks.length).toBeGreaterThan(0)
  }, 1_800_000)
})
