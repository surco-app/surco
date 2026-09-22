import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ffmpegPath } from './binaries'
import { probeAudio } from './ffmpeg'

// ffmpeg.ts keeps its own `run` private; a measurement has no business widening
// that surface, so it spawns the same binary itself.
const execFileAsync = promisify(execFile)

// Not a test of the code: a measurement of the bit-depth scan's window. The shipped
// scan reads the first BITS_SCAN_SECONDS (60) and its comment claims that is plenty
// because "the measured separation is total" and the grey middle was "never
// observed". A user's album (The Veronicas, HUMAN) broke both claims: two tracks read
// 0.0% over the first minute but 0.60% and 0.50% over the whole track, because the
// audio is 16-bit and only the fade-out tail was computed at a wider depth. Over the
// whole track those two land in the grey band the comment says nobody has seen.
//
// So this sweep grades every qualifying file twice — first minute vs whole track —
// and reports where the two disagree. It answers one question with numbers before
// anyone widens the window: how often does the minute hide something, and would
// reading the whole track trade a clean verdict for an 'unknown'?
//
//   SURCO_BITS_SWEEP_DIR=/Volumes/Public/Musica/FLAC npm run bits-sweep
//
// Rows are appended to SURCO_BITS_SWEEP_OUT (default ~/surco-bits-sweep.jsonl) as they
// land and a rerun skips what is already measured, so a stopped sweep resumes.
const root = process.env.SURCO_BITS_SWEEP_DIR
const out = process.env.SURCO_BITS_SWEEP_OUT ?? join(homedir(), 'surco-bits-sweep.jsonl')
const concurrency = Number(process.env.SURCO_BITS_SWEEP_CONCURRENCY ?? 4)
const EXTENSIONS = new Set(['.flac', '.aiff', '.aif', '.wav'])

// The shipped thresholds, restated rather than imported: this sweep exists to judge
// them, so a change to them should show up here as a moved verdict, not vanish into
// a shared constant that quietly moves both sides at once.
const PADDED_MAX_PCT = 0.01
const FULL_MIN_PCT = 50
const MIN_CONTENT = 100_000
const SCAN_SECONDS = 60

type Usage = 'padded16' | 'full' | 'unknown' | 'no-content'

interface Row {
  path: string
  minute?: { usage: Usage; pct: number; content: number }
  whole?: { usage: Usage; pct: number; content: number }
  error?: string
  ms: number
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else if (EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(full)
  }
  return files
}

function readRows(): Row[] {
  if (!existsSync(out)) return []
  const byPath = new Map<string, Row>()
  for (const line of readFileSync(out, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as Row
    byPath.set(row.path, row)
  }
  return [...byPath.values()]
}

function verdict(pct: number, content: number): Usage {
  if (content < MIN_CONTENT) return 'no-content'
  if (pct <= PADDED_MAX_PCT) return 'padded16'
  if (pct >= FULL_MIN_PCT) return 'full'
  return 'unknown'
}

// The shipped counting rule: skip all-zero samples (digital silence proves nothing),
// then ask what share of the rest carry signal in the lowest byte.
async function measure(
  input: string,
  seconds?: number,
): Promise<{ usage: Usage; pct: number; content: number }> {
  const { stdout } = await execFileAsync(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      input,
      ...(seconds ? ['-t', String(seconds)] : []),
      '-c:a',
      'pcm_s24le',
      '-f',
      's24le',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 },
  )
  const buf = stdout as unknown as Buffer
  const n = Math.floor(buf.length / 3)
  let content = 0
  let lowUsed = 0
  for (let i = 0; i < n; i++) {
    const o = i * 3
    if (buf[o] === 0 && buf[o + 1] === 0 && buf[o + 2] === 0) continue
    content++
    if (buf[o] !== 0) lowUsed++
  }
  const pct = content ? Number(((lowUsed / content) * 100).toFixed(4)) : 0
  return { usage: verdict(pct, content), pct, content }
}

async function grade(path: string): Promise<Row> {
  const t0 = Date.now()
  try {
    const probed = await probeAudio(path)
    // The same gate the shipped scan applies: only integer audio declaring 24 bits
    // has a low byte whose emptiness means anything.
    if (probed.bitsPerRawSample !== 24 || probed.sampleFmt.includes('flt'))
      return { path, ms: Date.now() - t0 }
    return {
      path,
      minute: await measure(path, SCAN_SECONDS),
      whole: await measure(path),
      ms: Date.now() - t0,
    }
  } catch (e) {
    return { path, error: String(e).slice(0, 200), ms: Date.now() - t0 }
  }
}

it.skipIf(!root)(
  'measures the bit-depth scan window: first minute against the whole track',
  async () => {
    const files = await walk(resolve(root as string))
    const done = new Set(
      readRows()
        .filter((r) => !r.error)
        .map((r) => r.path),
    )
    const pending = files.filter((f) => !done.has(f))
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const file = pending[next++]
        if (!file) return
        appendFileSync(out, `${JSON.stringify(await grade(file))}\n`)
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))

    const rows = readRows().filter((r) => files.includes(r.path))
    const judged = rows.filter((r) => r.minute && r.whole)
    const disagree = judged.filter((r) => r.minute?.usage !== r.whole?.usage)
    const greyWhole = judged.filter((r) => r.whole?.usage === 'unknown')
    const count = (u: Usage, pick: 'minute' | 'whole'): number =>
      judged.filter((r) => r[pick]?.usage === u).length

    const summary = [
      `${root}`,
      `${rows.length} files, ${judged.length} qualify (24-bit integer), ${rows.filter((r) => r.error).length} errors`,
      '',
      `first minute : padded ${count('padded16', 'minute')}, full ${count('full', 'minute')}, unknown ${count('unknown', 'minute')}`,
      `whole track  : padded ${count('padded16', 'whole')}, full ${count('full', 'whole')}, unknown ${count('unknown', 'whole')}`,
      '',
      `${disagree.length} of ${judged.length} disagree between the two windows`,
      `${greyWhole.length} land in the grey band over the whole track`,
      '',
      ...disagree
        .sort((a, b) => (b.whole?.pct ?? 0) - (a.whole?.pct ?? 0))
        .map(
          (r) =>
            `${r.minute?.usage} -> ${r.whole?.usage}  minute ${r.minute?.pct}%  whole ${r.whole?.pct}%  ${r.path}`,
        ),
    ].join('\n')
    writeFileSync(`${out}.summary.txt`, `${summary}\n`)
    console.log(summary)
  },
  24 * 60 * 60 * 1000,
)
