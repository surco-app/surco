import { describe, expect, it } from 'vitest'
import type { PlaylistRole, SessionAnswers } from '../../../shared/sessionTypes'
import type { AppleMusicTrackMeta, SourcePlaylistEntry } from '../../../shared/types'
import { runSession, sessionOptionsOf } from './sessionRun'

const ANSWERS: SessionAnswers = {
  minutes: 20,
  playMinutes: 10,
  sources: [],
  freshShare: 0,
  preferCombos: true,
  harmony: 'free',
  tasteWeight: true,
  alternate: false,
  surprise: false,
}

const row = (
  path: string,
  extra: Partial<SourcePlaylistEntry> = {},
  meta: AppleMusicTrackMeta = { bpm: '140' },
): SourcePlaylistEntry => ({
  path,
  separator: false,
  meta,
  preview: { title: path, artist: '', durationSec: 300, cues: [] },
  ...extra,
})

type Rows = ReadonlyMap<string, readonly SourcePlaylistEntry[]>

function run(
  over: Partial<SessionAnswers>,
  roles: Record<string, PlaylistRole>,
  rows: Record<string, SourcePlaylistEntry[]>,
  seed = 1,
  library: Record<string, 'base' | 'vocal'> = {},
  pins?: { pinned: { index: number; trackId: string }[]; length: number },
  startPath?: string,
  made?: ReadonlySet<string>,
) {
  return runSession({
    answers: { ...ANSWERS, ...over },
    roles,
    rows: new Map(Object.entries(rows)) as Rows,
    seed,
    library,
    pins,
    startPath,
    made,
  })
}

