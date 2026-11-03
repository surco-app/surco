import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  Id3v2AttachmentFrame,
  type Id3v2Tag,
  Picture,
  PictureType,
  StringType,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { HOT_KINDS, type WantedCue } from '../shared/cueRules'
import { hotCueArgb } from '../shared/rekordboxCueColors'
import { SERATO_MP3, SERATO_WAV } from '../shared/seratoMarkersFixture'
import type { TrackCues } from '../shared/types'
import { configureOriginalKeeper } from './originalKeeper'
import { createProgramQueue } from './programQueue'
import type { CuesOp, QueueOp } from './rekordboxQueueOps'
import { seratoLeadOfFile } from './seratoClock'
import { seratoCueSource } from './seratoCueSource'
import { applySeratoCuesBatch } from './seratoCuesWrite'
import { readSeratoMarkers } from './seratoTags'

const FF = ffmpegStatic as unknown as string

function wav(ext: 'wav' | 'mp3' = 'wav'): string {
  const file = join(mkdtempSync(join(tmpdir(), 'surco-serato-batch-')), `track.${ext}`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:a',
    ext === 'wav' ? 'pcm_s16le' : 'libmp3lame',
    file,
  ])
  const f = TagFile.createFromPath(file)
  try {
    const picture = Picture.fromFullData(
      ByteVector.fromByteArray(Buffer.from(ext === 'wav' ? SERATO_WAV : SERATO_MP3, 'base64')),
      PictureType.NotAPicture,
      'application/octet-stream',
      'Serato Markers2',
    )
    picture.filename = ''
    const frame = Id3v2AttachmentFrame.fromPicture(picture)
    frame.textEncoding = StringType.Latin1
    ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(frame)
    f.save()
  } finally {
    f.dispose()
  }
  return file
}

const reader = seratoCueSource({
  words: async () => null,
  queue: { enqueue: vi.fn(), cuesOp: vi.fn(), drop: vi.fn() },
  applyQuietly: vi.fn(),
})

async function seen(file: string): Promise<TrackCues> {
  const read = await reader.trackCues(`serato:${file}`)
  if (!read) throw new Error(`no Serato cues read from ${file}`)
  return read
}

const asWanted = (read: TrackCues): WantedCue[] =>
  read.cues.map((c) => ({ id: c.id, ms: c.ms, kind: c.kind, color: c.color }))

function op(file: string, read: TrackCues, wanted: WantedCue[], over: Partial<CuesOp> = {}) {
  return {
    id: 'op1',
    kind: 'cues',
    contentId: `serato:${file}`,
    path: file,
    label: 'Pray',
    wanted,
    fingerprint: read.fingerprint,
    ...over,
  } satisfies CuesOp
}

const closed = async () => true

beforeEach(() => configureOriginalKeeper(async () => ({ id: 'b1' }) as never))
afterEach(() => configureOriginalKeeper(null))

