import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findDrops } from '../shared/cueRules'
import {
  DROP_MODEL,
  type DropInput,
  type DropModel,
  dropCandidates,
  dropProposals,
} from '../shared/dropDetect'
import {
  barIndexOf,
  modelWithTaste,
  type TasteTrack,
  tasteTrackOf,
  tuneDropTaste,
} from '../shared/dropTaste'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readCueWaveDetail, readTrackCues } from './rekordboxCues'
import { openRekordboxDb, rekordboxRawKey } from './rekordboxDb'

const copy = process.env.SURCO_AUTO_TASTE_DB
const SCRATCH = '/private/tmp/claude-501/'

interface Track {
  id: string
  test: boolean
  input: DropInput
  mine: number[]
}

function hashOf(text: string): number {
  let h = 2166136261
  for (const c of text) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
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
    tracks.push({ id, test: hashOf(id) % 10 >= 7, input, mine })
  }
  db.close()
  return tracks
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000

function rates(tracks: Track[], labels: (t: Track) => number[], model: DropModel) {
  const t = { drops: 0, hit: 0, proposals: 0, right: 0, sure: 0, sureRight: 0 }
  for (const track of tracks) {
    const proposals = dropProposals(track.input, model)
    const offered = proposals.map((p) => barIndexOf(track.input.grid, p.ms))
    const mine = labels(track).map((ms) => barIndexOf(track.input.grid, ms))
    t.drops += mine.length
    t.proposals += offered.length
    t.hit += mine.filter((b) => offered.includes(b)).length
    t.right += offered.filter((b) => mine.includes(b)).length
    proposals.forEach((p, i) => {
      if (!p.sure) return
      t.sure++
      if (mine.includes(offered[i])) t.sureRight++
    })
  }
  const found = t.hit / t.drops
  const right = t.right / t.proposals
  return {
    found: r3(found),
    right: r3(right),
    f1: r3((2 * found * right) / (found + right)),
    perTrack: r3(t.proposals / tracks.length),
    sureShare: r3(t.sure / t.proposals),
    sureRight: r3(t.sureRight / t.sure),
    doubtRight: r3((t.right - t.sureRight) / (t.proposals - t.sure)),
  }
}

const tasteTrack = (t: Track, drops: number[]): TasteTrack => ({
  key: t.id,
  candidates: dropCandidates(t.input).map((c) => ({ bar: c.bar, features: c.features })),
  drops: [...new Set(drops.map((ms) => barIndexOf(t.input.grid, ms)))],
})

