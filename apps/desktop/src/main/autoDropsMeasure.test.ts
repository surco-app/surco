import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FlowPhrase } from '../shared/cueFlows'
import { findDrops, nearestBeat, proposeDrops, SAME_POSITION_MS } from '../shared/cueRules'
import type { TrackCues } from '../shared/types'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readTrackCues } from './rekordboxCues'
import { openRekordboxDb, rekordboxRawKey } from './rekordboxDb'

const copy = process.env.SURCO_AUTO_DROPS_DB
const SCRATCH = '/private/tmp/claude-501/'
const FOLDS = 5

type Grid = TrackCues['grid']
type Counts = Record<string, number>

interface Marked {
  grid: Grid
  phrases: FlowPhrase[]
  cues: TrackCues['cues']
  mine: number[]
}

interface Score {
  drops: number
  hit: number
  proposals: number
  right: number
}

interface Alignment {
  kind: string
  offset: number
}

function barOf(grid: Grid, ms: number): number {
  const index = nearestBeat(
    grid.map((b) => b.ms),
    ms,
  )
  return grid.slice(0, index + 1).filter((b) => b.beat === 1).length
}

function barStarts(grid: Grid): number[] {
  return grid.filter((b) => b.beat === 1).map((b) => b.ms)
}

function bump(counts: Counts, key: string, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by
}

function dominant(counts: Counts): string | null {
  const keys = Object.keys(counts).sort()
  return keys.reduce<string | null>(
    (best, key) => (best === null || counts[key] > counts[best] ? key : best),
    null,
  )
}

function score(grid: Grid, mine: number[], offered: number[]): Score {
  const offeredBars = new Set(offered.map((ms) => barOf(grid, ms)))
  const mineBars = new Set(mine.map((ms) => barOf(grid, ms)))
  return {
    drops: mine.length,
    hit: mine.filter((ms) => offeredBars.has(barOf(grid, ms))).length,
    proposals: offered.length,
    right: offered.filter((ms) => mineBars.has(barOf(grid, ms))).length,
  }
}

function addScore(total: Score, part: Score): Score {
  return {
    drops: total.drops + part.drops,
    hit: total.hit + part.hit,
    proposals: total.proposals + part.proposals,
    right: total.right + part.right,
  }
}

const NO_SCORE: Score = { drops: 0, hit: 0, proposals: 0, right: 0 }

function rates(total: Score): { recall: number | null; precision: number | null } {
  return {
    recall: total.drops ? total.hit / total.drops : null,
    precision: total.proposals ? total.right / total.proposals : null,
  }
}

function alignmentOf(grid: Grid, phrases: FlowPhrase[], dropMs: number): Alignment | null {
  const before = phrases.filter((p) => p.ms <= dropMs + SAME_POSITION_MS)
  const phrase = before[before.length - 1]
  if (!phrase) return null
  return { kind: phrase.kind, offset: barOf(grid, dropMs) - barOf(grid, phrase.ms) }
}

function alignmentKey(a: Alignment): string {
  return `${a.kind}@${a.offset}`
}

function alignmentCounts(track: Marked): Counts {
  const counts: Counts = {}
  for (const ms of track.mine) {
    const a = alignmentOf(track.grid, track.phrases, ms)
    if (a) bump(counts, alignmentKey(a))
  }
  return counts
}

function sumCounts(all: Counts[]): Counts {
  const total: Counts = {}
  for (const counts of all) for (const [key, n] of Object.entries(counts)) bump(total, key, n)
  return total
}

function parseAlignment(key: string): Alignment {
  const at = key.lastIndexOf('@')
  return { kind: key.slice(0, at), offset: Number(key.slice(at + 1)) }
}

function proposeAligned(grid: Grid, phrases: FlowPhrase[], a: Alignment): number[] {
  const starts = barStarts(grid)
  const found = phrases
    .filter((p) => p.kind === a.kind)
    .map((p) => starts[barOf(grid, p.ms) - 1 + a.offset])
    .filter((ms): ms is number => ms !== undefined)
  return [...new Set(found)].sort((x, y) => x - y)
}

function calibratedScores(tracks: Marked[]): Score {
  const own = tracks.map(alignmentCounts)
  return tracks.reduce<Score>((total, track, i) => {
    const fold = i % FOLDS
    const training = sumCounts(own.filter((_, j) => j % FOLDS !== fold))
    const key = dominant(training)
    if (key === null) return addScore(total, score(track.grid, track.mine, []))
    const offered = proposeAligned(track.grid, track.phrases, parseAlignment(key))
    return addScore(total, score(track.grid, track.mine, offered))
  }, NO_SCORE)
}

