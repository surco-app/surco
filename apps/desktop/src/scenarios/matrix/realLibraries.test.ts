import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../electronFake')).electronFake())

import { engineDbPath } from '../../main/enginePlaylistsFixture'
import { openRekordboxDb } from '../../main/rekordboxDb'
import { scenarioDir } from '../fixtures'
import { CELLS, type Cell } from './cells'
import { buildLibraries, type LibrarySet, sha1Of } from './libraries'
import { libraryInvariants, markerLagMs, nmlLocationPath, pointingAt } from './oracle'
import {
  assertOriginalsUntouched,
  assertRoomFor,
  copyRealLibraries,
  correlationLagMs,
  createRunRoot,
  pristine,
  type RealSources,
  removeRunRoot,
  type Watched,
} from './realLibraries'
import { makeSource, SEEDED_CUES_MS, type SourceTrack, TRICKY } from './sources'

const FF = ffmpegStatic as unknown as string
const STREAMING_ID = '999001'
const STREAMING_NAME = 'Streaming Café.wav'
const ALL = CELLS.find((c) => c.id === 'C-flac-aiff') as Cell

let sources: SourceTrack[]
let original: LibrarySet
let real: RealSources

function cloneRows(
  db: ReturnType<typeof openRekordboxDb>,
  table: string,
  where: string,
  from: string,
  set: Record<string, unknown>,
): void {
  if (!db) throw new Error('no rekordbox')
  const rows = db.prepare(`SELECT * FROM ${table} WHERE ${where} = ?`).all(from) as Record<
    string,
    unknown
  >[]
  for (const [i, row] of rows.entries()) {
    const columns = Object.keys(row)
    db.prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    ).run(...columns.map((c) => (c === 'ID' ? `${set.ID}${i}` : c in set ? set[c] : row[c])))
  }
}