describe('applying the queued Serato cue saves', () => {
  it('waits without touching a file while Serato is open, since Serato rewrites its tags on the way out', async () => {
    const file = wav()
    const read = await seen(file)
    const before = readFileSync(file)
    const ensureClosed = vi.fn(async () => false)
    const wanted = asWanted(read).map((c) => ({ ...c, ms: c.ms + 500 }))
    expect(await applySeratoCuesBatch([op(file, read, wanted)], { ensureClosed })).toEqual({
      ok: false,
      reason: 'cancelled',
    })
    expect(readFileSync(file)).toEqual(before)
  }, 60000)

  it("moves a cue and leaves the name and Serato's own colour of every cue on the file", async () => {
    const file = wav()
    const read = await seen(file)
    const was = readSeratoMarkers(file)?.cues ?? []
    expect(was.length).toBeGreaterThan(1)
    const wanted = asWanted(read).map((c, i) => (i === 0 ? { ...c, ms: c.ms + 500 } : c))
    const rewritten = vi.fn()
    const result = await applySeratoCuesBatch([op(file, read, wanted)], {
      ensureClosed: closed,
      rewritten,
    })
    expect(result).toEqual({
      ok: true,
      wrote: true,
      outcomes: [{ id: 'op1', applied: true, notices: [] }],
    })
    expect(readSeratoMarkers(file)?.cues).toEqual(
      was.map((c, i) => (i === 0 ? { ...c, ms: c.ms + 500 } : c)),
    )
    expect(rewritten).toHaveBeenCalledWith(file, expect.any(Number))
  }, 60000)

  it('writes the colour the DJ picked as its RGB, and a new cue on its pad with no name', async () => {
    const file = wav()
    const read = await seen(file)
    const taken = new Set(read.cues.map((c) => c.kind))
    const free = HOT_KINDS.findIndex((kind) => !taken.has(kind))
    const [first, ...rest] = asWanted(read)
    const wanted = [
      { ...first, color: 5 },
      ...rest,
      { ms: 1234, kind: HOT_KINDS[free], color: null },
    ]
    await applySeratoCuesBatch([op(file, read, wanted)], { ensureClosed: closed })
    const after = readSeratoMarkers(file)?.cues ?? []
    expect(after.find((c) => String(c.index) === first.id)?.color).toBe(hotCueArgb(5) & 0xffffff)
    expect(after.find((c) => c.index === free)).toEqual({
      index: free,
      ms: 1234,
      color: hotCueArgb(null) & 0xffffff,
      name: '',
    })
  }, 60000)

  it('takes a cue off the file when the DJ removed it in Surco', async () => {
    const file = wav()
    const read = await seen(file)
    const [, ...rest] = asWanted(read)
    await applySeratoCuesBatch([op(file, read, rest)], { ensureClosed: closed })
    expect(readSeratoMarkers(file)?.cues.map((c) => String(c.index))).toEqual(rest.map((c) => c.id))
  }, 60000)

  it.each(['wav', 'mp3'] as const)(
    'leaves a %s and its backups alone when the save changes no cue',
    async (ext) => {
      const file = wav(ext)
      expect((await seratoLeadOfFile(file, 44100)) === 0).toBe(ext === 'wav')
      const read = await seen(file)
      const before = readFileSync(file)
      const keeper = vi.fn(async () => ({ id: 'b1' }) as never)
      configureOriginalKeeper(keeper)
      const result = await applySeratoCuesBatch([op(file, read, asWanted(read))], {
        ensureClosed: closed,
      })
      expect(result).toEqual({
        ok: true,
        wrote: false,
        outcomes: [{ id: 'op1', applied: true, notices: [] }],
      })
      expect(keeper).not.toHaveBeenCalled()
      expect(readFileSync(file)).toEqual(before)
    },
    60000,
  )

  it('leaves a file whose cues Serato changed after the editor read them, and says so as Engine does', async () => {
    const file = wav()
    const read = await seen(file)
    const before = readFileSync(file)
    const result = await applySeratoCuesBatch(
      [op(file, read, asWanted(read), { fingerprint: 'stale' })],
      { ensureClosed: closed },
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'op1', applied: false, notices: [{ code: 'cues-changed', track: 'Pray' }] }],
    })
    expect(readFileSync(file)).toEqual(before)
  }, 60000)

  it('tells the DJ which track it could not write, and still writes the others in the batch', async () => {
    const good = wav()
    const gone = wav()
    const readGood = await seen(good)
    const readGone = await seen(gone)
    rmSync(gone)
    const moved = asWanted(readGood).map((c) => ({ ...c, ms: c.ms + 500 }))
    const result = await applySeratoCuesBatch(
      [
        op(gone, readGone, asWanted(readGone), { id: 'op0', label: 'Gone' }),
        op(good, readGood, moved),
      ],
      { ensureClosed: closed },
    )
    expect(result).toEqual({
      ok: true,
      wrote: true,
      outcomes: [
        { id: 'op0', applied: false, notices: [{ code: 'cues-write-failed', track: 'Gone' }] },
        { id: 'op1', applied: true, notices: [] },
      ],
    })
  }, 60000)

  it('says so when the write itself fails, and leaves the file as it was', async () => {
    const file = wav()
    const read = await seen(file)
    const before = readFileSync(file)
    configureOriginalKeeper(vi.fn().mockResolvedValue(null))
    const wanted = asWanted(read).map((c) => ({ ...c, ms: c.ms + 500 }))
    const result = await applySeratoCuesBatch([op(file, read, wanted)], { ensureClosed: closed })
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [
        { id: 'op1', applied: false, notices: [{ code: 'cues-write-failed', track: 'Pray' }] },
      ],
    })
    expect(readFileSync(file)).toEqual(before)
  }, 60000)

  it('leaves out a memory cue, which Serato has no place for, and says which', async () => {
    const file = wav()
    const read = await seen(file)
    const was = readSeratoMarkers(file)?.cues ?? []
    const wanted = [...asWanted(read), { ms: 1500, kind: 0, color: null }]
    const result = await applySeratoCuesBatch([op(file, read, wanted)], { ensureClosed: closed })
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [
        {
          id: 'op1',
          applied: true,
          notices: [{ code: 'cues-calls-dropped', track: 'Pray', calls: [1500] }],
        },
      ],
    })
    expect(readSeratoMarkers(file)?.cues).toEqual(was)
  }, 60000)

  it('refuses a set it cannot write as Serato cues, a grid edit, and anything that is not a cue save, without touching the file', async () => {
    const file = wav()
    const read = await seen(file)
    const before = readFileSync(file)
    const [first, ...rest] = asWanted(read)
    const twice = [first, { ...rest[0], kind: first.kind }, ...rest.slice(1)]
    const grid = { bpm: 120, anchorMs: 0 }
    const edit: QueueOp = {
      id: 'e1',
      kind: 'edit',
      edit: { kind: 'rename', playlistId: 'p', name: 'x' },
      stamps: {},
    } as QueueOp
    const result = await applySeratoCuesBatch(
      [
        op(file, read, twice, { id: 'twice' }),
        op(file, read, asWanted(read), { id: 'grid', grid, gridFingerprint: read.gridFingerprint }),
        op(file, read, asWanted(read), { id: 'drops', wanted: undefined, drops: [1000] }),
        edit,
      ],
      { ensureClosed: closed },
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [
        { id: 'twice', applied: false, notices: [{ code: 'cues-invalid', track: 'Pray' }] },
        { id: 'grid', applied: false, notices: [{ code: 'cues-invalid', track: 'Pray' }] },
        { id: 'drops', applied: false, notices: [{ code: 'cues-invalid', track: 'Pray' }] },
        { id: 'e1', applied: false, notices: [{ code: 'cues-invalid', track: '' }] },
      ],
    })
    expect(readFileSync(file)).toEqual(before)
  }, 60000)
})