function leaveOneOutScores(tracks: Marked[]): Score {
  const own = tracks.map(alignmentCounts)
  const everything = sumCounts(own)
  return tracks.reduce<Score>((total, track, i) => {
    const rest: Counts = { ...everything }
    for (const [key, n] of Object.entries(own[i])) rest[key] -= n
    const key = dominant(
      Object.fromEntries(Object.entries(rest).filter(([, n]) => n > 0)) as Counts,
    )
    if (key === null) return addScore(total, score(track.grid, track.mine, []))
    const offered = proposeAligned(track.grid, track.phrases, parseAlignment(key))
    return addScore(total, score(track.grid, track.mine, offered))
  }, NO_SCORE)
}

function colourKey(color: number | null): string {
  return String(color)
}

function cuePatterns(tracks: Marked[]) {
  const distances: Record<string, Counts> = {}
  const startColours: Counts = {}
  const alignments: Counts = {}
  let hot = 0
  let paired = 0
  let onFirstBeat = 0
  for (const track of tracks) {
    const first = Math.min(...track.mine)
    const memory = track.cues.filter((c) => c.kind === 0)
    const hotCues = track.cues.filter((c) => c.kind !== 0 && c.ms < first - SAME_POSITION_MS)
    for (const cue of hotCues) {
      const distance = barOf(track.grid, first) - barOf(track.grid, cue.ms)
      distances[distance] ??= {}
      bump(distances[distance], colourKey(cue.color))
      hot++
      if (memory.some((m) => Math.abs(m.ms - cue.ms) <= SAME_POSITION_MS)) paired++
      if (Math.abs(cue.ms - track.grid[0].ms) <= SAME_POSITION_MS) {
        onFirstBeat++
        bump(startColours, colourKey(cue.color))
      }
    }
    for (const [key, n] of Object.entries(alignmentCounts(track))) bump(alignments, key, n)
  }
  return {
    distanceHistogram: Object.fromEntries(
      Object.entries(distances).map(([d, colours]) => [
        d,
        Object.values(colours).reduce((a, n) => a + n, 0),
      ]),
    ),
    dominantColourByDistance: Object.fromEntries(
      Object.entries(distances).map(([d, colours]) => [d, dominant(colours)]),
    ),
    hotCuesBeforeFirstDrop: hot,
    pairedWithCall: hot ? paired / hot : null,
    onFirstBeat,
    startColours,
    alignments,
  }
}

describe.skipIf(!copy)('Auto proposals against the drops the DJ marked', () => {
  it('counts the drops a proposal lands in the same bar of, on a copy only', async () => {
    const path = resolve(copy as string)
    expect(path.startsWith(SCRATCH) && !path.includes('/Library/Pioneer')).toBe(true)
    const db =
      openRekordboxDb(path, { readonly: true }) ??
      openRekordboxDb(path, { readonly: true, key: await rekordboxRawKey(path) })
    if (!db) throw new Error('the copy did not open')
    const ids = db
      .prepare('SELECT DISTINCT ContentID FROM djmdCue WHERE coalesce(rb_local_deleted, 0) = 0')
      .all() as { ContentID: string }[]
    const tally = { tracks: 0, noPhrases: 0, drops: 0, hit: 0, proposals: 0, right: 0 }
    const withPhrases: Marked[] = []
    for (const { ContentID } of ids) {
      const read = readTrackCues(db, rekordboxShareDir(path), String(ContentID), { wave: false })
      if (!read?.analysed) continue
      const mine = findDrops(
        read.cues.filter((c) => c.kind === 0).map((c) => c.ms),
        read.cues.filter((c) => c.kind !== 0).map((c) => c.ms),
      )
      if (mine.length === 0) continue
      tally.tracks++
      if (read.phrases.length === 0) {
        tally.noPhrases++
        continue
      }
      withPhrases.push({
        grid: read.grid,
        phrases: read.phrases,
        cues: read.cues,
        mine,
      })
      const generic = score(read.grid, mine, proposeDrops(read.strong, []))
      tally.drops += generic.drops
      tally.hit += generic.hit
      tally.proposals += generic.proposals
      tally.right += generic.right
    }
    db.close()
    console.log(JSON.stringify({ ...tally, ...rates(tally) }))
    console.log(JSON.stringify({ patterns: cuePatterns(withPhrases) }))
    const leaveOneOut = leaveOneOutScores(withPhrases)
    const fiveFold = calibratedScores(withPhrases)
    console.log(
      JSON.stringify({
        calibrated: {
          learnedAlignment: dominant(sumCounts(withPhrases.map(alignmentCounts))),
          leaveOneOut: { ...leaveOneOut, ...rates(leaveOneOut) },
          fiveFold: { ...fiveFold, ...rates(fiveFold) },
        },
      }),
    )
    expect(tally.tracks).toBeGreaterThan(0)
  })
})
