import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, getAppPath: () => '/tmp' },
  ipcMain: { handle: vi.fn() },
}))

vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

const OPENED = vi.hoisted(
  () => [] as { path: string; readonly: boolean; rawKey: boolean; closed: boolean }[],
)
vi.mock('./rekordboxDb', async (importOriginal) => {
  const real = await importOriginal<typeof import('./rekordboxDb')>()
  return {
    ...real,
    openRekordboxDb: (path: string, options?: { readonly?: boolean; key?: string }) => {
      const db = real.openRekordboxDb(path, options)
      if (!db) return db
      const seen = {
        path,
        readonly: options?.readonly === true,
        rawKey: options?.key?.startsWith("x'") === true,
        closed: false,
      }
      OPENED.push(seen)
      const close = db.close.bind(db)
      db.close = () => {
        seen.closed = true
        return close()
      }
      return db
    },
  }
})

import type { WebContents } from 'electron'
import { ipcMain } from 'electron'
import { makeRekordbox, rekordboxRow } from '../scenarios/rekordboxFixture'
import type { Verification } from '../shared/verification'
import { FILE_TYPES, openRekordboxDb } from './rekordboxDb'
import { repointTracks } from './rekordboxLibrary'
import type { QueueApply } from './rekordboxQueue'
import { applyPatches } from './traktorNml'
import { nmlPatchOf, type QueuedNmlPatch } from './traktorPatchQueue'
import {
  appVerifyRegistry,
  libraryReaders,
  libraryRequeue,
  queueVerification,
  registerVerifyIpc,
  snapshotLibraries,
  verifyUpdateSender,
} from './verifyIpc'
import { createVerifyRegistry, type VerifyEntry, type VerifyRegistryDeps } from './verifyRegistry'

function handlerFor(channel: string): (e: unknown, ...args: unknown[]) => Promise<unknown> {
  const call = vi.mocked(ipcMain.handle).mock.calls.findLast(([ch]) => ch === channel)
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1] as (e: unknown, ...args: unknown[]) => Promise<unknown>
}

const contents = (destroyed = false) => {
  const send = vi.fn<WebContents['send']>()
  return { send, isDestroyed: () => destroyed } as unknown as WebContents & { send: typeof send }
}

const realPath = (p: string) => p
const FROM = '/Volumes/Music/Artist/Title.aiff'
const TO = '/Volumes/Music/Artist/Title.wav'

const entry = (over: Partial<VerifyEntry> = {}): VerifyEntry => ({
  trackId: 'a',
  from: FROM,
  source: FROM,
  to: TO,
  samplesKept: true,
  originalKept: false,
  places: new Set(['file', 'rekordbox']),
  file: {
    path: TO,
    ext: '.wav',
    codec: 'pcm_s16le',
    samplesKept: true,
    trimmedSec: 0,
    tags: {},
    cover: 'untouched',
  },
  verification: { status: 'checking', checks: [] },
  ...over,
})

const collection = () =>
  makeRekordbox(join(mkdtempSync(join(tmpdir(), 'surco-verifyipc-')), 'rekordbox'), [
    { id: '100', path: FROM, title: 'Title', artist: 'Artist', fileType: 12, cuesMs: [1000, 2000] },
  ])

