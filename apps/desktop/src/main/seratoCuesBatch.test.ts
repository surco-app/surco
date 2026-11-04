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
import { seratoGeobBody, withSeratoCues } from '../shared/seratoMarkers'
import { SERATO_MP3, SERATO_WAV } from '../shared/seratoMarkersFixture'
import type { TrackCues } from '../shared/types'
import { createBusyPaths } from './busyPaths'
import { configureOriginalKeeper } from './originalKeeper'
import { createProgramQueue } from './programQueue'
import { createRekordboxQueue } from './rekordboxQueue'
import type { CuesOp, QueueOp } from './rekordboxQueueOps'
import { seratoLeadOfFile } from './seratoClock'
import { seratoCueSource } from './seratoCueSource'
import { applySeratoCuesBatch } from './seratoCuesWrite'
import { readSeratoMarkers, readSeratoTrack } from './seratoTags'

const FF = ffmpegStatic as unknown as string

function wav(ext: 'wav' | 'mp3' = 'wav', payload?: Uint8Array): string {
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
      ByteVector.fromByteArray(
        payload
          ? seratoGeobBody(payload)
          : Buffer.from(ext === 'wav' ? SERATO_WAV : SERATO_MP3, 'base64'),
      ),
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

const reader = seratoCueSource(
  {
    words: async () => null,
    queue: { enqueue: vi.fn(), cuesOp: vi.fn(), drop: vi.fn() },
    applyQuietly: vi.fn(),
  },
  () => '',
)

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
  it('shows a cue Serato keeps before the MP3 lead at the start and saves past it untouched', async () => {
    const payload = withSeratoCues(null, [
      { index: 0, ms: 0, color: 0xcc0000, name: 'Intro' },
      { index: 1, ms: 1500, color: 0x00cc00, name: '' },
    ])
    const file = wav('mp3', payload)
    expect(await seratoLeadOfFile(file, 44100)).toBeGreaterThan(0)
    const read = await seen(file)
    expect(read.cues.map((c) => c.ms)[0]).toBe(0)
    const taken = new Set(read.cues.map((c) => c.kind))
    const free = HOT_KINDS.findIndex((kind) => !taken.has(kind))
    const wanted = [...asWanted(read), { ms: 1000, kind: HOT_KINDS[free], color: null }]
    const result = await applySeratoCuesBatch([op(file, read, wanted)], { ensureClosed: closed })
    expect(result).toEqual({
      ok: true,
      wrote: true,
      outcomes: [{ id: 'op1', applied: true, notices: [] }],
    })
    const alone = Buffer.from(
      withSeratoCues(null, [readSeratoMarkers(file)?.cues[0] ?? (null as never)]),
    )
    const original = Buffer.from(
      withSeratoCues(null, [{ index: 0, ms: 0, color: 0xcc0000, name: 'Intro' }]),
    )
    const entry = original.subarray(original.indexOf('CUE'), original.indexOf('BPMLOCK'))
    expect(alone.subarray(alone.indexOf('CUE'), alone.indexOf('BPMLOCK'))).toEqual(entry)
    expect(Buffer.from(readSeratoTrack(file)?.payload ?? []).indexOf(entry)).toBeGreaterThan(0)
  }, 60000)

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
      [op(file, read, moved(read), { fingerprint: 'stale' })],
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
    pq.queue.enqueue([op(file, read, moved(read), { fingerprint: 'stale' })])
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

describe('a Serato save for a file Surco is converting', () => {
  it('stays queued without touching the file and is written once the conversion is done, so neither rename eats the other', async () => {
    const file = wav()
    const read = await seen(file)
    const before = readFileSync(file)
    const converting = new Set([file])
    const ensureClosed = vi.fn(closed)
    const idle = { isRunning: async () => false }
    const broadcast = vi.fn()
    const pq = createProgramQueue(
      {
        program: 'serato',
        appliedChannel: 'serato:cueQueueApplied',
        queue: {
          store: { read: () => null, write: () => {}, setAside: () => {} },
          collection: () => '/Users/dj/Music/_Serato_',
          applyBatch: (_c, ops, ensure) =>
            applySeratoCuesBatch(ops, {
              ensureClosed: async () => {
                ensureClosed()
                return ensure()
              },
              converting: (f) => converting.has(f),
            }),
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
    pq.queue.enqueue([op(file, read, moved(read))])
    expect(await pq.queue.apply(closed)).toEqual({ status: 'refused', reason: 'cancelled' })
    expect(pq.queue.isEmpty()).toBe(false)
    expect(ensureClosed).not.toHaveBeenCalled()
    expect(readFileSync(file)).toEqual(before)
    converting.delete(file)
    expect(await pq.queue.apply(closed)).toMatchObject({ status: 'applied', tracks: 1 })
    expect(pq.queue.isEmpty()).toBe(true)
    expect(readFileSync(file)).not.toEqual(before)
  }, 60000)

  it('leaves a file a conversion took while Serato was being closed', async () => {
    const file = wav()
    const read = await seen(file)
    const before = readFileSync(file)
    const converting = new Set<string>()
    const result = await applySeratoCuesBatch([op(file, read, moved(read))], {
      ensureClosed: async () => {
        converting.add(file)
        return true
      },
      converting: (f) => converting.has(f),
    })
    expect(result).toEqual({ ok: false, reason: 'cancelled' })
    expect(readFileSync(file)).toEqual(before)
  }, 60000)

  it('writes the saves before a file that became busy, leaves that one and the rest queued, and finishes them once it is free', async () => {
    const first = wav()
    const second = wav()
    const readFirst = await seen(first)
    const readSecond = await seen(second)
    const secondBefore = readFileSync(second)
    const converting = new Set<string>()
    const writing = createBusyPaths(true)
    const heldWhileWriting: boolean[] = []
    const batch = (ops: QueueOp[]) =>
      applySeratoCuesBatch(ops, {
        ensureClosed: closed,
        converting: (f) => converting.has(f),
        writing,
        rewritten: (f) => {
          heldWhileWriting.push(writing.has(f))
          converting.add(second)
        },
      })
    const ops = [
      op(first, readFirst, moved(readFirst)),
      op(second, readSecond, moved(readSecond), { id: 'op2' }),
    ]
    expect(await batch(ops)).toEqual({ ok: false, reason: 'cancelled' })
    expect(heldWhileWriting).toEqual([true])
    expect(writing.has(first)).toBe(false)
    expect(readFileSync(second)).toEqual(secondBefore)
    expect((await seen(first)).cues[0].ms).not.toBe(readFirst.cues[0].ms)
    converting.clear()
    expect(await batch(ops)).toEqual({
      ok: true,
      wrote: true,
      outcomes: [
        { id: 'op1', applied: true, notices: [] },
        { id: 'op2', applied: true, notices: [] },
      ],
    })
    expect(readFileSync(second)).not.toEqual(secondBefore)
  }, 60000)
})

function cueEntries(file: string): Map<number, string> {
  const payload = readSeratoTrack(file)?.payload ?? new Uint8Array()
  const view = Buffer.from(payload)
  const found = new Map<number, string>()
  let at = 2
  while (at < view.length) {
    const nameEnd = view.indexOf(0, at)
    if (nameEnd <= at || nameEnd + 5 > view.length) break
    const end = nameEnd + 5 + view.readUInt32BE(nameEnd + 1)
    if (view.toString('latin1', at, nameEnd) === 'CUE')
      found.set(view[nameEnd + 6], view.subarray(at, end).toString('hex'))
    at = end
  }
  return found
}

function withUpperPads(): string {
  const base = readSeratoTrack(wav('mp3'))
  if (!base?.payload || !base.markers) throw new Error('no Serato payload in the fixture')
  return wav(
    'mp3',
    withSeratoCues(base.payload, [
      ...base.markers.cues,
      { index: 8, ms: 1203, color: 0x123456, name: 'Nine' },
      { index: 12, ms: 1777, color: 0xabcdef, name: '' },
    ]),
  )
}

const moved = (read: TrackCues, by = 500.4): WantedCue[] =>
  asWanted(read).map((c, i) => (i === 0 ? { ...c, ms: c.ms + by } : c))

describe("Serato's pads beyond the eight Surco edits", () => {
  it('come out of every write byte for byte as Serato left them', async () => {
    const file = withUpperPads()
    const before = cueEntries(file)
    expect([...before.keys()]).toEqual(expect.arrayContaining([8, 12]))
    const read = await seen(file)
    const result = await applySeratoCuesBatch([op(file, read, moved(read))], {
      ensureClosed: closed,
    })
    expect(result).toMatchObject({ ok: true, wrote: true })
    const after = cueEntries(file)
    expect(after.get(8)).toBe(before.get(8))
    expect(after.get(12)).toBe(before.get(12))
    expect(after.get(0)).not.toBe(before.get(0))
  }, 60000)
})

describe('applying a Serato save again', () => {
  it('reports it applied without writing when the file already holds those cues, as after a crash mid-apply', async () => {
    const file = withUpperPads()
    const read = await seen(file)
    const save = op(file, read, moved(read))
    await applySeratoCuesBatch([save], { ensureClosed: closed })
    const after = readFileSync(file)
    const keeper = vi.fn(async () => ({ id: 'b2' }) as never)
    configureOriginalKeeper(keeper)
    expect(await applySeratoCuesBatch([save], { ensureClosed: closed })).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'op1', applied: true, notices: [] }],
    })
    expect(keeper).not.toHaveBeenCalled()
    expect(readFileSync(file)).toEqual(after)
  }, 60000)
})