describe.skipIf(!copy)('Auto marcar tuned to a DJ’s own marks', () => {
  it('measures the shipped and the tuned detector on held-out tracks, on a copy only', async () => {
    const path = resolve(copy as string)
    expect(path.startsWith(SCRATCH) && !path.includes('/Library/Pioneer')).toBe(true)
    const tracks = await loadTracks(path)
    const test = tracks.filter((t) => t.test)
    const train = tracks.filter((t) => !t.test)
    console.log(JSON.stringify({ tracks: tracks.length, test: test.length }))
    const djs: Record<string, (t: Track) => number[]> = {
      vicent: (t) => t.mine,
      firstOnly: (t) => [Math.min(...t.mine)],
      lastOnly: (t) => [Math.max(...t.mine)],
    }
    for (const [dj, labels] of Object.entries(djs))
      for (const size of [30, 60, 120, 300, train.length]) {
        const started = performance.now()
        const tuned = tuneDropTaste(train.slice(0, size).map((t) => tasteTrack(t, labels(t))))
        const ms = Math.round(performance.now() - started)
        console.log(
          JSON.stringify({
            dj,
            learnedFrom: size,
            ms,
            adopted: tuned?.taste !== null,
            check: tuned?.check,
            shipped: rates(test, labels, DROP_MODEL),
            tuned: rates(test, labels, modelWithTaste(tuned?.taste ?? null)),
          }),
        )
      }
  }, 1_800_000)

  it('measures how much a correction should weigh, on held-out tracks, on a copy only', async () => {
    const path = resolve(copy as string)
    expect(path.startsWith(SCRATCH) && !path.includes('/Library/Pioneer')).toBe(true)
    const tracks = await loadTracks(path)
    const test = tracks.filter((t) => t.test)
    const train = tracks.filter((t) => !t.test)
    const djs: Record<string, (t: Track) => number[]> = {
      vicent: (t) => t.mine,
      firstOnly: (t) => [Math.min(...t.mine)],
    }
    for (const [dj, labels] of Object.entries(djs))
      for (const size of [30, 60, 120, train.length]) {
        const taken = train
          .slice(0, size)
          .flatMap((t) => tasteTrackOf(t.input, labels(t), DROP_MODEL) ?? [])
        const outcomes = Object.fromEntries(
          ['accepted', 'corrected', 'manual'].map((o) => [
            o,
            taken.filter((t) => t.outcome === o).length,
          ]),
        )
        for (const weight of [1, 2, 3, 5, 8]) {
          const tuned = tuneDropTaste(taken, DROP_MODEL, weight)
          console.log(
            JSON.stringify({
              dj,
              learnedFrom: size,
              outcomes,
              weight,
              adopted: tuned?.taste !== null,
              tuned: rates(test, labels, modelWithTaste(tuned?.taste ?? null)),
            }),
          )
        }
      }
  }, 3_600_000)

  it('measures what a shared edits file weighs and how long learning takes, on a copy only', async () => {
    const path = resolve(copy as string)
    expect(path.startsWith(SCRATCH) && !path.includes('/Library/Pioneer')).toBe(true)
    const tracks = await loadTracks(path)
    const taken = tracks
      .flatMap((t) => tasteTrackOf(t.input, t.mine, DROP_MODEL) ?? [])
      .slice(-1000)
    const text = JSON.stringify({ version: 1, edits: taken })
    const candidates = taken.reduce((n, t) => n + t.candidates.length, 0)
    console.log(
      JSON.stringify({
        edits: taken.length,
        candidates,
        megabytes: r3(text.length / 1_000_000),
        bytesPerEdit: Math.round(text.length / taken.length),
      }),
    )
    for (const size of [30, 100, 300, 1000]) {
      const started = performance.now()
      tuneDropTaste(taken.slice(0, size))
      console.log(
        JSON.stringify({ learnedFrom: size, seconds: r3((performance.now() - started) / 1000) }),
      )
    }
  }, 3_600_000)

  it('measures whether rounding the stored features changes what Auto learns, on a copy only', async () => {
    const path = resolve(copy as string)
    expect(path.startsWith(SCRATCH) && !path.includes('/Library/Pioneer')).toBe(true)
    const tracks = await loadTracks(path)
    const test = tracks.filter((t) => t.test)
    const train = tracks.filter((t) => !t.test)
    const all = (labels: (t: Track) => number[]) =>
      train.flatMap((t) => tasteTrackOf(t.input, labels(t), DROP_MODEL) ?? [])
    const rounded = (edits: TasteTrack[], decimals: number): TasteTrack[] =>
      edits.map((e) => ({
        ...e,
        candidates: e.candidates.map((c) => ({
          bar: c.bar,
          features: c.features.map((f) => Number(f.toFixed(decimals))),
        })),
      }))
    const djs: Record<string, (t: Track) => number[]> = {
      vicent: (t) => t.mine,
      firstOnly: (t) => [Math.min(...t.mine)],
    }
    for (const [dj, labels] of Object.entries(djs)) {
      const edits = all(labels)
      for (const decimals of [null, 3, 2]) {
        const used = decimals === null ? edits : rounded(edits, decimals)
        const tuned = tuneDropTaste(used)
        console.log(
          JSON.stringify({
            dj,
            decimals,
            megabytesPer1000: r3(
              (JSON.stringify({ version: 1, edits: used.slice(0, 1000) }).length / 1_000_000) *
                (1000 / Math.min(1000, used.length)),
            ),
            adopted: tuned?.taste !== null,
            tuned: rates(test, labels, modelWithTaste(tuned?.taste ?? null)),
          }),
        )
      }
    }
  }, 3_600_000)
})
