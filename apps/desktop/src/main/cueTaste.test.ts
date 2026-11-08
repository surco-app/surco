import { describe, expect, it, vi } from 'vitest'
import { fingerprintOf, type TasteTrack, type TunedTaste } from '../shared/dropTaste'
import type { LearnTrack } from '../shared/learnFlow'
import {
  type CueTasteDeps,
  createCueTaste,
  RELEARN_AFTER_CORRECTIONS,
  RELEARN_EVERY,
  SHARE_AFTER_MS,
} from './cueTaste'
import type { CollectionMarks } from './rekordboxLearnFlow'

function memoryStore(text: string | null = null) {
  let saved = text
  return {
    read: () => saved,
    write: (t: string) => {
      saved = t
    },
  }
}

const track = (key: string, drops = [8]): TasteTrack => ({
  key,
  candidates: [{ bar: 8, features: [1] }],
  drops,
})

const TUNED: TunedTaste = {
  taste: { trees: [[[0.5]]], picking: { threshold: 0, spacingBars: 16, maxDrops: 3 } },
  check: {
    tracks: 40,
    checked: 12,
    before: { found: 0.5, right: 0.4 },
    after: { found: 0.7, right: 0.6 },
  },
}

function deps(over: Partial<CueTasteDeps> = {}): CueTasteDeps {
  return {
    readCollection: async () => null,
    tune: vi.fn(async () => TUNED),
    now: () => new Date('2026-10-28T10:00:00Z'),
    ...over,
  }
}