describe('verify IPC', () => {
  // The preload hands the renderer (trackId, verification) as two arguments, like the
  // progress events: every open window hears it, a closed one is skipped.
  it('a verify:update reaches the window that converted', () => {
    const open = contents()
    const closed = contents(true)
    const v: Verification = { status: 'ok', checks: [], job: 'j', seq: 1 }

    verifyUpdateSender(() => [open, closed])('a', v)

    expect(open.send).toHaveBeenCalledWith('verify:update', 'a', v)
    expect(closed.send).not.toHaveBeenCalled()
  })

  // A track main no longer knows (the app restarted since the conversion) cannot be
  // re-read: the renderer is told so by key, not left waiting.
  it('verify:retry with an unknown track id rejects with an error key', async () => {
    const deps = {} as VerifyRegistryDeps
    registerVerifyIpc(createVerifyRegistry(deps))

    await expect(handlerFor('verify:retry')({}, 'nope')).rejects.toThrow(
      /^SURCO_ERR:verifyUnknownTrack$/,
    )
    await expect(handlerFor('verify:retry')({}, 42)).rejects.toThrow(
      /^SURCO_ERR:verifyUnknownTrack$/,
    )
  })

  it('verify:retry answers what the registry decided', async () => {
    const retry = vi.fn(async () => 'rerun-job' as const)
    registerVerifyIpc({ retry, musicAdded: vi.fn(async () => {}) })

    await expect(handlerFor('verify:retry')({}, 'a')).resolves.toBe('rerun-job')
    expect(retry).toHaveBeenCalledWith('a')
  })

  it('verify:musicAdded hands the registry the track and the entry the add made', async () => {
    const musicAdded = vi.fn(async (_trackId: string, _pid: string) => {})
    registerVerifyIpc({ retry: vi.fn(async () => 'rechecked' as const), musicAdded })

    await handlerFor('verify:musicAdded')({}, 'a', 'PID')
    expect(musicAdded).toHaveBeenCalledWith('a', 'PID')
  })
})

describe('library readers', () => {
  // An open handle keeps the next write's wal_checkpoint busy, which fails its backup: the
  // read closes the collection as soon as it has its answer. It opens with the derived key:
  // the passphrase costs a key derivation on the main thread at every open.
  it('reads rekordbox read-only with the derived key and closes it right after', async () => {
    const path = collection()
    const readers = libraryReaders(
      { rekordbox: () => path, engine: () => '', traktor: () => '' },
      { realPath, bootVolume: () => 'Macintosh HD' },
    )
    OPENED.length = 0

    const results = await readers.readRekordbox([
      entry({ rekordbox: { id: '100', cues: 2, analysisDataPath: '', analysed: 0 } }),
    ])

    expect(results).toEqual([
      {
        place: 'rekordbox',
        state: 'mismatch',
        detail: { key: 'rekordboxStillOld', params: { format: 'AIFF' } },
      },
    ])
    expect(OPENED).toEqual([{ path, readonly: true, rawKey: true, closed: true }])
  })

  it('a library that is not there reads as unreadable', async () => {
    const readers = libraryReaders(
      { rekordbox: () => '', engine: () => '', traktor: () => '' },
      { realPath, bootVolume: () => 'Macintosh HD' },
    )

    expect(await readers.readRekordbox([entry()])).toBe('unreadable')
    expect(await readers.readEngine([entry()])).toBe('unreadable')
    expect(await readers.readTraktor([])).toBe('unreadable')
  })

  // The Engine row the job's own Engine DJ step wrote has no snapshot: it only has to be on
  // the written file.
  it('an Engine row the job added is checked as added', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-verifyipc-engine-'))
    const seen: unknown[] = []
    const readers = libraryReaders(
      { rekordbox: () => '', engine: () => dir, traktor: () => '' },
      {
        realPath,
        bootVolume: () => 'Macintosh HD',
        openEngine: () => ({ close: () => {} }) as never,
        checkEngine: (_db, _dir, list) => {
          seen.push(...list)
          return list.map(() => ({ place: 'engine', state: 'ok', detail: { key: 'engineOk' } }))
        },
      },
    )

    await readers.readEngine([
      entry({ engineStep: true, engine: 'absent' }),
      entry({ engineStep: true, engine: { id: 1, quickCues: 'q', beatData: 'b', loops: 'l' } }),
      entry({ engine: 'unreadable' }),
    ])

    expect(seen.map((e) => (e as { added: boolean }).added)).toEqual([true, false, false])
  })
  // The check has to know the cut to tell cues that followed it from cues left behind.
  it('hands the Engine check the cut the conversion made', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-verifyipc-engine-'))
    const seen: unknown[] = []
    const readers = libraryReaders(
      { rekordbox: () => '', engine: () => dir, traktor: () => '' },
      {
        realPath,
        bootVolume: () => 'Macintosh HD',
        openEngine: () => ({ close: () => {} }) as never,
        checkEngine: (_db, _dir, list) => {
          seen.push(...list)
          return list.map(() => ({ place: 'engine', state: 'ok', detail: { key: 'engineOk' } }))
        },
      },
    )

    await readers.readEngine([entry({ engineShift: { trimmedMs: 1900 } }), entry()])

    expect(seen.map((e) => (e as { shift?: unknown }).shift)).toEqual([
      { trimmedMs: 1900 },
      undefined,
    ])
  })
})

