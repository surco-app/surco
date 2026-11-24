import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { forcedInputArgs } from '../shared/inputFormat'
import { ffmpegPath } from './binaries'
import { MASTER_RATE, masterShiftOf } from './replaceShiftMeasure'

const execFileAsync = promisify(execFile)

// Not a test of the code: the measurement that fixes the rules of the envelope measure
// (masterShiftOf: the six windows, the 0.5 minimum correlation, the 50 ms tolerance) on the pairs
// of the replace-shift sweep. It reads that sweep's rows (replaceShiftSweep.test.ts) and decodes
// every old and new file whole, mono at MASTER_RATE, to run masterShiftOf on it.
// A positive is "exact" when the sweep's h90 and t90 windows at reach 5 both correlate >= 0.95
// and agree within 2 ms: its truth is that lag, and the envelope measure must land on it. The
// other positives are another master (no exact shift exists) and, with the random and matching
// negatives, must not be moved at all: a wrong shift would slide a DJ's cues off the beat.
//
//   SURCO_MASTER_SWEEP_ROWS=$HOME/surco-replace-sweep.jsonl npm run master-sweep
//
// Only audio is read. The summary goes to SURCO_MASTER_SWEEP_OUT (default
// ~/surco-master-sweep.txt). It reads ~470 pairs from the NAS and takes about 30 minutes.
const rowsFile = process.env.SURCO_MASTER_SWEEP_ROWS
const out = process.env.SURCO_MASTER_SWEEP_OUT ?? join(homedir(), 'surco-master-sweep.txt')
const CONCURRENCY = 4
const EXACT_MIN_CORRELATION = 0.95
const EXACT_AGREEMENT_MS = 2

type Kind = 'positive' | 'random' | 'matching'

interface Peak {
  lag: number
  c: number
}

interface SweepRow {
  kind: Kind
  source: string
  old: string
  new: string
  windows?: Record<string, { peaks?: Record<string, Peak> }>
  error?: string
}

type Class = 'exact' | 'other' | 'negative'

interface Result {
  row: SweepRow
  class: Class
  truth: number | null
  moved: number | null
  error?: string
}

function readRows(path: string): SweepRow[] {
  if (!existsSync(path)) throw new Error(`no sweep rows at ${path}`)
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SweepRow)
    .filter((r) => !r.error)
}

function exactTruth(row: SweepRow): number | null {
  const head = row.windows?.h90?.peaks?.['5']
  const tail = row.windows?.t90?.peaks?.['5']
  if (!head || !tail) return null
  if (head.c < EXACT_MIN_CORRELATION || tail.c < EXACT_MIN_CORRELATION) return null
  return Math.abs(head.lag - tail.lag) <= EXACT_AGREEMENT_MS ? head.lag : null
}

function classOf(row: SweepRow): { class: Class; truth: number | null } {
  if (row.kind !== 'positive') return { class: 'negative', truth: null }
  const truth = exactTruth(row)
  return truth === null ? { class: 'other', truth } : { class: 'exact', truth }
}

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
      String(MASTER_RATE),
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

async function pool<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      await work(items[i])
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
}

async function measure(row: SweepRow): Promise<Result> {
  const { class: cls, truth } = classOf(row)
  try {
    const [old, current] = await Promise.all([decodeAll(row.old), decodeAll(row.new)])
    return { row, class: cls, truth, moved: masterShiftOf(old, current) }
  } catch (e) {
    return { row, class: cls, truth, moved: null, error: String(e).slice(0, 200) }
  }
}

const names = (r: Result): string => `${basename(r.row.old)} -> ${basename(r.row.new)}`

function summarise(results: Result[]): string {
  const ok = results.filter((r) => !r.error)
  const of = (cls: Class): Result[] => ok.filter((r) => r.class === cls)
  const movedOf = (rs: Result[]): Result[] => rs.filter((r) => r.moved !== null)
  const exact = of('exact')
  const other = of('other')
  const negatives = of('negative')
  const exactMoved = movedOf(exact)
  const maxError = exactMoved.reduce(
    (max, r) => Math.max(max, Math.abs((r.moved as number) - (r.truth as number))),
    0,
  )
  const negativesMoved = movedOf(negatives)
  const errors = results.filter((r) => r.error)
  return [
    `exact ${exact.length}, other master ${other.length}, negatives ${negatives.length} (random ${negatives.filter((r) => r.row.kind === 'random').length}, matching ${negatives.filter((r) => r.row.kind === 'matching').length}), decode errors ${errors.length}`,
    `exact moved ${exactMoved.length} of ${exact.length}, max |error| vs truth ${maxError.toFixed(2)} ms`,
    `other master moved ${movedOf(other).length} of ${other.length}`,
    `negatives moved ${negativesMoved.length} of ${negatives.length}`,
    ...negativesMoved.map((r) => `  negative moved ${r.moved} ms: ${names(r)}`),
    ...errors.map((r) => `  error: ${names(r)}: ${r.error}`),
  ].join('\n')
}

it.skipIf(!rowsFile)(
  'measures the envelope shift of the replace sweep pairs against their exact truth and the negatives',
  async () => {
    const rows = readRows(rowsFile as string)
    const results: Result[] = []
    await pool(rows, async (row) => {
      results.push(await measure(row))
    })
    const summary = summarise(results)
    writeFileSync(out, `${summary}\n`)
    console.log(summary)
  },
  24 * 60 * 60 * 1000,
)
