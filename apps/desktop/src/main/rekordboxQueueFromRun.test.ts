import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import type { RekordboxRepoint } from './rekordboxBatch'
import { rekordboxMetaFrom } from './rekordboxMetadata'
import {
  ORGANISE_FIXTURE,
  TWIN_PATHS,
  writeRekordboxPlaylistFixture,
} from './rekordboxPlaylistsFixture'
import {
  libraryTrackOps,
  queueConversionRun,
  type RunQueueDeps,
  trackOpsFromRun,
} from './rekordboxQueueFromRun'

const META = rekordboxMetaFrom({ ...emptyMetadata(), artist: 'Sister Nancy', title: 'Bam Bam' })
const probe = {
  properties: async () => ({ sampleRateHz: 44100, bitDepth: 16, channels: 2, bitrateKbps: 1411 }),
  duration: async () => 200,
}
let n = 0
const newId = () => `op-${++n}`

async function collection(): Promise<{ path: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rbrun-'))
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    xml: true,
    xmlTimestamps: { '2000': 1767225600111 },
  })
  return { path, dir }
}

describe('trackOpsFromRun', () => {
  it('finds the entry by where the track came from and records its playlists and their Timestamps when queued', async () => {
    const { path } = await collection()
    const repoint: RekordboxRepoint = {
      from: '/Volumes/Public/Music/Play This Song.wav',
      to: '/Volumes/Public/Music/Play This Song (24).wav',
      meta: META,
      playlists: [{ id: '3000', name: 'House' }],
    }
    const [op] = await trackOpsFromRun(path, [repoint], {
      repointing: true,
      probe,
      find: TWIN_PATHS,
      newId,
    })
    expect(op).toMatchObject({
      kind: 'track',
      path: '/Volumes/Public/Music/Play This Song (24).wav',
      label: 'Sister Nancy - Bam Bam',
      contentId: '102',
      wanted: [{ id: '3000', name: 'House' }],
    })
    expect(op.known.sort()).toEqual(['2000', '3000'])
    expect(op.stamps).toEqual({ '2000': 1767225600111, '3000': 1767225600000 })
  })

  it('takes as known only the playlists the user saw when editing, so one rekordbox gained since is never removed silently', async () => {
    const { path } = await collection()
    const [op] = await trackOpsFromRun(
      path,
      [
        {
          from: '/Volumes/Public/Music/Play This Song.wav',
          to: '/Volumes/Public/Music/Play This Song (24).wav',
          meta: META,
          playlists: [{ id: '3000', name: 'House' }],
          playlistsBase: ['3000'],
        },
      ],
      { repointing: true, probe, find: TWIN_PATHS, newId },
    )
    expect(op.known).toEqual(['3000'])
  })

  it('looks a converted file up by its new path only when the repoint is off so it is added beside the old entry', async () => {
    const { path } = await collection()
    const [op] = await trackOpsFromRun(
      path,
      [
        {
          from: '/Volumes/Public/Music/Play This Song.wav',
          to: '/Volumes/Public/Music/Play This Song (24).wav',
          meta: META,
          playlists: [{ id: '3000', name: 'House' }],
        },
      ],
      { repointing: false, probe, find: TWIN_PATHS, newId },
    )
    expect(op.contentId).toBeUndefined()
    expect(op.known).toEqual([])
  })

  it('reads the facts of a file rekordbox does not have while the file is certainly there', async () => {
    const { path, dir } = await collection()
    const file = join(dir, 'Bam Bam.wav')
    await writeFile(file, Buffer.alloc(64))
    const [op] = await trackOpsFromRun(
      path,
      [{ from: file, to: file, meta: META, playlists: [{ name: 'Bolos' }] }],
      { repointing: false, probe, find: TWIN_PATHS, newId },
    )
    expect(op.contentId).toBeUndefined()
    expect(op.known).toEqual([])
    expect(op.facts).toMatchObject({ path: file, fileType: 11, fileSize: 64 })
  })

  it('queues nothing for a track whose field was never touched', async () => {
    const { path } = await collection()
    expect(
      await trackOpsFromRun(path, [{ from: '/m/a.mp3', to: '/m/a.wav', meta: META }], {
        repointing: true,
        probe,
        find: TWIN_PATHS,
        newId,
      }),
    ).toEqual([])
  })

  it('asks rekordbox to register a converted track that is in no playlist when adding new tracks', async () => {
    const { path, dir } = await collection()
    const file = join(dir, 'Bam Bam.wav')
    await writeFile(file, Buffer.alloc(64))
    const ops = await trackOpsFromRun(path, [{ from: file, to: file, meta: META }], {
      repointing: false,
      probe,
      find: TWIN_PATHS,
      newId,
      addNew: true,
    })
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: 'track', path: file, add: true, wanted: [], known: [] })
    expect(ops[0].contentId).toBeUndefined()
    expect(ops[0].facts).toMatchObject({ path: file, fileType: 11, fileSize: 64 })
  })

  it('leaves a track rekordbox already has alone when only adding new tracks, so none of its playlists are lost', async () => {
    const { path } = await collection()
    expect(
      await trackOpsFromRun(
        path,
        [
          {
            from: '/Volumes/Public/Music/Play This Song.wav',
            to: '/Volumes/Public/Music/Play This Song (24).wav',
            meta: META,
          },
        ],
        { repointing: true, probe, find: TWIN_PATHS, newId, addNew: true },
      ),
    ).toEqual([])
  })

  it('skips registering a track rekordbox could not describe, so no notice asks about a track nobody chose', async () => {
    const { path, dir } = await collection()
    const file = join(dir, 'Untagged.wav')
    await writeFile(file, Buffer.alloc(64))
    expect(
      await trackOpsFromRun(path, [{ from: file, to: file }], {
        repointing: false,
        probe,
        find: TWIN_PATHS,
        newId,
        addNew: true,
      }),
    ).toEqual([])
  })

  it('does nothing new with adding off, so a track in no playlist stays out of rekordbox', async () => {
    const { path, dir } = await collection()
    const file = join(dir, 'Bam Bam.wav')
    await writeFile(file, Buffer.alloc(64))
    expect(
      await trackOpsFromRun(path, [{ from: file, to: file, meta: META }], {
        repointing: false,
        probe,
        find: TWIN_PATHS,
        newId,
      }),
    ).toEqual([])
  })

  it('queues nothing without a collection', async () => {
    expect(
      await trackOpsFromRun('', [{ from: '/m/a.wav', to: '/m/a.wav', meta: META, playlists: [] }], {
        repointing: false,
        probe,
        find: TWIN_PATHS,
        newId,
      }),
    ).toEqual([])
  })
})

