import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ActivityEvent } from '../shared/types'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const READS = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  READS.readFile.mockImplementation(actual.readFile)
  return { ...actual, readFile: READS.readFile }
})

const SETTINGS = vi.hoisted(() => ({
  syncRekordbox: true,
  rekordboxDbPath: '/c/master.db',
  syncEngineDj: false,
  engineLibraryDir: '',
  syncTraktor: false,
  traktorNmlPath: '',
  addToTraktor: false,
  addToEngineDj: false,
}))
const REPOINTS = vi.hoisted(() => [
  { from: '/m/a.mp3', to: '/m/a.flac', playlists: [{ name: 'House' }] },
])

vi.mock('./settings', () => ({ getSettings: () => SETTINGS }))
vi.mock('./rekordboxPath', () => ({ findRekordboxCollection: () => '/c/master.db' }))
const STATUS = vi.hoisted(() => ({
  rekordbox: { enabled: true, found: true },
  engine: { enabled: false, found: false },
  traktor: { enabled: false, found: false },
}))
vi.mock('./libraryStatus', () => ({ libraryStatus: () => STATUS }))
vi.mock('./rekordboxBatch', () => ({ endRekordboxBatch: () => REPOINTS }))
const WRITERS = vi.hoisted(() => ({
  trackOpsFromRun: vi.fn(async () => []),
  repointTracks: vi.fn(async () => [{ written: true }]),
  updateRekordboxTags: vi.fn(async () => [{ written: true }]),
  replaceRekordboxDuplicates: vi.fn(async () => [{ written: true, outcome: 'replaced' }]),
  repointEngineTracks: vi.fn(async () => [{ written: true, id: '1' }]),
}))
vi.mock('./engineRepoint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./engineRepoint')>()),
  repointEngineTracks: WRITERS.repointEngineTracks,
}))
vi.mock('./rekordboxQueueFromRun', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rekordboxQueueFromRun')>()),
  trackOpsFromRun: WRITERS.trackOpsFromRun,
}))
vi.mock('./rekordboxLibrary', () => ({ repointTracks: WRITERS.repointTracks }))
vi.mock('./rekordboxTags', () => ({ updateRekordboxTags: WRITERS.updateRekordboxTags }))
vi.mock('./rekordboxDuplicates', () => ({
  replaceRekordboxDuplicates: WRITERS.replaceRekordboxDuplicates,
}))

const FILE_USE = vi.hoisted(() => {
  const check = vi.fn(async (_path: string) => false)
  return { check, open: vi.fn(() => check) }
})
vi.mock('./libraryFileUse', () => ({ djLibraryFileUse: FILE_USE.open }))

const ENGINE_PROCESS = vi.hoisted(() => ({ isEngineDjRunning: vi.fn(async () => false) }))
vi.mock('./engineProcess', () => ENGINE_PROCESS)

import { activity } from './activity'
import { writeEngineLibraryFixture } from './enginePlaylistsFixture'
import {
  duplicateLibraryDeps,
  flushConversionBatch,
  type LibraryHost,
  repointEngineQueued,
  syncTagsInLibraries,
} from './libraryFlushes'

function host(overrides: Partial<LibraryHost> = {}): LibraryHost {
  return {
    ensureTraktorClosed: vi.fn(async () => true),
    ensureRekordboxClosed: vi.fn(async () => false),
    ensureEngineDjClosed: vi.fn(async () => true),
    showBlockedDialog: vi.fn(),
    reportIssue: vi.fn(),
    rekordboxHeld: () => false,
    ...overrides,
  }
}

const sessions = {
  rekordbox: {
    ensure: vi.fn(async () => {}),
    begin: vi.fn(),
    beginLoose: vi.fn(),
    failed: () => new Set<string>(),
  },
  engine: {
    ensure: vi.fn(async () => {}),
    begin: vi.fn(),
    beginLoose: vi.fn(),
    failed: () => new Set<string>(),
  },
}