function addStreamingRow(set: LibrarySet): void {
  const t = set.tracks[0]
  const file = join(dirname(t.path), STREAMING_NAME)
  copyFileSync(set.tracks[1].path, file)
  const db = openRekordboxDb(set.rekordboxDb as string)
  try {
    const row = db?.prepare('SELECT * FROM djmdContent WHERE ID = ?').get(t.rekordboxId) as Record<
      string,
      unknown
    >
    const columns = Object.keys(row)
    db?.prepare(
      `INSERT INTO djmdContent (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    ).run(
      ...columns.map((c) =>
        c === 'ID'
          ? STREAMING_ID
          : c === 'FileType'
            ? 25
            : c === 'FolderPath'
              ? file
              : c === 'FileNameL'
                ? STREAMING_NAME
                : row[c],
      ),
    )
    cloneRows(db, 'djmdCue', 'ContentID', t.rekordboxId, { ID: '9990010', ContentID: STREAMING_ID })
    cloneRows(db, 'djmdSongPlaylist', 'ContentID', t.rekordboxId, {
      ID: '9990020',
      ContentID: STREAMING_ID,
    })
  } finally {
    db?.close()
  }
}

const databases = (s: RealSources): string[] => [
  s.rekordboxDb as string,
  engineDbPath(s.engineDir as string),
  s.traktorNml as string,
]

function fingerprint(paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map((p) => [p, `${sha1Of(p)} ${statSync(p).mtimeMs}`]))
}

const audioOf = (dir: string): string[] =>
  readdirSync(dir)
    .filter((n) => /\.(wav|flac|mp3)$/i.test(n))
    .map((n) => join(dir, n))

beforeAll(() => {
  const crate = scenarioDir('matriz-real-origen-audio')
  sources = [makeSource(crate, 'flac'), makeSource(crate, 'wav16'), makeSource(crate, 'mp3x')]
  original = buildLibraries(scenarioDir('matriz-real-origen'), 'all', sources)
  addStreamingRow(original)
  real = {
    rekordboxDb: original.rekordboxDb,
    engineDir: original.engineDir,
    traktorNml: original.traktorNml,
  }
}, 120_000)

// The real run copies the DJ's own collections; none of these tests ever reads them, only a
// synthetic collection shaped like one, so a bug here can never reach the real libraries.
describe('copies of real collections', () => {
  it('copies without changing a byte or mtime of the originals', async () => {
    const watched = [
      ...databases(real),
      ...audioOf(dirname(sources[0].path)),
      original.bystander.path,
    ]
    const before = fingerprint(watched)

    const copy = await copyRealLibraries(real, scenarioDir('matriz-real-copia'))

    expect(fingerprint(watched)).toEqual(before)
    const listed = copy.originals.map((o) => o.path)
    for (const db of databases(real)) expect(listed).toContain(db)
    expect(copy.set.tracks.length).toBeGreaterThan(0)
    expect(() => assertOriginalsUntouched(copy)).not.toThrow()
  }, 120_000)

  it('fails loudly when an original changed after the copy', async () => {
    const copy = await copyRealLibraries(real, scenarioDir('matriz-real-copia-tocada'))
    const nml = real.traktorNml as string
    const { atime, mtime } = statSync(nml)
    utimesSync(nml, atime, new Date(mtime.getTime() + 5000))
    try {
      expect(() => assertOriginalsUntouched(copy)).toThrow(nml)
    } finally {
      utimesSync(nml, atime, mtime)
    }
  }, 120_000)

  it('leaves the copies writable even when the original is read-only', async () => {
    for (const db of databases(real)) chmodSync(db, 0o444)
    let copy: Awaited<ReturnType<typeof copyRealLibraries>>
    try {
      copy = await copyRealLibraries(real, scenarioDir('matriz-real-copia-444'))
    } finally {
      for (const db of databases(real)) chmodSync(db, 0o644)
    }
    for (const db of databases(copy.set)) expect(statSync(db).mode & 0o777).toBe(0o644)
    const db = openRekordboxDb(copy.set.rekordboxDb as string)
    try {
      expect(() => db?.prepare(`UPDATE djmdContent SET Commnt = 'x'`).run()).not.toThrow()
    } finally {
      db?.close()
    }
  }, 120_000)

  it('keeps NFD file names byte for byte in the mirror', async () => {
    const copy = await copyRealLibraries(real, scenarioDir('matriz-real-copia-nfd'))

    for (const t of copy.set.tracks) {
      const source = sources.find((s) => s.origin === t.origin) as SourceTrack
      const name = Buffer.from(basename(source.path))
      expect(name.equals(Buffer.from(basename(source.path).normalize('NFC')))).toBe(false)
      const listed = readdirSync(dirname(t.path), { encoding: 'buffer' })
      expect(listed.some((n) => n.equals(name))).toBe(true)
      expect(existsSync(t.path)).toBe(true)
    }
  }, 120_000)

  it('expects of each sampled file the tags it holds, a slash in the artist included', async () => {
    const copy = await copyRealLibraries(real, scenarioDir('matriz-real-copia-tags'))

    for (const t of copy.set.tracks) {
      expect(t.tags.title.normalize('NFC')).toBe(TRICKY.title.normalize('NFC'))
      expect(t.tags.artist).toBe(TRICKY.artist)
      expect(t.tags.trackNumber).toBe(TRICKY.trackNumber)
      expect(t.cuesMs).toEqual(SEEDED_CUES_MS)
    }
  }, 120_000)

  it('never samples a streaming row', async () => {
    const copy = await copyRealLibraries(real, scenarioDir('matriz-real-copia-streaming'))

    expect(copy.set.tracks.map((t) => t.rekordboxId)).not.toContain(STREAMING_ID)
    expect(copy.set.bystander.rekordboxId).not.toBe(STREAMING_ID)
    expect(copy.rewrites.join('\n')).not.toContain(STREAMING_NAME.normalize('NFC'))
  }, 120_000)

  it('points every sampled track at its mirror file in each library copy, logging each rewrite', async () => {
    const root = scenarioDir('matriz-real-copia-rutas')
    const copy = await copyRealLibraries(real, root)
    const inMirror = (p: string) => expect(p.startsWith(join(root, 'espejo'))).toBe(true)

    expect(copy.set.tracks.map((t) => t.origin).sort()).toEqual(['flac', 'mp3x', 'wav16'])
    const rekordbox = openRekordboxDb(copy.set.rekordboxDb as string, { readonly: true })
    const engine = new Database(engineDbPath(copy.set.engineDir as string), { readonly: true })
    const nml = readFileSync(copy.set.traktorNml as string, 'utf8')
    try {
      for (const t of [...copy.set.tracks, copy.set.bystander]) {
        inMirror(t.path)
        const row = rekordbox
          ?.prepare('SELECT FolderPath FROM djmdContent WHERE ID = ?')
          .get(t.rekordboxId) as { FolderPath: string }
        inMirror(row.FolderPath)
        expect(existsSync(row.FolderPath)).toBe(true)
        expect(copy.rewrites.some((r) => r.includes(t.rekordboxId))).toBe(true)
        const track = engine.prepare('SELECT path FROM Track WHERE id = ?').get(t.engineId) as {
          path: string
        }
        const engineFile = resolve(copy.set.engineDir as string, track.path)
        inMirror(engineFile)
        expect(existsSync(engineFile)).toBe(true)
        const entry = nml.slice(nml.indexOf(`AUDIO_ID="${t.traktorAudioId}"`))
        const location = nmlLocationPath(entry.match(/<LOCATION\b[^>]*>/)?.[0] ?? '')
        expect(existsSync(location)).toBe(true)
      }
      for (const t of copy.set.tracks)
        expect(
          libraryInvariants(ALL, copy.set, t, {
            finalPath: t.path,
            at: pointingAt(t.path),
            lagMs: 0,
            rekordboxStartMovedMs: 0,
            traktorStartMovedMs: 0,
            samplesKept: true,
            destGone: false,
          }),
        ).toEqual([])
    } finally {
      rekordbox?.close()
      engine.close()
    }
  }, 120_000)
})

describe('a copy shared by every batch of the real run', () => {
  it('comes back as it was copied, whatever a batch converted', async () => {
    const copy = await copyRealLibraries(real, scenarioDir('matriz-real-copia-intacta'))
    const restore = pristine(copy)
    const [t] = copy.set.tracks
    const file = realpathSync(t.path)
    const bytes = sha1Of(file)
    const db = openRekordboxDb(copy.set.rekordboxDb as string)
    db?.prepare(`UPDATE djmdContent SET Commnt = 'convertida'`).run()
    db?.close()
    writeFileSync(file, 'otra cosa')
    const converted = join(dirname(file), 'convertida.aiff')
    writeFileSync(converted, 'nuevo')

    restore()

    expect(sha1Of(copy.set.rekordboxDb as string)).toBe(copy.set.sha1Before.rekordbox)
    expect(sha1Of(file)).toBe(bytes)
    expect(existsSync(converted)).toBe(false)
  }, 120_000)
})

describe('the lag of real audio', () => {
  it('measures a shift by correlation as the click marker does on the synthetic sources', () => {
    const [flac, , mp3] = sources
    const delayed = join(dirname(flac.path), 'retrasada.wav')
    execFileSync(FF, ['-y', '-v', 'error', '-i', flac.path, '-af', 'adelay=30:all=1', delayed])

    const sampleMs = 1000 / 44100
    expect(correlationLagMs(flac.path, flac.path)).toBe(0)
    expect(Math.abs(correlationLagMs(flac.path, delayed) - 30)).toBeLessThanOrEqual(sampleMs)
    expect(
      Math.abs(
        correlationLagMs(sources[1].path, mp3.path) - markerLagMs(sources[1].path, mp3.path),
      ),
    ).toBeLessThan(1)
  }, 60_000)
})

describe('the folder of a real run', () => {
  it('is always a new subfolder, so removing it never touches what the base already held', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-base-'))
    const sentinel = join(base, 'keep.txt')
    writeFileSync(sentinel, 'mine')
    try {
      const root = createRunRoot(base)
      expect(root).not.toBe(base)
      expect(dirname(root)).toBe(base)
      removeRunRoot(root)
      expect(existsSync(root)).toBe(false)
      expect(readFileSync(sentinel, 'utf8')).toBe('mine')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('refuses to remove a folder this run did not create', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-base-'))
    try {
      expect(() => removeRunRoot(base)).toThrow('refusing')
      expect(existsSync(base)).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('originals watched outside the copy', () => {
  it('are still checked when the copy throws midway', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-src-'))
    const db = join(dir, 'collection.nml')
    writeFileSync(db, '<NML></NML>')
    const watched: Watched[] = []
    const root = mkdtempSync(join(tmpdir(), 'surco-dst-'))
    try {
      await expect(copyRealLibraries({ traktorNml: db }, root, 3, watched)).rejects.toThrow()
      expect(watched.map((w) => w.path)).toContain(db)
      writeFileSync(db, '<NML>changed</NML>')
      expect(() => assertOriginalsUntouched({ originals: watched })).toThrow(db)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('free space before copying', () => {
  it('fails clearly when the destination cannot hold the copies plus 20%', () => {
    expect(() => assertRoomFor('/dest', 1000, () => 1199)).toThrow('/dest has 1199 bytes free')
    expect(() => assertRoomFor('/dest', 1000, () => 1200)).not.toThrow()
  })

  it('reads the real free space of the folder by default', () => {
    expect(() => assertRoomFor(tmpdir(), 1)).not.toThrow()
    expect(() => assertRoomFor(tmpdir(), Number.MAX_SAFE_INTEGER)).toThrow('bytes free')
  })
})