describe('libraryTrackOps', () => {
  it('turns the choice made for one library into a track op that finds the file by either path', () => {
    const repoints: RekordboxRepoint[] = [
      {
        from: '/m/a.mp3',
        to: '/m/a.flac',
        meta: META,
        traktorPlaylists: { wanted: [{ id: 'fri', name: 'Friday' }], base: ['old'] },
      },
      { from: '/m/b.wav', to: '/m/b.wav', enginePlaylists: { wanted: [], base: ['7'] } },
    ]
    expect(libraryTrackOps(repoints, 'traktor', () => 'id1')).toEqual([
      {
        id: 'id1',
        kind: 'track',
        path: '/m/a.flac',
        from: '/m/a.mp3',
        label: 'Sister Nancy - Bam Bam',
        facts: null,
        meta: META,
        wanted: [{ id: 'fri', name: 'Friday' }],
        known: ['old'],
        stamps: {},
      },
    ])
    expect(libraryTrackOps(repoints, 'engine', () => 'id2')).toEqual([
      {
        id: 'id2',
        kind: 'track',
        path: '/m/b.wav',
        label: 'b.wav',
        facts: null,
        wanted: [],
        known: ['7'],
        stamps: {},
      },
    ])
  })

  it('asks Traktor to register a track with no playlist choice when adding new tracks', () => {
    const repoints: RekordboxRepoint[] = [{ from: '/m/a.wav', to: '/m/a.wav', meta: META }]
    expect(libraryTrackOps(repoints, 'traktor', () => 'id1', true)).toEqual([
      {
        id: 'id1',
        kind: 'track',
        path: '/m/a.wav',
        label: 'Sister Nancy - Bam Bam',
        facts: null,
        meta: META,
        wanted: [],
        known: [],
        stamps: {},
        add: true,
      },
    ])
  })

  it('does not queue adding a track the collection already has, so the queue shows only real additions', () => {
    const repoints: RekordboxRepoint[] = [{ from: '/m/a.mp3', to: '/m/a.wav', meta: META }]
    const known = vi.fn((path: string, from?: string) => path === '/m/a.wav' && from === '/m/a.mp3')
    expect(libraryTrackOps(repoints, 'traktor', () => 'id1', true, known)).toEqual([])
    expect(
      libraryTrackOps(
        repoints,
        'traktor',
        () => 'id1',
        true,
        () => false,
      ),
    ).toEqual([expect.objectContaining({ id: 'id1', path: '/m/a.wav', add: true, wanted: [] })])
  })

  it('needs track tags to register in Traktor, since its collection entry is built from them', () => {
    const repoints: RekordboxRepoint[] = [{ from: '/m/a.wav', to: '/m/a.wav' }]
    expect(libraryTrackOps(repoints, 'traktor', () => 'id1', true)).toEqual([])
  })

  it('leaves Engine DJ registration to the conversion itself, so no add op is queued for it', () => {
    const repoints: RekordboxRepoint[] = [{ from: '/m/a.wav', to: '/m/a.wav', meta: META }]
    expect(libraryTrackOps(repoints, 'engine', () => 'id1', true)).toEqual([])
  })
})

