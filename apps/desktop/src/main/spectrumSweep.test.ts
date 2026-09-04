import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { analyzeCutoff, analyzeShelf, buildSpectrum, probeAudio } from './ffmpeg'

// Not a test of the code: a sweep of a library through the real verdict, the
// ground-truth check the corpus is too small to give. Point it at a folder that is
// known lossless and every flagged file is a false positive to look at before a
// release (four user reports in three days were exactly that, found by one user
// with a big collection). It runs through vitest only because that is the cheapest
// way to load the main-process modules with electron mocked; without the folder in
// the environment it is skipped, so CI never touches it.
//
//   SURCO_SWEEP_DIR=/Volumes/Public/Musica/FLAC npm run sweep
//
// Every verdict is appended to SURCO_SWEEP_OUT (default ~/surco-sweep.jsonl) as it
// lands, and a rerun skips what is already graded (errors are retried), so a stopped
// sweep resumes and a changed detector can be re-swept file by file. A summary of the flagged files is
// written beside it. SURCO_SWEEP_CONCURRENCY (default 4) bounds the decodes in flight.
const root = process.env.SURCO_SWEEP_DIR
const out = process.env.SURCO_SWEEP_OUT ?? join(homedir(), 'surco-sweep.jsonl')
const concurrency = Number(process.env.SURCO_SWEEP_CONCURRENCY ?? 4)
const EXTENSIONS = new Set(['.flac', '.aiff', '.aif', '.wav'])

interface Row {
  path: string
  cutoffHz?: number | null
  hasKnee?: boolean
  processed?: boolean
  upsampled?: boolean
  sampleRateHz?: number
  error?: string
  ms: number
}

// AppleDouble side files (._foo.flac) litter SMB shares and are not audio.
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

// Last row per path wins, so a file retried after a transient error (an SMB
// hiccup mid-sweep left ten of them) is read by its retry, not its failure.
function readRows(): Row[] {
  if (!existsSync(out)) return []
  const byPath = new Map<string, Row>()
  for (const line of readFileSync(out, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as Row
    byPath.set(row.path, row)
  }
  return [...byPath.values()]
}

const flagged = (r: Row): boolean => !!(r.hasKnee || r.processed || r.upsampled)

async function grade(path: string): Promise<Row> {
  const t0 = Date.now()
  try {
    const built = await buildSpectrum(path, {
      probe: probeAudio,
      spectrogram: async () => '',
      cutoff: (i, s) => analyzeCutoff(i, s),
      shelf: (i, s) => analyzeShelf(i, s),
      bits: async () => null,
    })
    return {
      path,
      cutoffHz: built.cutoffHz,
      hasKnee: built.hasKnee,
      processed: built.processed,
      upsampled: built.upsampled,
      sampleRateHz: built.sampleRateHz,
      ms: Date.now() - t0,
    }
  } catch (e) {
    return { path, error: String(e).slice(0, 200), ms: Date.now() - t0 }
  }
}

it.skipIf(!root)(
  'sweeps a lossless library through the real spectrum verdict',
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
    const bad = rows.filter(flagged)
    const errors = rows.filter((r) => r.error)
    const summary = [
      `${root}`,
      `${rows.length} graded of ${files.length} found, ${errors.length} errors`,
      `${bad.length} flagged (${((100 * bad.length) / Math.max(1, rows.length)).toFixed(2)}%)`,
      '',
      ...bad.map(
        (r) =>
          `${r.hasKnee ? 'knee' : r.processed ? 'processed' : 'upsampled'} @ ${r.cutoffHz} Hz  ${r.path}`,
      ),
      '',
      ...errors.map((r) => `error  ${r.path}  ${r.error}`),
    ]
    writeFileSync(`${out}.summary.txt`, `${summary.join('\n')}\n`)
  },
  24 * 60 * 60 * 1000,
)
