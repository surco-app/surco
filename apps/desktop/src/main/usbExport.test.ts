import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { UsbExportEvent, UsbExportRequest, UsbVolume } from '../shared/types'
import type { BakenEvent, BakenHandle } from './bakenRun'
import { createMenuT } from './i18n'
import { type MasterIdentity, STALE_STICK_FILES, syncFileText } from './rekordboxStickSync'
import {
  createUsbExporter,
  failureReason,
  sourceRoot,
  USB_QUIT_DETAIL,
  type UsbExporterDeps,
} from './usbExport'
import { createUsbMemory, type UsbMemory } from './usbExportMemory'
import type { ExportSelection, ExportTrack } from './usbExportSource'
import type { Stage } from './usbExportStage'

const UUID = 'B10C96EF-51C2-344E-B78D-DAFC319D973E'

function track(id: string, over: Partial<ExportTrack> = {}): ExportTrack {
  return {
    id,
    path: `/m/${id}.wav`,
    title: `T${id}`,
    artist: 'A',
    album: '',
    genre: '',
    label: '',
    remixer: '',
    composer: '',
    mix: '',
    key: '',
    fileType: 11,
    lengthSec: 1,
    bpm: 120,
    bitRate: 0,
    sampleRate: 44100,
    bitDepth: 16,
    rating: 0,
    year: 0,
    trackNo: 0,
    discNo: 0,
    dateAdded: '',
    playCount: 0,
    comment: '',
    analysisPath: '',
    imagePath: '',
    separator: false,
    streaming: false,
    cues: [],
    ...over,
  }
}

const SEL: ExportSelection = {
  playlists: [
    {
      id: '2000',
      name: 'Makina',
      folders: ['BASES'],
      folderIds: ['1000'],
      updatedAt: 0,
      trackIds: ['101', '109', '102', '103', '105'],
    },
  ],
  tracks: [
    track('101'),
    track('109', { separator: true, title: '' }),
    track('102', { bitDepth: 32, title: 'No Fear' }),
    track('103', { title: 'Gone' }),
    track('105', { streaming: true, title: 'Streamed' }),
  ],
}

const volume = (over: Partial<UsbVolume> = {}): UsbVolume => ({
  uuid: UUID,
  name: 'Surco',
  mountPoint: '/Volumes/Surco',
  filesystem: 'exfat',
  partitionScheme: 'mbr',
  totalBytes: 32e9,
  freeBytes: 20e9,
  holder: { by: 'empty', at: null },
  remembered: null,
  stickPlaylists: null,
  ...over,
})

const PLAN: BakenEvent = {
  event: 'plan',
  volumeRoot: true,
  tracks: [
    { id: 101, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70, onStick: false },
    { id: 109, usbPath: '/Contents/U/B/_.mp3', size: 5, onStick: true },
    { id: 102, usbPath: '/Contents/A/UnknownAlbum/102.wav', size: 30, onStick: true },
  ],
  spaceNeeded: 80,
  spaceAvailable: 1000,
  warnings: [],
  skipped: [],
  onelibraryFiles: [],
}
const REPORT: BakenEvent = {
  event: 'report',
  copied: 1,
  kept: 2,
  failures: [],
  cancelled: false,
  onelibraryWritten: true,
  onelibraryError: null,
  artwork: 3,
  pruned: 0,
  tracksInDatabase: 3,
}

type Emit = (e: BakenEvent) => void
// The fake baken: `dry` answers the dry run, `real` plays the export. `cancelled` resolves
// when Surco asks to cancel, as the stdin line does for the real one.
type Script = (emit: Emit, cancelled: Promise<void>) => Promise<void>

let memory: UsbMemory
let sent: UsbExportEvent[]
let calls: string[][]
let cancels: number
let logged: string[]
let removed: string[]
let writes: [string, string][]
// Bumped before each test: a baken run a test left behind (one that never awaited its
// finish, or a mutant that let a refused export run) keeps calling the harness after its
// test ended, and must not land in the next test's records.
let generation = 0

const IDENTITY: MasterIdentity = { dbId: 3942308644, myTagMasterDbId: 7, myTags: [], fileSizes: {} }

beforeEach(async () => {
  generation++
  memory = createUsbMemory(join(await mkdtemp(join(tmpdir(), 'usb-exp-')), 'usb-exports.json'))
  sent = []
  calls = []
  cancels = 0
  logged = []
  removed = []
  writes = []
})

const dryPlan: Script = async (emit) => emit(PLAN)

function deps(
  real: Script,
  over: Partial<UsbExporterDeps> & { dry?: Script; started?: boolean } = {},
): UsbExporterDeps {
  const { dry = dryPlan, started = true, ...rest } = over
  const mine = generation
  const live = (): boolean => mine === generation
  return {
    platform: 'darwin',
    collection: () => '/rb/master.db',
    readSelection: () => SEL,
    volumes: async () => [volume()],
    idAt: async () => UUID,
    devOf: async () => 42,
    realPath: async (p) => p,
    baken: () => ({ file: 'baken', prefixArgs: [] }),
    stage: async (_sel, dir): Promise<Stage> => ({
      dir,
      xml: `${dir}/c.xml`,
      anlzDir: `${dir}/USBANLZ`,
      artworkDir: `${dir}/art`,
      settingsDir: `${dir}/settings`,
      included: ['101', '109', '102'],
      missing: ['103'],
      sizes: new Map([
        ['101', 70],
        ['109', 5],
        ['102', 30],
      ]),
      waves: new Map([['101', [0.5]]]),
      covers: new Map(),
      masterIds: null,
    }),
    makeStageDir: async () => '/tmp/stage',
    removeDir: async () => {},
    memory,
    home: '/Users/dj',
    pioneerDir: '/Users/dj/Library/Pioneer',
    systemRoot: '/',
    send: (e) => {
      if (live()) sent.push(e)
    },
    now: () => 1000,
    fileSize: async () => 35,
    pdbFacts: async () => ({ size: 9, mtimeMs: 5 }),
    log: (m) => {
      if (live()) logged.push(m)
    },
    rekordboxRunning: async () => false,
    ensureRekordboxClosed: async () => true,
    exists: async () => true,
    readText: async () => null,
    writeAtomic: async (path, text) => {
      if (live()) writes.push([path, text])
    },
    removeFile: async (path) => {
      if (live()) removed.push(path)
    },
    identity: () => IDENTITY,
    masterPlaylistsXml: async () => null,
    pollMs: 2,
    devPollMs: 2,
    run: (_cmd, args, onEvent): BakenHandle => {
      if (live()) calls.push(args)
      let cancel: () => void = () => {}
      const cancelled = new Promise<void>((r) => {
        cancel = r
      })
      const script = args.includes('--dry-run') ? dry : real
      const done = script(onEvent, cancelled).then(() => ({
        code: started ? 0 : null,
        stderr: '',
        started,
      }))
      return {
        done,
        cancel: () => {
          if (live()) cancels++
          cancel()
        },
      }
    },
    ...rest,
  }
}

