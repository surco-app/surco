import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, relative, resolve } from 'node:path'
import { it, vi } from 'vitest'

const { userData } = vi.hoisted(() => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  return { userData: fs.mkdtempSync(path.join(os.tmpdir(), 'surco-search-sweep-')) }
})
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => userData, on: () => {} },
}))
vi.mock('./settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./settings')>()
  return { ...actual, getSettings: () => actual.defaults }
})

import {
  dropDjPrefix,
  dropOriginalMarker,
  stripIgnoredWords,
  stripParentheticals,
} from '../shared/searchClean'
import type { SearchHints, SearchProviderId, SearchResult, TrackMetadata } from '../shared/types'
import * as bandcamp from './bandcamp'
import * as beatport from './beatport'
import { createBeatportSession } from './beatportSession'
import * as deezer from './deezer'
import { readMeta } from './ffmpeg'
import * as musicbrainz from './musicbrainz'
import { cleanHints, getProvider } from './providers'
import { buildSearchCandidates, namesArtist } from './searchQuery'
import { defaults } from './settings'

// Not a test of the code: a sweep of a real library through every search provider, rung
// by rung. The app stops each provider's candidate ladder at the first rung that returns
// anything, and free-text search always returns something, so a track the catalog lacks
// comes back as another act's homonym ("Autumn Tactics" by Sola Brothers brought Chicane's
// original from three sources). Recording every rung, not only the one the app stops at,
// lets any stopping rule be simulated offline against the same answers. It runs through
// vitest only because that is the cheapest way to load the main-process modules with
// electron mocked; without the folder in the environment it is skipped, so CI never
// touches it.
//
//   SURCO_SEARCH_SWEEP_DIR=/Volumes/Public/Musica/FLAC npm run search-sweep
//
// The sample is SURCO_SEARCH_SWEEP_SIZE tracks (default 120) drawn with a fixed seed
// (SURCO_SEARCH_SWEEP_SEED, default 1), dealt round-robin across the top-level folders so
// one huge folder does not fill it. Each track is read with the import's tag reader and
// turned into the query and hints the app would send, with the default settings. Every
// (track, provider) is appended to SURCO_SEARCH_SWEEP_OUT (default
// ~/surco-search-sweep.jsonl) as it lands, and a rerun skips what is already there without
// an error, so a stopped sweep resumes. Beatport is asked only when its credentials are in
// the keychain (service surco-beatport, as the live test reads them). Discogs is never
// asked: its quota is shared with the owner's own app. Caches live in a temporary userData,
// never the owner's.
//
// Each line also carries `app`: the ids the provider's real search returns for the same
// query, asked right after the rungs so it answers from the cache. A simulated first
// non-empty rung that disagrees with it means the sweep no longer mirrors the app.
//
// The second pass reads the lines and simulates the stopping policies on them, writing
// the table and examples to SURCO_SEARCH_SWEEP_OUT.report.txt.
//
//   SURCO_SEARCH_SWEEP_REPORT=1 npm run search-sweep
const root = process.env.SURCO_SEARCH_SWEEP_DIR
const report = process.env.SURCO_SEARCH_SWEEP_REPORT
const out = process.env.SURCO_SEARCH_SWEEP_OUT ?? join(homedir(), 'surco-search-sweep.jsonl')
const size = Number(process.env.SURCO_SEARCH_SWEEP_SIZE ?? 120)
const seed = Number(process.env.SURCO_SEARCH_SWEEP_SEED ?? 1)
// The import's own query and hints builders live in the renderer, outside this project's
// type program, so they are loaded by path and typed by what the sweep uses of them.
interface ImportBuilders {
  parseFileName(path: string): { artist: string; title: string; query: string }
  searchFromTags(
    parsed: { artist: string; title: string; query: string },
    tags: { title: string; artist: string },
  ): { artist: string; title: string; query: string }
  searchHintsFor(
    track: { meta: TrackMetadata; query: string },
    cleanup: { ignoreWords?: string[]; titleFormat?: string },
  ): SearchHints
}

async function importBuilders(): Promise<ImportBuilders> {
  const lib = (name: string) => import(`../renderer/src/lib/${name}.ts`)
  const [filename, search, autoMatch] = await Promise.all(
    ['filename', 'search', 'autoMatch'].map(lib),
  )
  return { ...filename, ...search, ...autoMatch }
}

const EXTENSIONS = new Set(['.flac', '.aiff', '.aif', '.wav', '.mp3', '.m4a'])
const TOP = 5