describe('runSession', () => {
  it('learns no order from a session Surco made, so a session never proves its own pairs', () => {
    const pairs = [row('/m/a.mp3'), row('/m/b.mp3'), row('/m/c.mp3')]
    const { combos, plan } = run(
      { sources: ['made1', 'made2'], minutes: 30 },
      { made1: 'any', made2: 'any' },
      { made1: pairs, made2: pairs },
      1,
      {},
      undefined,
      undefined,
      new Set(['made1', 'made2']),
    )
    expect(combos.size).toBe(0)
    expect(
      plan.items.some((item) => item.why.kind === 'combo' || item.why.kind === 'partner'),
    ).toBe(false)
    expect(plan.items).toHaveLength(3)
  })

  it('gives every track the role of the playlist it comes from', () => {
    const { pool } = run(
      { sources: ['bases', 'voices'] },
      { bases: 'base', voices: 'vocal' },
      { bases: [row('/m/a.mp3')], voices: [row('/m/b.mp3')] },
    )
    expect(pool.find((t) => t.id === '/m/a.mp3')?.role).toBe('base')
    expect(pool.find((t) => t.id === '/m/b.mp3')?.role).toBe('vocal')
  })

  it('mines combos from Mixed playlists only, since only there the order means something', () => {
    const { combos } = run(
      { sources: ['m1', 'm2', 'bases'] },
      { m1: 'any', m2: 'any', bases: 'base' },
      {
        m1: [row('/m/a.mp3'), row('/m/b.mp3'), row('/m/c.mp3')],
        m2: [row('/m/q.mp3'), row('/m/a.mp3'), row('/m/b.mp3')],
        bases: [row('/m/x.mp3'), row('/m/y.mp3'), row('/m/x2.mp3'), row('/m/y.mp3')],
      },
    )
    expect(combos.get('/m/a.mp3')?.get('/m/b.mp3')).toBe(2)
    expect(combos.get('/m/x.mp3')).toBeUndefined()
  })

  it('does not take for a combo a pair that only one playlist holds, since nothing repeats it', () => {
    const { combos } = run(
      { sources: ['m1', 'm2'] },
      { m1: 'any', m2: 'any' },
      {
        m1: [row('/m/a.mp3'), row('/m/b.mp3'), row('/m/c.mp3')],
        m2: [row('/m/q.mp3'), row('/m/a.mp3'), row('/m/b.mp3')],
      },
    )
    expect(combos.get('/m/b.mp3')?.get('/m/c.mp3')).toBeUndefined()
    expect(combos.get('/m/q.mp3')).toBeUndefined()
  })

  it('goes by a pair seen in a single set as a partner of the track it followed, without calling it a combo', () => {
    const { plan, combos } = run(
      { sources: ['bases', 'voices', 'set'], minutes: 30, preferCombos: true },
      { bases: 'base', voices: 'vocal', set: 'any' },
      {
        bases: [row('/m/a.mp3'), row('/m/c.mp3')],
        voices: [row('/m/b.mp3'), row('/m/d.mp3')],
        set: [row('/m/a.mp3'), row('/m/b.mp3')],
      },
    )
    expect(combos.size).toBe(0)
    expect(plan.items[0].track.id).toBe('/m/a.mp3')
    expect(plan.items[1].track.id).toBe('/m/b.mp3')
    expect(plan.items[1].why).toEqual({ kind: 'partner' })
    expect(plan.summary.combos).toBe(0)
  })

  it('keeps the pinned tracks at their positions when it draws the session again', () => {
    const entries = Array.from({ length: 30 }, (_, i) => row(`/m/t${i}.mp3`))
    const first = run(
      { sources: ['s'], minutes: 60, preferCombos: false },
      { s: 'any' },
      { s: entries },
    )
    const ids = first.plan.items.map((item) => item.track.id)
    const again = run(
      { sources: ['s'], minutes: 60, preferCombos: false },
      { s: 'any' },
      { s: entries },
      9,
      {},
      { pinned: [{ index: 2, trackId: ids[2] }], length: ids.length },
    )
    expect(again.plan.items[2].track.id).toBe(ids[2])
    expect(again.plan.items).toHaveLength(ids.length)
    expect(again.refs[2]).toEqual(first.refs[2])
  })

  it('gives a track that is only in a set the role of the library playlist that holds it', () => {
    const { pool } = run(
      { sources: ['set'] },
      { set: 'any' },
      {
        set: [row('/m/x.mp3'), row('/m/y.mp3'), row('/m/z.mp3')],
        libBases: [row('/m/x.mp3')],
        libVoices: [row('/m/y.mp3')],
      },
      1,
      { libBases: 'base', libVoices: 'vocal' },
    )
    const roleOf = (id: string) => pool.find((t) => t.id === id)?.role
    expect(roleOf('/m/x.mp3')).toBe('base')
    expect(roleOf('/m/y.mp3')).toBe('vocal')
    expect(roleOf('/m/z.mp3')).toBe('any')
  })

  it('does not bring in tracks that are only in the library playlists, which were not chosen', () => {
    const { pool } = run(
      { sources: ['set'] },
      { set: 'any' },
      { set: [row('/m/x.mp3')], libBases: [row('/m/x.mp3'), row('/m/other.mp3')] },
      1,
      { libBases: 'base' },
    )
    expect(pool.map((t) => t.id)).toEqual(['/m/x.mp3'])
  })

  it('reads a track as neutral when the library holds it as both a base and a vocal', () => {
    const { pool } = run(
      { sources: ['set'] },
      { set: 'any' },
      { set: [row('/m/x.mp3')], libBases: [row('/m/x.mp3')], libVoices: [row('/m/x.mp3')] },
      1,
      { libBases: 'base', libVoices: 'vocal' },
    )
    expect(pool[0].role).toBe('any')
  })

  it('works as before when there is no library', () => {
    const { pool } = run({ sources: ['set'] }, { set: 'any' }, { set: [row('/m/x.mp3')] })
    expect(pool[0].role).toBe('any')
  })

  it('starts from the strongest combo and says how many sets proved it', () => {
    const { plan } = run(
      { sources: ['s1', 's2'] },
      { s1: 'any', s2: 'any' },
      {
        s1: [row('/m/a.mp3'), row('/m/b.mp3'), row('/m/q.mp3')],
        s2: [row('/m/r.mp3'), row('/m/a.mp3'), row('/m/b.mp3')],
      },
    )
    expect(plan.items[0].track.id).toBe('/m/a.mp3')
    expect(plan.items[1].why).toEqual({ kind: 'combo', sets: 2 })
  })

  it('lists the tracks to write in session order, by content id when a row has one and path otherwise', () => {
    const { plan, refs } = run(
      { sources: ['s'], minutes: 5 },
      { s: 'any' },
      {
        s: [row('/m/a.mp3', { contentId: '7' }), row('/m/b.mp3')],
      },
    )
    const expected = plan.items.map((item) =>
      item.track.id === '7'
        ? { contentId: '7', paths: ['/m/a.mp3'] }
        : { contentId: undefined, paths: ['/m/b.mp3'] },
    )
    expect(refs).toEqual(expected)
    expect(refs).toHaveLength(plan.items.length)
  })

  it('gives the same session for the same seed and another for another seed', () => {
    const entries = Array.from({ length: 8 }, (_, i) => row(`/m/t${i}.mp3`))
    const input = { sources: ['s'], minutes: 40, preferCombos: false }
    const first = run(input, { s: 'any' }, { s: entries }, 5).plan.items.map((i) => i.track.id)
    const again = run(input, { s: 'any' }, { s: entries }, 5).plan.items.map((i) => i.track.id)
    const other = run(input, { s: 'any' }, { s: entries }, 6).plan.items.map((i) => i.track.id)
    expect(again).toEqual(first)
    expect(other).not.toEqual(first)
  })

  it('does not break when a chosen playlist has no rows loaded', () => {
    const { plan } = run(
      { sources: ['gone', 's'] },
      { gone: 'base', s: 'any' },
      {
        s: [row('/m/a.mp3')],
      },
    )
    expect(plan.items.map((i) => i.track.id)).toEqual(['/m/a.mp3'])
  })

  it('keeps a reference for every track of the pool, so one that was swapped in can be written', () => {
    const { pool, refsById } = run(
      { sources: ['s'] },
      { s: 'any' },
      { s: [row('/m/a.mp3', { contentId: '7' }), row('/m/b.mp3')] },
    )
    expect(refsById.size).toBe(pool.length)
    expect(refsById.get('7')).toEqual({ contentId: '7', paths: ['/m/a.mp3'] })
    expect(refsById.get('/m/b.mp3')).toEqual({ contentId: undefined, paths: ['/m/b.mp3'] })
  })

  it('rebuilds the builder options from the answers and the seed', () => {
    expect(
      sessionOptionsOf({ ...ANSWERS, minutes: 45, surprise: true, harmony: 'same' }, 9),
    ).toEqual({
      minutes: 45,
      playSecs: 600,
      preferCombos: true,
      harmony: 'same',
      tasteWeight: true,
      alternate: false,
      freshShare: 0,
      surprise: true,
      seed: 9,
    })
  })

  it('passes the answers to the builder', () => {
    const entries = [row('/m/a.mp3'), row('/m/b.mp3')]
    const { plan } = run({ sources: ['s'], minutes: 600 }, { s: 'any' }, { s: entries })
    expect(plan.summary.shortBySecs).toBe(600 * 60 - 600)
  })
})

