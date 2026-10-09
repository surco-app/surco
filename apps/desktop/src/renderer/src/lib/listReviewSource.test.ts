// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { listReviewSource } from './listReviewSource'

const row = (path: string, artist: string, over: Partial<TrackItem> = {}): TrackItem => {
  const meta = { ...emptyMetadata(), title: 'Song', artist }
  return {
    id: path,
    inputPath: path,
    fileName: path,
    listLabel: 'Song',
    query: '',
    status: 'idle',
    meta,
    diskSignature: trackSignature({ meta }),
    ...over,
  }
}
let api: Record<string, ReturnType<typeof vi.fn>>
beforeEach(() => {
  api = {
    appleMusicFileEntries: vi.fn().mockResolvedValue({ consulted: true, entries: {} }),
    applyListFixes: vi.fn().mockResolvedValue([]),
    cancelListFixes: vi.fn().mockResolvedValue(undefined),
    onListFixProgress: vi.fn(() => () => {}),
    removeListDuplicates: vi.fn().mockResolvedValue([]),
    onListRemovalPhase: vi.fn(() => () => {}),
    setMusicField: vi.fn().mockResolvedValue('set'),
  }
  ;(window as unknown as { api: unknown }).api = api
})
const source = (rows: TrackItem[], over = {}) =>
  listReviewSource({
    rows: () => rows,
    mac: true,
    launchMusic: () => false,
    onRowsRemoved: vi.fn(),
    ...over,
  })
const hooks = () => ({
  isCancelled: () => false,
  onStep: vi.fn(),
  onDone: vi.fn(),
  onLibraries: vi.fn(),
  onCheckingMusic: vi.fn(),
})
const r = (removeId: string, keepId: string) => ({
  removeId,
  keepId,
  label: 'A - T',
  keepLabel: 'A - T',
})