type SweptProvider = Exclude<SearchProviderId, 'discogs'>

interface Row {
  id: number
  title: string
  year?: string
  format?: string[]
}

interface Rung {
  kind: 'isrc' | 'fielded' | 'text'
  candidate: string
  rows: Row[]
  error?: string
}

interface Line {
  path: string
  folder: string
  provider: SweptProvider
  meta: { artist: string; title: string; album: string; isrc: string; catalogNumber: string }
  query: string
  hints: SearchHints
  rungs: Rung[]
  app?: number[]
  error?: string
  ms: number
}

// AppleDouble side files (._foo.flac) litter SMB shares and are not audio. Only readdir,
// never a stat per file: on the NAS the directories are the cost, not the files.
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

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const folderOf = (base: string, path: string): string => relative(base, path).split('/')[0]

function sample(base: string, files: string[]): string[] {
  const random = mulberry32(seed)
  const byFolder = new Map<string, string[]>()
  for (const file of files) {
    const folder = folderOf(base, file)
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), file])
  }
  const queues = [...byFolder.values()].map((list) => {
    const shuffled = [...list]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  })
  const picked: string[] = []
  while (picked.length < size && queues.some((q) => q.length)) {
    for (const queue of queues) {
      const next = queue.shift()
      if (next && picked.length < size) picked.push(next)
    }
  }
  return picked
}

function readLines(): Line[] {
  if (!existsSync(out)) return []
  const byKey = new Map<string, Line>()
  for (const text of readFileSync(out, 'utf8').split('\n').filter(Boolean)) {
    const line = JSON.parse(text) as Line
    byKey.set(`${line.provider} ${line.path}`, line)
  }
  return [...byKey.values()]
}

const rowOf = (r: SearchResult): Row => ({
  id: r.id,
  title: r.title,
  ...(r.year ? { year: r.year } : {}),
  ...(r.format?.length ? { format: r.format } : {}),
})

async function rung(
  kind: Rung['kind'],
  candidate: string,
  ask: () => Promise<SearchResult[]>,
): Promise<Rung> {
  try {
    return { kind, candidate, rows: (await ask()).map(rowOf) }
  } catch (e) {
    return { kind, candidate, rows: [], error: String(e).slice(0, 200) }
  }
}

// The same ladders the providers walk, every rung asked. The free-text ones are
// searchCandidates' list with album-first off (cleanHints already dropped the album);
// MusicBrainz leads with its two fielded queries and escapes the free text for dismax;
// Deezer resolves the ISRC before any of it.
async function rungsOf(
  provider: SweptProvider,
  query: string,
  hints: SearchHints,
): Promise<Rung[]> {
  const rungs: Rung[] = []
  if (provider === 'musicbrainz') {
    const artist = hints.artist?.trim()
    const title = hints.title?.trim()
    if (artist && title) {
      const fielded = `recording:"${musicbrainz.escapeLucene(title)}" AND artist:"${musicbrainz.escapeLucene(artist)}"`
      for (const q of [`${fielded} AND NOT secondarytype:compilation`, fielded])
        rungs.push(await rung('fielded', q, () => musicbrainz.searchOnce(q, 'low')))
    }
    for (const c of buildSearchCandidates(
      query,
      { ...hints, album: undefined },
      {
        includeCatalog: false,
        albumFirst: true,
      },
    ))
      rungs.push(
        await rung('text', c, () =>
          musicbrainz.searchOnce(musicbrainz.escapeLucene(c), 'low', true),
        ),
      )
    return rungs
  }
  if (provider === 'deezer') {
    const isrc = hints.isrc?.trim()
    if (isrc)
      rungs.push(
        await rung('isrc', isrc, async () => {
          const exact = await deezer.trackByIsrc(isrc, 'low')
          return exact ? [exact] : []
        }),
      )
  }
  const searchOnce = { deezer, bandcamp, beatport }[provider].searchOnce
  for (const c of buildSearchCandidates(query, hints, { includeCatalog: false, albumFirst: true }))
    rungs.push(await rung('text', c, () => searchOnce(c, 'low')))
  return rungs
}

