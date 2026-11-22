import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { forcedInputArgs } from '../shared/inputFormat'
import type { AppleMusicLookupCandidate } from '../shared/types'
import { ffmpegPath } from './binaries'
import { probeDuration, readTags } from './ffmpeg'
import { lagCorrelations, PAIR_RATE } from './pcmLag'
import { openRekordboxDb } from './rekordboxDb'
import { readRekordboxCollection } from './rekordboxPlaylists'

const execFileAsync = promisify(execFile)

// Not a test of the code: the measurement that fixes the replace-shift constants (reach, window
// positions, tolerance, peak margin and exclusion, minimum correlation) on real same-track pairs.
// The positives are pairs of files that hold the same track, from three places:
//   originals  the originals Surco kept in its trash (trash.json in userData), each against the
//              copy of the same track still in the library;
//   djCopies   an Apple Music file against a rekordbox entry of the same track at another path,
//              paired the way the editor's "In your library" section pairs them (findLibraryEntry:
//              title, artist and duration);
//   downloads  a downloaded file against the Apple Music copy of the same track, the case a
//              replacement starts from.
// The same title is no proof of the same master: a pair the measure rejects can be right to. The
// truth of a pair is what every window agrees on (see `truthOf`), not the title.
// Two negative controls must give nothing reliable: every old file against the new file of another
// pair at random (fixed seed), and the Matching pairs in matching-pairs.json (different tracks
// that mix well, so they share tempo and often key).
//
//   SURCO_REPLACE_SWEEP_LIBRARY=/Volumes/Public/Music/Media.localized/Music \
//   SURCO_REPLACE_SWEEP_DOWNLOADS="/Volumes/Public/Soulseek Downloads:$HOME/Desktop" \
//   SURCO_REPLACE_SWEEP_RB_DB=/path/to/a/copy/of/master.db npm run replace-sweep
//
// or SURCO_REPLACE_SWEEP_PAIRS=pairs.tsv with `old<TAB>new[<TAB>source]` lines. Lists are joined
// with ':'. Only audio is read: no program is touched and rekordbox is read from a copy.
// Rows are appended to SURCO_REPLACE_SWEEP_OUT (default ~/surco-replace-sweep.jsonl) as they land,
// tag reads to the same path with .files.jsonl, and a rerun skips what is already there.
const library = process.env.SURCO_REPLACE_SWEEP_LIBRARY
const pairsFile = process.env.SURCO_REPLACE_SWEEP_PAIRS
const downloads = process.env.SURCO_REPLACE_SWEEP_DOWNLOADS
const rekordboxCopy = process.env.SURCO_REPLACE_SWEEP_RB_DB
const userData = join(homedir(), 'Library', 'Application Support', 'Surco')
const trashFile = process.env.SURCO_REPLACE_SWEEP_TRASH ?? join(userData, 'trash', 'trash.json')
const matchingFile =
  process.env.SURCO_REPLACE_SWEEP_MATCHING ?? join(userData, 'matching-pairs.json')
const out = process.env.SURCO_REPLACE_SWEEP_OUT ?? join(homedir(), 'surco-replace-sweep.jsonl')
const filesOut = `${out}.files.jsonl`
const concurrency = Number(process.env.SURCO_REPLACE_SWEEP_CONCURRENCY ?? 4)
const EXTENSIONS = new Set(['.flac', '.aiff', '.aif', '.wav', '.mp3', '.m4a'])

// Measured wide on purpose: every candidate setting is a sub-range of these.
const MEASURE_REACH = 30
const WINDOW = 5
const REACHES = [5, 10, 15, 20, 30]
const EXCLUDES_MS = [20, 50, 100]
const HEADS = [10, 20, 30, 45, 60, 90]
const TAILS = [10, 20, 30, 45, 60, 90]
const OLD_SLACK_SAMPLES = 441
const SEED = 20261122

type Kind = 'positive' | 'random' | 'matching'

interface Pair {
  kind: Kind
  source: string
  old: string
  new: string
}

// Per reach: the best lag (ms) and its correlation, and per exclusion the best correlation of any
// other lag at least that far from it (the rival) with its lag.
interface ReachPeak {
  lag: number
  c: number
  rival: Record<string, { c: number; lag: number }>
}

type WindowRead = { silent: true } | { short: true } | { peaks: Record<string, ReachPeak> }

interface Row extends Pair {
  oldSec?: number
  newSec?: number
  windows?: Record<string, WindowRead>
  error?: string
  ms: number
}

