import { describe, expect, it, vi } from 'vitest'
import {
  type PlaceCheck,
  type Verification,
  type VerifyPlace,
  verificationStatus,
} from '../shared/verification'
import type { NmlPatch } from './traktorNml'
import type { FileExpect } from './verifyFile'
import type { MusicExpect } from './verifyMusic'
import { createVerifyRegistry, type VerifyEntry, type VerifyRegistryDeps } from './verifyRegistry'
import type { TraktorExpect } from './verifyTraktor'

const ok = (place: VerifyPlace, key = `${place}Ok`): PlaceCheck => ({
  place,
  state: 'ok',
  detail: { key },
})
const checking = (place: VerifyPlace): PlaceCheck => ({
  place,
  state: 'checking',
  detail: { key: 'checking' },
})
const mismatch = (place: VerifyPlace, key: string): PlaceCheck => ({
  place,
  state: 'mismatch',
  detail: { key },
})
const unreadable = (place: VerifyPlace, key: string): PlaceCheck => ({
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
    list.map(() => ok('rekordbox')),
  ),
  readEngine: vi.fn<VerifyRegistryDeps['readEngine']>(async (list) => list.map(() => ok('engine'))),
  readTraktor: vi.fn<VerifyRegistryDeps['readTraktor']>(async (list) =>
    list.map(() => ok('traktor')),
  ),
  readFile: vi.fn<VerifyRegistryDeps['readFile']>(async () => ok('file', 'fileIdentical')),
  readMusic: vi.fn<VerifyRegistryDeps['readMusic']>(async () => ok('appleMusic', 'musicOne')),
  requeue: vi.fn<VerifyRegistryDeps['requeue']>(),
  exists: vi.fn<VerifyRegistryDeps['exists']>(async () => true),
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
      checks: [ok('file', 'fileIdentical'), ok('rekordbox')],
    })
    expect(registry.get('b')).toEqual({
      status: 'ok',
      checks: [ok('file', 'fileIdentical'), ok('rekordbox'), ok('engine')],
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
    registry.register(entry('done'))
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

    await registry.afterQueueApplied('rekordbox')

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
        list.map((e) => (e.before === null ? null : ok('traktor'))),
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

    await registry.afterFlush({
      ...written,
      traktor: {
        before: new Map([
          [had, 'A.AIFF'],
          [none, null],
        ]),
      },
    })

    expect(deps.readTraktor.mock.calls[0][0]).toEqual<TraktorExpect[]>([
      { patch: had, before: 'A.AIFF', stranded: true },
      { patch: none, before: null, stranded: false },
    ])
    expect(stateOf(registry.get('a'), 'traktor')).toBe('ok')
    expect(registry.get('b')).toEqual({ status: 'ok', checks: [ok('file', 'fileIdentical')] })
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
      checks: [ok('file', 'fileIdentical'), ok('rekordbox'), ok('engine')],
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

    await registry.afterQueueApplied('rekordbox')

    expect(deps.readRekordbox).toHaveBeenCalledTimes(2)
    expect(registry.get('a')?.status).toBe('ok')
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
      expect(deps.emit).toHaveBeenCalledWith('a', registry.get('a'))
    },
  )

  it('retry on a track it does not know rejects with an error key', async () => {
    const { registry } = setup()
    await expect(registry.retry('nope')).rejects.toThrow('verifyUnknownTrack')
  })
})