describe('flushConversionBatch with rekordbox open', () => {
  it('queues the run instead of showing the blocked dialog, because the queue applies it later', async () => {
    const h = host()
    const queue = { enqueue: vi.fn(), applyQuietly: vi.fn() }
    await flushConversionBatch(h, sessions, queue)
    expect(h.showBlockedDialog).not.toHaveBeenCalled()
    expect(queue.enqueue).toHaveBeenCalledWith([], REPOINTS)
    expect(queue.applyQuietly).toHaveBeenCalled()
  })
})

describe('flushConversionBatch with master.db on an unplugged drive', () => {
  it('queues the repoints for when the drive is back instead of letting them go', async () => {
    Object.assign(SETTINGS, { rekordboxDbPath: '/Volumes/Surco Desconectado/master.db' })
    STATUS.rekordbox = { enabled: true, found: false }
    try {
      const queue = { enqueue: vi.fn(), applyQuietly: vi.fn() }
      await flushConversionBatch(host(), sessions, queue)
      expect(queue.enqueue).toHaveBeenCalledWith([], REPOINTS)
    } finally {
      Object.assign(SETTINGS, { rekordboxDbPath: '/c/master.db' })
      STATUS.rekordbox = { enabled: true, found: true }
    }
  })

  it('tells the DJ in Activity the changes land when the drive is connected', async () => {
    Object.assign(SETTINGS, { rekordboxDbPath: '/Volumes/Surco Desconectado/master.db' })
    STATUS.rekordbox = { enabled: true, found: false }
    const events: ActivityEvent[] = []
    const stop = activity.subscribe((event) => events.push(event))
    try {
      await flushConversionBatch(host(), sessions, { enqueue: vi.fn(), applyQuietly: vi.fn() })
    } finally {
      stop()
      Object.assign(SETTINGS, { rekordboxDbPath: '/c/master.db' })
      STATUS.rekordbox = { enabled: true, found: true }
    }
    expect(events).toContainEqual(
      expect.objectContaining({
        labelKey: 'activity.rekordboxSync',
        detailKey: 'activity.rekordboxCollectionUnplugged',
      }),
    )
  })
})