const REQ: UsbExportRequest = {
  playlistIds: ['1000'],
  target: { kind: 'volume', uuid: UUID },
  prune: false,
  settings: false,
}
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))
const finished = async () => {
  for (let i = 0; i < 200 && !sent.some((e) => e.type === 'finished'); i++) await tick(5)
  return sent.find((e) => e.type === 'finished')
}
const realCalls = () => calls.filter((a) => !a.includes('--dry-run'))

const happy: Script = async (emit) => {
  emit(PLAN)
  emit({ event: 'start', index: 0, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70 })
  await tick(20)
  emit({ event: 'written', index: 0, kept: false })
  emit({ event: 'start', index: 1, usbPath: '/Contents/U/B/_.mp3', size: 5 })
  emit({ event: 'written', index: 1, kept: true })
  emit({ event: 'start', index: 2, usbPath: '/Contents/A/UnknownAlbum/102.wav', size: 30 })
  emit({ event: 'written', index: 2, kept: true })
  emit({ event: 'database' })
  emit(REPORT)
}

describe('plan', () => {
  it('asks baken for a dry run and summarises what it would copy, separators not counted', async () => {
    const r = await createUsbExporter(deps(async () => {})).plan(REQ)
    expect(calls[0]).toContain('--dry-run')
    if (!r.ok) throw new Error(r.reason)
    expect(r.plan).toMatchObject({ trackCount: 2, newCount: 1, newBytes: 70, keptCount: 1 })
    expect(r.plan.tracks.map((t) => [t.id, t.onStick, t.wave])).toEqual([
      ['101', false, [0.5]],
      ['109', true, null],
      ['102', true, null],
    ])
  })

  // Each track that cannot go is named with its reason; baken's own skip reason is English,
  // so it goes to the log and the UI gets a code.
  it('warns about what the players will not read and lists what cannot be exported', async () => {
    const dry: Script = async (emit) =>
      emit({ ...PLAN, skipped: [{ name: 'Odd One', reason: 'unknown Kind' }] } as BakenEvent)
    const ex = createUsbExporter(
      deps(async () => {}, {
        dry,
        volumes: async () => [
          volume({ holder: { by: 'rekordbox', at: 1 }, partitionScheme: 'gpt' }),
        ],
      }),
    )
    const r = await ex.plan(REQ)
    if (!r.ok) throw new Error(r.reason)
    expect(r.plan.warnings).toEqual([
      { kind: 'rekordboxExport' },
      { kind: 'exfat' },
      { kind: 'gpt' },
      { kind: 'cdj2000', titles: ['No Fear'] },
      {
        kind: 'unexportable',
        tracks: [
          { title: 'Gone', reason: 'missing-file' },
          { title: 'Streamed', reason: 'streaming' },
          { title: 'Odd One', reason: 'skipped' },
        ],
      },
    ])
    expect(logged.join('\n')).toContain('unknown Kind')
  })

  it('warns about NTFS, which the players do not read', async () => {
    const r = await createUsbExporter(
      deps(async () => {}, { volumes: async () => [volume({ filesystem: 'ntfs' })] }),
    ).plan(REQ)
    expect(r.ok && r.plan.warnings).toContainEqual({ kind: 'ntfs' })
  })

  // baken refuses the plan outright when it does not fit; the summary still has to say what
  // was asked for, how much it needs and how much there is.
  it('still summarises when the stick is too small', async () => {
    const dry: Script = async (emit) =>
      emit({ event: 'error', kind: 'not-enough-space', message: 'no', needed: 10, available: 4 })
    const r = await createUsbExporter(deps(async () => {}, { dry })).plan(REQ)
    if (!r.ok) throw new Error(r.reason)
    expect(r.plan.newCount).toBe(2)
    expect(r.plan.warnings).toContainEqual({ kind: 'noSpace', neededBytes: 10, freeBytes: 4 })
  })

  it('counts what left the stick since Surco last wrote it', async () => {
    memory.remember(`volume:${UUID}`, {
      playlistIds: ['1000'],
      trackIds: ['101', '999'],
      at: 1,
      pdb: null,
      prune: false,
      settings: false,
    })
    const ex = createUsbExporter(
      deps(async () => {}, { volumes: async () => [volume({ holder: { by: 'surco', at: 1 } })] }),
    )
    const r = await ex.plan(REQ)
    expect(r.ok && r.plan.removedSinceLast).toBe(1)
  })

  it('answers why when it cannot summarise', async () => {
    const none = async () => {}
    expect(await createUsbExporter(deps(none)).plan({ ...REQ, playlistIds: [] })).toEqual({
      ok: false,
      reason: 'nothing-selected',
    })
    expect(await createUsbExporter(deps(none, { collection: () => '' })).plan(REQ)).toEqual({
      ok: false,
      reason: 'no-collection',
    })
    expect(
      await createUsbExporter(deps(none, { readSelection: () => 'unreadable' })).plan(REQ),
    ).toEqual({ ok: false, reason: 'unreadable' })
    expect(await createUsbExporter(deps(none, { volumes: async () => [] })).plan(REQ)).toEqual({
      ok: false,
      reason: 'volume-gone',
    })
    expect(await createUsbExporter(deps(none, { baken: () => null })).plan(REQ)).toEqual({
      ok: false,
      reason: 'no-baken',
    })
  })

  // "Otro destino" must be on a removable volume; a folder of the system disk is refused,
  // and a folder below a stick's root only warns.
  it('refuses a folder that is not on a removable volume, and warns below the root', async () => {
    const folder = (path: string): UsbExportRequest => ({
      ...REQ,
      target: { kind: 'folder', path },
    })
    const ex = createUsbExporter(
      deps(async () => {}, {
        dry: async (emit) => emit({ ...PLAN, volumeRoot: false } as BakenEvent),
      }),
    )
    expect(await ex.plan(folder('/Users/dj/Music/usb'))).toEqual({
      ok: false,
      reason: 'not-removable',
    })
    const r = await ex.plan(folder('/Volumes/Surco/sets'))
    expect(r.ok && r.plan.warnings).toContainEqual({ kind: 'notVolumeRoot' })
  })
})

