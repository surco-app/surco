import { describe, expect, it, vi } from 'vitest'
import {
  type PlaceCheck,
  type Verification,
  type VerifyDetailKey,
  type VerifyPlace,
  verificationStatus,
} from '../shared/verification'
import type { NmlPatch } from './traktorNml'
import type { FileExpect } from './verifyFile'
import type { MusicExpect } from './verifyMusic'
import {
  createVerifyRegistry,
  traktorPatchKey,
  type VerifyEntry,
  type VerifyRegistryDeps,
} from './verifyRegistry'
import type { TraktorExpect } from './verifyTraktor'

const ok = (place: VerifyPlace, key: VerifyDetailKey): PlaceCheck => ({
  place,
  state: 'ok',
  detail: { key },
})
const libraryOk = (place: 'rekordbox' | 'engine' | 'traktor'): PlaceCheck => ok(place, `${place}Ok`)
const checking = (place: VerifyPlace): PlaceCheck => ({
  place,
  state: 'checking',
  detail: { key: 'checking' },
})
const mismatch = (place: VerifyPlace, key: VerifyDetailKey): PlaceCheck => ({
  place,
  state: 'mismatch',
  detail: { key },
})
const unreadable = (place: VerifyPlace, key: VerifyDetailKey): PlaceCheck => ({
  place,
  state: 'unreadable',
  detail: { key },
})

const fileExpect = (path: string): FileExpect => ({
  path,
  ext: '.wav',
  codec: 'pcm_s16le',
  samplesKept: true,
  trimmedSec: 0,
  tags: {},
  cover: 'untouched',
})

const musicExpect: MusicExpect = {
  pid: 'PID',
  file: '/Music/Title.wav',
  ext: '.wav',
  meta: { title: 'Title', artist: 'Artist', album: 'Album' },
  coverSet: false,
}

const snapshot = { id: '7', cues: 3, analysisDataPath: '/PIONEER/ANLZ0000.DAT', analysed: 105 }

function entry(trackId: string, over: Partial<VerifyEntry> = {}): VerifyEntry {
  const places = over.places ?? new Set<VerifyPlace>(['file', 'rekordbox'])
  const checks = [
    ok('file', 'fileIdentical'),
    ...[...places].filter((p) => p !== 'file' && p !== 'appleMusic').map(checking),
  ]
  return {
    trackId,
    from: `/Music/${trackId}.aiff`,
    source: `/Music/${trackId}.aiff`,
    to: `/Music/${trackId}.wav`,
    samplesKept: true,
    originalKept: false,
    places,
    rekordbox: snapshot,
    file: fileExpect(`/Music/${trackId}.wav`),
    verification: { status: verificationStatus(checks), checks },
    ...over,
  }
}

const mocks = () => ({
  emit: vi.fn<VerifyRegistryDeps['emit']>(),
  readRekordbox: vi.fn<VerifyRegistryDeps['readRekordbox']>(async (list) =>
    list.map(() => libraryOk('rekordbox')),
  ),
  readEngine: vi.fn<VerifyRegistryDeps['readEngine']>(async (list) =>
    list.map(() => libraryOk('engine')),
  ),
  readTraktor: vi.fn<VerifyRegistryDeps['readTraktor']>(async (list) =>
    list.map(() => libraryOk('traktor')),
  ),
  readFile: vi.fn<VerifyRegistryDeps['readFile']>(async () => ok('file', 'fileIdentical')),
  readMusic: vi.fn<VerifyRegistryDeps['readMusic']>(async () => ok('appleMusic', 'musicOne')),
  requeue: vi.fn<VerifyRegistryDeps['requeue']>(() => true),
  exists: vi.fn<VerifyRegistryDeps['exists']>(async () => true),
  samePath: vi.fn<NonNullable<VerifyRegistryDeps['samePath']>>(
    (a, b) => a.normalize('NFC') === b.normalize('NFC'),
  ),
})

function setup(over: Partial<ReturnType<typeof mocks>> = {}) {
  const deps = { ...mocks(), ...over }
  return { deps, registry: createVerifyRegistry(deps) }
}

const written = { rekordbox: 'written', engine: 'written', traktor: 'off' } as const

const stateOf = (v: Verification | undefined, place: VerifyPlace) =>
  v?.checks.find((c) => c.place === place)?.state