// Engine DJ abierto al acabar una conversión en su sitio: el aviso pedía volver a convertir,
// y el MP3 ya no existe. La biblioteca se queda en la cola y apunta al FLAC al cerrar Engine.
describe('flushConversionBatch with Engine DJ open', () => {
  async function withEngineOpen(running: () => Promise<boolean>, run: () => Promise<void>) {
    Object.assign(SETTINGS, { syncEngineDj: true, engineLibraryDir: '/e/Engine Library' })
    STATUS.engine = { enabled: true, found: true }
    ENGINE_PROCESS.isEngineDjRunning.mockImplementation(running)
    try {
      await run()
    } finally {
      ENGINE_PROCESS.isEngineDjRunning.mockImplementation(async () => false)
      Object.assign(SETTINGS, { syncEngineDj: false, engineLibraryDir: '' })
      STATUS.engine = { enabled: false, found: false }
    }
  }

  it('queues the repoints for when Engine DJ closes without asking to close it, since the queue applies them later', async () => {
    await withEngineOpen(
      async () => true,
      async () => {
        const h = host({ ensureEngineDjClosed: vi.fn(async () => false) })
        const engine = { enqueue: vi.fn(), applyQuietly: vi.fn() }
        await flushConversionBatch(
          h,
          sessions,
          { enqueue: vi.fn(), applyQuietly: vi.fn() },
          undefined,
          engine,
        )
        expect(h.ensureEngineDjClosed).not.toHaveBeenCalled()
        expect(h.showBlockedDialog).not.toHaveBeenCalledWith('engineSyncBlocked')
        expect(engine.enqueue).toHaveBeenCalledWith([], REPOINTS)
        expect(engine.applyQuietly).toHaveBeenCalled()
      },
    )
  })

  it('treats an unanswered check for Engine DJ as open and queues, because writing under a live Engine loses the library', async () => {
    await withEngineOpen(
      async () => {
        throw new Error('pgrep missing')
      },
      async () => {
        WRITERS.repointEngineTracks.mockClear()
        const h = host()
        const engine = { enqueue: vi.fn(), applyQuietly: vi.fn() }
        await flushConversionBatch(
          h,
          sessions,
          { enqueue: vi.fn(), applyQuietly: vi.fn() },
          undefined,
          engine,
        )
        expect(h.ensureEngineDjClosed).not.toHaveBeenCalled()
        expect(WRITERS.repointEngineTracks).not.toHaveBeenCalled()
        expect(engine.enqueue).toHaveBeenCalledWith([], REPOINTS)
      },
    )
  })

  it('still asks to close Engine DJ when there is no queue to leave the repoints in', async () => {
    await withEngineOpen(
      async () => true,
      async () => {
        const h = host({ ensureEngineDjClosed: vi.fn(async () => false) })
        await flushConversionBatch(h, sessions, { enqueue: vi.fn(), applyQuietly: vi.fn() })
        expect(h.ensureEngineDjClosed).toHaveBeenCalled()
      },
    )
  })

  it('queues the repoints while the Engine library is on an unplugged drive', async () => {
    Object.assign(SETTINGS, {
      syncEngineDj: true,
      engineLibraryDir: '/Volumes/Surco Desconectado/Engine Library',
    })
    try {
      const engine = { enqueue: vi.fn(), applyQuietly: vi.fn() }
      await flushConversionBatch(
        host(),
        sessions,
        { enqueue: vi.fn(), applyQuietly: vi.fn() },
        undefined,
        engine,
      )
      expect(engine.enqueue).toHaveBeenCalledWith([], REPOINTS)
    } finally {
      Object.assign(SETTINGS, { syncEngineDj: false, engineLibraryDir: '' })
    }
  })

  it('tells the DJ in Activity the Engine changes land when the drive is connected', async () => {
    Object.assign(SETTINGS, {
      syncEngineDj: true,
      engineLibraryDir: '/Volumes/Surco Desconectado/Engine Library',
    })
    const events: ActivityEvent[] = []
    const stop = activity.subscribe((event) => events.push(event))
    try {
      await flushConversionBatch(
        host(),
        sessions,
        { enqueue: vi.fn(), applyQuietly: vi.fn() },
        undefined,
        { enqueue: vi.fn(), applyQuietly: vi.fn() },
      )
    } finally {
      stop()
      Object.assign(SETTINGS, { syncEngineDj: false, engineLibraryDir: '' })
    }
    expect(events).toContainEqual(
      expect.objectContaining({
        labelKey: 'activity.engineSync',
        detailKey: 'activity.engineCollectionUnplugged',
      }),
    )
  })

  // La cola solo guarda los cambios cuando la razón es la suya de "app abierta". Con la de
  // Engine tal cual, un Engine abierto justo antes de escribir tiraba la cola entera.
  it('names Engine DJ being open the way the queue keeps waiting on', async () => {
    WRITERS.repointEngineTracks.mockResolvedValueOnce([
      { written: false, reason: 'engine-running' },
    ] as never)
    const results = await repointEngineQueued('/e/Engine Library', REPOINTS, sessions)
    expect(results).toEqual([{ written: false, reason: 'rekordbox-running' }])
  })
})