describe('staging', () => {
  // The stage looks for the stick's own PIONEER/DEVSETTING.DAT under this root so the
  // staged My Settings never overwrite it: it has to be where baken will write.
  it('stages against the root baken will write, the real folder for a folder target', async () => {
    const roots: string[] = []
    const base = deps(async () => {}, {
      realPath: async (p) => (p === '/Volumes/surco/sets' ? '/Volumes/Surco/sets' : p),
    })
    const ex = createUsbExporter({
      ...base,
      stage: (sel, dir, root, stick) => {
        roots.push(root)
        return base.stage(sel, dir, root, stick)
      },
    })
    await ex.plan(REQ)
    await ex.plan({ ...REQ, target: { kind: 'folder', path: '/Volumes/surco/sets' } })
    expect(roots).toEqual(['/Volumes/Surco', '/Volumes/Surco/sets'])
  })

  // A failure while staging must reach the renderer as a code, not as an English
  // exception through IPC, and must not leave the work folder in tmp.
  it('answers with a code and removes the work folder when staging fails', async () => {
    const removed: string[] = []
    const ex = createUsbExporter(
      deps(async () => {}, {
        stage: async () => {
          throw new Error('EACCES: permission denied')
        },
        removeDir: async (dir) => {
          removed.push(dir)
        },
      }),
    )
    expect(await ex.plan(REQ)).toEqual({ ok: false, reason: 'baken-failed' })
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'baken-failed' })
    expect(removed).toEqual(['/tmp/stage', '/tmp/stage'])
    expect(calls).toEqual([])
    expect(logged.join('\n')).toContain('EACCES')
  })
})