interface FileRead {
  path: string
  title: string
  artist: string
  durationSec: number | null
  error?: string
}

const pairKey = (p: Pair): string => `${p.kind}\t${p.old}\t${p.new}`

function listOf(value: string | undefined): string[] {
  return value ? value.split(':').filter(Boolean) : []
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else if (EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(full)
  }
  return files
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

async function pool<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      await work(items[i])
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
}

async function readFiles(paths: string[]): Promise<Map<string, FileRead>> {
  const reads = new Map(readJsonl<FileRead>(filesOut).map((r) => [r.path, r]))
  await pool(
    paths.filter((p) => !reads.has(p)),
    async (path) => {
      let read: FileRead
      try {
        const tags = await readTags(path)
        read = {
          path,
          title: tags.title,
          artist: tags.artist,
          durationSec: await probeDuration(path),
        }
      } catch (e) {
        read = { path, title: '', artist: '', durationSec: null, error: String(e).slice(0, 200) }
      }
      reads.set(path, read)
      appendFileSync(filesOut, `${JSON.stringify(read)}\n`)
    },
  )
  return reads
}

function fileId(path: string): string | null {
  try {
    const { dev, ino } = statSync(path)
    return `${dev}:${ino}`
  } catch {
    return null
  }
}

function candidates(reads: FileRead[]): AppleMusicLookupCandidate[] {
  return reads.flatMap((r) =>
    r.title && r.artist
      ? [{ title: r.title, artist: r.artist, path: r.path, durationSec: r.durationSec ?? 0 }]
      : [],
  )
}

// The editor's matcher lives in the renderer, outside this project's type program, so it is
// loaded by path and typed by what the sweep uses of it.
interface LibraryMatcher {
  buildLibraryIndex(tracks: AppleMusicLookupCandidate[]): unknown
  findLibraryEntry(
    index: unknown,
    meta: { title: string; artist: string },
    durationSec?: number,
  ): { path?: string } | null
}

async function importMatcher(): Promise<LibraryMatcher> {
  return import(`../renderer/src/lib/${'appleMusicLibrary'}.ts`)
}

// The editor's pairing: the best library entry for the file's title, artist and duration, as
// long as it is another file (not the same one reached by another path).
function pairsAgainst(
  { buildLibraryIndex, findLibraryEntry }: LibraryMatcher,
  queries: FileRead[],
  targets: AppleMusicLookupCandidate[],
  source: string,
  oldIsQuery: boolean,
): Pair[] {
  const index = buildLibraryIndex(targets)
  return queries.flatMap((q) => {
    if (!q.title || !q.artist) return []
    const entry = findLibraryEntry(index, q, q.durationSec ?? undefined)
    if (!entry?.path || !existsSync(entry.path)) return []
    const a = fileId(q.path)
    if (a === null || a === fileId(entry.path)) return []
    return [
      oldIsQuery
        ? { kind: 'positive' as const, source, old: q.path, new: entry.path }
        : { kind: 'positive' as const, source, old: entry.path, new: q.path },
    ]
  })
}

function rekordboxTracks(path: string): AppleMusicLookupCandidate[] {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error(`could not open the rekordbox copy ${path}`)
  try {
    return readRekordboxCollection(db).flatMap((t) =>
      t.path && existsSync(t.path)
        ? [{ title: t.title, artist: t.artist, durationSec: t.durationSec ?? 0, path: t.path }]
        : [],
    )
  } finally {
    db.close()
  }
}