describe('snapshotLibraries', () => {
  it('takes the source row from the libraries in play and closes them', async () => {
    const path = collection()
    OPENED.length = 0
    const before = await snapshotLibraries(FROM, { rekordbox: path, engine: '' }, realPath)

    expect(before).toEqual({
      rekordbox: { id: '100', cues: 2, analysisDataPath: '', analysed: 0 },
    })
    expect(OPENED).toEqual([{ path, readonly: true, rawKey: true, closed: true }])
  })

  // A conversion must never fail because a library could not be read before it.
  it('never rejects: a library it cannot open is unreadable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-verifyipc-broken-'))
    mkdirSync(join(dir, 'Database2', 'm.db'), { recursive: true })
    const garbage = join(dir, 'master.db')
    writeFileSync(garbage, 'not a database either')

    const before = await snapshotLibraries(FROM, { rekordbox: garbage, engine: dir }, realPath)

    expect(before).toEqual({ rekordbox: 'unreadable', engine: 'unreadable' })
  })
})

describe('libraryRequeue', () => {
  const queues = (holds = (_from: string) => false) => ({
    rekordbox: { enqueue: vi.fn(), apply: vi.fn(), at: () => '/c/master.db', holds },
    engine: { enqueue: vi.fn(), apply: vi.fn(), at: () => '', holds },
    traktor: {
      enqueue: vi.fn<(ops: [], patches: QueuedNmlPatch[]) => void>(),
      apply: vi.fn(),
      at: () => '/t/collection.nml',
      holds,
    },
  })

  // The run's repoint still queued carries its tags, artwork, grid or stars: a bare move by
  // the same source would replace it, and the apply would leave them out.
  it.each(['rekordbox', 'engine', 'traktor'] as const)(
    'leaves a %s repoint already queued for the source as it is and only applies',
    (place) => {
      const holds = vi.fn((_from: string) => true)
      const q = queues(holds)
      const patch = { volume: 'HD', dir: '/:M/:', file: 'a.aiff', newFile: 'a.wav' }

      libraryRequeue(q)(place, entry({ traktorPatch: patch }))

      expect(q[place].enqueue).not.toHaveBeenCalled()
      expect(q[place].apply).toHaveBeenCalledOnce()
      expect(holds).toHaveBeenCalledWith(place === 'traktor' ? 'HD\0/:M/:\0a.aiff' : FROM)
    },
  )

  // Still on the old file, the first repoint never touched the row, and its cue shift went
  // with it: handed again, the move carries the same shift, and nothing else.
  it('hands rekordbox and Engine the move with the original cue shift', () => {
    const q = queues()
    const requeue = libraryRequeue(q)

    expect(requeue('rekordbox', entry({ cueShiftMs: 25 }))).toBe(false)
    expect(requeue('engine', entry())).toBe(true)

    expect(q.rekordbox.enqueue).toHaveBeenCalledWith(
      [],
      [{ from: FROM, to: TO, audio: { cueShiftMs: 25 } }],
    )
    expect(q.engine.enqueue).toHaveBeenCalledWith([], [{ from: FROM, to: TO }])
    expect(q.rekordbox.apply).toHaveBeenCalledOnce()
  })

  // Engine's row also never moved, so its cues still wait for the cut: the retry is the
  // only write that can still bring it, once, along with the move.
  it('hands Engine the move with the cut its cues still wait for', () => {
    const q = queues()
    const shift = { trimmedMs: 1900, sampleRateHz: 48000 }

    libraryRequeue(q)('engine', entry({ cueShiftMs: -1900, engineShift: shift }))

    expect(q.engine.enqueue).toHaveBeenCalledWith(
      [],
      [{ from: FROM, to: TO, audio: { cueShiftMs: -1900 }, engineShift: shift }],
    )
  })

  it('hands Traktor the rename and its cue shift, without cue tree, grid or stars', () => {
    const q = queues()
    const patch = {
      volume: 'HD',
      dir: '/:M/:',
      file: 'a.aiff',
      newFile: 'a.wav',
      cueTree: new Uint8Array([1, 2]),
      cueShift: { shiftMs: 25, maxMs: 50 },
      bpm: 128,
      ranking: 255,
    }

    libraryRequeue(q)('traktor', entry({ traktorPatch: patch }))

    const [, [queued]] = q.traktor.enqueue.mock.calls[0]
    expect(queued.patch).toEqual({
      volume: 'HD',
      dir: '/:M/:',
      file: 'a.aiff',
      newFile: 'a.wav',
      cueShift: { shiftMs: 25, maxMs: 50 },
    })
  })

  describe('on a Traktor collection', () => {
    const entryAt = (file: string, start: number) =>
      `<ENTRY TITLE="Uno"><LOCATION DIR="/:Musica/:" FILE="${file}" VOLUME="Macintosh HD"></LOCATION>` +
      `<CUE_V2 NAME="Mine" DISPL_ORDER="0" TYPE="0" START="${start}" LEN="0" REPEATS="-1" HOTCUE="0"></CUE_V2></ENTRY>`
    const nml = (...entries: string[]) =>
      `<NML VERSION="19"><COLLECTION ENTRIES="${entries.length}">${entries.join('')}</COLLECTION></NML>`
    const retry = () => {
      const q = queues()
      libraryRequeue(q)(
        'traktor',
        entry({
          traktorPatch: {
            volume: 'Macintosh HD',
            dir: '/:Musica/:',
            file: 'uno.aiff',
            newFile: 'uno.flac',
            cueShift: { shiftMs: -51 },
            outputVolume: 'Macintosh HD',
            outputDir: '/:Musica/:',
            outputFile: 'uno.flac',
          },
        }),
      )
      const [, [queued]] = q.traktor.enqueue.mock.calls[0]
      return nmlPatchOf(queued)
    }
    const onDisk = () => true

    it('a free name moves the entry and shifts its cues exactly once', () => {
      const once = applyPatches(nml(entryAt('uno.aiff', 1000)), [retry()], onDisk)
      expect(once).toContain('FILE="uno.flac"')
      expect(once).not.toContain('START="1000"')

      expect(applyPatches(once, [retry()], onDisk)).toBe(once)
    })

    // Another entry already holds the new name: the old one cannot move, and its cues
    // describe the old file, which did not change. Retried again and again, they stay.
    it('a name another entry holds leaves the old entry and its cues alone', () => {
      const before = nml(entryAt('uno.aiff', 1000), entryAt('uno.flac', 2000))
      const once = applyPatches(before, [retry()], onDisk)
      expect(applyPatches(once, [retry()], onDisk)).toBe(before)
      expect(once).toBe(before)
    })
  })

  describe('on a real collection', () => {
    function setupCollection(rowPath: 'from' | 'to', fileType = 12) {
      const dir = mkdtempSync(join(tmpdir(), 'surco-verifyipc-requeue-'))
      const from = join(dir, 'Title.aiff')
      const to = join(dir, 'Title.wav')
      writeFileSync(from, 'aiff')
      writeFileSync(to, 'wav')
      const path = makeRekordbox(join(dir, 'rekordbox'), [
        {
          id: '100',
          path: rowPath === 'from' ? from : to,
          title: 'Title',
          artist: 'Artist',
          fileType,
          cuesMs: [1000, 2000],
        },
      ])
      const q = queues()
      libraryRequeue(q)('rekordbox', entry({ from, to, cueShiftMs: 25 }))
      const [, [item]] = q.rekordbox.enqueue.mock.calls[0]
      const apply = () => repointTracks(path, [{ ...item, realPath, quiet: true }])
      return { path, to, apply }
    }

    it('moves the cues by the shift exactly once', async () => {
      const { path, to, apply } = setupCollection('from')

      await apply()
      expect(rekordboxRow(path, '100')).toMatchObject({ path: to, cuesMs: [1025, 2025] })

      await apply()
      expect(rekordboxRow(path, '100').cuesMs).toEqual([1025, 2025])
    })

    // A row already on the new path with the old type is not found by the old path: the
    // repoint finds nothing to move, and the cues stay.
    it('moves nothing for a row already on the new path', async () => {
      const { path, apply } = setupCollection('to', 12)

      await apply()
      expect(rekordboxRow(path, '100')).toMatchObject({ fileType: 12, cuesMs: [1000, 2000] })
    })
  })
})