describe('start', () => {
  // The mount point names whatever is mounted there now; a different stick there must get
  // nothing written, not even a started baken.
  it('writes nothing when another stick sits at the mount point', async () => {
    const ex = createUsbExporter(deps(happy, { idAt: async () => 'OTHER' }))
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'volume-changed' })
    expect(calls).toEqual([])
  })

  // The dry run takes seconds; a stick swapped meanwhile must not get the real run.
  it('asks again who is at the mount point right before the real run', async () => {
    let asked = 0
    const swapped = createUsbExporter(
      deps(happy, { idAt: async () => (asked++ === 0 ? UUID : 'OTHER') }),
    )
    expect(await swapped.start(REQ)).toEqual({ ok: false, reason: 'volume-changed' })
    expect(realCalls()).toEqual([])
    let looked = 0
    const remounted = createUsbExporter(
      deps(happy, { devOf: async () => (looked++ === 0 ? 42 : 7) }),
    )
    expect(await remounted.start(REQ)).toEqual({ ok: false, reason: 'volume-gone' })
    expect(realCalls()).toEqual([])
  })

  // Two presses before the first await returns: one baken, one export.
  it('runs one export even when asked twice at once', async () => {
    const ex = createUsbExporter(deps(happy))
    const [a, b] = await Promise.all([ex.start(REQ), ex.start(REQ)])
    expect([a, b]).toContainEqual({ ok: false, reason: 'busy' })
    expect([a, b]).toContainEqual({ ok: true })
    await finished()
    expect(realCalls()).toHaveLength(1)
  })

  it('releases the claim when it cannot start, so the next try runs', async () => {
    let other = true
    const ex = createUsbExporter(deps(happy, { idAt: async () => (other ? 'OTHER' : UUID) }))
    expect((await ex.start(REQ)).ok).toBe(false)
    other = false
    expect(await ex.start(REQ)).toEqual({ ok: true })
    await finished()
  })

  // The space check runs before any write, with the numbers for the message.
  it('refuses before writing when it does not fit', async () => {
    const dry: Script = async (emit) =>
      emit({ ...PLAN, spaceNeeded: 3_100, spaceAvailable: 1_700 } as BakenEvent)
    const ex = createUsbExporter(deps(happy, { dry }))
    expect(await ex.start(REQ)).toEqual({
      ok: false,
      reason: 'no-space',
      neededBytes: 3_100,
      freeBytes: 1_700,
    })
    expect(realCalls()).toEqual([])
  })

  // A stick mounted somewhere below its own root would get an unreadable library.
  it('refuses a volume target that is not a volume root', async () => {
    const dry: Script = async (emit) => emit({ ...PLAN, volumeRoot: false } as BakenEvent)
    expect(await createUsbExporter(deps(happy, { dry })).start(REQ)).toEqual({
      ok: false,
      reason: 'not-volume-root',
    })
  })

  it('never prunes a folder target, even when asked', async () => {
    const ex = createUsbExporter(deps(happy))
    await ex.start({ ...REQ, prune: true, target: { kind: 'folder', path: '/Volumes/Surco/sets' } })
    await finished()
    expect(realCalls()[0]).not.toContain('--prune')
  })

  it('passes My Settings only when asked', async () => {
    const ex = createUsbExporter(deps(happy))
    await ex.start(REQ)
    await finished()
    expect(realCalls()[0]).toContain('--no-settings')
  })

  it('tells the renderer each track as it lands, then done, and remembers the stick', async () => {
    const ex = createUsbExporter(deps(happy))
    expect(await ex.start({ ...REQ, settings: true })).toEqual({ ok: true })
    // three tracks in the database, the separator not counted
    expect(await finished()).toEqual({
      type: 'finished',
      outcome: 'done',
      tracks: 2,
      failed: 0,
      ms: 0,
      syncFiles: true,
    })
    const types = sent
      .filter((e) => e.type !== 'progress')
      .map((e) => (e.type === 'track' ? `${e.index} ${e.state}` : e.type))
    expect(types).toEqual(['started', '0 done', '1 kept', '2 kept', 'database', 'finished'])
    expect(memory.get(`volume:${UUID}`)).toMatchObject({
      playlistIds: ['1000'],
      trackIds: ['101', '109', '102'],
      pdb: { size: 9, mtimeMs: 5 },
      settings: true,
    })
    expect(memory.last()).toBe(`volume:${UUID}`)
  })

  // The row of the track being copied fills as its bytes land; tracks already on the stick
  // are not polled, and nothing about a track arrives after it is done.
  it('polls the bytes of the track being copied, and only that one', async () => {
    const ex = createUsbExporter(deps(happy))
    await ex.start(REQ)
    await finished()
    const progress = sent.filter((e) => e.type === 'progress')
    expect(progress.some((e) => e.type === 'progress' && e.index === 0 && e.bytes === 35)).toBe(
      true,
    )
    expect(progress.some((e) => e.type === 'progress' && e.index > 0 && e.bytes > 0)).toBe(false)
    const doneAt = sent.findIndex((e) => e.type === 'track' && e.index === 0)
    expect(sent.slice(doneAt).some((e) => e.type === 'progress' && e.index === 0)).toBe(false)
  })

  // baken's failure text is English: the row gets a code, the log gets the text.
  it('maps a failed track to a reason code and logs the raw text', async () => {
    const ex = createUsbExporter(
      deps(async (emit) => {
        emit(PLAN)
        emit({ event: 'failed', index: 0, message: 'No such file or directory (os error 2)' })
        emit({
          ...REPORT,
          failures: [{ name: 'T101', message: 'No such file or directory (os error 2)' }],
        } as BakenEvent)
      }),
    )
    await ex.start(REQ)
    await finished()
    expect(sent).toContainEqual({ type: 'failed', index: 0, reason: 'missing-file' })
    expect(logged.join('\n')).toContain('os error 2')
    expect(failureReason('Cannot write to the stick: /Volumes/Surco: Read-only file system')).toBe(
      'device',
    )
    expect(failureReason('could not decode the FLAC frames')).toBe('unreadable')
  })

  // Cancel is a request: baken finishes the track it copies and reports. Surco waits; it
  // never kills it, which could truncate audio the previous library references.
  it('asks baken to cancel and waits for its report', async () => {
    const ex = createUsbExporter(
      deps(async (emit, cancelled) => {
        emit(PLAN)
        emit({ event: 'start', index: 0, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70 })
        await cancelled
        emit({ event: 'written', index: 0, kept: false })
        emit({ ...REPORT, cancelled: true } as BakenEvent)
      }),
    )
    await ex.start(REQ)
    await tick()
    expect(ex.cancel()).toBe(true)
    expect(cancels).toBe(1)
    expect(sent).toContainEqual({ type: 'cancelling' })
    expect(await finished()).toEqual({ type: 'finished', outcome: 'cancelled' })
    expect(memory.get(`volume:${UUID}`)).toBeNull()
  })

  // Between export.pdb and exportLibrary.db a stop would leave two different libraries.
  it('does not cancel once the database is being written', async () => {
    const ex = createUsbExporter(
      deps(async (emit) => {
        emit(PLAN)
        emit({ event: 'database' })
        await tick(30)
        emit(REPORT)
      }),
    )
    await ex.start(REQ)
    await tick()
    expect(ex.cancel()).toBe(false)
    expect(cancels).toBe(0)
    expect((await finished())?.type).toBe('finished')
  })

  // Another stick taking the same mount point or drive letter mid-run changes the device
  // number: the export stops at the next track and says the stick went away.
  it('cancels when the volume under the target changes', async () => {
    let dev = 42
    const ex = createUsbExporter(
      deps(
        async (emit, cancelled) => {
          emit(PLAN)
          emit({ event: 'start', index: 0, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70 })
          dev = 7
          await cancelled
          emit({ ...REPORT, cancelled: true } as BakenEvent)
        },
        { devOf: async () => dev },
      ),
    )
    await ex.start(REQ)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'volume-gone' })
    expect(cancels).toBe(1)
  })

  // The cancel lands too late to stop the last track, so baken finishes; but what it wrote
  // may have gone to another stick. Never remember it as this stick's export.
  it('reports the volume lost, not done, when it changed during the last track', async () => {
    let dev = 42
    const ex = createUsbExporter(
      deps(
        async (emit) => {
          emit(PLAN)
          emit({ event: 'start', index: 2, usbPath: '/Contents/A/UnknownAlbum/102.wav', size: 30 })
          dev = 7
          await tick(20)
          emit({ event: 'written', index: 2, kept: false })
          emit({ event: 'database' })
          emit(REPORT)
        },
        { devOf: async () => dev },
      ),
    )
    await ex.start(REQ)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'volume-gone' })
    expect(memory.get(`volume:${UUID}`)).toBeNull()
  })

  // The renderer greys Cancel and shows "stopping" the same way whoever asked; a press of
  // Cancel after that asks baken nothing more.
  it('says it is stopping when the stick changes, as for a user cancel', async () => {
    let dev = 42
    const ex = createUsbExporter(
      deps(
        async (emit, cancelled) => {
          emit(PLAN)
          emit({ event: 'start', index: 0, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70 })
          dev = 7
          await cancelled
          await tick(20)
          emit({ ...REPORT, cancelled: true } as BakenEvent)
        },
        { devOf: async () => dev },
      ),
    )
    await ex.start(REQ)
    for (let i = 0; i < 100 && cancels === 0; i++) await tick(2)
    expect(sent).toContainEqual({ type: 'cancelling' })
    expect(ex.cancel()).toBe(false)
    expect(cancels).toBe(1)
    await finished()
  })

  // A cancel that lands during the last track is too late for baken to stop: the stick has
  // the whole export, so it is done and remembered (the ledger's rule).
  it('treats a report that was not cancelled as done even after a cancel', async () => {
    const ex = createUsbExporter(
      deps(async (emit, cancelled) => {
        emit(PLAN)
        emit({ event: 'start', index: 2, usbPath: '/Contents/A/UnknownAlbum/102.wav', size: 30 })
        await cancelled
        emit({ event: 'written', index: 2, kept: false })
        emit({ event: 'database' })
        emit(REPORT)
      }),
    )
    await ex.start(REQ)
    await tick()
    expect(ex.cancel()).toBe(true)
    expect((await finished()) as UsbExportEvent).toMatchObject({
      type: 'finished',
      outcome: 'done',
    })
    expect(memory.get(`volume:${UUID}`)).not.toBeNull()
  })

  it('says the stick went away when it was unplugged mid-export', async () => {
    let mounted = true
    const ex = createUsbExporter(
      deps(
        async (emit) => {
          emit(PLAN)
          mounted = false
          emit({ event: 'error', kind: 'device-write', message: 'gone' })
        },
        { volumes: async () => (mounted ? [volume()] : []) },
      ),
    )
    await ex.start(REQ)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'volume-gone' })
  })

  it('maps a full stick, a baken that never starts, and an unknown failure', async () => {
    const full = createUsbExporter(
      deps(async (emit) => {
        emit(PLAN)
        emit({ event: 'error', kind: 'not-enough-space', message: '' })
      }),
    )
    await full.start(REQ)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'no-space' })
    sent = []
    const never = createUsbExporter(deps(async () => {}, { started: false, dry: async () => {} }))
    expect(await never.start(REQ)).toEqual({ ok: false, reason: 'no-baken' })
    const silent = createUsbExporter(deps(async () => {}))
    await silent.start(REQ)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'baken-failed' })
  })
})

