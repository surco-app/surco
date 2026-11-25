import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// cachedAnalysis persists under app.getPath('userData'), so point it at a
// throwaway temp dir; isPackaged is for binaries.ts.
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-readmetacache-'))
  return { app: { isPackaged: false, getPath: () => dir } }
})

// Capture every spawn so the tests can count how many probe/decode calls a
// repeated readMeta actually costs. The combined probe returns duration + tags
// + video stream dims; the cover extract and foreign-tags ffmetadata pass are
// answered too, though their exact bytes don't matter to these tests.
const calls: Array<{ file: string; args: string[] }> = []

const TRAKTOR_BLOB = 'AQAAAAAAAAA'.repeat(42_000)
const LINER_NOTE = 'Near mint, original 1995 pressing, light hairlines on side B, sleeve intact'

const PROBE_JSON = JSON.stringify({
  format: { duration: '1.5', tags: { title: 'Test Track', artist: 'Test Artist' } },
  streams: [],
})

vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    _opts: unknown,
    cb: (err: unknown, out: { stdout: string; stderr: string }) => void,
  ) => {
    calls.push({ file, args })
    if (args.some((a) => a.includes('moved away'))) {
      cb(Object.assign(new Error('probe failed'), { stderr: 'No such file or directory' }), {
        stdout: '',
        stderr: 'No such file or directory',
      })
      return
    }
    if (args.some((a) => a.includes('broken.flac'))) {
      cb(new Error('probe failed'), { stdout: '', stderr: '' })
      return
    }
    if (args.includes('ffmetadata')) {
      const stdout = args.some((a) => /traktor(-\d+)?\.flac/.test(a))
        ? `FFMETADATA1\nTRAKTOR4=${TRAKTOR_BLOB}\nVINYLCONDITION=${LINER_NOTE}\n`
        : 'FFMETADATA1\n'
      cb(null, { stdout, stderr: '' })
      return
    }
    if (args.includes('-show_entries')) {
      cb(null, { stdout: PROBE_JSON, stderr: '' })
      return
    }
    // Cover extract: readFile(out) will fail since no real jpg was written,
    // which extractCover already treats as a (caught) missing cover.
    cb(null, { stdout: '', stderr: '' })
  },
}))

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { app } from 'electron'
import { clearAnalysisCache } from './analysisCache'
import { peekMeta, readMeta, readMetaLight } from './ffmpeg'

const work = mkdtempSync(join(tmpdir(), 'surco-readmetacache-src-'))
const src = join(work, 'in.flac')
writeFileSync(src, 'audio')

beforeEach(async () => {
  calls.length = 0
  await clearAnalysisCache()
})

