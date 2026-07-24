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
    if (args.some((a) => a.includes('broken.flac'))) {
      cb(new Error('probe failed'), { stdout: '', stderr: '' })
      return
    }
    if (args.includes('ffmetadata')) {
      cb(null, { stdout: 'FFMETADATA1\n', stderr: '' })
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
import { app } from 'electron'
import { clearAnalysisCache } from './analysisCache'
import { readMeta } from './ffmpeg'

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

    expect(first).toEqual({ tags: {}, duration: null, cover: null, foreignTags: [] })
    expect(second).toEqual(first)
    expect(calls.length).toBeGreaterThan(callsAfterFirst)
  })
})