describe('queueConversionRun', () => {
  const repoint: RekordboxRepoint = { from: '/m/a.mp3', to: '/m/a.wav', meta: META }
  const deps = (over: Partial<RunQueueDeps> = {}) => ({
    collectionPath: '/c/master.db',
    flushRepoints: vi.fn<RunQueueDeps['flushRepoints']>(async () => ({ written: 1, skipped: [] })),
    readOps: vi.fn<RunQueueDeps['readOps']>(async () => []),
    enqueue: vi.fn<RunQueueDeps['enqueue']>(),
    apply: vi.fn<RunQueueDeps['apply']>(),
    ...over,
  })

  it('queues the repoints the user kept rekordbox open for instead of losing them', async () => {
    const d = deps({
      flushRepoints: vi.fn<RunQueueDeps['flushRepoints']>(async () => ({
        written: 0,
        skipped: [],
        blocked: 'rekordbox-running',
      })),
    })
    await queueConversionRun([repoint], d)
    expect(d.enqueue).toHaveBeenCalledWith([], [repoint])
    expect(d.apply).toHaveBeenCalled()
  })

  it('queues the repoints while the queue is held, so they wait for Apply now instead of being lost', async () => {
    const d = deps({
      held: true,
      flushRepoints: vi.fn<RunQueueDeps['flushRepoints']>(async () => ({
        written: 0,
        skipped: [],
      })),
    })
    await queueConversionRun([repoint], d)
    expect(d.enqueue).toHaveBeenCalledWith([], [repoint])
  })

  // master.db en un disco desconectado: sin cola, las pistas convertidas en su sitio salían
  // perdidas en rekordbox al volver a montarlo.
  it('queues the repoints while the collection is on an unplugged drive', async () => {
    const d = deps({
      collectionPath: '',
      unplugged: true,
      flushRepoints: vi.fn<RunQueueDeps['flushRepoints']>(async () => ({
        written: 0,
        skipped: [],
        blocked: 'collection-missing',
      })),
    })
    await queueConversionRun([repoint], d)
    expect(d.enqueue).toHaveBeenCalledWith([], [repoint])
    expect(d.apply).toHaveBeenCalled()
  })

  it('lets the repoints go when the collection is gone from a drive that is there', async () => {
    const d = deps({
      collectionPath: '',
      flushRepoints: vi.fn<RunQueueDeps['flushRepoints']>(async () => ({
        written: 0,
        skipped: [],
        blocked: 'collection-missing',
      })),
    })
    await queueConversionRun([repoint], d)
    expect(d.enqueue).not.toHaveBeenCalled()
  })

  it('queues the run playlists whatever the repoint did', async () => {
    const op = {
      id: 'x',
      kind: 'track' as const,
      path: '/m/a.wav',
      label: 'a',
      facts: null,
      wanted: [],
      known: [],
      stamps: {},
    }
    const d = deps({ readOps: vi.fn<RunQueueDeps['readOps']>(async () => [op]) })
    await queueConversionRun([repoint], d)
    expect(d.enqueue).toHaveBeenCalledWith([op], [])
  })

  it('still queues the waiting repoints when reading the playlist operations fails', async () => {
    const d = deps({
      flushRepoints: vi.fn<RunQueueDeps['flushRepoints']>(async () => ({
        written: 0,
        skipped: [],
        blocked: 'rekordbox-running',
      })),
      readOps: vi.fn<RunQueueDeps['readOps']>(async () => {
        throw new Error('disk')
      }),
    })
    await queueConversionRun([repoint], d)
    expect(d.enqueue).toHaveBeenCalledWith([], [repoint])
  })

  it('queues both the operations and the waiting repoints when the flush was blocked', async () => {
    const op = {
      id: 'x',
      kind: 'track' as const,
      path: '/m/a.wav',
      label: 'a',
      facts: null,
      wanted: [],
      known: [],
      stamps: {},
    }
    const d = deps({
      flushRepoints: vi.fn<RunQueueDeps['flushRepoints']>(async () => ({
        written: 0,
        skipped: [],
        blocked: 'rekordbox-running',
      })),
      readOps: vi.fn<RunQueueDeps['readOps']>(async () => [op]),
    })
    await queueConversionRun([repoint], d)
    expect(d.enqueue).toHaveBeenCalledWith([op], [repoint])
  })

  it('leaves the queue alone when the run has nothing for it', async () => {
    const d = deps()
    await queueConversionRun([repoint], d)
    expect(d.enqueue).not.toHaveBeenCalled()
    expect(d.apply).not.toHaveBeenCalled()
  })
})