describe('verify registry', () => {
  it('after a written flush each registered track gets its library checks and one emit', async () => {
    const { deps, registry } = setup()
    registry.register(entry('a'))
    registry.register(
      entry('b', {
        places: new Set(['file', 'rekordbox', 'engine']),
        engine: { id: 1, quickCues: 'q', beatData: 'b', loops: 'l' },
      }),
    )

    await registry.afterFlush(written)

    // One read-only pass per library for the whole batch, not one per track.
    expect(deps.readRekordbox).toHaveBeenCalledTimes(1)
    expect(deps.readRekordbox.mock.calls[0][0].map((e) => e.trackId)).toEqual(['a', 'b'])
    expect(deps.readEngine.mock.calls[0][0].map((e) => e.trackId)).toEqual(['b'])
    expect(deps.emit).toHaveBeenCalledTimes(2)
    expect(deps.emit).toHaveBeenCalledWith('a', {
      status: 'ok',
      checks: [ok('file', 'fileIdentical'), libraryOk('rekordbox')],
      seq: 1,
    })
    expect(registry.get('b')).toEqual({
      status: 'ok',
      checks: [ok('file', 'fileIdentical'), libraryOk('rekordbox'), libraryOk('engine')],
    })
  })

  it('a queued rekordbox flush marks rekordbox pending, not mismatch', async () => {
    const { deps, registry } = setup()
    registry.register(entry('a'))

    await registry.afterFlush({ ...written, rekordbox: 'queued' })

    // Nothing has been written yet, so reading the collection now would see the old file.
    expect(deps.readRekordbox).not.toHaveBeenCalled()
    expect(registry.get('a')).toEqual({
      status: 'pending',
      checks: [
        ok('file', 'fileIdentical'),
        {
          place: 'rekordbox',
          state: 'pending',
          detail: { key: 'pending', params: { program: 'rekordbox' } },
        },
      ],
    })
    expect(deps.emit).toHaveBeenCalledTimes(1)
  })

  it('applying the rekordbox queue re-checks only the tracks pending there', async () => {
    const { deps, registry } = setup()
    deps.readRekordbox.mockResolvedValueOnce([mismatch('rekordbox', 'rekordboxStillOld')])
    registry.register(entry('wrong'))
    await registry.afterFlush(written)
    registry.register(entry('held'))
    registry.register(
      entry('engine-held', {
        places: new Set(['file', 'engine']),
        rekordbox: undefined,
        engine: { id: 2, quickCues: 'q', beatData: 'b', loops: 'l' },
      }),
    )
    await registry.afterFlush({ ...written, rekordbox: 'queued', engine: 'queued' })
    deps.readRekordbox.mockClear()
    deps.emit.mockClear()

    await registry.afterQueueApplied('rekordbox', 'written')

    expect(deps.readRekordbox).toHaveBeenCalledTimes(1)
    expect(deps.readRekordbox.mock.calls[0][0].map((e) => e.trackId)).toEqual(['held'])
    expect(deps.emit).toHaveBeenCalledTimes(1)
    expect(stateOf(registry.get('held'), 'rekordbox')).toBe('ok')
    expect(registry.get('held')?.status).toBe('ok')
    expect(stateOf(registry.get('engine-held'), 'engine')).toBe('pending')
  })

  it('a place the job never touched is never listed', async () => {
    const { deps, registry } = setup()
    // rekordbox had no row for the source: the repoint had nothing to move.
    registry.register(
      entry('a', {
        places: new Set(['file', 'rekordbox', 'engine']),
        rekordbox: 'absent',
        engine: 'absent',
      }),
    )
    registry.register(entry('b', { places: new Set(['file']) }))

    await registry.afterFlush(written)

    expect(deps.readRekordbox).not.toHaveBeenCalled()
    expect(deps.readEngine).not.toHaveBeenCalled()
    expect(registry.get('a')).toEqual({ status: 'ok', checks: [ok('file', 'fileIdentical')] })
    expect(registry.get('b')).toEqual({ status: 'ok', checks: [ok('file', 'fileIdentical')] })
  })

  it('a library switched off at flush time is not listed', async () => {
    const { registry } = setup()
    registry.register(entry('a'))

    await registry.afterFlush({ ...written, rekordbox: 'off' })

    expect(registry.get('a')).toEqual({ status: 'ok', checks: [ok('file', 'fileIdentical')] })
  })

  it('a collection that cannot be opened reports every track unreadable, never skipped', async () => {
    const { registry } = setup({
      readRekordbox: vi.fn<VerifyRegistryDeps['readRekordbox']>(async () => 'unreadable'),
      readEngine: vi.fn<VerifyRegistryDeps['readEngine']>(async () => {
        throw new Error('SQLITE_BUSY')
      }),
    })
    registry.register(
      entry('a', { places: new Set(['file', 'rekordbox', 'engine']), engine: 'ambiguous' }),
    )

    await registry.afterFlush(written)

    expect(registry.get('a')?.checks).toEqual([
      ok('file', 'fileIdentical'),
      unreadable('rekordbox', 'rekordboxUnreadable'),
      unreadable('engine', 'engineUnreadable'),
    ])
  })

  it('Traktor is judged against the entry the write matched, and dropped where it had none', async () => {
    const { deps, registry } = setup({
      readTraktor: vi.fn<VerifyRegistryDeps['readTraktor']>(async (list) =>
        list.map((e) => (e.before === null ? null : libraryOk('traktor'))),
      ),
    })
    const had: NmlPatch = { volume: 'Public', dir: '/:Musica/:', file: 'a.aiff', newFile: 'a.wav' }
    const none: NmlPatch = { volume: 'Public', dir: '/:Musica/:', file: 'b.aiff', newFile: 'b.wav' }
    registry.register(
      entry('a', {
        places: new Set(['file', 'traktor']),
        traktorPatch: had,
        traktorStranded: true,
      }),
    )
    registry.register(entry('b', { places: new Set(['file', 'traktor']), traktorPatch: none }))
    registry.register(
      entry('c', {
        places: new Set(['file', 'traktor']),
        traktorPatch: { ...none, file: 'c.aiff' },
      }),
    )

    // The flush hands back patches that went through the queue's JSON: equal, not the same.
    const copy = (p: NmlPatch): NmlPatch => JSON.parse(JSON.stringify(p))
    await registry.afterFlush({
      ...written,
      traktor: {
        before: new Map([
          [traktorPatchKey(copy(had)), 'A.AIFF'],
          [traktorPatchKey(copy(none)), null],
        ]),
      },
    })

    expect(deps.readTraktor.mock.calls[0][0]).toEqual<TraktorExpect[]>([
      { patch: had, before: 'A.AIFF', stranded: true },
      { patch: none, before: null, stranded: false },
    ])
    expect(stateOf(registry.get('a'), 'traktor')).toBe('ok')
    expect(registry.get('b')).toEqual({ status: 'ok', checks: [ok('file', 'fileIdentical')] })
    // A patch the write said nothing about is not a track Traktor lacks: it is unknown.
    expect(registry.get('c')?.checks[1]).toEqual(unreadable('traktor', 'traktorUnreadable'))
  })

  it('a Traktor write that never happened is not read as if it had', async () => {
    const { deps, registry } = setup()
    const p: NmlPatch = { volume: 'Public', dir: '/:Musica/:', file: 'a.aiff', newFile: 'a.wav' }
    registry.register(entry('a', { places: new Set(['file', 'traktor']), traktorPatch: p }))
    registry.register(
      entry('b', { places: new Set(['file', 'traktor']), traktorPatch: { ...p, file: 'b.aiff' } }),
    )

    await registry.afterFlush({ ...written, traktor: 'failed' })
    expect(deps.readTraktor).not.toHaveBeenCalled()
    expect(registry.get('a')?.checks[1]).toEqual(unreadable('traktor', 'traktorUnreadable'))

    registry.register(
      entry('c', { places: new Set(['file', 'traktor']), traktorPatch: { ...p, file: 'c.aiff' } }),
    )
    await registry.afterFlush({ ...written, traktor: 'queued' })
    await registry.afterQueueApplied('traktor', 'failed')
    expect(deps.readTraktor).not.toHaveBeenCalled()
    expect(registry.get('c')?.checks[1]).toEqual(unreadable('traktor', 'traktorUnreadable'))
  })

  it('retry on an unreadable place re-reads only that place', async () => {
    const { deps, registry } = setup()
    deps.readRekordbox.mockResolvedValueOnce('unreadable')
    registry.register(
      entry('a', {
        places: new Set(['file', 'rekordbox', 'engine']),
        engine: { id: 1, quickCues: 'q', beatData: 'b', loops: 'l' },
      }),
    )
    await registry.afterFlush(written)
    deps.readEngine.mockClear()
    deps.emit.mockClear()

    expect(await registry.retry('a')).toBe('rechecked')

    expect(deps.readRekordbox).toHaveBeenCalledTimes(2)
    expect(deps.readRekordbox.mock.calls[1][0].map((e) => e.trackId)).toEqual(['a'])
    expect(deps.readEngine).not.toHaveBeenCalled()
    expect(deps.readFile).not.toHaveBeenCalled()
    expect(deps.requeue).not.toHaveBeenCalled()
    expect(deps.emit).toHaveBeenCalledWith('a', {
      status: 'ok',
      checks: [ok('file', 'fileIdentical'), libraryOk('rekordbox'), libraryOk('engine')],
      seq: 2,
    })
  })

  it('retry on a library mismatch re-enqueues that repoint and re-checks after apply', async () => {
    const { deps, registry } = setup()
    deps.readRekordbox.mockResolvedValueOnce([mismatch('rekordbox', 'rekordboxStillOld')])
    const a = entry('a')
    registry.register(a)
    await registry.afterFlush(written)

    expect(await registry.retry('a')).toBe('rechecked')

    expect(deps.requeue).toHaveBeenCalledWith('rekordbox', a)
    expect(deps.readFile).not.toHaveBeenCalled()
    expect(stateOf(registry.get('a'), 'rekordbox')).toBe('pending')
    expect(deps.readRekordbox).toHaveBeenCalledTimes(1)

    await registry.afterQueueApplied('rekordbox', 'written')

    expect(deps.readRekordbox).toHaveBeenCalledTimes(2)
    expect(registry.get('a')?.status).toBe('ok')
  })

  // Handing the repoint again moves cues a second time when the row already names the
  // file (a same-path reconversion): only a library still on the old file gets it again.
  it.each([
    ['rekordbox', 'rekordboxCuesLost'],
    ['engine', 'enginePerformanceChanged'],
    ['traktor', 'traktorMissing'],
  ] as const)('retry on a %s %s only re-reads it, never repoints again', async (place, key) => {
    const p: NmlPatch = { volume: 'HD', dir: '/:M/:', file: 'a.aiff', newFile: 'a.wav' }
    const { deps, registry } = setup()
    const read = {
      rekordbox: deps.readRekordbox,
      engine: deps.readEngine,
      traktor: deps.readTraktor,
    }[place]
    read.mockResolvedValueOnce([mismatch(place, key)])
    registry.register(
      entry('a', {
        places: new Set(['file', place]),
        engine: { id: 1, quickCues: 'q', beatData: 'b', loops: 'l' },
        traktorPatch: p,
      }),
    )
    await registry.afterFlush({
      ...written,
      traktor: { before: new Map([[traktorPatchKey(p), 'a.aiff']]) },
    })

    await registry.retry('a')

    expect(deps.requeue).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(2)
    expect(stateOf(registry.get('a'), place)).toBe('ok')
  })

  // A row found on the written path is never handed the repoint again, whatever it says:
  // from and to being the same file, the repoint would find it and move its cues twice.
  it('retry on a conversion written over its own path never repoints, only re-reads', async () => {
    const { deps, registry } = setup()
    deps.readRekordbox.mockResolvedValueOnce([mismatch('rekordbox', 'rekordboxStillOld')])
    registry.register(entry('a', { from: '/Music/a.wav', source: '/Music/a.wav' }))
    await registry.afterFlush(written)

    await registry.retry('a')

    expect(deps.requeue).not.toHaveBeenCalled()
    expect(deps.readRekordbox).toHaveBeenCalledTimes(2)
  })

  // The same file spelled twice (another case on a case-insensitive volume, a link) is
  // still the same file: the repoint would find the moved row by it.
  it('retry compares the paths as the libraries resolve them', async () => {
    const { deps, registry } = setup({
      samePath: vi.fn<NonNullable<VerifyRegistryDeps['samePath']>>(
        (a, b) => a.toLowerCase() === b.toLowerCase(),
      ),
    })
    deps.readRekordbox.mockResolvedValueOnce([mismatch('rekordbox', 'rekordboxStillOld')])
    registry.register(entry('a', { from: '/Music/A.WAV' }))
    await registry.afterFlush(written)

    await registry.retry('a')

    expect(deps.requeue).not.toHaveBeenCalled()
    expect(deps.samePath).toHaveBeenCalledWith('/Music/A.WAV', '/Music/a.wav')
  })

  // A batch that began while the last one was still flushing: each flush judges only the
  // tracks registered before its own batch ended, against what it did.
  it('overlapping batches: each flush judges only the tracks its batch registered', async () => {
    const { deps, registry } = setup()
    registry.register(entry('a'))
    const first = registry.cut()
    registry.register(entry('b'))

    await registry.afterFlush(written, first)
    expect(deps.readRekordbox.mock.calls.map(([list]) => list.map((e) => e.trackId))).toEqual([
      ['a'],
    ])
    expect(stateOf(registry.get('b'), 'rekordbox')).toBe('checking')

    await registry.afterFlush({ rekordbox: 'off', engine: 'off', traktor: 'off' })
    expect(stateOf(registry.get('a'), 'rekordbox')).toBe('ok')
    expect(stateOf(registry.get('b'), 'rekordbox')).toBeUndefined()
  })

  // A nested end took nothing: the end that takes the run's repoints judges its tracks.
  it('a flush that left a library for a later end keeps its tracks checking for it', async () => {
    const { deps, registry } = setup()
    registry.register(entry('a'))
    await registry.afterFlush({ rekordbox: 'later', engine: 'later', traktor: 'later' })
    expect(deps.readRekordbox).not.toHaveBeenCalled()
    expect(stateOf(registry.get('a'), 'rekordbox')).toBe('checking')

    await registry.afterFlush(written)
    expect(stateOf(registry.get('a'), 'rekordbox')).toBe('ok')
  })

  it('retry on a file or Music mismatch answers rerun-job while the source is still on disk', async () => {
    const { deps, registry } = setup()
    registry.register(
      entry('a', {
        verification: { status: 'mismatch', checks: [mismatch('file', 'filePcmDiffers')] },
        places: new Set(['file']),
      }),
    )
    registry.register(
      entry('m', {
        music: musicExpect,
        places: new Set(['file', 'appleMusic']),
        verification: {
          status: 'mismatch',
          checks: [ok('file', 'fileIdentical'), mismatch('appleMusic', 'musicMissing')],
        },
      }),
    )

    expect(await registry.retry('a')).toBe('rerun-job')
    expect(await registry.retry('m')).toBe('rerun-job')

    expect(deps.exists).toHaveBeenCalledWith('/Music/a.aiff')
    expect(deps.readFile).not.toHaveBeenCalled()
    expect(deps.readMusic).not.toHaveBeenCalled()
  })

  it('retry on a file mismatch after an in-place conversion only re-reads and answers rechecked', async () => {
    const { deps, registry } = setup()
    registry.register(
      entry('a', {
        from: '/Music/a.wav',
        source: '/Music/a.wav',
        to: '/Music/a.wav',
        places: new Set(['file']),
        verification: { status: 'mismatch', checks: [mismatch('file', 'filePcmDiffers')] },
      }),
    )

    expect(await registry.retry('a')).toBe('rechecked')

    expect(deps.readFile).toHaveBeenCalledTimes(1)
    expect(deps.readFile).toHaveBeenCalledWith(fileExpect('/Music/a.wav'))
    expect(registry.get('a')).toEqual({ status: 'ok', checks: [ok('file', 'fileIdentical')] })
  })

  // A swap converts one file and retires another: the copy the libraries followed is still
  // on disk, but the file converted in place is not, and only that one can be converted again.
  it('retry on a swap whose converted file is gone only re-reads', async () => {
    const { deps, registry } = setup({
      exists: vi.fn<VerifyRegistryDeps['exists']>(async (p) => p === '/Music/old.mp3'),
    })
    registry.register(
      entry('s', {
        from: '/Music/old.mp3',
        source: '/Music/s.flac',
        places: new Set(['file']),
        verification: { status: 'mismatch', checks: [mismatch('file', 'filePcmDiffers')] },
      }),
    )

    expect(await registry.retry('s')).toBe('rechecked')
    expect(deps.exists).toHaveBeenCalledWith('/Music/s.flac')
    expect(deps.readFile).toHaveBeenCalledTimes(1)
  })

  it('retry on a conversion written over its own source only re-reads', async () => {
    const { deps, registry } = setup()
    registry.register(
      entry('p', {
        from: '/Music/old.mp3',
        source: '/Music/p.wav',
        to: '/Music/p.wav',
        places: new Set(['file']),
        verification: { status: 'mismatch', checks: [mismatch('file', 'filePcmDiffers')] },
      }),
    )

    expect(await registry.retry('p')).toBe('rechecked')
    expect(deps.exists).not.toHaveBeenCalled()
  })

  // The Engine DJ destination writes its row during the job, not in the flush: it is
  // there to read whether the flush wrote Engine, queued it or had nothing for it.
  it.each(['off', 'queued', 'written'] as const)(
    'an Engine row the job wrote is read after a flush that was %s',
    async (engine) => {
      const { deps, registry } = setup()
      registry.register(
        entry('e', { places: new Set(['file', 'engine']), engine: 'absent', engineStep: true }),
      )

      await registry.afterFlush({ rekordbox: 'off', engine, traktor: 'off' })

      expect(deps.readEngine).toHaveBeenCalledWith([expect.objectContaining({ trackId: 'e' })])
      expect(registry.get('e')).toEqual({
        status: 'ok',
        checks: [ok('file', 'fileIdentical'), libraryOk('engine')],
      })
    },
  )

  it('retry when the source was deleted only re-reads', async () => {
    const { deps, registry } = setup({
      exists: vi.fn<VerifyRegistryDeps['exists']>(async () => false),
    })
    registry.register(
      entry('m', {
        music: musicExpect,
        places: new Set(['file', 'appleMusic']),
        verification: {
          status: 'mismatch',
          checks: [ok('file', 'fileIdentical'), mismatch('appleMusic', 'musicMissing')],
        },
      }),
    )

    expect(await registry.retry('m')).toBe('rechecked')

    expect(deps.readFile).toHaveBeenCalledTimes(1)
    expect(deps.readMusic).toHaveBeenCalledWith(musicExpect)
    expect(registry.get('m')?.status).toBe('ok')
  })

  it.each([
    [true, 1],
    [false, 0],
  ])(
    'a file still wrong after retry with the source gone carries fileSourceGone (Originals copy %s)',
    async (originalKept, kept) => {
      const { deps, registry } = setup({
        exists: vi.fn<VerifyRegistryDeps['exists']>(async () => false),
      })
      deps.readFile.mockResolvedValue(mismatch('file', 'filePcmDiffers'))
      registry.register(
        entry('a', {
          originalKept,
          places: new Set(['file']),
          verification: { status: 'mismatch', checks: [mismatch('file', 'filePcmDiffers')] },
        }),
      )

      await registry.retry('a')

      expect(registry.get('a')).toEqual({
        status: 'mismatch',
        checks: [
          { place: 'file', state: 'mismatch', detail: { key: 'fileSourceGone', params: { kept } } },
        ],
      })
      expect(deps.emit).toHaveBeenCalledWith('a', { ...registry.get('a'), seq: 1 })
    },
  )

  it('a library flush that failed reads unreadable and a failed queue apply never leaves it pending', async () => {
    const { deps, registry } = setup()
    registry.register(entry('a'))
    await registry.afterFlush({ ...written, rekordbox: 'failed' })
    expect(deps.readRekordbox).not.toHaveBeenCalled()
    expect(registry.get('a')?.checks[1]).toEqual(unreadable('rekordbox', 'rekordboxUnreadable'))

    registry.register(entry('b'))
    await registry.afterFlush({ ...written, rekordbox: 'queued' })
    await registry.afterQueueApplied('rekordbox', 'failed')
    expect(deps.readRekordbox).not.toHaveBeenCalled()
    expect(registry.get('b')?.checks[1]).toEqual(unreadable('rekordbox', 'rekordboxUnreadable'))
  })

  it('a reader that answers for another number of tracks marks them all unreadable', async () => {
    const { deps, registry } = setup()
    deps.readRekordbox.mockResolvedValueOnce([libraryOk('rekordbox')])
    registry.register(entry('a'))
    registry.register(entry('b'))

    await registry.afterFlush(written)

    expect(stateOf(registry.get('a'), 'rekordbox')).toBe('unreadable')
    expect(stateOf(registry.get('b'), 'rekordbox')).toBe('unreadable')
    expect(deps.emit).toHaveBeenCalledTimes(2)
  })

  it('a track registered twice in a batch is read once', async () => {
    const { deps, registry } = setup()
    const a = entry('a')
    registry.register(a)
    registry.register(a)
    registry.register(entry('a'))

    await registry.afterFlush(written)

    expect(deps.readRekordbox.mock.calls[0][0]).toHaveLength(1)
    expect(deps.emit).toHaveBeenCalledTimes(1)
  })

  it('a check that finishes after the track was converted again never lands on it', async () => {
    let finish: (v: PlaceCheck[]) => void = () => {}
    const { deps, registry } = setup()
    deps.readRekordbox.mockReturnValueOnce(new Promise((r) => (finish = r)))
    registry.register(entry('a'))
    const flushing = registry.afterFlush(written)
    const again = entry('a')
    registry.register(again)

    finish([mismatch('rekordbox', 'rekordboxStillOld')])
    await flushing

    expect(deps.emit).not.toHaveBeenCalled()
    expect(registry.get('a')).toBe(again.verification)
    expect(stateOf(registry.get('a'), 'rekordbox')).toBe('checking')
  })

  it('a queue apply does not re-read a track converted again since it was held', async () => {
    const { deps, registry } = setup()
    registry.register(entry('a'))
    await registry.afterFlush({ ...written, rekordbox: 'queued' })
    registry.register(entry('a'))
    await registry.afterFlush(written)
    deps.readRekordbox.mockClear()

    await registry.afterQueueApplied('rekordbox', 'written')

    expect(deps.readRekordbox).not.toHaveBeenCalled()
  })

  it('a track verified while the rest of its batch is still read is not forgotten before its emit', async () => {
    let finish: (v: PlaceCheck[]) => void = () => {}
    const { deps, registry } = setup()
    deps.readEngine.mockReturnValueOnce(new Promise((r) => (finish = r)))
    registry.register(entry('x'))
    registry.register(
      entry('y', {
        places: new Set(['file', 'engine']),
        engine: { id: 1, quickCues: 'q', beatData: 'b', loops: 'l' },
      }),
    )
    const flushing = registry.afterFlush(written)
    await new Promise((r) => setTimeout(r, 0))
    registry.register(entry('z'))

    finish([libraryOk('engine')])
    await flushing

    expect(deps.emit).toHaveBeenCalledWith('x', {
      status: 'ok',
      checks: [ok('file', 'fileIdentical'), libraryOk('rekordbox')],
      seq: 1,
    })
  })

  // A batch begun the moment the reads are in must not find the tracks done but not yet sent.
  it.each([0, 1, 2, 3, 4, 5, 6])(
    'a batch registered %i ticks after the reads land still lets the flush send its tracks',
    async (ticks) => {
      const { deps, registry } = setup()
      registry.register(entry('x'))
      deps.readRekordbox.mockImplementationOnce(async (list) => {
        let at: Promise<void> = Promise.resolve()
        for (let i = 0; i < ticks; i++) at = at.then(() => {})
        void at.then(() => registry.register(entry('z')))
        return list.map(() => libraryOk('rekordbox'))
      })

      await registry.afterFlush(written, 1)

      expect(deps.emit).toHaveBeenCalledWith('x', expect.objectContaining({ status: 'ok' }))
    },
  )

  it.each([0, 1, 2, 3, 4, 5, 6])(
    'a batch registered %i ticks after a queue apply reads lets it send its tracks',
    async (ticks) => {
      const { deps, registry } = setup()
      registry.register(entry('x'))
      await registry.afterFlush({ ...written, rekordbox: 'queued' })
      deps.readRekordbox.mockImplementationOnce(async (list) => {
        let at: Promise<void> = Promise.resolve()
        for (let i = 0; i < ticks; i++) at = at.then(() => {})
        void at.then(() => registry.register(entry('z')))
        return list.map(() => libraryOk('rekordbox'))
      })

      await registry.afterQueueApplied('rekordbox', 'written')

      expect(deps.emit).toHaveBeenLastCalledWith('x', expect.objectContaining({ status: 'ok' }))
    },
  )

  it('a retry that turns ok while Music is still read is not forgotten before its emit', async () => {
    let finish: (v: PlaceCheck) => void = () => {}
    const { deps, registry } = setup({
      exists: vi.fn<VerifyRegistryDeps['exists']>(async () => false),
    })
    deps.readMusic.mockReturnValueOnce(new Promise((r) => (finish = r)))
    const checks = [mismatch('file', 'filePcmDiffers'), ok('appleMusic', 'musicOne')]
    registry.register(
      entry('m', {
        music: musicExpect,
        places: new Set(['file', 'appleMusic']),
        verification: { status: 'mismatch', checks },
      }),
    )
    await registry.afterFlush(written)
    const retrying = registry.retry('m')
    await new Promise((r) => setTimeout(r, 0))
    registry.register(entry('n', { places: new Set(['file']) }))
    await registry.afterFlush(written)
    registry.register(entry('o', { places: new Set(['file']) }))

    finish(ok('appleMusic', 'musicOne'))
    await retrying

    expect(deps.emit).toHaveBeenLastCalledWith('m', {
      status: 'ok',
      checks: [ok('file', 'fileIdentical'), ok('appleMusic', 'musicOne')],
      seq: 2,
    })
  })

  it('a new batch forgets the tracks already verified and keeps the open ones', async () => {
    const { deps, registry } = setup()
    deps.readRekordbox.mockResolvedValueOnce([
      libraryOk('rekordbox'),
      mismatch('rekordbox', 'rekordboxStillOld'),
    ])
    registry.register(entry('done'))
    registry.register(entry('wrong'))
    await registry.afterFlush(written)
    registry.register(entry('held'))
    await registry.afterFlush({ ...written, rekordbox: 'queued' })

    registry.register(entry('next'))

    expect(registry.get('done')).toBeUndefined()
    expect(registry.get('wrong')?.status).toBe('mismatch')
    expect(registry.get('held')?.status).toBe('pending')
  })

  it('a queue apply landing while a retry re-reads the file is kept', async () => {
    let finish: (v: PlaceCheck) => void = () => {}
    const { deps, registry } = setup()
    deps.readFile.mockReturnValueOnce(new Promise((r) => (finish = r)))
    const verification = {
      status: 'mismatch' as const,
      checks: [mismatch('file', 'filePcmDiffers'), checking('rekordbox')],
    }
    registry.register(
      entry('a', {
        from: '/Music/a.wav',
        source: '/Music/a.wav',
        to: '/Music/a.wav',
        verification,
      }),
    )
    await registry.afterFlush({ ...written, rekordbox: 'queued' })

    const retrying = registry.retry('a')
    await registry.afterQueueApplied('rekordbox', 'written')
    finish(ok('file', 'fileIdentical'))
    await retrying

    expect(registry.get('a')).toEqual({
      status: 'ok',
      checks: [ok('file', 'fileIdentical'), libraryOk('rekordbox')],
    })
  })

  it('a repoint retried with the program closed reads checking, not waiting for it to close', async () => {
    const { deps, registry } = setup()
    deps.readRekordbox.mockResolvedValueOnce([mismatch('rekordbox', 'rekordboxStillOld')])
    deps.requeue.mockImplementation(() => {
      expect(stateOf(registry.get('a'), 'rekordbox')).toBe('pending')
      return false
    })
    registry.register(entry('a'))
    await registry.afterFlush(written)

    await registry.retry('a')
    expect(registry.get('a')?.checks[1]).toEqual(checking('rekordbox'))

    await registry.afterQueueApplied('rekordbox', 'written')
    expect(registry.get('a')?.status).toBe('ok')
  })

  it('retry on an unreadable Traktor re-reads with what the write matched', async () => {
    const { deps, registry } = setup()
    deps.readTraktor.mockResolvedValueOnce('unreadable')
    const p: NmlPatch = { volume: 'Public', dir: '/:Musica/:', file: 'a.aiff', newFile: 'a.wav' }
    registry.register(entry('a', { places: new Set(['file', 'traktor']), traktorPatch: p }))
    await registry.afterFlush({
      ...written,
      traktor: { before: new Map([[traktorPatchKey(p), 'a.aiff']]) },
    })

    await registry.retry('a')

    expect(deps.readTraktor.mock.calls[1][0]).toEqual([
      { patch: p, before: 'a.aiff', stranded: false },
    ])
    expect(stateOf(registry.get('a'), 'traktor')).toBe('ok')
  })

  // A refused write leaves the patches in the queue: the next apply writes them, and the
  // track held on them is read back then, against what that write matched.
  it('a Traktor apply refused with its patches still queued is re-checked when they land', async () => {
    const { deps, registry } = setup()
    const p: NmlPatch = { volume: 'Public', dir: '/:Musica/:', file: 'a.aiff', newFile: 'a.wav' }
    registry.register(entry('a', { places: new Set(['file', 'traktor']), traktorPatch: p }))
    await registry.afterFlush({ ...written, traktor: 'queued' })

    await registry.afterQueueApplied('traktor', 'failed', true)
    expect(registry.get('a')?.checks[1]).toEqual(unreadable('traktor', 'traktorUnreadable'))
    expect(deps.readTraktor).not.toHaveBeenCalled()

    await registry.afterQueueApplied('traktor', {
      before: new Map([[traktorPatchKey(p), 'a.aiff']]),
    })
    expect(deps.readTraktor.mock.calls[0][0]).toEqual([
      { patch: p, before: 'a.aiff', stranded: false },
    ])
    expect(stateOf(registry.get('a'), 'traktor')).toBe('ok')
  })

  it('a discarded Traktor queue leaves nothing to re-check', async () => {
    const { deps, registry } = setup()
    const p: NmlPatch = { volume: 'Public', dir: '/:Musica/:', file: 'a.aiff', newFile: 'a.wav' }
    registry.register(entry('a', { places: new Set(['file', 'traktor']), traktorPatch: p }))
    await registry.afterFlush({ ...written, traktor: 'queued' })

    await registry.afterQueueApplied('traktor', 'failed')
    await registry.afterQueueApplied('traktor', {
      before: new Map([[traktorPatchKey(p), 'a.aiff']]),
    })
    expect(deps.readTraktor).not.toHaveBeenCalled()
  })

  // A write that failed changed nothing: what the last one matched still holds, and a retry
  // reads with it instead of answering unreadable without looking.
  it('a failed Traktor write keeps what the last write matched for the retry', async () => {
    const { deps, registry } = setup()
    deps.readTraktor.mockResolvedValueOnce([mismatch('traktor', 'traktorStillOld')])
    const p: NmlPatch = { volume: 'Public', dir: '/:Musica/:', file: 'a.aiff', newFile: 'a.wav' }
    registry.register(entry('a', { places: new Set(['file', 'traktor']), traktorPatch: p }))
    await registry.afterFlush({
      ...written,
      traktor: { before: new Map([[traktorPatchKey(p), 'a.aiff']]) },
    })
    await registry.retry('a')
    await registry.afterQueueApplied('traktor', 'failed', true)
    expect(registry.get('a')?.checks[1]).toEqual(unreadable('traktor', 'traktorUnreadable'))

    await registry.retry('a')

    expect(deps.readTraktor).toHaveBeenCalledTimes(2)
    expect(deps.readTraktor.mock.calls[1][0]).toEqual([
      { patch: p, before: 'a.aiff', stranded: false },
    ])
    expect(stateOf(registry.get('a'), 'traktor')).toBe('ok')
  })

  // Never written, there is nothing to read against: the retry hands the patch again.
  it('retry on a Traktor patch never written hands it again instead of answering unreadable', async () => {
    const { deps, registry } = setup()
    const p: NmlPatch = { volume: 'Public', dir: '/:Musica/:', file: 'a.aiff', newFile: 'a.wav' }
    const a = entry('a', { places: new Set(['file', 'traktor']), traktorPatch: p })
    registry.register(a)
    await registry.afterFlush({ ...written, traktor: 'failed' })

    await registry.retry('a')

    expect(deps.requeue).toHaveBeenCalledWith('traktor', a)
    expect(stateOf(registry.get('a'), 'traktor')).toBe('pending')
    await registry.afterQueueApplied('traktor', {
      before: new Map([[traktorPatchKey(p), 'a.aiff']]),
    })
    expect(stateOf(registry.get('a'), 'traktor')).toBe('ok')
  })

  // The renderer applies an update only for the conversion it holds and only when it is newer
  // than what it has: the result came back as seq 0, so every later word must count up.
  it('every emit names its conversion and counts up across the flush, a queue apply and a retry', async () => {
    const { deps, registry } = setup()
    const checks = [ok('file', 'fileIdentical'), checking('rekordbox')]
    registry.register(
      entry('a', { verification: { status: 'checking', checks, job: 'job-1', seq: 0 } }),
    )
    deps.readRekordbox.mockResolvedValueOnce([mismatch('rekordbox', 'rekordboxStillOld')])
    await registry.afterFlush(written)
    await registry.retry('a')
    await registry.afterQueueApplied('rekordbox', 'written')

    const sent = deps.emit.mock.calls.map(([, v]) => [v.job, v.seq])
    expect(sent).toEqual([
      ['job-1', 1],
      ['job-1', 2],
      ['job-1', 3],
    ])
  })

  it('a conversion of the same track again counts its own updates from the start', async () => {
    const { deps, registry } = setup()
    const checks = [ok('file', 'fileIdentical'), checking('rekordbox')]
    deps.readRekordbox.mockResolvedValueOnce([mismatch('rekordbox', 'rekordboxStillOld')])
    registry.register(
      entry('a', { verification: { status: 'checking', checks, job: 'j1', seq: 0 } }),
    )
    await registry.afterFlush(written)
    registry.register(
      entry('a', { verification: { status: 'checking', checks, job: 'j2', seq: 0 } }),
    )
    await registry.afterFlush(written)

    expect(deps.emit.mock.calls.map(([, v]) => [v.job, v.seq])).toEqual([
      ['j1', 1],
      ['j2', 1],
    ])
  })

  // The job's add never reached Music and the DJ added it by hand: the amber line that said
  // so is answered by reading Music again for the entry the add made, not left standing.
  it('a manual Music add re-reads Music for the entry it made', async () => {
    const { deps, registry } = setup()
    const checks = [ok('file', 'fileIdentical'), mismatch('appleMusic', 'musicMissing')]
    registry.register(
      entry('a', {
        places: new Set(['file', 'appleMusic']),
        music: musicExpect,
        verification: { status: 'mismatch', checks, job: 'j', seq: 0 },
      }),
    )
    await registry.afterFlush(written)

    await registry.musicAdded('a', 'NEWPID')

    expect(deps.readMusic).toHaveBeenCalledWith({ ...musicExpect, pid: 'NEWPID' })
    expect(registry.get('a')?.status).toBe('ok')
    expect(deps.emit).toHaveBeenLastCalledWith('a', expect.objectContaining({ status: 'ok' }))
  })

  it('a manual Music add for a track never checked in Music reads nothing', async () => {
    const { deps, registry } = setup()
    registry.register(entry('a'))
    await registry.musicAdded('a', 'NEWPID')
    await registry.musicAdded('gone', 'NEWPID')
    expect(deps.readMusic).not.toHaveBeenCalled()
  })

  it('retry on a track it does not know rejects with an error key', async () => {
    const { registry } = setup()
    await expect(registry.retry('nope')).rejects.toThrow(/^SURCO_ERR:verifyUnknownTrack$/)
  })
})