describe('rekordbox writes while the queue is held after a write left the collection unknown', () => {
  const held = () =>
    host({ ensureRekordboxClosed: vi.fn(async () => true), rekordboxHeld: () => true })

  it('keeps the conversion run in the queue instead of repointing, so master.db.surco-backup stays the good copy', async () => {
    WRITERS.repointTracks.mockClear()
    const queue = { enqueue: vi.fn(), applyQuietly: vi.fn() }
    await flushConversionBatch(held(), sessions, queue)
    expect(WRITERS.repointTracks).not.toHaveBeenCalled()
    expect(queue.enqueue).toHaveBeenCalledWith([], REPOINTS)
  })

  it('reads the run playlists by where each track came from, because its repoint waits in the queue', async () => {
    WRITERS.trackOpsFromRun.mockClear()
    await flushConversionBatch(held(), sessions, { enqueue: vi.fn(), applyQuietly: vi.fn() })
    expect(WRITERS.trackOpsFromRun).toHaveBeenCalledWith(
      '/c/master.db',
      REPOINTS,
      expect.objectContaining({ repointing: true }),
    )
  })

  it('does not write Update tags into the collection, so master.db.surco-backup stays the good copy', async () => {
    WRITERS.updateRekordboxTags.mockClear()
    await syncTagsInLibraries([{ path: '/m/a.flac', fields: {} }], held(), sessions)
    expect(WRITERS.updateRekordboxTags).not.toHaveBeenCalled()
  })

  it('still writes Update tags when the queue is not held', async () => {
    WRITERS.updateRekordboxTags.mockClear()
    await syncTagsInLibraries(
      [{ path: '/m/a.flac', fields: {} }],
      host({ ensureRekordboxClosed: vi.fn(async () => true) }),
      sessions,
    )
    expect(WRITERS.updateRekordboxTags).toHaveBeenCalled()
  })

  it('hands the duplicate writer the hold, and keeps rekordbox in the step so the removed copy is not trashed', async () => {
    WRITERS.replaceRekordboxDuplicates.mockClear()
    const deps = duplicateLibraryDeps(held(), sessions)
    await deps.libraries.rekordbox?.([{ from: '/m/a.mp3', to: '/m/b.mp3' }])
    const [, , options] = WRITERS.replaceRekordboxDuplicates.mock.calls[0] as unknown as [
      string,
      unknown,
      { held: () => boolean },
    ]
    expect(options.held()).toBe(true)
  })
})

describe('duplicateLibraryDeps', () => {
  // The check runs once per removed copy; opening the libraries afresh for each one
  // re-read Engine's database and the whole collection.nml every time.
  it('checks every removed copy against the libraries loaded once for the run', async () => {
    FILE_USE.open.mockClear()
    const deps = duplicateLibraryDeps(host(), sessions)
    await deps.usedByLibrary('/m/a.mp3')
    await deps.usedByLibrary('/m/b.mp3')
    expect(FILE_USE.open).toHaveBeenCalledTimes(1)
    expect(FILE_USE.check.mock.calls).toEqual([['/m/a.mp3'], ['/m/b.mp3']])
  })
})

// Los campos de playlists de Traktor y Engine DJ escriben por la cola de cada programa, que
// espera a que esté cerrado, tenga o no activado el reapuntado de esa biblioteca.
describe('flushConversionBatch with playlists chosen for Traktor and Engine DJ', () => {
  it('queues each library its own track ops and applies them quietly', async () => {
    Object.assign(REPOINTS[0], {
      traktorPlaylists: { wanted: [{ id: 'fri', name: 'Friday' }], base: [] },
      enginePlaylists: { wanted: [], base: ['7'] },
    })
    try {
      const traktor = {
        enqueue: vi.fn(),
        applyQuietly: vi.fn(),
        state: () => ({ tracks: 0, changes: 0, items: [] }),
      }
      const engine = { enqueue: vi.fn(), applyQuietly: vi.fn() }
      await flushConversionBatch(
        host(),
        sessions,
        { enqueue: vi.fn(), applyQuietly: vi.fn() },
        traktor,
        engine,
      )
      expect(traktor.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({
          kind: 'track',
          path: '/m/a.flac',
          from: '/m/a.mp3',
          wanted: [{ id: 'fri', name: 'Friday' }],
        }),
      ])
      expect(traktor.applyQuietly).toHaveBeenCalled()
      expect(engine.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({ kind: 'track', path: '/m/a.flac', known: ['7'] }),
      ])
      expect(engine.applyQuietly).toHaveBeenCalled()
    } finally {
      const first = REPOINTS[0] as Record<string, unknown>
      delete first.traktorPlaylists
      delete first.enginePlaylists
    }
  })
})