describe('createCueTaste', () => {
  it('starts without a profile, so Settings can invite the DJ to teach Surco', () => {
    expect(createCueTaste(memoryStore(), deps()).profile()).toBeNull()
  })

  it('learns from the rekordbox marks and the edits together, an edit winning over the same track in the collection', async () => {
    const tune = vi.fn(async () => TUNED)
    const collection: CollectionMarks = { learn: [], taste: [track('103', [4]), track('104')] }
    const taste = createCueTaste(
      memoryStore(),
      deps({ readCollection: async () => collection, tune }),
    )
    taste.record(track('103', [12]), false)
    taste.record(track('engine:7'), false)
    const profile = await taste.learn()
    const sent = (tune.mock.calls[0] as unknown as [TasteTrack[]])[0]
    expect(sent.map((t) => [t.key, t.drops])).toEqual([
      ['103', [12]],
      ['104', [8]],
      ['engine:7', [8]],
    ])
    expect(profile).toMatchObject({
      learnedAt: '2026-10-28T10:00:00.000Z',
      sources: { rekordbox: 0, edits: 2 },
      taste: TUNED.taste,
      check: TUNED.check,
    })
  })

  it('counts the rekordbox tracks it read marks from, so the profile says where it learned', async () => {
    const learn = [{ beats: [], cues: [], strong: [], phrases: [] } as LearnTrack]
    const taste = createCueTaste(
      memoryStore(),
      deps({ readCollection: async () => ({ learn: [...learn, ...learn], taste: [] }) }),
    )
    expect((await taste.learn()).sources.rekordbox).toBe(2)
  })

  it('keeps the profile and the edits across restarts', async () => {
    const store = memoryStore()
    const first = createCueTaste(store, deps())
    first.record(track('a'), false)
    await first.learn()
    const again = createCueTaste(store, deps())
    expect(again.profile()?.taste).toEqual(TUNED.taste)
    expect(again.edits()).toEqual({ count: 1, sinceLearn: 0 })
  })

  it('learns again on its own after enough edits when the DJ lets it, so Auto keeps up with their corrections', async () => {
    const tune = vi.fn(async () => TUNED)
    const taste = createCueTaste(memoryStore(), deps({ tune }))
    for (let i = 0; i < RELEARN_EVERY - 1; i++) taste.record(track(`t${i}`), true)
    expect(tune).not.toHaveBeenCalled()
    taste.record(track('last'), true)
    await vi.waitFor(() => expect(tune).toHaveBeenCalledTimes(1))
  })

  it('never learns on its own when the DJ turned it off', async () => {
    const tune = vi.fn(async () => TUNED)
    const taste = createCueTaste(memoryStore(), deps({ tune }))
    for (let i = 0; i < RELEARN_EVERY * 2; i++) taste.record(track(`t${i}`), false)
    await new Promise((r) => setTimeout(r, 0))
    expect(tune).not.toHaveBeenCalled()
    expect(taste.edits().sinceLearn).toBe(RELEARN_EVERY * 2)
  })

  it('learns sooner from corrections than from proposals taken as they came, because they are where Auto was wrong', async () => {
    const tune = vi.fn(async () => TUNED)
    const taste = createCueTaste(memoryStore(), deps({ tune }))
    for (let i = 0; i < RELEARN_AFTER_CORRECTIONS - 1; i++)
      taste.record({ ...track(`c${i}`), outcome: 'corrected' }, true)
    for (let i = 0; i < 4; i++) taste.record({ ...track(`a${i}`), outcome: 'accepted' }, true)
    await new Promise((r) => setTimeout(r, 0))
    expect(tune).not.toHaveBeenCalled()
    taste.record({ ...track('last'), outcome: 'manual' }, true)
    await vi.waitFor(() => expect(tune).toHaveBeenCalledTimes(1))
  })

  describe('when another Mac saved something new', () => {
    const others = (edits: TasteTrack[]) => ({
      write: vi.fn(),
      readOthers: vi.fn(() => edits),
    })

    it('learns from it on its own, so the DJ never has to ask Auto to catch up', async () => {
      const tune = vi.fn(async () => TUNED)
      const taste = createCueTaste(
        memoryStore(),
        deps({ tune, shared: others([track('x'), track('y')]) }),
      )
      taste.refresh(true)
      await vi.waitFor(() => expect(tune).toHaveBeenCalledTimes(1))
    })

    it('does not learn again when nothing changed since the last time', async () => {
      const tune = vi.fn(async () => TUNED)
      const taste = createCueTaste(memoryStore(), deps({ tune, shared: others([track('x')]) }))
      await taste.learn()
      taste.refresh(true)
      await new Promise((r) => setTimeout(r, 0))
      expect(tune).toHaveBeenCalledTimes(1)
    })

    it('does nothing when there are no other Macs', async () => {
      const tune = vi.fn(async () => TUNED)
      const taste = createCueTaste(memoryStore(), deps({ tune, shared: others([]) }))
      taste.refresh(true)
      await new Promise((r) => setTimeout(r, 0))
      expect(tune).not.toHaveBeenCalled()
    })

    it('stays quiet when the DJ turned learning off', async () => {
      const tune = vi.fn(async () => TUNED)
      const taste = createCueTaste(memoryStore(), deps({ tune, shared: others([track('x')]) }))
      taste.refresh(false)
      await new Promise((r) => setTimeout(r, 0))
      expect(tune).not.toHaveBeenCalled()
    })
  })

  it('runs one learning at a time when the button and the edits ask together', async () => {
    let finish: (t: TunedTaste) => void = () => {}
    const tune = vi.fn(
      () =>
        new Promise<TunedTaste>((r) => {
          finish = r
        }),
    )
    const taste = createCueTaste(memoryStore(), deps({ tune }))
    const a = taste.learn()
    const b = taste.learn()
    await vi.waitFor(() => expect(tune).toHaveBeenCalledTimes(1))
    finish(TUNED)
    expect(await a).toBe(await b)
  })

  it('starts over from an unreadable file instead of failing every edit after it', () => {
    const taste = createCueTaste(memoryStore('{not json'), deps())
    expect(taste.profile()).toBeNull()
    taste.record(track('a'), false)
    expect(taste.edits().count).toBe(1)
  })

  it('renames edits saved under a library id, so the same track edited again does not count twice', () => {
    const old = { key: '103', candidates: [{ bar: 8, features: [1] }], drops: [8] }
    const store = memoryStore(JSON.stringify({ version: 1, profile: null, edits: [old] }))
    const taste = createCueTaste(store, deps())
    taste.record({ ...old, key: fingerprintOf(old.candidates) }, false)
    expect(taste.edits().count).toBe(1)
  })

  describe('across Macs', () => {
    const sharedWith = (others: TasteTrack[] = []) => ({
      write: vi.fn<(machine: string, edits: TasteTrack[]) => void>(),
      readOthers: vi.fn<(machine: string) => TasteTrack[]>(() => others),
    })

    it('writes the edits to the shared folder under this Mac once the DJ pauses, so another Mac can learn from them', () => {
      vi.useFakeTimers()
      const shared = sharedWith()
      const taste = createCueTaste(memoryStore(), deps({ shared, newId: () => 'mac-a' }))
      taste.record(track('a'), false)
      expect(shared.write).not.toHaveBeenCalled()
      vi.advanceTimersByTime(SHARE_AFTER_MS)
      expect(shared.write).toHaveBeenLastCalledWith('mac-a', [track('a')])
      vi.useRealTimers()
    })

    it('writes a whole session of saves once, because the shared file is megabytes in a synced folder', () => {
      vi.useFakeTimers()
      const shared = sharedWith()
      const taste = createCueTaste(memoryStore(), deps({ shared }))
      for (const key of ['a', 'b', 'c']) {
        taste.record(track(key), false)
        vi.advanceTimersByTime(SHARE_AFTER_MS / 2)
      }
      expect(shared.write).not.toHaveBeenCalled()
      vi.advanceTimersByTime(SHARE_AFTER_MS)
      expect(shared.write).toHaveBeenCalledTimes(1)
      expect(shared.write.mock.calls[0][1]).toHaveLength(3)
      vi.useRealTimers()
    })

    it('writes right away when the app is closing, so the last saves are not stuck waiting', () => {
      vi.useFakeTimers()
      const shared = sharedWith()
      const taste = createCueTaste(memoryStore(), deps({ shared }))
      taste.record(track('a'), false)
      taste.flush()
      expect(shared.write).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(SHARE_AFTER_MS * 2)
      expect(shared.write).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })

    it('has nothing to write on close when nothing was saved', () => {
      const shared = sharedWith()
      createCueTaste(memoryStore(), deps({ shared })).flush()
      expect(shared.write).not.toHaveBeenCalled()
    })

    it('keeps the same Mac name after a restart, so it overwrites its own file instead of leaving copies', () => {
      const store = memoryStore()
      const shared = sharedWith()
      const first = createCueTaste(store, deps({ shared, newId: () => 'mac-a' }))
      first.record(track('a'), false)
      first.flush()
      const second = createCueTaste(store, deps({ shared, newId: () => 'mac-b' }))
      second.record(track('b'), false)
      second.flush()
      expect(shared.write.mock.calls.map(([machine]) => machine)).toEqual(['mac-a', 'mac-a'])
    })

    it('learns from what the other Macs saved, an edit made here winning over the same track there', async () => {
      const tune = vi.fn(async () => TUNED)
      const shared = sharedWith([track('x', [4]), track('a', [99])])
      const taste = createCueTaste(memoryStore(), deps({ shared, tune, newId: () => 'mac-a' }))
      taste.record(track('a', [12]), false)
      await taste.learn()
      const sent = (tune.mock.calls[0] as unknown as [TasteTrack[]])[0]
      expect(sent.map((t) => [t.key, t.drops])).toEqual([
        ['x', [4]],
        ['a', [12]],
      ])
      expect(shared.readOthers).toHaveBeenCalledWith('mac-a')
    })

    it('keeps the edit here when the shared folder refuses the write, so a full iCloud does not cost the DJ their lesson', () => {
      const shared = sharedWith()
      shared.write.mockImplementation(() => {
        throw new Error('disk full')
      })
      const taste = createCueTaste(memoryStore(), deps({ shared }))
      taste.record(track('a'), false)
      expect(() => taste.flush()).not.toThrow()
      expect(taste.edits().count).toBe(1)
    })

    it('learns without the shared folder when it cannot be read', async () => {
      const shared = sharedWith()
      shared.readOthers.mockImplementation(() => {
        throw new Error('not downloaded yet')
      })
      const taste = createCueTaste(memoryStore(), deps({ shared }))
      taste.record(track('a'), false)
      await expect(taste.learn()).resolves.toMatchObject({ sources: { edits: 1 } })
    })
  })
})