describe('a Serato save whose cues changed meanwhile', () => {
  it('reaches the window on the Serato channel as changed, the way an Engine one does', async () => {
    const file = wav()
    const read = await seen(file)
    const broadcast = vi.fn()
    const idle = { isRunning: async () => false }
    const pq = createProgramQueue(
      {
        program: 'serato',
        appliedChannel: 'serato:cueQueueApplied',
        queue: {
          store: { read: () => null, write: () => {}, setAside: () => {} },
          collection: () => '/Users/dj/Music/_Serato_',
          applyBatch: (_c, ops, ensureClosed) => applySeratoCuesBatch(ops, { ensureClosed }),
          repoint: async () => [],
          nodeStamps: async () => ({}),
          onChange: () => {},
          addsTracks: false,
        },
      },
      {
        broadcast,
        settled: vi.fn(),
        moments: { begin: vi.fn() },
        serial: (task) => task(),
        processes: { rekordbox: idle, engine: idle, traktor: idle, serato: idle },
      },
    )
    pq.queue.enqueue([op(file, read, asWanted(read), { fingerprint: 'stale' })])
    pq.applyQuietly()
    await vi.waitFor(() =>
      expect(broadcast).toHaveBeenCalledWith('serato:cueQueueApplied', {
        tracks: 0,
        changes: 0,
        notices: [{ code: 'cues-changed', track: 'Pray' }],
        written: [],
      }),
    )
    expect(pq.queue.isEmpty()).toBe(true)
  }, 60000)
})
