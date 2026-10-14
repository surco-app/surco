import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => tmpdir(), on: () => {} } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { AppleMusicLookupCandidate, TrackMetadata } from '../shared/types'
import { buildLibraryDumpScript, parseLibraryDump, runOsascript } from './applemusic'
import { readMeta } from './ffmpeg'

// Not a test of the code: a sweep of a download folder through the real "already in Apple
// Music" verdict, against the live library. Reported 13/10: a label's Bandcamp download
// read as "not in Apple Music" while the library held it, and only a real file showed it.
// The answer key is the audio itself: a library entry whose length matches the file's to
// the millisecond, and whose title shares a word with the file's path, is the same track.
//
//   SURCO_LIBRARY_SWEEP_DIR=/Volumes/Public/Musica npm run sweep:library
//
// The file reads are the slow part over SMB, so each one is appended to
// SURCO_LIBRARY_SWEEP_OUT (default ~/surco-library-sweep.jsonl) and a rerun skips them;
// the library dump and the verdict are recomputed every run, so a changed parser or
// matcher is measured on the same reads. The report lands beside it as .summary.txt.
// SURCO_LIBRARY_SWEEP_REUSE=1 skips the folder and grades every read already saved, so a
// fix is measured before and after without touching a share that drops mid-walk.
const root = process.env.SURCO_LIBRARY_SWEEP_DIR
const reuse = process.env.SURCO_LIBRARY_SWEEP_REUSE
const out = process.env.SURCO_LIBRARY_SWEEP_OUT ?? join(homedir(), 'surco-library-sweep.jsonl')
const concurrency = Number(process.env.SURCO_LIBRARY_SWEEP_CONCURRENCY ?? 6)
const EXTENSIONS = new Set(['.flac', '.aiff', '.aif', '.wav', '.mp3', '.m4a'])
const SAME_AUDIO_SEC = 0.005
const ANY_VERSION_SEC = 1
const VERSION_WORDS = new Set([
  'mix',
  'remix',
  'edit',
  'extended',
  'original',
  'radio',
  'club',
  'dub',
  'version',
  'remaster',
  'remastered',
  'feat',
  'the',
  'and',
])

interface Row {
  path: string
  title: string
  artist: string
  duration: number | null
  error?: string
}

interface RendererLib {
  buildLibraryIndex(tracks: AppleMusicLookupCandidate[]): unknown
  isInLibrary(
    index: unknown,
    candidate: { title: string; artist: string; durationSec?: number },
  ): boolean
  parseFileName(path: string): { fileName: string; artist: string; title: string; query: string }
  foldText(s: string): string
  searchFromTags(
    parsed: { fileName: string; artist: string; title: string; query: string },
    tags: Pick<TrackMetadata, 'title' | 'artist'>,
  ): { title: string; artist: string }
}

async function importRenderer(): Promise<RendererLib> {
  const lib = (name: string) => import(`../renderer/src/lib/${name}.ts`)
  const mods = await Promise.all(
    ['appleMusicLibrary', 'filename', 'normalizeText', 'search'].map(lib),
  )
  return Object.assign({}, ...mods)
}

