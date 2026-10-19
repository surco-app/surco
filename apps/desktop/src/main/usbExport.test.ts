import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { UsbExportEvent, UsbExportRequest, UsbVolume } from '../shared/types'
import type { BakenEvent, BakenHandle } from './bakenRun'
import { createUsbExporter, failureReason, type UsbExporterDeps } from './usbExport'
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

beforeEach(async () => {
  memory = createUsbMemory(join(await mkdtemp(join(tmpdir(), 'usb-exp-')), 'usb-exports.json'))
  sent = []
  calls = []
  cancels = 0
  logged = []
})

const dryPlan: Script = async (emit) => emit(PLAN)

function deps(
  real: Script,
  over: Partial<UsbExporterDeps> & { dry?: Script; started?: boolean } = {},
): UsbExporterDeps {
  const { dry = dryPlan, started = true, ...rest } = over
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
    send: (e) => sent.push(e),
    now: () => 1000,
    fileSize: async () => 35,
    pdbFacts: async () => ({ size: 9, mtimeMs: 5 }),
    log: (m) => logged.push(m),
    pollMs: 2,
    devPollMs: 2,
    run: (_cmd, args, onEvent): BakenHandle => {
      calls.push(args)
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
          cancels++
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
      stage: (sel, dir, root) => {
        roots.push(root)
        return base.stage(sel, dir, root)
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