describe('Windows paths', () => {
  // Same rules with a drive letter: the identifier is the volume GUID, the root E:\.
  it('exports to a drive root by its volume GUID', async () => {
    const guid = '{6f1c2a7e-3b4d-11f0-9c2a-806e6f6e6963}'
    const ex = createUsbExporter(
      deps(
        async (emit) => {
          emit(PLAN)
          emit(REPORT)
        },
        {
          platform: 'win32',
          volumes: async () => [volume({ uuid: guid, mountPoint: 'E:\\', filesystem: 'fat32' })],
          idAt: async (root) => (root === 'E:\\' ? guid : null),
          home: 'C:\\Users\\dj',
          pioneerDir: 'C:\\Users\\dj\\AppData\\Roaming\\Pioneer',
          systemRoot: 'C:\\',
        },
      ),
    )
    expect(await ex.start({ ...REQ, target: { kind: 'volume', uuid: guid } })).toEqual({ ok: true })
    expect((await finished())?.type).toBe('finished')
    expect(realCalls()[0]).toContain('E:\\')
  })
})

describe('sharing the stick with rekordbox', () => {
  const STICK_DIR = '/Volumes/Surco/PIONEER/rekordbox'
  // rekordbox 7.2.19's own playlists3.sync on the test stick (18/10): BASES 1, Makina 2.
  const REKORDBOX_SYNC = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '',
    '<Sync DBID="-352658652" AutomaticSync="1" AllPlaylists="0" IncludeCue="1" ForcedSync="0" Timestamp="0">',
    '  <Playlists>',
    '    <NODE Id="0" ParentId="0" Attribute="1" Lib_Type="0" Dev_ID="0" Timestamp="0" CheckType="2"/>',
    '    <NODE Id="5387A1B7" ParentId="0" Attribute="1" Lib_Type="0" Dev_ID="1" Timestamp="1787178676095" CheckType="2"/>',
    '    <NODE Id="EC5D6B62" ParentId="5387A1B7" Attribute="0" Lib_Type="0" Dev_ID="2" Timestamp="1792349372735" CheckType="1"/>',
    '  </Playlists>',
    '</Sync>',
    '',
  ].join('\r\n')
  const onPublic: ExportSelection = {
    playlists: SEL.playlists,
    tracks: [
      track('101', { path: '/Volumes/Public/Musica/101.wav' }),
      track('109', { separator: true, title: '', path: '/Users/dj/Music/PioneerDJ/sep.mp3' }),
      track('102', { path: '/Volumes/Public/Musica/102.wav' }),
      track('103', { path: '/Users/dj/Music/103.wav' }),
      track('105', { streaming: true }),
    ],
  }

  // rekordbox holds master.db and rewrites the stick's .sync files while it runs: an export
  // underneath it could be overwritten or mixed with its own. Cancel in the dialog must
  // leave the stick exactly as it was.
  it('asks to close rekordbox before writing and writes nothing if it stays open', async () => {
    let asked = 0
    const ex = createUsbExporter(
      deps(happy, {
        rekordboxRunning: async () => true,
        ensureRekordboxClosed: async () => {
          asked++
          return false
        },
      }),
    )
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'rekordbox-open' })
    expect(asked).toBe(1)
    expect(calls).toEqual([])
    expect(removed).toEqual([])
    expect(ex.busy()).toBe(false)
  })

  it('exports once rekordbox is closed through the dialog', async () => {
    const ex = createUsbExporter(deps(happy, { rekordboxRunning: async () => true }))
    expect(await ex.start(REQ)).toEqual({ ok: true })
    expect((await finished()) as UsbExportEvent).toMatchObject({ outcome: 'done' })
  })

  // The summary only reads, so it works with rekordbox open and never closes it; it says
  // the export will ask.
  it('plans with rekordbox open and says so', async () => {
    let asked = 0
    const r = await createUsbExporter(
      deps(happy, {
        rekordboxRunning: async () => true,
        ensureRekordboxClosed: async () => {
          asked++
          return true
        },
      }),
    ).plan(REQ)
    expect(asked).toBe(0)
    expect(r.ok && r.plan.warnings).toContainEqual({ kind: 'rekordboxOpen' })
  })

  // A NAS or disk that is not mounted makes every one of its tracks "missing": the stick
  // would lose them all. Better to stop and name the volume to mount.
  it("refuses when the music's volume is not mounted", async () => {
    const asked: string[] = []
    const ex = createUsbExporter(
      deps(happy, {
        readSelection: () => onPublic,
        exists: async (p) => {
          asked.push(p)
          return p !== '/Volumes/Public'
        },
      }),
    )
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'sources-unreachable' })
    expect(calls).toEqual([])
    const r = await ex.plan(REQ)
    expect(r.ok && r.plan.warnings).toContainEqual({
      kind: 'sourcesUnreachable',
      volume: 'Public',
      tracks: 2,
    })
    // The system disk is always there: never asked, never blamed.
    expect(asked.every((p) => p === '/Volumes/Public')).toBe(true)
  })

  it("refuses on Windows when the music's drive is not there", async () => {
    const guid = '{6f1c2a7e-3b4d-11f0-9c2a-806e6f6e6963}'
    const ex = createUsbExporter(
      deps(happy, {
        platform: 'win32',
        volumes: async () => [volume({ uuid: guid, mountPoint: 'F:\\', filesystem: 'fat32' })],
        idAt: async () => guid,
        home: 'C:\\Users\\dj',
        pioneerDir: 'C:\\Users\\dj\\AppData\\Roaming\\Pioneer',
        systemRoot: 'C:\\',
        readSelection: () => ({
          playlists: SEL.playlists,
          tracks: [track('101', { path: 'e:\\Musica\\101.wav' }), track('102')],
        }),
        exists: async (p) => p !== 'E:\\',
      }),
    )
    const req = { ...REQ, target: { kind: 'volume' as const, uuid: guid } }
    expect(await ex.start(req)).toEqual({ ok: false, reason: 'sources-unreachable' })
    expect(calls).toEqual([])
    const r = await ex.plan(req)
    expect(r.ok && r.plan.warnings).toContainEqual({
      kind: 'sourcesUnreachable',
      volume: 'E:',
      tracks: 1,
    })
  })

  it('finds the root of the volume a track is on', () => {
    expect(sourceRoot('/Volumes/Public/Musica/a.wav', 'darwin')).toBe('/Volumes/Public')
    expect(sourceRoot('/Users/dj/Music/a.wav', 'darwin')).toBeNull()
    expect(sourceRoot('e:\\Musica\\a.wav', 'win32')).toBe('E:\\')
    expect(sourceRoot('\\\\nas\\music\\Techno\\a.wav', 'win32')).toBe('\\\\nas\\music\\')
  })

  // A playlist whose every track is gone would reach the players empty, and the stick's
  // previous copy of it would be lost: stop and name it.
  it('refuses a playlist that would be empty', async () => {
    const sel: ExportSelection = {
      playlists: [
        ...SEL.playlists,
        { id: '3000', name: 'Gone', folders: [], folderIds: [], updatedAt: 0, trackIds: ['103'] },
      ],
      tracks: SEL.tracks,
    }
    const base = deps(happy, { readSelection: () => sel })
    const ex = createUsbExporter({
      ...base,
      stage: async (s, dir, root, stick) => ({
        ...(await base.stage(s, dir, root, stick)),
        included: ['101', '109', '102'],
        missing: ['103'],
      }),
    })
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'playlist-empty' })
    expect(realCalls()).toEqual([])
    const r = await ex.plan(REQ)
    expect(r.ok && r.plan.warnings).toContainEqual({ kind: 'emptyPlaylist', names: ['Gone'] })
  })

  // A NAS dropping mid-copy would fail every remaining track: stop at the next one and say
  // why, the same way as a stick pulled out.
  it("cancels when the music's volume goes away mid-run", async () => {
    let mounted = true
    const ex = createUsbExporter(
      deps(
        async (emit, cancelled) => {
          emit(PLAN)
          emit({ event: 'start', index: 0, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70 })
          mounted = false
          await cancelled
          emit({ ...REPORT, cancelled: true } as BakenEvent)
        },
        { readSelection: () => onPublic, exists: async () => mounted },
      ),
    )
    expect(await ex.start(REQ)).toEqual({ ok: true })
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'source-lost' })
    expect(cancels).toBe(1)
    expect(sent).toContainEqual({ type: 'cancelling' })
  })

  // Those two names, on the stick that was checked, and only for a run that writes.
  it('removes only the two stale files, before baken, and only on a real run', async () => {
    let idAts = 0
    const at: { idAts: number; realRuns: number }[] = []
    const ex = createUsbExporter(
      deps(happy, {
        idAt: async () => {
          idAts++
          return UUID
        },
        removeFile: async (path) => {
          removed.push(path)
          at.push({ idAts, realRuns: realCalls().length })
        },
      }),
    )
    await ex.plan(REQ)
    expect(removed).toEqual([])
    await ex.start(REQ)
    await finished()
    expect(removed).toEqual(STALE_STICK_FILES.map((f) => `${STICK_DIR}/${f}`))
    // After every check before the run; the one left is the check before the .sync files.
    expect(at.every((a) => a.idAts === idAts - 1 && a.realRuns === 0)).toBe(true)
  })

  // A cancelled run leaves the old export.pdb and exportLibrary.db; rekordbox's last writes
  // to the latter may live only in its WAL, so the WAL stays until baken replaces the
  // database, which it clears beside it itself.
  it('leaves the WAL of exportLibrary.db for baken to clear when it rewrites it', async () => {
    const ex = createUsbExporter(
      deps(async (emit, cancelled) => {
        emit(PLAN)
        emit({ event: 'start', index: 0, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70 })
        await cancelled
        emit({ ...REPORT, cancelled: true } as BakenEvent)
      }),
    )
    await ex.start(REQ)
    await tick()
    ex.cancel()
    expect(await finished()).toEqual({ type: 'finished', outcome: 'cancelled' })
    expect(removed).not.toContain(`${STICK_DIR}/exportLibrary.db-wal`)
    expect(removed).not.toContain(`${STICK_DIR}/exportLibrary.db-shm`)
  })

  it('removes nothing when the stick changed before the real run', async () => {
    let asked = 0
    const ex = createUsbExporter(
      deps(happy, { idAt: async () => (asked++ === 0 ? UUID : 'OTHER') }),
    )
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'volume-changed' })
    expect(removed).toEqual([])
  })

  // rekordbox learns from these files which of its playlists the stick holds and keeps
  // them in sync; they describe the new library, so they follow baken's success. The
  // memory comes last, so export.pdb's remembered facts are the final ones.
  it('writes both sync files after a successful run', async () => {
    let writesAtPdb = -1
    const xml = [
      '<NODE Id="3E8" ParentId="0" Attribute="1" Timestamp="555" Name="BASES"/>',
      '<NODE Id="7D0" ParentId="3E8" Attribute="0" Timestamp="777" Name="Makina"/>',
    ].join('\r\n')
    const ex = createUsbExporter(
      deps(happy, {
        masterPlaylistsXml: async () => xml,
        pdbFacts: async () => {
          writesAtPdb = writes.length
          return { size: 9, mtimeMs: 5 }
        },
      }),
    )
    await ex.start(REQ)
    expect((await finished()) as UsbExportEvent).toMatchObject({ outcome: 'done', syncFiles: true })
    const text = syncFileText(
      IDENTITY.dbId,
      [
        { id: '1000', parentId: 'root', folder: true },
        { id: '2000', parentId: '1000', folder: false },
      ],
      new Map([
        ['1000', 1],
        ['2000', 2],
      ]),
      new Map([
        ['3E8', 555],
        ['7D0', 777],
      ]),
      new Map([['2000', 0]]),
    )
    expect(text).toContain('Dev_ID="2" Timestamp="777"')
    expect(writes).toEqual([
      [`${STICK_DIR}/playlists3.sync`, text],
      [`${STICK_DIR}/playlists3Plus.sync`, text],
    ])
    expect(writesAtPdb).toBe(2)
  })

  it('writes no sync file when baken fails or is cancelled', async () => {
    const failing = createUsbExporter(
      deps(async (emit) => {
        emit(PLAN)
        emit({ event: 'error', kind: 'other', message: 'boom' })
      }),
    )
    await failing.start(REQ)
    await finished()
    sent = []
    const cancelled = createUsbExporter(
      deps(async (emit, c) => {
        emit(PLAN)
        emit({ event: 'start', index: 0, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70 })
        await c
        emit({ ...REPORT, cancelled: true } as BakenEvent)
      }),
    )
    await cancelled.start(REQ)
    await tick()
    cancelled.cancel()
    expect(await finished()).toEqual({ type: 'finished', outcome: 'cancelled' })
    expect(writes).toEqual([])
  })

  // The library on the stick is new and complete; only rekordbox's view of which playlists
  // it holds is stale. That is not a failed export.
  // The log names the file that failed: the first may already be the new one, and which
  // is stale is what a support reply needs.
  it('says the sync files failed without calling the export failed', async () => {
    const ex = createUsbExporter(
      deps(happy, {
        writeAtomic: async (path) => {
          if (path.endsWith('playlists3Plus.sync')) throw new Error('EROFS: read-only file system')
        },
      }),
    )
    await ex.start(REQ)
    expect((await finished()) as UsbExportEvent).toMatchObject({
      outcome: 'done',
      syncFiles: false,
    })
    expect(logged.find((m) => m.includes('EROFS'))).toContain(`${STICK_DIR}/playlists3Plus.sync`)
    expect(memory.get(`volume:${UUID}`)).not.toBeNull()
  })

  // baken finished every track before the NAS went: the stick holds a whole library, and
  // the tracks the loss made fail are counted as failed, as for any other failure.
  it('is done, failures counted, when a source went but baken finished anyway', async () => {
    let mounted = true
    const ex = createUsbExporter(
      deps(
        async (emit) => {
          emit(PLAN)
          emit({ event: 'start', index: 2, usbPath: '/Contents/A/UnknownAlbum/102.wav', size: 30 })
          mounted = false
          await tick(20)
          emit({ event: 'failed', index: 2, message: 'No such file or directory (os error 2)' })
          emit({ event: 'database' })
          emit({
            ...REPORT,
            failures: [{ name: 'T102', message: 'No such file or directory (os error 2)' }],
          } as BakenEvent)
        },
        { readSelection: () => onPublic, exists: async () => mounted },
      ),
    )
    await ex.start(REQ)
    expect((await finished()) as UsbExportEvent).toMatchObject({ outcome: 'done', failed: 1 })
    expect(cancels).toBe(1)
  })

  // An export may take minutes: the dialog must not invite reopening rekordbox "right
  // away" while baken writes the stick, and it says so in every language.
  it('asks to close rekordbox with words about the USB export', () => {
    for (const locale of ['es', 'en', 'de', 'fr', 'pt-BR']) {
      const t = createMenuT(locale)
      const text = t(USB_QUIT_DETAIL)
      expect(text).toContain('USB')
      expect(text).not.toBe(t('rekordboxQuitDetailPlaylists'))
      expect(text).not.toMatch(/[—:]/)
    }
  })

  // rekordbox knows the stick's playlists by these ids; a renumbered one is a different
  // playlist to it, so a re-export keeps them even when a new one sorts first.
  it("keeps the stick's playlist ids across exports", async () => {
    const read: string[] = []
    let given: { identity: MasterIdentity | null; deviceIds: ReadonlyMap<string, number> } | null =
      null
    const base = deps(happy, {
      readSelection: () => ({
        playlists: [
          { id: '77', name: 'New', folders: [], folderIds: [], updatedAt: 0, trackIds: ['101'] },
          {
            id: '3965545314',
            name: 'Makina',
            folders: ['BASES'],
            folderIds: ['1401397687'],
            updatedAt: 0,
            trackIds: ['102'],
          },
        ],
        tracks: [track('101'), track('102')],
      }),
      readText: async (p) => {
        read.push(p)
        return p === `${STICK_DIR}/playlists3.sync` ? REKORDBOX_SYNC : null
      },
    })
    const ex = createUsbExporter({
      ...base,
      stage: (s, dir, root, stick) => {
        given = stick
        return base.stage(s, dir, root, stick)
      },
    })
    await ex.plan(REQ)
    expect(read).toContain(`${STICK_DIR}/playlists3.sync`)
    expect(given).not.toBeNull()
    const { identity, deviceIds } = given as unknown as {
      identity: MasterIdentity
      deviceIds: ReadonlyMap<string, number>
    }
    expect(identity).toEqual(IDENTITY)
    expect([...deviceIds]).toEqual([
      ['77', 3],
      ['1401397687', 1],
      ['3965545314', 2],
    ])
  })

  // baken stores the ids as u32; a stick whose file already used the last one cannot take
  // a new playlist rekordbox would follow.
  it('refuses when the stick has no playlist id left', async () => {
    const full = REKORDBOX_SYNC.replace('Dev_ID="2"', 'Dev_ID="4294967295"')
    const ex = createUsbExporter(deps(happy, { readText: async () => full }))
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'stick-ids-full' })
    expect(calls).toEqual([])
  })

  // Without rekordbox's identity the stick would not be recognised as its own.
  it('refuses an unreadable identity', async () => {
    const ex = createUsbExporter(deps(happy, { identity: () => 'unreadable' }))
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'unreadable' })
    expect(await ex.plan(REQ)).toEqual({ ok: false, reason: 'unreadable' })
    expect(calls).toEqual([])
  })
})

