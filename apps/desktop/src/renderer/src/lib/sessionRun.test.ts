import { describe, expect, it } from 'vitest'
import type { PlaylistRole, SessionAnswers } from '../../../shared/sessionTypes'
import type { AppleMusicTrackMeta, SourcePlaylistEntry } from '../../../shared/types'
import { runSession, sessionOptionsOf } from './sessionRun'

const ANSWERS: SessionAnswers = {
  minutes: 20,
  sources: [],
  fresh: [],
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
) {
  return runSession({
    answers: { ...ANSWERS, ...over },
    roles,
    rows: new Map(Object.entries(rows)) as Rows,
    seed,
  })
}

describe('runSession', () => {
  it('gives every track the role of the playlist it comes from', () => {
    const { pool } = run(
      { sources: ['bases', 'voices'] },
      { bases: 'base', voices: 'vocal' },
      { bases: [row('/m/a.mp3')], voices: [row('/m/b.mp3')] },
    )
    expect(pool.find((t) => t.id === '/m/a.mp3')?.role).toBe('base')
    expect(pool.find((t) => t.id === '/m/b.mp3')?.role).toBe('vocal')
  })

  it('mines combos from Set playlists only, since only there the order means something', () => {
    const { combos } = run(
      { sources: ['sets', 'bases'] },
      { sets: 'set', bases: 'base' },
      {
        sets: [row('/m/a.mp3'), row('/m/b.mp3'), row('/m/c.mp3')],
        bases: [row('/m/x.mp3'), row('/m/y.mp3'), row('/m/z.mp3')],
      },
    )
    expect(combos.get('/m/a.mp3')?.get('/m/b.mp3')).toBe(1)
    expect(combos.get('/m/x.mp3')).toBeUndefined()
  })

  it('starts from the strongest combo and says how many sets proved it', () => {
    const { plan } = run(
      { sources: ['s1', 's2'] },
      { s1: 'set', s2: 'set' },
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
      { s: 'set' },
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

  it('gives a new-track playlist the role it was marked with', () => {
    const { pool } = run(
      { sources: ['s'], fresh: ['new'] },
      { s: 'any', new: 'vocal' },
      { s: [row('/m/a.mp3')], new: [row('/m/n.mp3')] },
    )
    expect(pool.find((t) => t.id === '/m/n.mp3')).toMatchObject({ fresh: true, role: 'vocal' })
  })

  it('treats a new-track playlist with no role, or a Set role, as neutral', () => {
    const { pool } = run(
      { sources: ['s'], fresh: ['n1', 'n2'] },
      { s: 'any', n2: 'set' },
      { s: [row('/m/a.mp3')], n1: [row('/m/n1.mp3')], n2: [row('/m/n2.mp3')] },
    )
    expect(pool.find((t) => t.id === '/m/n1.mp3')?.role).toBe('any')
    expect(pool.find((t) => t.id === '/m/n2.mp3')?.role).toBe('any')
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
