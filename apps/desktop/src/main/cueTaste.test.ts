import { describe, expect, it, vi } from 'vitest'
import type { TasteTrack, TunedTaste } from '../shared/dropTaste'
import type { LearnTrack } from '../shared/learnFlow'
import { type CueTasteDeps, createCueTaste, RELEARN_EVERY } from './cueTaste'
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
})