function keychainCredentials(): { username: string; password: string } | undefined {
  try {
    const attrs = execFileSync('security', ['find-generic-password', '-s', 'surco-beatport'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
    const username = attrs.match(/"acct"<blob>="([^"]*)"/)?.[1] ?? ''
    const password = execFileSync(
      'security',
      ['find-generic-password', '-s', 'surco-beatport', '-w'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .trim()
    return username && password ? { username, password } : undefined
  } catch {
    return undefined
  }
}

// The track the import builds for a file: tags from the same reader, the query from the
// same tags-over-file-name rule, and the hints the editor and the sweep send, cleaned at
// the provider seam with the default ignore words and album-first off.
type Swept = Pick<Line, 'meta' | 'query' | 'hints'> & { failed: boolean }

async function trackOf(path: string, b: ImportBuilders): Promise<Swept> {
  const { tags, failed } = await readMeta(path)
  const s = b.searchFromTags(b.parseFileName(path), {
    title: tags.title ?? '',
    artist: tags.artist ?? '',
  })
  const meta = { ...tags, title: s.title, artist: s.artist }
  const words = defaults.searchIgnoreWords
  const hints =
    cleanHints(
      b.searchHintsFor(
        { meta, query: s.query },
        { ignoreWords: words, titleFormat: defaults.titleFormat },
      ),
      words,
      false,
    ) ?? {}
  return {
    meta: {
      artist: meta.artist,
      title: meta.title,
      album: meta.album ?? '',
      isrc: meta.isrc ?? '',
      catalogNumber: meta.catalogNumber ?? '',
    },
    query: stripIgnoredWords(s.query.normalize('NFC'), words),
    hints,
    failed: failed === true,
  }
}

it.skipIf(!root)(
  'sweeps a library sample through every rung of every search provider',
  async () => {
    const base = resolve(root as string)
    const picked = sample(base, await walk(base))
    const credentials = keychainCredentials()
    if (credentials)
      beatport.setBeatportSession(
        createBeatportSession({
          fetch: (...a) => fetch(...a),
          credentials: () => credentials,
          now: Date.now,
        }),
      )
    const providers: SweptProvider[] = ['deezer', 'bandcamp', 'musicbrainz']
    if (credentials) providers.push('beatport')
    const done = new Set(
      readLines()
        .filter((l) => !l.error && !l.rungs.some((r) => r.error))
        .map((l) => `${l.provider} ${l.path}`),
    )
    // One worker per provider: each has its own limiter, so they pace independently and
    // MusicBrainz' one request a second never holds the others back.
    const builders = await importBuilders()
    const tracks = new Map<string, Promise<Swept>>()
    const trackFor = (path: string): Promise<Swept> => {
      if (!tracks.has(path)) tracks.set(path, trackOf(path, builders))
      return tracks.get(path) as Promise<Swept>
    }
    await Promise.all(
      providers.map(async (provider) => {
        for (const path of picked) {
          if (done.has(`${provider} ${path}`)) continue
          const t0 = Date.now()
          const track = await trackFor(path)
          const line: Line = {
            path,
            folder: folderOf(base, path),
            provider,
            meta: track.meta,
            query: track.query,
            hints: track.hints,
            rungs: [],
            ms: 0,
          }
          if (track.failed) line.error = 'tags unread'
          else {
            line.rungs = await rungsOf(provider, track.query, track.hints)
            try {
              line.app = (await getProvider(provider).search(track.query, 'low', track.hints)).map(
                (r) => r.id,
              )
            } catch (e) {
              line.error = `app search: ${String(e).slice(0, 200)}`
            }
          }
          line.ms = Date.now() - t0
          appendFileSync(out, `${JSON.stringify(line)}\n`)
        }
      }),
    )
    const lines = readLines().filter((l) => picked.includes(l.path))
    const summary = [
      `${base}: ${picked.length} tracks sampled (seed ${seed})`,
      `providers: ${providers.join(', ')}${credentials ? '' : ' (beatport skipped: no keychain credentials)'}`,
      ...providers.map((p) => {
        const mine = lines.filter((l) => l.provider === p)
        const errors = mine.filter((l) => l.error || l.rungs.some((r) => r.error))
        return `${p}: ${mine.length} swept, ${errors.length} with errors`
      }),
      '',
      ...lines
        .filter((l) => l.error || l.rungs.some((r) => r.error))
        .map(
          (l) =>
            `error  ${l.provider}  ${l.path}  ${l.error ?? l.rungs.find((r) => r.error)?.error}`,
        ),
    ]
    writeFileSync(`${out}.summary.txt`, `${summary.join('\n')}\n`)
  },
  24 * 60 * 60 * 1000,
)

// Who the file says made it, as the acts a row may name: the whole credit, the credit
// without a "DJ " prefix, and each act of a collaboration split on commas, "&", "+", "/",
// " x ", "vs" and "feat."/"ft."/"featuring". Any one of them named counts, so a row filed
// under the lead act alone ("Sola Brothers - …" for "Sola Brothers, Head Horny's") stands.
// "and" does not split: too many acts carry it in their name. A single letter or a bare
// "DJ" is dropped, since nearly any row would name it; two letters stay ("BK").
function actsOf(artist: string): string[] {
  const whole = [artist, dropDjPrefix(artist)]
  const split = artist
    .split(/\s*(?:,|&|\+|\/|\sx\s|\bvs\.?(?=\s)|\bfeat\.?(?=\s)|\bft\.?(?=\s)|\bfeaturing\b)\s*/i)
    .map((a) => dropDjPrefix(a.trim()))
  return [...new Set([...whole, ...split])].filter(
    (a) => a.replace(/[^\p{L}\p{N}]/gu, '').length >= 2 && !/^dj$/i.test(a.trim()),
  )
}

const relevant = (row: Row, acts: string[]): boolean =>
  acts.some((a) => namesArtist(row as SearchResult, a))

type Policy = 'P0' | 'P1' | 'P1b'
const POLICIES: Policy[] = ['P0', 'P1', 'P1b']

// What the results column would show under each stopping rule. The ISRC rung is an exact
// identity, so every policy keeps it on top as the app does; the guard only judges the
// text and fielded rungs. With no artist on the file there is nothing to guard with, and
// P1/P1b fall back to P0.
function shown(line: Line, policy: Policy): Row[] {
  const exact = line.rungs.filter((r) => r.kind === 'isrc').flatMap((r) => r.rows)
  const ladder = line.rungs.filter((r) => r.kind !== 'isrc')
  const acts = actsOf(line.hints.artist ?? '')
  let rows: Row[] = []
  if (policy === 'P0' || acts.length === 0) rows = ladder.find((r) => r.rows.length)?.rows ?? []
  else {
    const hit = ladder.find((r) => r.rows.some((row) => relevant(row, acts)))
    rows = hit ? hit.rows : []
    if (policy === 'P1b') rows = rows.filter((row) => relevant(row, acts))
  }
  const ids = new Set(exact.map((r) => r.id))
  return [...exact, ...rows.filter((r) => !ids.has(r.id))].slice(0, TOP)
}

// A row that carries the track's title but not its artist: Chicane's "Autumn Tactics"
// for Sola Brothers' remix, and also a label's Bandcamp upload that credits the label and
// not the act. The proxy cannot tell the two apart, which is why they are listed.
function titleOnly(line: Line, row: Row): boolean {
  const title = stripParentheticals(dropOriginalMarker(line.hints.title ?? '')).trim()
  const acts = actsOf(line.hints.artist ?? '')
  return (
    title.replace(/[^\p{L}\p{N}]/gu, '').length >= 3 &&
    !relevant(row, acts) &&
    namesArtist(row as SearchResult, title)
  )
}

const pctOf = (n: number, of: number): string => `${((100 * n) / Math.max(1, of)).toFixed(1)}%`

function listed(rows: Row[]): string {
  return rows.length
    ? rows.map((r) => `      ${r.title}${r.year ? ` (${r.year})` : ''}`).join('\n')
    : '      (vacío)'
}

function example(line: Line, a: Policy, b: Policy): string {
  return [
    `  [${line.provider}] ${line.meta.artist} - ${line.meta.title}`,
    `    query: ${line.query}`,
    `    ${a}:`,
    listed(shown(line, a)),
    `    ${b}:`,
    listed(shown(line, b)),
  ].join('\n')
}

it.skipIf(!report)(
  'simulates the stopping policies over a finished search sweep',
  () => {
    const lines = readLines().filter((l) => !l.error && !l.rungs.some((r) => r.error))
    const providers = [...new Set(lines.map((l) => l.provider))]
    const text: string[] = [`${out}`, `${lines.length} (pista, proveedor) sin errores`, '']
    const fidelity = lines.filter((l) => {
      const exact = l.rungs.filter((r) => r.kind === 'isrc').flatMap((r) => r.rows)
      const first = l.rungs.filter((r) => r.kind !== 'isrc').find((r) => r.rows.length)?.rows ?? []
      const ids = new Set(exact.map((r) => r.id))
      const p0 = [...exact, ...first.filter((r) => !ids.has(r.id))].map((r) => r.id)
      return JSON.stringify(p0) !== JSON.stringify(l.app)
    })
    text.push(`P0 simulado distinto de la búsqueda real de la app: ${fidelity.length}`)
    for (const l of fidelity.slice(0, 5)) text.push(`  ${l.provider} ${l.path}`)
    text.push(
      `sin artista en la pista (P1 = P0): ${lines.filter((l) => actsOf(l.hints.artist ?? '').length === 0).length}`,
      '',
      'proveedor    política  n    con relevante  precisión@5  solo basura  vacías',
    )
    const changes: Record<string, string[]> = { junkToEmpty: [], junkToHit: [], titleLost: [] }
    const counts: Record<string, Record<string, number>> = {}
    for (const provider of providers) {
      const mine = lines.filter((l) => l.provider === provider)
      for (const policy of POLICIES) {
        let hit = 0
        let junk = 0
        let empty = 0
        let rel = 0
        let total = 0
        for (const l of mine) {
          const rows = shown(l, policy)
          const acts = actsOf(l.hints.artist ?? '')
          const n = rows.filter((r) => relevant(r, acts)).length
          rel += n
          total += rows.length
          if (!rows.length) empty++
          else if (n) hit++
          else junk++
        }
        text.push(
          `${provider.padEnd(12)} ${policy.padEnd(9)} ${String(mine.length).padEnd(4)} ${pctOf(hit, mine.length).padEnd(14)} ${pctOf(rel, total).padEnd(12)} ${pctOf(junk, mine.length).padEnd(12)} ${pctOf(empty, mine.length)}`,
        )
      }
      const c = {
        lostToEmpty: 0,
        junkToEmpty: 0,
        junkToHit: 0,
        titleRowsLostP1: 0,
        titleRowsLostP1b: 0,
        titleTracksLostP1: 0,
        titleTracksLostP1b: 0,
      }
      for (const l of mine) {
        const acts = actsOf(l.hints.artist ?? '')
        const p0 = shown(l, 'P0')
        const p1 = shown(l, 'P1')
        const p1b = shown(l, 'P1b')
        const hits = (rows: Row[]): boolean => rows.some((r) => relevant(r, acts))
        if (hits(p0) && !p1.length) c.lostToEmpty++
        if (p0.length && !hits(p0) && !p1.length) {
          c.junkToEmpty++
          changes.junkToEmpty.push(example(l, 'P0', 'P1'))
        }
        if (p0.length && !hits(p0) && hits(p1)) {
          c.junkToHit++
          changes.junkToHit.push(example(l, 'P0', 'P1'))
        }
        const titled = p0.filter((r) => titleOnly(l, r))
        const lost1 = titled.filter((r) => !p1.some((x) => x.id === r.id))
        const lost1b = titled.filter((r) => !p1b.some((x) => x.id === r.id))
        c.titleRowsLostP1 += lost1.length
        c.titleRowsLostP1b += lost1b.length
        if (lost1.length) c.titleTracksLostP1++
        if (lost1b.length) {
          c.titleTracksLostP1b++
          changes.titleLost.push(example(l, 'P0', 'P1b'))
        }
      }
      counts[provider] = c
    }
    text.push('', 'cambios al pasar de P0 a P1 (pistas):')
    for (const [provider, c] of Object.entries(counts))
      text.push(
        `  ${provider.padEnd(12)} relevante→vacío ${c.lostToEmpty}  basura→vacío ${c.junkToEmpty}  basura→relevante ${c.junkToHit}  filas solo-título perdidas P1 ${c.titleRowsLostP1} (${c.titleTracksLostP1} pistas), P1b ${c.titleRowsLostP1b} (${c.titleTracksLostP1b} pistas)`,
      )
    const shuffled = (list: string[]): string[] => {
      const random = mulberry32(seed)
      return [...list].sort(() => random() - 0.5).slice(0, 10)
    }
    text.push(
      '',
      '== basura eliminada (P0 solo basura, P1 vacío) ==',
      ...shuffled(changes.junkToEmpty),
    )
    text.push(
      '',
      '== basura sustituida por relevante (P1 encuentra al artista en otro peldaño) ==',
      ...shuffled(changes.junkToHit),
    )
    text.push(
      '',
      '== filas solo-título que P1b quitaría (¿homónimo o subida de sello?) ==',
      ...shuffled(changes.titleLost),
    )
    writeFileSync(`${out}.report.txt`, `${text.join('\n')}\n`)
  },
  60 * 1000,
)