describe('after baken reports', () => {
  // The modal and the pill wait for finished with no Cancel left; a throw in the writes
  // after baken's success used to leave them at "database" until a restart.
  it('still says done when remembering the stick fails, and logs why', async () => {
    const ex = createUsbExporter(
      deps(happy, {
        memory: {
          ...memory,
          remember: () => {
            throw new Error('ENOSPC: no space left on device')
          },
        },
      }),
    )
    await ex.start(REQ)
    expect((await finished()) as UsbExportEvent).toMatchObject({ outcome: 'done', syncFiles: true })
    expect(logged.some((m) => m.includes('ENOSPC'))).toBe(true)
    expect(ex.busy()).toBe(false)
  })

  // While the .sync files are still being written a second export would delete the stale
  // names and spawn another baken on the same stick.
  it('stays busy until finished is sent', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((r) => {
      release = r
    })
    const ex = createUsbExporter(deps(happy, { writeAtomic: () => held }))
    await ex.start(REQ)
    for (let i = 0; i < 100 && !sent.some((e) => e.type === 'database'); i++) await tick(5)
    await tick(20)
    expect(ex.busy()).toBe(true)
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'busy' })
    release()
    expect((await finished()) as UsbExportEvent).toMatchObject({ outcome: 'done' })
    expect(ex.busy()).toBe(false)
  })

  // The 1 s device poll may not have run since the last track: the .sync files are
  // Surco's last write and go only to the stick that was chosen.
  it('writes no sync file when another stick took the mount point at the end', async () => {
    let swapped = false
    const ex = createUsbExporter(
      deps(
        async (emit) => {
          await happy(emit, new Promise(() => {}))
          swapped = true
        },
        { idAt: async () => (swapped ? 'OTHER' : UUID) },
      ),
    )
    await ex.start(REQ)
    expect((await finished()) as UsbExportEvent).toMatchObject({
      outcome: 'done',
      syncFiles: false,
    })
    expect(writes).toEqual([])
    expect(memory.get(`volume:${UUID}`)).toBeNull()
  })

  it('writes no sync file when the device number changed before the poll saw it', async () => {
    let swapped = false
    const ex = createUsbExporter(
      deps(
        async (emit) => {
          await happy(emit, new Promise(() => {}))
          swapped = true
        },
        { devOf: async () => (swapped ? 7 : 42), devPollMs: 60_000 },
      ),
    )
    await ex.start(REQ)
    expect((await finished()) as UsbExportEvent).toMatchObject({
      outcome: 'done',
      syncFiles: false,
    })
    expect(writes).toEqual([])
  })
})