afterAll(() => {
  rmSync(app.getPath('userData'), { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
})

// readMeta spawns ffprobe/ffmpeg/TagLib on every call today — the whole cost this
// task removes from a reopened session. A second read of an unchanged file must
// return the same result without spawning anything.
describe('readMeta caching', () => {
  it('reads an unchanged file once and serves the second call from disk', async () => {
    const first = await readMeta(src)
    const callsAfterFirst = calls.length
    const second = await readMeta(src)

    expect(first.tags.title).toBe('Test Track')
    expect(second).toEqual(first)
    expect(callsAfterFirst).toBeGreaterThan(0)
    expect(calls.length).toBe(callsAfterFirst)
  })

  // An edited or replaced file gets a new mtime, so its stale tags must be
  // re-read rather than served from the old key.
  it('re-reads when the file mtime changes', async () => {
    await readMeta(src)
    const callsAfterFirst = calls.length

    const later = new Date(Date.now() + 60_000)
    utimesSync(src, later, later)
    await readMeta(src)

    expect(calls.length).toBeGreaterThan(callsAfterFirst)
  })

  // A failed probe must not pin its degraded result: the next call should retry
  // (spawning ffprobe again) rather than serving the failure (empty tags, no
  // duration) forever. The file exists on disk (stat succeeds, so it gets a real
  // cache key) but its probe is made to fail via the mock.
  it('does not cache a failed probe, so a later read retries', async () => {
    const broken = join(work, 'broken.flac')
    writeFileSync(broken, 'audio')

    const first = await readMeta(broken)
    const callsAfterFirst = calls.length
    const second = await readMeta(broken)

    expect(first).toEqual({
      tags: {},
      duration: null,
      cover: null,
      foreignTags: [],
      failed: true,
    })
    expect(second).toEqual(first)
    expect(calls.length).toBeGreaterThan(callsAfterFirst)
  })

  // A row whose file was moved or deleted since it was listed fails its read too, and the
  // notice blamed the tags of a file that no longer exists. The read says which it was, so
  // the DJ is told to look for the file instead of thinking it is damaged.
  it('says the file is missing when nothing is at the path any more', async () => {
    const read = await readMeta(join(work, 'moved away.mp3'))

    expect(read).toEqual({
      tags: {},
      duration: null,
      cover: null,
      foreignTags: [],
      failed: true,
      missing: true,
    })
  })

  it('says a light read the file is missing too', async () => {
    const read = await readMetaLight(join(work, 'moved away.mp3'))

    expect(read.missing).toBe(true)
  })

  // A degraded read and a file that genuinely carries no tags produce the same empty
  // fields, and the row has no way to tell them apart: the renderer's own catch never
  // fires, because readMeta resolves rather than rejecting. Without this flag a 0-byte
  // or unreadable file imported from inside a folder sits in the list with no title, no
  // duration and nothing saying why — the exact complaint behind a user's two "MP3s that
  // keep failing" (21/09/2026). The mark the UI already draws (TrackList's warning
  // triangle) just needs to be told.
  it('says a read succeeded, so an empty file is not mistaken for an untagged one', async () => {
    const fine = join(work, 'fine.flac')
    writeFileSync(fine, 'audio')

    const read = await readMeta(fine)

    expect(read.failed, 'a good read must not be flagged').toBeUndefined()
    expect(read.tags.title, 'the fixture no longer returns tags').toBe('Test Track')
  })
})

describe('readMetaLight', () => {
  it('reads tags and length without the cover thumbnail or the ffmetadata pass', async () => {
    const read = await readMetaLight(src)
    expect(read.tags.title).toBe('Test Track')
    expect(read.partial).toBe(true)
    expect(read.cover).toBeNull()
    expect(calls.some((c) => c.args.includes('ffmetadata'))).toBe(false)
    expect(calls.some((c) => c.args.some((a) => a.endsWith('.jpg')))).toBe(false)
  })

  it('answers the full read when one is already cached, so a known file is never partial', async () => {
    await readMeta(src)
    calls.length = 0
    const read = await readMetaLight(src)
    expect(read.partial).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('caches the light read too, so reopening the playlist costs nothing', async () => {
    await readMetaLight(src)
    calls.length = 0
    await readMetaLight(src)
    expect(calls).toHaveLength(0)
  })
})

// A big library opened again must land its known files at once: thousands of reads, each
// already on disk, went one by one through the import queue and kept the list "reading"
// for minutes on every launch. The peek is what lets the list take them in one batch, so it
// must never cost a spawn, and must answer exactly what the read would have.
describe('peekMeta', () => {
  it('answers the cached full read without spawning anything', async () => {
    const read = await readMeta(src)
    calls.length = 0

    const peeked = await peekMeta(src, false)

    expect(peeked).toEqual({ ...read, partial: false })
    expect(calls).toHaveLength(0)
  })

  it('answers nothing for a file never read, and does not read it', async () => {
    expect(await peekMeta(src, false)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('answers the light read for a row that only needs it', async () => {
    await readMetaLight(src)
    calls.length = 0

    const peeked = await peekMeta(src, true)

    expect(peeked?.partial).toBe(true)
    expect(peeked?.tags.title).toBe('Test Track')
    expect(calls).toHaveLength(0)
  })

  it('prefers the full read for a light row, so a known file is never partial', async () => {
    await readMeta(src)

    expect((await peekMeta(src, true))?.partial).toBe(false)
  })

  it('never hands a light read to a row that needs the cover', async () => {
    await readMetaLight(src)

    expect(await peekMeta(src, false)).toBeNull()
  })
})

// Traktor keeps its whole analysis inside every file it analysed, in a TRAKTOR4 tag of
// ~450 KB. A list hands the renderer the cached reads of all its rows in one IPC reply, so
// 8,272 of those added up to 3.7 GB and killed the main process while serializing it (a
// DJ's "Todas las pistas", 15/11/2026). The renderer only shows the value and only sends the
// name back, so what crosses must stay small, the cached reads written before included.
describe('a foreign tag holding a program blob', () => {
  const traktorFile = join(work, 'traktor.flac')
  writeFileSync(traktorFile, 'audio')

  it('reaches the renderer cut short, from the file and from the cache alike', async () => {
    const read = await readMeta(traktorFile)
    const peeked = await peekMeta(traktorFile, true)
    const light = await readMetaLight(traktorFile)

    for (const answer of [read, peeked, light]) {
      const blob = answer?.foreignTags.find((t) => t.name === 'TRAKTOR4')
      expect(blob, 'the tag must still be listed by name').toBeDefined()
      expect(blob?.value.length).toBeLessThan(2000)
      expect(TRAKTOR_BLOB.startsWith(blob?.value.replace(/…$/, '') ?? '-')).toBe(true)
    }
  })

  // V8 keeps a slice's whole parent string alive: a value cut with a plain slice still
  // held its 450 KB blob, and the 8,272 rows kept 3.8 GB in the main process all the same.
  it('lets go of the blob once it is cut, so thousands of rows do not keep it in memory', async () => {
    setFlagsFromString('--expose-gc')
    const gc = runInNewContext('gc') as () => void
    const files = Array.from({ length: 100 }, (_, i) => {
      const file = join(work, `traktor-${i}.flac`)
      writeFileSync(file, 'audio')
      return file
    })
    gc()
    const before = process.memoryUsage().heapUsed

    const reads = []
    for (const file of files) reads.push(await readMeta(file))
    gc()
    const held = process.memoryUsage().heapUsed - before

    expect(reads.every((r) => r.foreignTags.some((t) => t.name === 'TRAKTOR4'))).toBe(true)
    expect(held, `100 cut values still hold ${Math.round(held / 1e6)} MB`).toBeLessThan(10e6)
  })

  it('leaves an ordinary foreign tag whole', async () => {
    const read = await readMeta(traktorFile)

    expect(read.foreignTags).toContainEqual({ name: 'VINYLCONDITION', value: LINER_NOTE })
  })
})