interface RawEntry {
  title: string
  artist: string
  durationSec: number
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

function readRows(): Map<string, Row> {
  const byPath = new Map<string, Row>()
  if (!existsSync(out)) return byPath
  for (const line of readFileSync(out, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as Row
    byPath.set(row.path, row)
  }
  return byPath
}

async function read(path: string): Promise<Row> {
  const meta = await readMeta(path)
  if (meta.failed) return { path, title: '', artist: '', duration: null, error: 'read failed' }
  return {
    path,
    title: meta.tags.title ?? '',
    artist: meta.tags.artist ?? '',
    duration: meta.duration,
  }
}

function rawEntries(stdout: string): RawEntry[] {
  return stdout.split('\n').flatMap((line) => {
    const fields = line.split('\t')
    const durationSec = Number(fields.at(-2)?.replace(',', '.'))
    if (fields.length < 4 || !Number.isFinite(durationSec)) return []
    return [{ title: fields[0], artist: fields.slice(1, -2).join('\t'), durationSec }]
  })
}

function sameAudio(
  foldText: (s: string) => string,
  path: string,
  duration: number,
  entries: RawEntry[],
): RawEntry | undefined {
  const words = new Set(foldText(path).split(' '))
  return entries.find((e) => {
    if (Math.abs(e.durationSec - duration) > SAME_AUDIO_SEC) return false
    const base = foldText(e.title.replace(/\s*[([].*$/, ''))
      .split(' ')
      .filter((w) => w.length >= 3 && !VERSION_WORDS.has(w))
    return base.length > 0 && base.every((w) => words.has(w))
  })
}

it.skipIf(!root && !reuse)(
  'sweeps a download folder through the real Apple Music verdict',
  async () => {
    const { buildLibraryIndex, isInLibrary, parseFileName, foldText, searchFromTags } =
      await importRenderer()
    const files = reuse ? [...readRows().keys()] : await walk(resolve(root as string))
    const done = readRows()
    const pending = reuse ? [] : files.filter((f) => !done.get(f) || done.get(f)?.error)
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const file = pending[next++]
        if (!file) return
        appendFileSync(out, `${JSON.stringify(await read(file))}\n`)
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))

    const t0 = performance.now()
    const stdout = await runOsascript(buildLibraryDumpScript(), { maxBuffer: 64 * 1024 * 1024 })
    const dumpMs = performance.now() - t0
    const t1 = performance.now()
    const index = buildLibraryIndex(parseLibraryDump(stdout))
    const indexMs = performance.now() - t1
    const entries = rawEntries(stdout)

    const rows = [...readRows().values()].filter((r) => files.includes(r.path) && !r.error)
    const missed: string[] = []
    const unproven: string[] = []
    let owned = 0
    let lookupMs = 0
    let slowestMs = 0
    for (const row of rows) {
      const tags = searchFromTags(parseFileName(row.path), row)
      const candidate = {
        title: tags.title,
        artist: tags.artist,
        durationSec: row.duration ?? undefined,
      }
      const t = performance.now()
      const verdict = isInLibrary(index, candidate)
      const ms = performance.now() - t
      lookupMs += ms
      slowestMs = Math.max(slowestMs, ms)
      const truth = row.duration ? sameAudio(foldText, row.path, row.duration, entries) : undefined
      if (truth) owned++
      const read = `${tags.artist} / ${tags.title}`
      if (truth && !verdict)
        missed.push(`${read}  ≠  ${truth.artist} / ${truth.title}  ${row.path}`)
      if (
        verdict &&
        !entries.some(
          (e) => row.duration && Math.abs(e.durationSec - row.duration) <= ANY_VERSION_SEC,
        )
      )
        unproven.push(`${read}  ${row.path}`)
    }
    const errors = [...readRows().values()].filter((r) => files.includes(r.path) && r.error)

    const summary = [
      `${reuse ? out : root}`,
      `${rows.length} read of ${files.length} found, ${errors.length} errors`,
      `library: ${entries.length} entries, dump ${dumpMs.toFixed(0)} ms, index ${indexMs.toFixed(1)} ms`,
      `lookups: ${rows.length} in ${lookupMs.toFixed(1)} ms, ${((1000 * lookupMs) / Math.max(1, rows.length)).toFixed(1)} µs avg, slowest ${slowestMs.toFixed(2)} ms`,
      `${owned} files have the same audio in the library`,
      `${missed.length} of them read "not in Apple Music"`,
      `${unproven.length} read "in Apple Music" with no library entry within ${ANY_VERSION_SEC} s`,
      '',
      'NOT IN APPLE MUSIC, BUT IT IS (read  ≠  library)',
      ...missed,
      '',
      'IN APPLE MUSIC, NO ENTRY OF THAT LENGTH',
      ...unproven,
      '',
      ...errors.map((r) => `error  ${r.path}  ${r.error}`),
    ]
    writeFileSync(`${out}.summary.txt`, `${summary.join('\n')}\n`)
  },
  24 * 60 * 60 * 1000,
)