describe('track indexes', () => {
  // baken numbers its events by position in its plan; a row dropped from the list would
  // shift every later index onto the wrong track.
  it('keeps one row per plan track, even one the selection does not know', async () => {
    const plan = {
      ...PLAN,
      tracks: [
        { id: 999, usbPath: '/Contents/X/x.wav', size: 1, onStick: false },
        ...(PLAN as { tracks: unknown[] }).tracks,
      ],
    } as BakenEvent
    const ex = createUsbExporter(
      deps(async (emit) => {
        emit(plan)
        emit({ event: 'start', index: 1, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70 })
        emit({ event: 'written', index: 1, kept: false })
        emit({ event: 'database' })
        emit(REPORT)
      }),
    )
    await ex.start(REQ)
    await finished()
    const started = sent.find((e) => e.type === 'started')
    expect(started?.type === 'started' && started.tracks.map((t) => t.id)).toEqual([
      '999',
      '101',
      '109',
      '102',
    ])
  })
})

describe('while an export runs', () => {
  // A reload of the renderer mid-export reopens the chooser; its summary must not run a
  // second baken against the stick being written.
  it('answers busy to a summary', async () => {
    const ex = createUsbExporter(
      deps(async (emit, cancelled) => {
        emit(PLAN)
        await cancelled
        emit({ ...REPORT, cancelled: true } as BakenEvent)
      }),
    )
    await ex.start(REQ)
    const before = calls.length
    expect(await ex.plan(REQ)).toEqual({ ok: false, reason: 'busy' })
    expect(calls.length).toBe(before)
    ex.cancel()
    await finished()
  })
})

