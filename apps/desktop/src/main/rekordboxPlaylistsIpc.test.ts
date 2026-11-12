import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { MY_FLOW } from '../shared/cueFlows'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))
vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))
vi.mock('./rekordboxDb', async (importOriginal) => {
  const real = await importOriginal<typeof import('./rekordboxDb')>()
  return { ...real, openRekordboxDb: vi.fn(real.openRekordboxDb) }
})

import type { DjEditMain } from '../shared/djApi'
import type { CollectionTrack, RekordboxPlaylistEdit, SourcePlaylistEntry } from '../shared/types'
import { registerCuesIpc } from './cuesIpc'
import { queueWithApplyInFlight } from './editRaceFixture'
import { rekordboxCueSource } from './rekordboxCueSource'
import { openRekordboxDb, rekordboxRawKey } from './rekordboxDb'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import {
  collectionAvailable,
  type PlaylistEditHost,
  rekordboxEdit,
  rekordboxRead,
  withCollection,
} from './rekordboxPlaylistsIpc'
import { applyRekordboxBatch } from './rekordboxPlaylistWrite'
import { createRekordboxQueue, type RekordboxQueue } from './rekordboxQueue'

describe('withCollection', () => {
  it('falls back when there is no collection, the normal case for a user without rekordbox', () => {
    expect(withCollection('', () => 'read', 'none')).toBe('none')
  })

  // A collection that is there but does not read is not an empty one: answering empty
  // would show "no playlists" and close the open playlist as if it had been deleted.
  it('fails when the file is not a rekordbox database, so the renderer can say it could not read it', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    await writeFile(path, 'not a database')
    expect(() => withCollection(path, () => 'read', 'none')).toThrow()
  })

  it('reads a real collection', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { content: [], keys: [], playlists: [], links: [] })
    expect(withCollection(path, () => 'read', 'none')).toBe('read')
  })

  it('fails when the read itself fails, rekordbox mid-write or a renamed column, rather than answering empty', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { content: [], keys: [], playlists: [], links: [] })
    expect(() =>
      withCollection(
        path,
        () => {
          throw new Error('no such column')
        },
        'none',
      ),
    ).toThrow('no such column')
  })
})

// Asked on every focus for the rail: decrypting the whole collection for a yes/no would
// run the SQLCipher key derivation in the main process each time Surco comes back, for
// every user with rekordbox installed. Whether it reads is what the tree reports.
describe('collectionAvailable', () => {
  it('answers from the file being there, without decrypting it', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    await writeFile(path, 'not a database')
    expect(collectionAvailable(path)).toBe(true)
  })

  it('is false with no collection, or one that is gone', async () => {
    expect(collectionAvailable('')).toBe(false)
    expect(collectionAvailable(join(tmpdir(), 'surco-no-such', 'master.db'))).toBe(false)
  })
})