describe('flushConversionBatch with a converted track Traktor does not have', () => {
  const traktorQueue = () => ({
    enqueue: vi.fn(),
    applyQuietly: vi.fn(),
    state: () => ({ tracks: 0, changes: 0, items: [] }),
  })
  const flush = (traktor: ReturnType<typeof traktorQueue>) =>
    flushConversionBatch(host(), sessions, { enqueue: vi.fn(), applyQuietly: vi.fn() }, traktor)

  it('asks Traktor to register it when the DJ chose to add new tracks there', async () => {
    Object.assign(REPOINTS[0], { meta: { artist: 'Jaydee', title: 'Plastic Dreams' } })
    Object.assign(SETTINGS, { addToTraktor: true })
    try {
      const traktor = traktorQueue()
      await flush(traktor)
      expect(traktor.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({ kind: 'track', path: '/m/a.flac', add: true, wanted: [] }),
      ])
      expect(traktor.applyQuietly).toHaveBeenCalled()
    } finally {
      delete (REPOINTS[0] as Record<string, unknown>).meta
      Object.assign(SETTINGS, { addToTraktor: false })
    }
  })

  it('asks the Traktor collection which converted tracks it already has, so the queue does not promise adding one it holds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-flush-nml-'))
    const nmlPath = join(dir, 'collection.nml')
    await writeFile(
      nmlPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Plastic Dreams" ARTIST="Jaydee"><LOCATION DIR="/:m/:" FILE="a.flac" VOLUME="" VOLUMEID=""></LOCATION>
</ENTRY>
</COLLECTION>
<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="0"></SUBNODES>
</NODE>
</PLAYLISTS>
</NML>
`,
    )
    Object.assign(REPOINTS[0], { meta: { artist: 'Jaydee', title: 'Plastic Dreams' } })
    Object.assign(SETTINGS, { addToTraktor: true, traktorNmlPath: nmlPath })
    try {
      const traktor = traktorQueue()
      await flush(traktor)
      expect(traktor.enqueue).not.toHaveBeenCalled()
    } finally {
      delete (REPOINTS[0] as Record<string, unknown>).meta
      Object.assign(SETTINGS, { addToTraktor: false, traktorNmlPath: '' })
    }
  })

  it('counts a track Traktor has under the file it was converted from only while Traktor follows moves, since only then a repoint brings that entry over', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-flush-nml-'))
    const nmlPath = join(dir, 'collection.nml')
    await writeFile(
      nmlPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Plastic Dreams" ARTIST="Jaydee"><LOCATION DIR="/:m/:" FILE="a.mp3" VOLUME="" VOLUMEID=""></LOCATION>
</ENTRY>
</COLLECTION>
<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="0"></SUBNODES>
</NODE>
</PLAYLISTS>
</NML>
`,
    )
    Object.assign(REPOINTS[0], { meta: { artist: 'Jaydee', title: 'Plastic Dreams' } })
    Object.assign(SETTINGS, { addToTraktor: true, traktorNmlPath: nmlPath })
    try {
      const unsynced = traktorQueue()
      await flush(unsynced)
      expect(unsynced.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({ path: '/m/a.flac', add: true }),
      ])
      Object.assign(SETTINGS, { syncTraktor: true })
      const synced = traktorQueue()
      await flush(synced)
      expect(synced.enqueue).not.toHaveBeenCalledWith([
        expect.objectContaining({ path: '/m/a.flac', add: true }),
      ])
    } finally {
      delete (REPOINTS[0] as Record<string, unknown>).meta
      Object.assign(SETTINGS, { addToTraktor: false, traktorNmlPath: '', syncTraktor: false })
    }
  })

  it('does not read collection.nml when no converted track could be added, since a large collection costs every run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-flush-nml-'))
    const nmlPath = join(dir, 'collection.nml')
    await writeFile(nmlPath, '<NML VERSION="20"><COLLECTION ENTRIES="0"></COLLECTION></NML>')
    Object.assign(SETTINGS, { addToTraktor: true, traktorNmlPath: nmlPath })
    READS.readFile.mockClear()
    try {
      const traktor = traktorQueue()
      await flush(traktor)
      expect(READS.readFile).not.toHaveBeenCalledWith(nmlPath, expect.anything())
      expect(traktor.enqueue).not.toHaveBeenCalled()
    } finally {
      Object.assign(SETTINGS, { addToTraktor: false, traktorNmlPath: '' })
    }
  })

  it('leaves it out of Traktor when the DJ only updates the tracks already there', async () => {
    Object.assign(REPOINTS[0], { meta: { artist: 'Jaydee', title: 'Plastic Dreams' } })
    try {
      const traktor = traktorQueue()
      await flush(traktor)
      expect(traktor.enqueue).not.toHaveBeenCalled()
    } finally {
      delete (REPOINTS[0] as Record<string, unknown>).meta
    }
  })
})