describe('stopping for quit', () => {
  // Quitting must not leave baken writing the stick with no .sync and no memory: during
  // the tracks it is asked to stop, and the quit waits for its report.
  it('cancels during the tracks and settles once finished is sent', async () => {
    const ex = createUsbExporter(
      deps(async (emit, cancelled) => {
        emit(PLAN)
        emit({ event: 'start', index: 0, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70 })
        await cancelled
        emit({ event: 'written', index: 0, kept: false })
        emit({ ...REPORT, cancelled: true } as BakenEvent)
      }),
    )
    await ex.start(REQ)
    await tick()
    await ex.stop()
    expect(cancels).toBe(1)
    expect(sent.find((e) => e.type === 'finished')).toEqual({
      type: 'finished',
      outcome: 'cancelled',
    })
    expect(ex.busy()).toBe(false)
  })

  // Cutting between export.pdb and exportLibrary.db leaves two libraries: wait instead.
  it('waits for the database without cancelling it', async () => {
    const ex = createUsbExporter(
      deps(async (emit) => {
        emit(PLAN)
        emit({ event: 'database' })
        await tick(30)
        emit(REPORT)
      }),
    )
    await ex.start(REQ)
    await tick()
    await ex.stop()
    expect(cancels).toBe(0)
    expect(sent.find((e) => e.type === 'finished')).toMatchObject({ outcome: 'done' })
    expect(writes).toHaveLength(2)
  })

  it('settles at once when nothing runs', async () => {
    await createUsbExporter(deps(happy)).stop()
    expect(calls).toEqual([])
  })
})