describe('listReviewSource', () => {
  it('reviews the read rows, counts the rest and asks Music about the read ones only', async () => {
    const s = source([row('/m/a.aiff', 'A'), row('/m/b.aiff', 'B', { metaReadFailed: true })], {
      launchMusic: () => true,
    })
    const load = await s.load()
    expect(load).toMatchObject({ skipped: 1, musicConsulted: true })
    expect(load.entries.map((e) => e.id)).toEqual(['/m/a.aiff'])
    expect(api.appleMusicFileEntries).toHaveBeenCalledWith(
      [{ path: '/m/a.aiff', title: 'Song' }],
      true,
    )
  })

  it('never asks Music where there is none', async () => {
    const load = await source([row('/m/a.aiff', 'A')], { mac: false }).load()
    expect(api.appleMusicFileEntries).not.toHaveBeenCalled()
    expect(load.musicConsulted).toBeUndefined()
  })

  // The lookup carries no date added; a guess from the file system would be a different date.
  it('leaves the date added empty', async () => {
    api.appleMusicFileEntries.mockResolvedValue({
      consulted: true,
      entries: { '/m/a.aiff': [{ persistentId: 'A1', label: 'A - Song' }] },
    })
    const load = await source([row('/m/a.aiff', 'A')]).load()
    expect(load.entries[0].dateAdded).toBeUndefined()
  })

  // Several entries on one file: correcting one at random could leave the other wrong.
  it('names a Music entry for a write only when the file has exactly one', async () => {
    api.appleMusicFileEntries.mockResolvedValue({
      consulted: true,
      entries: {
        '/m/a.aiff': [{ persistentId: 'A1', label: 'x' }],
        '/m/b.aiff': [
          { persistentId: 'B1', label: 'x' },
          { persistentId: 'B2', label: 'x' },
        ],
      },
    })
    const s = source([row('/m/a.aiff', 'Dj Lara'), row('/m/b.aiff', 'Dj Lara')])
    await s.load()
    const fix = (id: string) => ({ id, field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara' })
    await s.applyFixes([fix('/m/a.aiff'), fix('/m/b.aiff')])
    expect(api.applyListFixes).toHaveBeenCalledWith({
      fixes: [fix('/m/a.aiff'), fix('/m/b.aiff')],
      music: { '/m/a.aiff': 'A1' },
    })
    expect(s.inMusic?.('/m/b.aiff')).toBe(true)
    expect(s.inMusic?.('/m/c.aiff')).toBe(false)
  })

  it('tells main which Music entries a removed copy and its kept copy have', async () => {
    api.appleMusicFileEntries.mockResolvedValue({
      consulted: true,
      entries: {
        '/m/old.aiff': [{ persistentId: 'OLD', label: 'A - T' }],
        '/m/keep.aiff': [{ persistentId: 'KEEP', label: 'A - T' }],
        '/m/twice.aiff': [
          { persistentId: 'T1', label: 'A - T' },
          { persistentId: 'T2', label: 'A - T' },
        ],
      },
    })
    const s = source([
      row('/m/old.aiff', 'A'),
      row('/m/keep.aiff', 'A'),
      row('/m/twice.aiff', 'A'),
      row('/m/free.aiff', 'A'),
    ])
    await s.load()
    await s.removeCopies(
      [
        r('/m/old.aiff', '/m/keep.aiff'),
        r('/m/twice.aiff', '/m/keep.aiff'),
        r('/m/old.aiff', '/m/free.aiff'),
        r('/m/free.aiff', '/m/keep.aiff'),
      ],
      hooks(),
    )
    expect(api.removeListDuplicates).toHaveBeenCalledWith([
      {
        from: '/m/old.aiff',
        to: '/m/keep.aiff',
        music: { removePid: 'OLD', label: 'A - T', keep: { persistentId: 'KEEP', label: 'A - T' } },
      },
      { from: '/m/twice.aiff', to: '/m/keep.aiff', music: 'ambiguous' },
      { from: '/m/old.aiff', to: '/m/free.aiff', music: { removePid: 'OLD', label: 'A - T' } },
      { from: '/m/free.aiff', to: '/m/keep.aiff' },
    ])
  })

  // Closed Music that was not opened answers nothing: "no entry" would let main assume the
  // file is free of Music, so every removal says the question went unasked.
  it('says Music is unknown for every copy when it could not be asked', async () => {
    api.appleMusicFileEntries.mockResolvedValue({ consulted: false, entries: {} })
    const s = source([row('/m/a.aiff', 'A'), row('/m/b.aiff', 'A')])
    await s.load()
    await s.removeCopies([r('/m/b.aiff', '/m/a.aiff')], hooks())
    expect(api.removeListDuplicates).toHaveBeenCalledWith([
      { from: '/m/b.aiff', to: '/m/a.aiff', music: 'unknown' },
    ])
  })

  it('says nothing about Music off macOS', async () => {
    const s = source([row('/m/a.aiff', 'A'), row('/m/b.aiff', 'A')], { mac: false })
    await s.load()
    await s.removeCopies([r('/m/b.aiff', '/m/a.aiff')], hooks())
    expect(api.removeListDuplicates).toHaveBeenCalledWith([{ from: '/m/b.aiff', to: '/m/a.aiff' }])
  })

  // The whole batch is one call in main, so its outcomes come back as they are, with no
  // Music-review result invented for them.
  it('hands back main outcomes as they are and steps once for the batch', async () => {
    const outcome = {
      from: '/m/b.aiff',
      fileTrashed: false,
      keptForLibrary: false,
      keptForMusic: true,
      music: 'held',
    }
    api.removeListDuplicates.mockResolvedValue([outcome])
    const s = source([row('/m/a.aiff', 'A'), row('/m/b.aiff', 'A')])
    await s.load()
    const h = hooks()
    const run = await s.removeCopies([r('/m/b.aiff', '/m/a.aiff')], h)
    expect(run).toEqual({
      removed: [],
      replaced: [outcome],
      librariesUntouched: false,
      replaceFailed: false,
    })
    expect(h.onStep).toHaveBeenCalledWith(1)
    expect(h.onDone).toHaveBeenCalledWith(1)
  })

  it('records a failed removal when main rejects', async () => {
    api.removeListDuplicates.mockRejectedValue(new Error('x'))
    const s = source([row('/m/a.aiff', 'A'), row('/m/b.aiff', 'A')])
    await s.load()
    const run = await s.removeCopies([r('/m/b.aiff', '/m/a.aiff')], hooks())
    expect(run).toMatchObject({ replaced: [], replaceFailed: true })
  })

  it('removes nothing once the run was stopped', async () => {
    const s = source([row('/m/a.aiff', 'A'), row('/m/b.aiff', 'A')])
    await s.load()
    await s.removeCopies([r('/m/b.aiff', '/m/a.aiff')], { ...hooks(), isCancelled: () => true })
    expect(api.removeListDuplicates).not.toHaveBeenCalled()
  })

  // Main reads every file Music holds before trashing, which takes most of a minute.
  it('passes on that main is checking Music, only while the removal runs', async () => {
    let phase: ((p: 'checking-music') => void) | undefined
    const off = vi.fn()
    api.onListRemovalPhase.mockImplementation((cb: (p: 'checking-music') => void) => {
      phase = cb
      return off
    })
    let finish: (v: unknown[]) => void = () => {}
    api.removeListDuplicates.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const s = source([row('/m/a.aiff', 'A'), row('/m/b.aiff', 'A')])
    await s.load()
    const h = hooks()
    const running = s.removeCopies([r('/m/b.aiff', '/m/a.aiff')], h)
    phase?.('checking-music')
    expect(h.onCheckingMusic).toHaveBeenCalledTimes(1)
    expect(off).not.toHaveBeenCalled()
    finish([])
    await running
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('locates a copy at its own path and stops the writes in main', async () => {
    const s = source([row('/m/a.aiff', 'A')])
    expect(await s.locate('/m/a.aiff')).toBe('/m/a.aiff')
    s.cancel()
    expect(api.cancelListFixes).toHaveBeenCalledTimes(1)
  })

  // The list commits its patch a render later; the recount must already see the fix and
  // the trashed copies gone, and those rows must leave the list.
  it('reloads with what it wrote and without what it trashed, and drops those rows', async () => {
    const onRowsRemoved = vi.fn()
    const s = source([row('/m/a.aiff', 'Dj Lara'), row('/m/b.aiff', 'DJ Lara')], { onRowsRemoved })
    s.settle?.(
      [{ path: '/m/a.aiff', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } }],
      ['/m/b.aiff'],
    )
    expect(onRowsRemoved).toHaveBeenCalledWith(['/m/b.aiff'])
    expect((await s.load()).entries).toEqual([
      expect.objectContaining({ id: '/m/a.aiff', artist: 'DJ Lara' }),
    ])
  })

  it('puts Music back on the entry the write went to, and nowhere when there was none', async () => {
    const s = source([])
    const f = { id: '/m/a.aiff', field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara' }
    const o = {
      id: '/m/a.aiff',
      fixes: [f],
      music: ['set' as const],
      file: 'written' as const,
      written: ['artist' as const],
    }
    await s.revertMusic({ ...o, musicId: 'PID' }, f)
    await s.revertMusic(o, f)
    expect(api.setMusicField).toHaveBeenCalledTimes(1)
    expect(api.setMusicField).toHaveBeenCalledWith('PID', 'artist', 'DJ Lara', 'Dj Lara')
  })

  describe('facts', () => {
    // A copy's analysis is read for every duplicate card on every render; over thousands
    // of rows each lookup must not walk the list again.
    it('reads a row by path without walking the list once per lookup', () => {
      const plain = Array.from({ length: 200 }, (_, i) => row(`/m/${i}.aiff`, 'A'))
      let reads = 0
      const rows = new Proxy(plain, {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1
          return Reflect.get(target, key, receiver)
        },
      })
      const s = source(rows)
      for (let i = 0; i < 200; i++) expect(s.facts?.(`/m/${i}.aiff`)).toBe(plain[i])
      expect(reads).toBeLessThanOrEqual(plain.length)
    })

    // The list hands a new array whenever a row changes, such as an analysis landing.
    it('sees the rows of the latest snapshot', () => {
      let rows = [row('/m/a.aiff', 'A')]
      const s = source([], { rows: () => rows })
      expect(s.facts?.('/m/a.aiff')?.spectrum).toBeUndefined()
      const analyzed = row('/m/a.aiff', 'A', {
        spectrum: { cutoffHz: 20500, sampleRateHz: 44100, processed: false, hasKnee: true },
      } as Partial<TrackItem>)
      rows = [analyzed]
      expect(s.facts?.('/m/a.aiff')).toBe(analyzed)
    })
  })
})