describe('queueVerification', () => {
  const applied: QueueApply = {
    status: 'applied',
    tracks: 1,
    changes: 0,
    notices: [],
    written: [],
    outcomes: [],
  }
  const setup = () => {
    const afterQueueApplied = vi.fn(
      async (_place: string, _result: unknown, _stillQueued?: boolean) => {},
    )
    const afterQueueWaits = vi.fn(async (_place: string) => {})
    return {
      afterQueueApplied,
      afterQueueWaits,
      q: queueVerification({ afterQueueApplied, afterQueueWaits }),
    }
  }

  it('an apply that repointed is checked as written', () => {
    const { afterQueueApplied, q } = setup()
    q.repointed('rekordbox', [{ written: true }])
    q.settled('rekordbox', applied)
    expect(afterQueueApplied).toHaveBeenCalledWith('rekordbox', 'written')
  })

  // The repoints landed and left the queue; what failed after them was the rest of the
  // queue, and the tracks are read as they are.
  it('repoints that landed before a later refusal are still checked as written', () => {
    const { afterQueueApplied, q } = setup()
    q.repointed('rekordbox', [{ written: true }, { written: false, reason: 'no-match' }])
    q.settled('rekordbox', { status: 'refused', reason: 'rekordbox-running' })
    expect(afterQueueApplied).toHaveBeenCalledWith('rekordbox', 'written')
  })

  it('Traktor carries the facts of its write', () => {
    const { afterQueueApplied, q } = setup()
    const write = { before: new Map([['k', 'a.aiff']]) }
    q.repointed('traktor', [{ written: true }], write)
    q.settled('traktor', applied)
    expect(afterQueueApplied).toHaveBeenCalledWith('traktor', write)
  })

  it('a repoint the program refused stays pending', () => {
    const { afterQueueApplied, afterQueueWaits, q } = setup()
    q.repointed('engine', [{ written: false, reason: 'rekordbox-running' }])
    q.settled('engine', { status: 'refused', reason: 'rekordbox-running' })
    q.settled('engine', { status: 'refused', reason: 'cancelled' })
    q.settled('engine', { status: 'empty' })
    expect(afterQueueApplied).not.toHaveBeenCalled()
    expect(afterQueueWaits.mock.calls).toEqual([['engine'], ['engine']])
  })

  // A refusal or a throw leaves the repoints in the queue for the next apply; a discard
  // takes them away.
  it('a refusal, a throw or a discard is a failed apply, never left pending', () => {
    const { afterQueueApplied, q } = setup()
    q.repointed('rekordbox', [{ written: false, reason: 'backup-failed' }])
    q.settled('rekordbox', { status: 'refused', reason: 'backup-failed' })
    q.settled('engine', 'threw')
    q.discarded('traktor')
    expect(afterQueueApplied.mock.calls).toEqual([
      ['rekordbox', 'failed', true],
      ['engine', 'failed', true],
      ['traktor', 'failed', false],
    ])
  })

  // A retry finds the library there and reads checking; the apply it started finds the
  // program open and waits. The track says so, and is read once the program closes.
  it('a retry while the program is open reads pending, then verified when it closes', async () => {
    const emit = vi.fn<VerifyRegistryDeps['emit']>()
    const readRekordbox = vi
      .fn<VerifyRegistryDeps['readRekordbox']>()
      .mockResolvedValueOnce([
        { place: 'rekordbox', state: 'mismatch', detail: { key: 'rekordboxStillOld' } },
      ])
      .mockResolvedValue([{ place: 'rekordbox', state: 'ok', detail: { key: 'rekordboxOk' } }])
    const registry = createVerifyRegistry({
      emit,
      readRekordbox,
      readEngine: vi.fn<VerifyRegistryDeps['readEngine']>(),
      readTraktor: vi.fn<VerifyRegistryDeps['readTraktor']>(),
      readFile: vi.fn<VerifyRegistryDeps['readFile']>(),
      readMusic: vi.fn<VerifyRegistryDeps['readMusic']>(),
      requeue: vi.fn<VerifyRegistryDeps['requeue']>(() => false),
      exists: vi.fn<VerifyRegistryDeps['exists']>(async () => true),
    })
    const q = queueVerification(registry)
    const rekordboxOf = () => registry.get('a')?.checks.find((c) => c.place === 'rekordbox')
    registry.register(entry())
    await registry.afterFlush({ rekordbox: 'written', engine: 'off', traktor: 'off' })
    await registry.retry('a')
    expect(rekordboxOf()?.state).toBe('checking')

    q.settled('rekordbox', { status: 'refused', reason: 'cancelled' })
    await vi.waitFor(() => expect(rekordboxOf()?.state).toBe('pending'))
    expect(rekordboxOf()?.detail).toEqual({ key: 'pending', params: { program: 'rekordbox' } })
    expect(emit.mock.lastCall?.[1].checks).toContainEqual(rekordboxOf())

    q.repointed('rekordbox', [{ written: true }])
    q.settled('rekordbox', applied)
    await vi.waitFor(() => expect(registry.get('a')?.status).toBe('ok'))
  })

  // The registry's work runs detached from the queue's own chain: a check that throws is
  // logged, never left as an unhandled rejection.
  it('a check that rejects after an apply is logged, not left unhandled', async () => {
    const { default: log } = await import('electron-log/main')
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const afterQueueApplied = vi.fn(async () => {
      throw new Error('boom')
    })
    const q = queueVerification({ afterQueueApplied, afterQueueWaits: vi.fn(async () => {}) })
    q.discarded('rekordbox')
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom')))
    warn.mockRestore()
  })

  it('what one apply repointed is not reported again by the next', () => {
    const { afterQueueApplied, q } = setup()
    q.repointed('rekordbox', [{ written: true }])
    q.settled('rekordbox', applied)
    q.settled('rekordbox', applied)
    expect(afterQueueApplied).toHaveBeenCalledTimes(1)
  })
})