describe('flushConversionBatch with a converted track Engine DJ does not have', () => {
  const engineQueue = () => ({ enqueue: vi.fn(), applyQuietly: vi.fn() })
  const flush = (engine: ReturnType<typeof engineQueue>) =>
    flushConversionBatch(
      host(),
      sessions,
      { enqueue: vi.fn(), applyQuietly: vi.fn() },
      undefined,
      engine,
    )
  async function engineLibrary(paths: string[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'surco-flush-engine-'))
    writeEngineLibraryFixture(dir, {
      tracks: paths.map((path, i) => ({ id: i + 1, path, title: `t${i}` })),
      playlists: [],
      entities: [],
    }).close()
    return dir
  }
  async function withRun(
    dir: string,
    addToEngineDj: boolean,
    run: (engine: ReturnType<typeof engineQueue>) => Promise<void>,
    syncEngineDj = false,
  ) {
    const saved = { from: REPOINTS[0].from, to: REPOINTS[0].to }
    Object.assign(REPOINTS[0], {
      from: join(dir, 'Music', 'a.mp3'),
      to: join(dir, 'Music', 'a.flac'),
      meta: { artist: 'Jaydee', title: 'Plastic Dreams' },
    })
    Object.assign(SETTINGS, { addToEngineDj, syncEngineDj, engineLibraryDir: dir })
    try {
      await run(engineQueue())
    } finally {
      Object.assign(REPOINTS[0], saved)
      delete (REPOINTS[0] as Record<string, unknown>).meta
      Object.assign(SETTINGS, { addToEngineDj: false, syncEngineDj: false, engineLibraryDir: '' })
    }
  }

  it('queues adding it to Engine DJ, so a track converted while Engine was open lands there once Engine closes', async () => {
    const dir = await engineLibrary(['Music/other.flac'])
    await withRun(dir, true, async (engine) => {
      await flush(engine)
      expect(engine.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({
          kind: 'track',
          path: join(dir, 'Music', 'a.flac'),
          add: true,
          wanted: [],
        }),
      ])
      expect(engine.applyQuietly).toHaveBeenCalled()
    })
  })

  it('asks the Engine library which converted tracks it already has, so a track the conversion registered is not queued again', async () => {
    const dir = await engineLibrary(['Music/a.flac'])
    await withRun(dir, true, async (engine) => {
      await flush(engine)
      expect(engine.enqueue).not.toHaveBeenCalled()
    })
  })

  it('counts a track Engine still has under the file it was converted from, since the repoint moves that row', async () => {
    const dir = await engineLibrary(['Music/a.mp3'])
    await withRun(
      dir,
      true,
      async (engine) => {
        await flush(engine)
        expect(engine.enqueue).not.toHaveBeenCalled()
      },
      true,
    )
  })

  it('still queues adding it when Engine only has the file it was converted from and the DJ keeps Engine from following moves, since no repoint will bring that row over', async () => {
    const dir = await engineLibrary(['Music/a.mp3'])
    await withRun(dir, true, async (engine) => {
      await flush(engine)
      expect(engine.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({ path: join(dir, 'Music', 'a.flac'), add: true }),
      ])
    })
  })

  it('does not read the Engine database when no converted track could be added, since a large library costs every run', async () => {
    const dir = await engineLibrary(['Music/other.flac'])
    await withRun(dir, true, async (engine) => {
      delete (REPOINTS[0] as Record<string, unknown>).meta
      READS.readFile.mockClear()
      await flush(engine)
      expect(READS.readFile).not.toHaveBeenCalledWith(join(dir, 'Database2', 'm.db'))
      expect(engine.enqueue).not.toHaveBeenCalled()
    })
  })

  it('leaves it out of Engine DJ when the DJ only updates the tracks already there', async () => {
    const dir = await engineLibrary(['Music/other.flac'])
    await withRun(dir, false, async (engine) => {
      await flush(engine)
      expect(engine.enqueue).not.toHaveBeenCalled()
    })
  })
})