describe('a save undone while its batch runs', () => {
  it('is skipped and its file left as it was', async () => {
    const kept = wav()
    const undone = wav()
    const readKept = await seen(kept)
    const readUndone = await seen(undone)
    const before = readFileSync(undone)
    const result = await applySeratoCuesBatch(
      [op(kept, readKept, moved(readKept)), op(undone, readUndone, moved(readUndone), { id: 'b' })],
      { ensureClosed: closed, stillQueued: (id) => id !== 'b' },
    )
    expect(result).toEqual({
      ok: true,
      wrote: true,
      outcomes: [
        { id: 'op1', applied: true, notices: [] },
        { id: 'b', applied: false, reason: 'cancelled', notices: [] },
      ],
    })
    expect(readFileSync(undone)).toEqual(before)
  }, 60000)
})

describe('Serato opening in the middle of a batch', () => {
  it('stops after the first of three files and writes the other two once Serato closes again', async () => {
    const files = [wav('mp3'), wav('mp3'), wav('mp3')]
    const reads = await Promise.all(files.map(seen))
    const queue = createRekordboxQueue({
      store: { read: () => null, write: () => {}, setAside: () => {} },
      collection: () => '/Users/dj/Music/_Serato_',
      applyBatch: (_c, ops, ensureClosed, stillQueued) =>
        applySeratoCuesBatch(ops, { ensureClosed, stillQueued }),
      repoint: async () => [],
      nodeStamps: async () => ({}),
      onChange: () => {},
      addsTracks: false,
    })
    queue.enqueue(
      files.map((file, i) => op(file, reads[i], moved(reads[i]), { id: `s${i}`, label: `t${i}` })),
    )
    const untouched = files.map((file) => readFileSync(file))
    let checks = 0
    const openAfterOne = async () => {
      checks += 1
      return checks <= 1
    }
    expect(await queue.apply(openAfterOne)).toEqual({ status: 'refused', reason: 'cancelled' })
    expect(readFileSync(files[0])).not.toEqual(untouched[0])
    expect(readFileSync(files[1])).toEqual(untouched[1])
    expect(readFileSync(files[2])).toEqual(untouched[2])
    expect(queue.state().tracks).toBe(3)
    const result = await queue.apply(closed)
    expect(result).toMatchObject({ status: 'applied', tracks: 3, notices: [] })
    for (const [i, file] of files.entries())
      expect((await seen(file)).cues.map((c) => c.ms)).toEqual(
        moved(reads[i]).map((c) => expect.closeTo(c.ms, 0)),
      )
    expect(queue.isEmpty()).toBe(true)
  }, 60000)
})