describe('appVerifyRegistry', () => {
  it('reads rekordbox at the path it is handed, after a flush, and emits ok for a repointed row', async () => {
    const path = collection()
    const to = join(mkdtempSync(join(tmpdir(), 'surco-verifyipc-')), 'Title.wav')
    writeFileSync(to, Buffer.alloc(64))
    const db = openRekordboxDb(path)
    db?.prepare(
      'UPDATE djmdContent SET FolderPath = ?, FileNameL = ?, FileType = ?, FileSize = ? WHERE ID = ?',
    ).run(to, 'Title.wav', FILE_TYPES.wav, statSync(to).size, '100')
    db?.close()
    const emit = vi.fn<VerifyRegistryDeps['emit']>()
    const registry = appVerifyRegistry({
      paths: { rekordbox: () => path, engine: () => '', traktor: () => '' },
      queues: {
        rekordbox: { enqueue: vi.fn(), apply: vi.fn(), at: () => path, holds: () => false },
        engine: { enqueue: vi.fn(), apply: vi.fn(), at: () => '', holds: () => false },
        traktor: { enqueue: vi.fn(), apply: vi.fn(), at: () => '', holds: () => false },
      },
      emit,
      readMusic: vi.fn<VerifyRegistryDeps['readMusic']>(),
      realPath,
      bootVolume: () => 'Macintosh HD',
    })
    registry.register(
      entry({
        to,
        places: new Set(['rekordbox']),
        rekordbox: { id: '100', cues: 2, analysisDataPath: '', analysed: 0 },
        size: statSync(to).size,
      } as Partial<VerifyEntry>),
    )

    await registry.afterFlush({ rekordbox: 'written', engine: 'off', traktor: 'off' })

    expect(emit.mock.lastCall?.[1].status).toBe('ok')
    expect(emit.mock.lastCall?.[1].checks).toContainEqual(
      expect.objectContaining({
        place: 'rekordbox',
        state: 'ok',
        detail: expect.objectContaining({ key: 'rekordboxOk' }),
      }),
    )
  })
})