async function positivePairs(): Promise<Pair[]> {
  if (pairsFile) {
    return readFileSync(pairsFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [old, current = '', source = 'file'] = line.split('\t')
        return { kind: 'positive' as const, source, old, new: current }
      })
  }
  const libraryFiles = (await Promise.all(listOf(library).map(walk))).flat()
  const downloadFiles = (await Promise.all(listOf(downloads).map(walk))).flat()
  const trash = existsSync(trashFile)
    ? (JSON.parse(readFileSync(trashFile, 'utf8')) as { storedPath: string }[])
        .map((e) => e.storedPath)
        .filter((p) => existsSync(p))
    : []
  const reads = await readFiles([...libraryFiles, ...downloadFiles, ...trash])
  const pick = (paths: string[]): FileRead[] =>
    paths.flatMap((p) => {
      const r = reads.get(p)
      return r && !r.error ? [r] : []
    })
  const libraryReads = pick(libraryFiles)
  const rekordbox = rekordboxCopy ? rekordboxTracks(rekordboxCopy) : []
  const everywhere = [
    ...candidates(libraryReads),
    ...candidates(pick(downloadFiles)),
    ...rekordbox.filter((t) => !reads.has(t.path ?? '')),
  ]
  const matcher = await importMatcher()
  const found = [
    ...pairsAgainst(matcher, pick(trash), everywhere, 'originals', true),
    ...pairsAgainst(matcher, libraryReads, rekordbox, 'djCopies', true),
    ...pairsAgainst(matcher, pick(downloadFiles), candidates(libraryReads), 'downloads', false),
  ]
  const seen = new Set<string>()
  return found.filter((p) => {
    const key = [fileId(p.old), fileId(p.new)].sort().join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// Each old file against the new file of another pair: two different tracks, so any reliable
// shift between them is a false one.
function randomPairs(positives: Pair[]): Pair[] {
  const next = random(SEED)
  return positives.flatMap((p, i) => {
    for (let tries = 0; tries < 20; tries++) {
      const j = Math.floor(next() * positives.length)
      const other = positives[j]
      if (j === i || other.new === p.new || other.old === p.old || other.new === p.old) continue
      return [{ kind: 'random' as const, source: p.source, old: p.old, new: other.new }]
    }
    return []
  })
}

function matchingPairs(): Pair[] {
  if (!existsSync(matchingFile)) return []
  const { pairs } = JSON.parse(readFileSync(matchingFile, 'utf8')) as { pairs: string[][] }
  return pairs
    .filter(([a, b]) => existsSync(a) && existsSync(b))
    .map(([a, b]) => ({ kind: 'matching' as const, source: 'matching', old: a, new: b }))
}

// The whole file once, mono at PAIR_RATE with the same downmix as decodePcm: slicing it is the
// same audio as decodePcm's exactStart windows, which decode from the top and discard.
async function decodeAll(path: string): Promise<Float32Array> {
  const { stdout } = await execFileAsync(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      ...forcedInputArgs(path),
      '-i',
      path,
      '-ac',
      '1',
      '-rematrix_maxval',
      '1.0',
      '-ar',
      String(PAIR_RATE),
      '-f',
      'f32le',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 * 1024 },
  )
  const buf = stdout as unknown as Buffer
  const bytes = buf.length - (buf.length % 4)
  const pcm = new Uint8Array(bytes)
  pcm.set(buf.subarray(0, bytes))
  return new Float32Array(pcm.buffer)
}

// One window as measureReplaceShift cuts it, but with MEASURE_REACH, read out for every
// candidate reach and exclusion at once (a narrower reach is a sub-range of the same curve).
function readWindow(old: Float32Array, current: Float32Array, at: number): WindowRead {
  const width = WINDOW * PAIR_RATE
  const reach = MEASURE_REACH * PAIR_RATE
  const from = Math.round(at * PAIR_RATE)
  if (from < 0 || old.length - from < width - OLD_SLACK_SAMPLES) return { short: true }
  const padded = new Float32Array(width + 2 * reach)
  padded.set(old.subarray(from, from + width), reach)
  const wide = new Float32Array(width + 2 * reach)
  const start = from - reach
  for (let k = Math.max(0, -start); k < wide.length && start + k < current.length; k++)
    wide[k] = current[start + k]
  const curve = lagCorrelations(padded, wide, reach, reach)
  if (!curve) return { silent: true }
  const peaks: Record<string, ReachPeak> = {}
  for (const r of REACHES) {
    const lo = reach - r * PAIR_RATE
    const hi = reach + r * PAIR_RATE
    let best = lo
    for (let k = lo; k <= hi; k++) if (curve[k] > curve[best]) best = k
    const rival: ReachPeak['rival'] = {}
    for (const e of EXCLUDES_MS) {
      const ex = Math.round((e * PAIR_RATE) / 1000)
      let at2 = -1
      for (let k = lo; k <= hi; k++)
        if (Math.abs(k - best) > ex && (at2 < 0 || curve[k] > curve[at2])) at2 = k
      rival[e] = {
        c: at2 < 0 ? -1 : round4(curve[at2]),
        lag: at2 < 0 ? 0 : round2(((at2 - reach) * 1000) / PAIR_RATE),
      }
    }
    peaks[r] = {
      lag: round2(((best - reach) * 1000) / PAIR_RATE),
      c: round4(curve[best]),
      rival,
    }
  }
  return { peaks }
}

const round2 = (x: number): number => Math.round(x * 100) / 100
const round4 = (x: number): number => Math.round(x * 10000) / 10000

async function measure(pair: Pair): Promise<Row> {
  const t0 = Date.now()
  try {
    const [old, current] = await Promise.all([decodeAll(pair.old), decodeAll(pair.new)])
    const oldSec = old.length / PAIR_RATE
    const windows: Record<string, WindowRead> = {}
    for (const h of HEADS) windows[`h${h}`] = readWindow(old, current, h)
    for (const t of TAILS) windows[`t${t}`] = readWindow(old, current, oldSec - t - WINDOW)
    return {
      ...pair,
      oldSec: round2(oldSec),
      newSec: round2(current.length / PAIR_RATE),
      windows,
      ms: Date.now() - t0,
    }
  } catch (e) {
    return { ...pair, error: String(e).slice(0, 200), ms: Date.now() - t0 }
  }
}

interface Rule {
  reach: number
  head: number
  tail: number
  exclude: number
  margin: number
  minCorrelation: number
  tolerance: number
}

type Verdict =
  | { moved: number; headMs: number; tailMs: number }
  | { drift: true }
  | { noMatch: 'silent' | 'short' | 'low' | 'rival' }

// windowLagMs on a recorded window.
function windowLag(
  w: WindowRead | undefined,
  rule: Rule,
): number | 'silent' | 'short' | 'low' | 'rival' {
  if (!w || 'short' in w) return 'short'
  if ('silent' in w) return 'silent'
  const p = w.peaks[rule.reach]
  if (p.c < rule.minCorrelation) return 'low'
  if (p.rival[rule.exclude].c >= Math.min(rule.minCorrelation, p.c - rule.margin)) return 'rival'
  return p.lag
}

// replaceShiftOf on a recorded row, with measureReplaceShift's rule that a track too short for a
// tail after the head has no tail.
function verdictOf(row: Row, rule: Rule): Verdict {
  const oldSec = row.oldSec ?? 0
  const tailAt = oldSec - rule.tail - WINDOW
  const head = windowLag(row.windows?.[`h${rule.head}`], rule)
  const tail =
    tailAt >= rule.head + WINDOW ? windowLag(row.windows?.[`t${rule.tail}`], rule) : 'short'
  if (typeof head !== 'number') return { noMatch: head }
  if (typeof tail !== 'number') return { noMatch: tail }
  if (Math.abs(head - tail) > rule.tolerance) return { drift: true }
  return { moved: Math.round(head), headMs: head, tailMs: tail }
}

// What the pair's audio says, independent of any rule: at least three windows over the whole
// track, head and tail among them, whose best lag at the widest reach correlates ≥ 0.95 and
// agrees within 2 ms. Null when the windows do not agree on one shift (another master, an edit).
function truthOf(row: Row): number | null {
  const lags = Object.entries(row.windows ?? {}).flatMap(([name, w]) =>
    'peaks' in w && w.peaks[MEASURE_REACH].c >= 0.95
      ? [{ name, lag: w.peaks[MEASURE_REACH].lag }]
      : [],
  )
  for (const anchor of lags) {
    const near = lags.filter((l) => Math.abs(l.lag - anchor.lag) <= 2)
    if (
      near.length >= 3 &&
      near.some((l) => l.name.startsWith('h')) &&
      near.some((l) => l.name.startsWith('t'))
    ) {
      const sorted = near.map((l) => l.lag).sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]
    }
  }
  return null
}