function queueFor(path: string, sessionBackup = vi.fn(async () => {})) {
  let text: string | null = null
  return createRekordboxQueue({
    store: {
      read: () => text,
      write: (t) => {
        text = t
      },
      setAside: () => {
        text = null
      },
    },
    collection: () => path,
    applyBatch: (c, ops, ensureClosed) =>
      applyRekordboxBatch(c, ops, { ensureClosed, sessionBackup }),
    repoint: async () => [],
    nodeStamps: async () => ({}),
    onChange: () => {},
  })
}

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls]
    .reverse()
    .find(([name]) => name === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

let section: DjEditMain

function register(collection: () => string, host: PlaylistEditHost): void {
  section = rekordboxEdit(collection, host)
}

const save = (edit: RekordboxPlaylistEdit, label?: string) => section.save(edit, label)

describe('rekordboxEdit', () => {
  it('grants the files and covers of the playlist it read, so the rows can play and paint before any disk walk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-rbipc-'))
    const path = join(dir, 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const allowMedia = vi.fn()
    const read = rekordboxRead(
      () => path,
      () => path,
      { allowMedia },
    )
    const entries = (await read.playlist('2000')) as SourcePlaylistEntry[]
    const paths = entries.flatMap((e) => (e.path && !e.separator ? [e.path] : []))
    expect(paths.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.separator || e.path === null || e.preview)).toBe(true)
    expect(allowMedia).toHaveBeenCalledWith(expect.arrayContaining(paths))
  })

  it('opens the playlist with the key already stretched, since stretching the passphrase on every open held the main process for 80 ms', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const read = rekordboxRead(
      () => path,
      () => path,
      {},
    )
    vi.mocked(openRekordboxDb).mockClear()
    await read.playlist('2000')
    expect(openRekordboxDb).toHaveBeenCalledWith(path, {
      readonly: true,
      key: await rekordboxRawKey(path),
    })
  })

  it('reads the tree and the separator check with the stretched key too, since both run back to back on every focus and held the main process for 226 ms', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    register(() => path, {
      isRunning: async () => false,
      queue: queueFor(path),
    })
    const read = rekordboxRead(
      () => path,
      () => path,
      {},
    )
    const key = await rekordboxRawKey(path)
    vi.mocked(openRekordboxDb).mockClear()
    await read.tree()
    await section.hasSeparator?.()
    await read.recentCount()
    expect(vi.mocked(openRekordboxDb).mock.calls).toEqual([
      [path, { readonly: true, key }],
      [path, { readonly: true, key }],
      [path, { readonly: true, key }],
    ])
  })

  it('reads a track opened in the editor, its cues and its playlists, with the stretched key, since the two back to back held the main process for 210 ms', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    registerCuesIpc({
      collection: () => path,
      flow: () => MY_FLOW,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
      sources: {
        rekordbox: rekordboxCueSource({
          collection: () => path,
          queue: { enqueue: vi.fn(), cuesOp: vi.fn(), drop: vi.fn() },
          applyQuietly: vi.fn(),
          beatGrid: async () => null,
          words: async () => null,
        }),
        engine: null,
        traktor: null,
        serato: null,
        virtualdj: null,
      },
    })
    const read = rekordboxRead(
      () => path,
      () => path,
      {},
    )
    const key = await rekordboxRawKey(path)
    vi.mocked(openRekordboxDb).mockClear()
    await Promise.resolve(handler('cues:trackCues')({}, 'c1')).catch(() => null)
    await Promise.resolve(read.membership(['/m/a.wav'])).catch(() => null)
    expect(vi.mocked(openRekordboxDb).mock.calls).toEqual([
      [path, { readonly: true, key }],
      [path, { readonly: true, key }],
    ])
  })

  it('writes the edit at once when rekordbox is closed', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    register(() => path, {
      isRunning: async () => false,
      queue: queueFor(path),
    })
    const result = await save({
      kind: 'move',
      playlistId: '2000',
      linkIds: ['f6'],
      beforeLinkId: 'f1',
    })
    expect(result).toEqual({ applied: true })
  })

  it('reports a queued edit as waiting, never as refused, and names it so its result can be matched later', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const queue = queueFor(path)
    const enqueue = vi.spyOn(queue, 'enqueue')
    const onWaiting = vi.fn()
    register(() => path, { isRunning: async () => true, queue, onWaiting })
    const result = await save(
      { kind: 'create', parentId: 'root', name: 'Sesion', folder: false, tracks: [] },
      'Sesion',
    )
    const opId = (enqueue.mock.calls[0][0][0] as { id: string }).id
    expect(result).toEqual({ applied: false, queued: true, opId })
    expect(onWaiting).toHaveBeenCalledOnce()
  })

  it('a playlist edit is a small change of its collection, marked before the queue applies', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const order: string[] = []
    const queue = queueFor(path)
    const apply = queue.apply.bind(queue)
    queue.apply = (...args) => {
      order.push('apply')
      return apply(...args)
    }
    register(() => path, {
      isRunning: async () => false,
      queue,
      beginLoose: (p) => order.push(`loose:${p}`),
    })
    await save({ kind: 'move', playlistId: '2000', linkIds: ['f6'], beforeLinkId: 'f1' })
    expect(order).toEqual([`loose:${path}`, 'apply'])
  })

  it('says whether the collection has a separator to copy', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    register(() => path, {
      isRunning: async () => false,
      queue: queueFor(path),
    })
    expect(await section.hasSeparator?.()).toBe(true)
  })

  it('counts the tracks added in the last 30 days, the number the tree shows beside Recently added', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    const today = new Date().toLocaleDateString('sv-SE')
    writeRekordboxPlaylistFixture(path, {
      ...ORGANISE_FIXTURE,
      content: ORGANISE_FIXTURE.content.map((c, i) => (i < 2 ? { ...c, StockDate: today } : c)),
    })
    const read = rekordboxRead(
      () => path,
      () => path,
      {},
    )
    expect(await read.recentCount()).toBe(2)
  })

  // The write's transaction spans an await: two at once would fight over SQLite's busy
  // timeout, so the second must not even look at rekordbox until the first is done.
  it('runs two edits sent at once one after the other', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const order: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    let calls = 0
    const isRunning = vi.fn(async () => {
      const n = ++calls
      order.push(`start${n}`)
      if (n === 1) await gate
      order.push(`end${n}`)
      return false
    })
    register(() => path, {
      isRunning,
      queue: queueFor(path),
    })
    const edit = save
    const first = edit({ kind: 'move', playlistId: '2000', linkIds: ['f6'], beforeLinkId: 'f1' })
    const second = edit({ kind: 'move', playlistId: '2000', linkIds: ['f5'], beforeLinkId: 'f1' })
    await vi.waitFor(() => expect(order).toEqual(['start1']))
    await new Promise((r) => setTimeout(r, 50))
    expect(order).toEqual(['start1'])
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2'])
  })

  it('keeps the edit queued while rekordbox is open', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const queue = queueFor(path)
    register(() => path, {
      isRunning: async () => true,
      queue,
    })
    const result = await save({ kind: 'rename', playlistId: '3000', name: 'House 26' }, 'House')
    expect(result).toEqual({ applied: false, queued: true, opId: expect.any(String) })
    expect(queue.state().items).toEqual([
      {
        key: expect.stringMatching(/^edit:/),
        label: 'House',
        parts: [{ kind: 'tree', edit: 'rename' }],
      },
    ])
  })

  it('does not wake the watcher after a refusal that is not rekordbox being open', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const onWaiting = vi.fn()
    const queue = {
      enqueue: vi.fn(),
      apply: vi.fn(async () => ({ status: 'refused', reason: 'backup-failed' }) as const),
      drop: vi.fn(),
      outcomeOf: vi.fn(),
    }
    register(() => path, {
      isRunning: async () => false,
      queue,
      onWaiting,
    })
    const edit: RekordboxPlaylistEdit = { kind: 'rename', playlistId: '3000', name: 'House 26' }
    expect(await save(edit)).toEqual({
      applied: false,
      reason: 'backup-failed',
    })
    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('takes a refused edit out of the queue, so a retry after "nothing changed" does not write it twice', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const queue = queueFor(
      path,
      vi.fn(async () => {
        throw new Error('disk full')
      }),
    )
    queue.enqueue([
      {
        id: 'other',
        kind: 'edit',
        edit: { kind: 'rename', playlistId: '2000', name: 'Factory 26' },
        stamps: {},
        label: 'Factory',
      },
    ])
    register(() => path, { isRunning: async () => false, queue })
    expect(
      await save({ kind: 'create', parentId: 'root', name: 'Makina 2', folder: false }, 'Makina 2'),
    ).toEqual({ applied: false, reason: 'backup-failed' })
    expect(queue.state().items.map((i) => i.label)).toEqual(['Factory'])
  })

  it("tells the window what the other queued operations did, without the route's own edit", async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const other = { code: 'playlist-changed', track: 'Bam Bam', playlist: 'House' } as const
    const own = { code: 'edit-changed', playlist: 'House' } as const
    const enqueue = vi.fn<RekordboxQueue['enqueue']>()
    const ownId = () => enqueue.mock.calls[0][0][0].id
    const queue = {
      enqueue,
      drop: vi.fn(),
      outcomeOf: vi.fn(),
      apply: vi.fn(async () => ({
        status: 'applied' as const,
        tracks: 0,
        changes: 1,
        notices: [own, other],
        written: [{ path: '/m/a.wav', wanted: [] }],
        outcomes: [
          { id: ownId(), applied: false, reason: 'stale' as const, notices: [own] },
          { id: 'e2', applied: true, notices: [] },
          { id: 't', applied: false, notices: [other] },
        ],
      })),
    }
    const onApplied = vi.fn()
    register(() => path, {
      isRunning: async () => false,
      queue,
      onApplied,
    })
    await save({ kind: 'rename', playlistId: '3000', name: 'House 26' })
    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: 1,
        notices: [other],
        written: [{ path: '/m/a.wav', wanted: [] }],
      }),
    )
  })

  it('tells the window nothing when only its own edit was in the batch', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const onApplied = vi.fn()
    register(() => path, {
      isRunning: async () => false,
      queue: queueFor(path),
      onApplied,
    })
    await save({ kind: 'rename', playlistId: '3000', name: 'House 26' })
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('wakes the watcher when the edit waits for rekordbox to close', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const onWaiting = vi.fn()
    register(() => path, {
      isRunning: async () => true,
      queue: queueFor(path),
      onWaiting,
    })
    await save({ kind: 'rename', playlistId: '3000', name: 'House 26' })
    expect(onWaiting).toHaveBeenCalledTimes(1)
  })

  it('says rekordbox is there from the file alone, so the tab shows without decrypting', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    let configured = ''
    const read = rekordboxRead(
      () => configured,
      () => configured,
      {},
    )
    expect(await read.available()).toBe(false)
    configured = path
    expect(await read.available()).toBe(true)
  })

  it('counts every track of the collection and lists it as rows to match against', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const read = rekordboxRead(
      () => path,
      () => path,
      {},
    )
    const rows = (await read.collection?.()) as CollectionTrack[]
    expect(await read.trackCount()).toBeGreaterThan(0)
    expect(rows.map((r) => r.title)).toContain('Night Train')
    expect(rows.find((r) => r.title === 'Night Train')?.path).toBe(
      '/Volumes/Public/Music/Night Train.aiff',
    )
  })

  it('answers which playlists hold each file of the collection, so the field can fill in', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const read = rekordboxRead(
      () => path,
      () => path,
      {},
    )
    expect(await read.membership(['/Volumes/Public/Music/Night Train.aiff'])).toEqual({
      '/Volumes/Public/Music/Night Train.aiff': ['2000'],
    })
  })

  it('answers no membership without a collection', async () => {
    const read = rekordboxRead(
      () => '',
      () => '',
      {},
    )
    expect(await read.membership(['/m/a.wav'])).toEqual({})
  })
})

describe('rekordboxEdit with an apply already running', () => {
  it('says the edit was written when that apply wrote it, not that it failed', async () => {
    const race = queueWithApplyInFlight('Nueva')
    const saving = rekordboxEdit(() => '/library/master.db', {
      isRunning: async () => false,
      queue: race.queue,
    }).save({ kind: 'create', parentId: 'root', name: 'Nueva', folder: false }, 'Nueva')
    await race.release()
    expect(await saving).toEqual({ applied: true, createdId: 'Nueva' })
  })
})