describe('runSession starting from a track', () => {
  const rows = {
    a: ['/m/a.mp3', '/m/b.mp3', '/m/c.mp3', '/m/d.mp3', '/m/e.mp3'].map((path) => row(path)),
  }

  it('opens the session with the track at that path', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { plan } = run(
        { sources: ['a'], minutes: 60, playMinutes: 2 },
        {},
        rows,
        seed,
        {},
        undefined,
        '/m/d.mp3',
      )
      expect(plan.items[0].track.id, `seed ${seed}`).toBe('/m/d.mp3')
    }
  })

  it('finds the track by path when the program identifies tracks by content id', () => {
    const byContent = {
      a: ['/m/a.mp3', '/m/b.mp3', '/m/c.mp3'].map((path, i) => row(path, { contentId: `id${i}` })),
    }
    const { plan } = run(
      { sources: ['a'], minutes: 60, playMinutes: 2 },
      {},
      byContent,
      1,
      {},
      undefined,
      '/m/c.mp3',
    )
    expect(plan.items[0].track.id).toBe('id2')
  })

  it('builds as usual when that track is not in the chosen playlists', () => {
    const { plan } = run(
      { sources: ['a'], minutes: 60, playMinutes: 2 },
      {},
      rows,
      1,
      {},
      undefined,
      '/m/zzz.mp3',
    )
    expect(plan.items.length).toBeGreaterThan(0)
    expect(plan.items[0].why.kind).not.toBe('chosen')
  })
})