interface Score {
  moved: number
  correct: number
  wrong: number
  drift: number
  noMatch: Record<string, number>
  negativesReliable: number
}

function score(rows: Row[], rule: Rule): Score {
  const s: Score = { moved: 0, correct: 0, wrong: 0, drift: 0, noMatch: {}, negativesReliable: 0 }
  for (const row of rows) {
    const v = verdictOf(row, rule)
    if (row.kind !== 'positive') {
      if ('moved' in v) s.negativesReliable++
      continue
    }
    if ('moved' in v) {
      s.moved++
      const truth = truthOf(row)
      if (truth !== null && Math.abs(v.moved - truth) <= rule.tolerance + 1) s.correct++
      else s.wrong++
    } else if ('drift' in v) s.drift++
    else s.noMatch[v.noMatch] = (s.noMatch[v.noMatch] ?? 0) + 1
  }
  return s
}

function summarise(measured: Row[]): string {
  const errors = (kind: (k: Kind) => boolean): number =>
    measured.filter((r) => kind(r.kind) && r.error).length
  const rows = measured.filter((r) => !r.error)
  const positives = rows.filter((r) => r.kind === 'positive')
  const lines: string[] = []
  const bySource = new Map<string, number>()
  for (const r of positives) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1)
  lines.push(
    `positives ${positives.length} (${[...bySource].map(([k, v]) => `${k} ${v}`).join(', ')}), errors ${errors((k) => k === 'positive')}`,
    `random ${rows.filter((r) => r.kind === 'random').length}, matching ${rows.filter((r) => r.kind === 'matching').length}, errors ${errors((k) => k !== 'positive')}`,
  )
  const truths = positives.map(truthOf)
  lines.push(
    `positives whose windows agree on one shift: ${truths.filter((t) => t !== null).length}; shifts ${JSON.stringify(
      [...new Set(truths.filter((t) => t !== null).map((t) => Math.round(t as number)))].sort(
        (a, b) => a - b,
      ),
    )}`,
  )

  let maxHeadLag = 0
  for (const r of positives)
    for (const [name, w] of Object.entries(r.windows ?? {}))
      if (name.startsWith('h') && 'peaks' in w && w.peaks[MEASURE_REACH].c >= 0.9)
        maxHeadLag = Math.max(maxHeadLag, Math.abs(w.peaks[MEASURE_REACH].lag) / 1000)
  lines.push(`max |head lag| with correlation >= 0.9 at reach 30: ${maxHeadLag.toFixed(3)} s`)

  const silentOf = (name: string): number =>
    rows.filter((r) => r.windows && 'silent' in (r.windows[name] ?? {})).length
  lines.push(
    `silent windows: ${[...HEADS.map((h) => `h${h}`), ...TAILS.map((t) => `t${t}`)].map((n) => `${n} ${silentOf(n)}`).join(', ')}`,
  )

  let maxNegative = -1
  for (const r of rows.filter((x) => x.kind !== 'positive'))
    for (const w of Object.values(r.windows ?? {}))
      if ('peaks' in w) maxNegative = Math.max(maxNegative, w.peaks[20].c)
  lines.push(`highest best-lag correlation of any negative window at reach 20: ${maxNegative}`)

  const header = 'reach head tail excl margin minC tol | moved correct wrong drift noMatch | neg'
  const table: { line: string; correct: number; neg: number }[] = []
  for (const reach of [5, 10, 15, 20])
    for (const head of HEADS.filter((h) => h >= reach))
      for (const tail of TAILS)
        for (const exclude of EXCLUDES_MS)
          for (const margin of [0.02, 0.05, 0.1])
            for (const minCorrelation of [0.8, 0.85, 0.9, 0.95])
              for (const tolerance of [1, 2, 3, 5]) {
                const rule = { reach, head, tail, exclude, margin, minCorrelation, tolerance }
                const s = score(rows, rule)
                table.push({
                  correct: s.correct,
                  neg: s.negativesReliable,
                  line: `${reach} ${head} ${tail} ${exclude} ${margin} ${minCorrelation} ${tolerance} | ${s.moved} ${s.correct} ${s.wrong} ${s.drift} ${JSON.stringify(s.noMatch)} | ${s.negativesReliable}`,
                })
              }
  lines.push('', `best 40 rules with no negative reliable`, header)
  lines.push(
    ...table
      .filter((t) => t.neg === 0)
      .sort((a, b) => b.correct - a.correct)
      .slice(0, 40)
      .map((t) => t.line),
  )
  lines.push('', 'rules with a negative reliable (first 20 by negatives)', header)
  lines.push(
    ...table
      .filter((t) => t.neg > 0)
      .sort((a, b) => b.neg - a.neg)
      .slice(0, 20)
      .map((t) => t.line),
  )
  return lines.join('\n')
}

it.skipIf(!library && !pairsFile)(
  'measures the replace shift of real same-track pairs and two negative controls',
  async () => {
    const positives = await positivePairs()
    const all = [...positives, ...randomPairs(positives), ...matchingPairs()]
    const done = new Set(
      readJsonl<Row>(out)
        .filter((r) => !r.error)
        .map(pairKey),
    )
    await pool(
      all.filter((p) => !done.has(pairKey(p))),
      async (pair) => {
        appendFileSync(out, `${JSON.stringify(await measure(pair))}\n`)
      },
    )
    const wanted = new Set(all.map(pairKey))
    const byKey = new Map<string, Row>()
    for (const row of readJsonl<Row>(out))
      if (wanted.has(pairKey(row))) byKey.set(pairKey(row), row)
    const summary = summarise([...byKey.values()])
    writeFileSync(`${out}.summary.txt`, `${summary}\n`)
    console.log(summary)
  },
  24 * 60 * 60 * 1000,
)
