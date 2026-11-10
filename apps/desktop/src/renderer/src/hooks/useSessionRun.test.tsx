// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaylistRole, SessionAnswers } from '../../../shared/sessionTypes'
import type { SourcePlaylistEntry } from '../../../shared/types'
import { type SessionRunDeps, useSessionRun } from './useSessionRun'
import type { SessionWriter } from './useSessionWrite'

afterEach(cleanup)

const ANSWERS: SessionAnswers = {
  minutes: 10,
  playMinutes: 10,
  sources: ['s'],
  freshShare: 0,
  preferCombos: false,
  harmony: 'free',
  tasteWeight: true,
  alternate: false,
  surprise: false,
}

const entry = (path: string): SourcePlaylistEntry => ({
  path,
  separator: false,
  meta: { bpm: '140' },
  preview: { title: path, artist: '', durationSec: 300, cues: [] },
})

const ROLES: Record<string, PlaylistRole> = { s: 'any' }

const ROWS = new Map([['s', [entry('/m/a.mp3'), entry('/m/b.mp3'), entry('/m/c.mp3')]]])

let create = vi.fn<SessionWriter['create']>()
let replace = vi.fn<SessionWriter['replace']>()
let fill = vi.fn<SessionWriter['fill']>()

function setup(over: Partial<SessionRunDeps> = {}) {
  create = vi.fn<SessionWriter['create']>(async () => 'new1')
  replace = vi.fn<SessionWriter['replace']>(async () => 'new2')
  fill = vi.fn<SessionWriter['fill']>(async () => true)
  const deps: SessionRunDeps = {
    rows: { load: vi.fn(async () => ROWS), reset: vi.fn(), loading: false, failed: [] },
    writer: { create, replace, fill },
    canWrite: async () => true,
    namesIn: () => new Set<string>(),
    nameFor: () => 'Sesión del 9-11',
    openPlaylist: vi.fn(),
    saveAnswers: vi.fn(),
    newSeed: () => 100,
    ...over,
  }
  const { result } = renderHook(() => useSessionRun(deps))
  return { deps, result }
}

describe('useSessionRun remembers the playlists it wrote', () => {
  it('notes the new playlist of a build, a redo and a fill as made by Surco', async () => {
    const noteMade = vi.fn()
    const { result } = setup({ noteMade })
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES)
    })
    expect(noteMade).toHaveBeenLastCalledWith('new1')
    await act(async () => {
      await result.current.redo()
    })
    expect(noteMade).toHaveBeenLastCalledWith('new2')
    await act(async () => {
      await result.current.fill({ id: 'empty', name: 'Vacía', parentId: 'root' }, ANSWERS, ROLES)
    })
    expect(noteMade).toHaveBeenLastCalledWith('empty')
  })

  it('hands the sessions it made to the run so their order is not learned', async () => {
    const made = () => new Set(['s'])
    const twice = new Map([
      ['s', [entry('/m/a.mp3'), entry('/m/b.mp3'), entry('/m/a.mp3'), entry('/m/b.mp3')]],
    ])
    const { result } = setup({
      made,
      rows: { load: vi.fn(async () => twice), reset: vi.fn(), loading: false, failed: [] },
    })
    await act(async () => {
      await result.current.build('folder', { ...ANSWERS, preferCombos: true }, ROLES)
    })
    const kinds = result.current.recent?.plan.items.map((item) => item.why.kind) ?? []
    expect(kinds).not.toContain('partner')
    expect(kinds).not.toContain('combo')
  })
})

describe('useSessionRun build', () => {
  it('saves the answers, writes the session as a new playlist and opens it', async () => {
    const { deps, result } = setup()

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.build('folder', ANSWERS, ROLES)
    })

    expect(outcome).toBe('built')
    expect(deps.saveAnswers).toHaveBeenCalledExactlyOnceWith(ANSWERS)
    expect(create).toHaveBeenCalledOnce()
    const [parent, name, refs] = create.mock.calls[0] as unknown as [string, string, unknown[]]
    expect(parent).toBe('folder')
    expect(name).toBe('Sesión del 9-11')
    expect(refs.length).toBeGreaterThan(0)
    expect(deps.openPlaylist).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'new1', name: 'Sesión del 9-11', kind: 'playlist' }),
    )
    expect(result.current.recent).toMatchObject({
      playlistId: 'new1',
      parentId: 'folder',
      name: 'Sesión del 9-11',
      seed: 100,
    })
  })

  it('reads the chosen playlists through the shared reader', async () => {
    const { deps, result } = setup()
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES)
    })
    expect(deps.rows.load).toHaveBeenCalledWith(['s'])
  })

  it('reports a refused write and leaves no band behind', async () => {
    const { deps, result } = setup({
      writer: {
        create: vi.fn(async () => null),
        replace: vi.fn(async () => null),
        fill,
      },
    })

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.build('folder', ANSWERS, ROLES)
    })

    expect(outcome).toBe('refused')
    expect(result.current.recent).toBeNull()
    expect(deps.openPlaylist).not.toHaveBeenCalled()
  })

  it('writes nothing when there is not a single track to put in', async () => {
    const { result } = setup({
      rows: { load: vi.fn(async () => new Map()), reset: vi.fn(), loading: false, failed: [] },
    })

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.build('folder', ANSWERS, ROLES)
    })

    expect(outcome).toBe('empty')
    expect(create).not.toHaveBeenCalled()
  })

  it('is busy while the write is going and ignores a second build meanwhile', async () => {
    let release: (id: string | null) => void = () => {}
    const create = vi.fn(() => new Promise<string | null>((resolve) => (release = resolve)))
    const { result } = setup({ writer: { create, replace: vi.fn(async () => null), fill } })

    let first: Promise<string> = Promise.resolve('')
    act(() => {
      first = result.current.build('folder', ANSWERS, ROLES)
    })
    expect(result.current.busy).toBe(true)
    let second: string | undefined
    await act(async () => {
      second = await result.current.build('folder', ANSWERS, ROLES)
    })
    expect(second).toBe('refused')
    expect(create).toHaveBeenCalledOnce()

    await act(async () => {
      release('new1')
      await first
    })
    expect(result.current.busy).toBe(false)
  })
})

async function built(over: Partial<SessionRunDeps> = {}) {
  const ctx = setup(over)
  await act(async () => {
    await ctx.result.current.build('folder', ANSWERS, ROLES)
  })
  return ctx
}

describe('useSessionRun starting from a track', () => {
  const buildFrom = async (path: string) => {
    const { result } = setup()
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES, path)
    })
    return result
  }

  it('writes the session starting with that track', async () => {
    const result = await buildFrom('/m/c.mp3')
    const refs = create.mock.calls[0][2]
    expect(refs[0].paths).toEqual(['/m/c.mp3'])
    expect(result.current.recent?.plan.items[0].track.id).toBe('/m/c.mp3')
  })

  it('locks that track so redoing the session keeps it first', async () => {
    const result = await buildFrom('/m/c.mp3')
    expect([...(result.current.recent?.locked ?? [])]).toEqual(['/m/c.mp3'])
    await act(async () => {
      await result.current.redo()
    })
    expect(result.current.recent?.plan.items[0].track.id).toBe('/m/c.mp3')
  })

  it('locks nothing when the session is built the usual way', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES)
    })
    expect(result.current.recent?.locked.size).toBe(0)
  })

  it('locks nothing when the track is not in the chosen playlists', async () => {
    const result = await buildFrom('/m/zzz.mp3')
    expect(result.current.recent?.locked.size).toBe(0)
  })
})

describe('useSessionRun locking tracks', () => {
  const idAt = (
    result: { current: { recent: { plan: { items: { track: { id: string } }[] } } | null } },
    i: number,
  ) => result.current.recent?.plan.items[i].track.id ?? ''

  it('starts with nothing locked', async () => {
    const { result } = await built()
    expect(result.current.recent?.locked.size).toBe(0)
  })

  it('locks a track and unlocks it with the same call', async () => {
    const { result } = await built()
    const id = idAt(result, 1)
    act(() => result.current.toggleLock(id))
    expect(result.current.recent?.locked.has(id)).toBe(true)
    act(() => result.current.toggleLock(id))
    expect(result.current.recent?.locked.has(id)).toBe(false)
  })

  it('writes nothing when a track is locked, since the playlist does not change', async () => {
    const { result } = await built()
    act(() => result.current.toggleLock(idAt(result, 0)))
    expect(replace).not.toHaveBeenCalled()
  })

  it('keeps the locked track at its place when it is redone', async () => {
    const { result } = await built()
    const id = idAt(result, 1)
    const refs = result.current.recent?.refsById.get(id)
    act(() => result.current.toggleLock(id))
    await act(async () => {
      await result.current.redo()
    })
    const written = replace.mock.calls[0][3]
    expect(written[1]).toEqual(refs)
    expect(result.current.recent?.plan.items[1].track.id).toBe(id)
  })

  it('goes on with the lock after redoing, so it can be redone again', async () => {
    const { result } = await built()
    const id = idAt(result, 1)
    act(() => result.current.toggleLock(id))
    await act(async () => {
      await result.current.redo()
    })
    expect(result.current.recent?.locked.has(id)).toBe(true)
  })

  it('redoes as before when nothing is locked', async () => {
    const { result } = await built()
    await act(async () => {
      await result.current.redo()
    })
    expect(replace).toHaveBeenCalledOnce()
    expect(result.current.recent?.locked.size).toBe(0)
  })

  it('locks the track that was put in by hand and frees the one it replaced', async () => {
    const { result } = await built()
    const replaced = idAt(result, 1)
    act(() => result.current.toggleLock(replaced))
    const spare = result.current.alternatives(1)[0]
    await act(async () => {
      await result.current.swap(1, spare)
    })
    expect(result.current.recent?.locked.has(spare.id)).toBe(true)
    expect(result.current.recent?.locked.has(replaced)).toBe(false)
  })

  it('lets go of the locks when the session is adjusted, since what was asked for changed', async () => {
    const { result } = await built()
    act(() => result.current.toggleLock(idAt(result, 1)))
    await act(async () => {
      await result.current.adjust({ ...ANSWERS, minutes: 10 }, ROLES)
    })
    expect(result.current.recent?.locked.size).toBe(0)
  })

  it('ignores a lock on a track that is not in the session', async () => {
    const { result } = await built()
    act(() => result.current.toggleLock('/m/gone.mp3'))
    expect(result.current.recent?.locked.has('/m/gone.mp3')).toBe(false)
  })
})

describe('useSessionRun reading the library roles', () => {
  const withLibrary = (rows: Map<string, SourcePlaylistEntry[]>) => ({
    rows: {
      load: vi.fn(
        async (ids: readonly string[]) => new Map([...rows].filter(([id]) => ids.includes(id))),
      ),
      reset: vi.fn(),
      loading: false,
      failed: [],
    },
    library: () => ({ lib: 'vocal' as const }),
  })

  it('reads the playlists the roles come from along with the chosen ones', async () => {
    const deps = withLibrary(new Map([...ROWS, ['lib', [entry('/m/a.mp3')]]]))
    const { result } = setup(deps)
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES)
    })
    expect(deps.rows.load).toHaveBeenCalledWith(['s', 'lib'])
  })

  it('does not read a playlist twice when it is chosen and also gives roles', async () => {
    const deps = {
      ...withLibrary(new Map(ROWS)),
      library: () => ({ s: 'base' as const }),
    }
    const { result } = setup(deps)
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES)
    })
    expect(deps.rows.load).toHaveBeenCalledWith(['s'])
  })

  it('gives the tracks of the set the role those playlists say', async () => {
    const deps = withLibrary(new Map([...ROWS, ['lib', [entry('/m/a.mp3')]]]))
    const { result } = setup(deps)
    await act(async () => {
      await result.current.build('folder', ANSWERS, { s: 'any' })
    })
    expect(result.current.recent?.pool.find((t) => t.id === '/m/a.mp3')?.role).toBe('vocal')
  })

  it('goes on when a playlist that gives roles could not be read', async () => {
    const deps = withLibrary(new Map(ROWS))
    const { result } = setup(deps)
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.build('folder', ANSWERS, ROLES)
    })
    expect(outcome).toBe('built')
  })

  it('reads nothing more when there is no library', async () => {
    const { deps, result } = setup()
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES)
    })
    expect(deps.rows.load).toHaveBeenCalledWith(['s'])
  })
})

describe('useSessionRun redo and adjust', () => {
  it('replaces the playlist with another draw of the same answers', async () => {
    const { deps, result } = await built()

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.redo()
    })

    expect(outcome).toBe('built')
    expect(replace).toHaveBeenCalledOnce()
    const [parent, oldId, name] = replace.mock.calls[0] as unknown as [string, string, string]
    expect([parent, oldId, name]).toEqual(['folder', 'new1', 'Sesión del 9-11'])
    expect(result.current.recent).toMatchObject({ playlistId: 'new2', seed: 101 })
    expect(deps.openPlaylist).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'new2' }))
  })

  it('keeps the band and the old playlist when the replacement is refused', async () => {
    const { result } = await built({
      writer: {
        create: vi.fn(async () => 'new1'),
        replace: vi.fn(async () => null),
        fill,
      },
    })

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.redo()
    })

    expect(outcome).toBe('refused')
    expect(result.current.recent).toMatchObject({ playlistId: 'new1', seed: 100 })
  })

  it('has nothing to redo before a session was built', async () => {
    const { result } = setup()
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.redo()
    })
    expect(outcome).toBe('refused')
    expect(replace).not.toHaveBeenCalled()
  })

  it('adjusts with new answers, saves them and replaces the playlist', async () => {
    const { deps, result } = await built()
    const adjusted = { ...ANSWERS, minutes: 15, surprise: true }

    await act(async () => {
      await result.current.adjust(adjusted, ROLES)
    })

    expect(deps.saveAnswers).toHaveBeenLastCalledWith(adjusted)
    expect(replace).toHaveBeenCalledOnce()
    expect(result.current.recent?.answers).toEqual(adjusted)
  })
})

describe('useSessionRun reading fresh rows', () => {
  it('reads the playlists again for a redo, so edits made since are seen', async () => {
    const { deps, result } = await built()
    await act(async () => {
      await result.current.redo()
    })
    expect(deps.rows.reset).toHaveBeenCalledOnce()
    const resetAt = vi.mocked(deps.rows.reset).mock.invocationCallOrder[0]
    const secondLoadAt = vi.mocked(deps.rows.load).mock.invocationCallOrder[1]
    expect(resetAt).toBeLessThan(secondLoadAt)
  })

  it('does the same for an adjust', async () => {
    const { deps, result } = await built()
    await act(async () => {
      await result.current.adjust(ANSWERS, ROLES)
    })
    expect(deps.rows.reset).toHaveBeenCalledOnce()
  })

  it('does not reset for the first build, which comes straight after the wizard read them', async () => {
    const { deps } = await built()
    expect(deps.rows.reset).not.toHaveBeenCalled()
  })

  it('does not reset for a swap, which reads no playlist', async () => {
    const { deps, result } = await built()
    const spare = result.current.alternatives(1)[0]
    await act(async () => {
      await result.current.swap(1, spare)
    })
    expect(deps.rows.reset).not.toHaveBeenCalled()
  })
})

describe('useSessionRun naming', () => {
  it('numbers the playlist when a sibling already has the name, and opens it under that name', async () => {
    const { deps, result } = setup({ namesIn: () => new Set(['Sesión del 9-11']) })
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES)
    })
    expect(create.mock.calls[0][1]).toBe('Sesión del 9-11 (2)')
    expect(deps.openPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Sesión del 9-11 (2)' }),
    )
    expect(result.current.recent?.name).toBe('Sesión del 9-11')
  })

  it('asks for the names of the folder the playlist goes in', async () => {
    const namesIn = vi.fn(() => new Set<string>())
    const { result } = setup({ namesIn })
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES)
    })
    expect(namesIn).toHaveBeenCalledWith('folder')
  })

  it('writes the replacement under a name the old playlist does not have, since it is still there', async () => {
    let existing = new Set<string>()
    const { result } = setup({ namesIn: () => existing })
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES)
    })
    existing = new Set(['Sesión del 9-11'])
    await act(async () => {
      await result.current.redo()
    })
    expect(replace.mock.calls[0][2]).toBe('Sesión del 9-11 (2)')
    existing = new Set(['Sesión del 9-11 (2)'])
    await act(async () => {
      await result.current.redo()
    })
    expect(replace.mock.calls[1][2]).toBe('Sesión del 9-11')
  })

  it('does the same when a track is swapped', async () => {
    let existing = new Set<string>()
    const { result } = setup({ namesIn: () => existing })
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES)
    })
    existing = new Set(['Sesión del 9-11'])
    const spare = result.current.alternatives(1)[0]
    await act(async () => {
      await result.current.swap(1, spare)
    })
    expect(replace.mock.calls[0][2]).toBe('Sesión del 9-11 (2)')
  })
})

describe('useSessionRun with the DJ program open', () => {
  it('writes nothing and says so when a DJ program is open, so no half-made playlist is queued', async () => {
    const { deps, result } = setup({ canWrite: async () => false })

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.build('folder', ANSWERS, ROLES)
    })

    expect(outcome).toBe('closed')
    expect(create).not.toHaveBeenCalled()
    expect(deps.openPlaylist).not.toHaveBeenCalled()
    expect(result.current.recent).toBeNull()
  })

  it('does not even read the playlists when it cannot write', async () => {
    const { deps, result } = setup({ canWrite: async () => false })
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES)
    })
    expect(deps.rows.load).not.toHaveBeenCalled()
    expect(deps.saveAnswers).not.toHaveBeenCalled()
  })

  it('leaves the playlist and the band as they were when a redo finds the program open', async () => {
    let open = false
    const { result } = await built({ canWrite: async () => !open })
    const before = result.current.recent
    open = true

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.redo()
    })

    expect(outcome).toBe('closed')
    expect(replace).not.toHaveBeenCalled()
    expect(result.current.recent).toBe(before)
  })

  it('does the same for an adjust and for a swap', async () => {
    let open = false
    const { result } = await built({ canWrite: async () => !open })
    const spare = result.current.alternatives(1)[0]
    open = true

    let adjusted: string | undefined
    let swapped: string | undefined
    await act(async () => {
      adjusted = await result.current.adjust(ANSWERS, ROLES)
      swapped = await result.current.swap(1, spare)
    })

    expect(adjusted).toBe('closed')
    expect(swapped).toBe('closed')
    expect(replace).not.toHaveBeenCalled()
  })

  it('checks again right before writing, in case a program opened while the playlists were read', async () => {
    const canWrite = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false)
    const { result } = setup({ canWrite })

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.build('folder', ANSWERS, ROLES)
    })

    expect(outcome).toBe('closed')
    expect(canWrite).toHaveBeenCalledTimes(2)
    expect(create).not.toHaveBeenCalled()
  })

  it('checks again before a redo writes as well', async () => {
    let calls = 0
    const { result } = await built({ canWrite: async () => ++calls <= 2 })
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.redo()
    })
    expect(outcome).toBe('closed')
    expect(replace).not.toHaveBeenCalled()
  })

  it('writes again once the program is closed', async () => {
    let open = true
    const { result } = setup({ canWrite: async () => !open })
    await act(async () => {
      await result.current.build('folder', ANSWERS, ROLES)
    })
    expect(create).not.toHaveBeenCalled()
    open = false

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.build('folder', ANSWERS, ROLES)
    })

    expect(outcome).toBe('built')
    expect(create).toHaveBeenCalledOnce()
  })
})

describe('useSessionRun roles', () => {
  const SET_ROWS = new Map([
    ['s', [entry('/m/a.mp3'), entry('/m/b.mp3'), entry('/m/c.mp3')]],
    ['t', [entry('/m/a.mp3'), entry('/m/b.mp3')]],
  ])

  it('builds with the roles it is given, so a role just chosen counts before it is saved', async () => {
    const { result } = setup({
      rows: { load: vi.fn(async () => SET_ROWS), reset: vi.fn(), loading: false, failed: [] },
    })
    await act(async () => {
      await result.current.build(
        'folder',
        { ...ANSWERS, sources: ['s', 't'], preferCombos: true },
        { s: 'any', t: 'any' },
      )
    })
    expect(result.current.recent?.plan.items[0].track.id).toBe('/m/a.mp3')
    expect(result.current.recent?.plan.items[1].why).toEqual({ kind: 'combo', sets: 2 })
  })

  it('keeps those roles for the redo, whatever the settings say by then', async () => {
    const { result } = setup({
      rows: { load: vi.fn(async () => SET_ROWS), reset: vi.fn(), loading: false, failed: [] },
    })
    await act(async () => {
      await result.current.build(
        'folder',
        { ...ANSWERS, sources: ['s', 't'], preferCombos: true },
        { s: 'any', t: 'any' },
      )
    })
    await act(async () => {
      await result.current.redo()
    })
    expect(result.current.recent?.roles).toEqual({ s: 'any', t: 'any' })
    expect(result.current.recent?.plan.items[1].why).toEqual({ kind: 'combo', sets: 2 })
  })

  it('adjusts with the roles chosen in the wizard', async () => {
    const { result } = await built()
    await act(async () => {
      await result.current.adjust(ANSWERS, { s: 'base' })
    })
    expect(result.current.recent?.roles).toEqual({ s: 'base' })
  })
})

describe('useSessionRun swapping a track', () => {
  it('offers the tracks that were left out of the session for a place', async () => {
    const { result } = await built()
    const inPlan = result.current.recent?.plan.items.map((item) => item.track.id) ?? []
    const offered = result.current.alternatives(1)
    expect(offered).toHaveLength(1)
    expect(inPlan).not.toContain(offered[0].id)
  })

  it('offers nothing before a session was built', () => {
    const { result } = setup()
    expect(result.current.alternatives(0)).toEqual([])
  })

  it('swaps by replacing the playlist with the new order, marking the track as chosen by hand', async () => {
    const { result } = await built()
    const spare = result.current.alternatives(1)[0]

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.swap(1, spare)
    })

    expect(outcome).toBe('built')
    const written = replace.mock.calls[0][3]
    expect(written).toHaveLength(2)
    expect(written[1]).toEqual({ contentId: undefined, paths: [spare.id] })
    expect(result.current.recent?.playlistId).toBe('new2')
    expect(result.current.recent?.plan.items[1]).toMatchObject({
      track: { id: spare.id },
      why: { kind: 'chosen' },
    })
  })

  it('counts the swapped track for the time it plays, as the rest of the session does', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.build('folder', { ...ANSWERS, minutes: 4, playMinutes: 2 }, ROLES)
    })
    expect(result.current.recent?.plan.summary.secs).toBe(240)
    const spare = result.current.alternatives(1)[0]
    await act(async () => {
      await result.current.swap(1, spare)
    })
    expect(result.current.recent?.plan.summary.secs).toBe(240)
  })

  it('keeps the seed, so a redo goes on from where the draw was', async () => {
    const { result } = await built()
    const spare = result.current.alternatives(1)[0]
    await act(async () => {
      await result.current.swap(1, spare)
    })
    expect(result.current.recent?.seed).toBe(100)
  })

  it('keeps the plan and the old playlist when the swap is refused', async () => {
    const { result } = await built({
      writer: { create: vi.fn(async () => 'new1'), replace: vi.fn(async () => null), fill },
    })
    const before = result.current.recent?.plan
    const spare = result.current.alternatives(1)[0]

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.swap(1, spare)
    })

    expect(outcome).toBe('refused')
    expect(result.current.recent?.plan).toBe(before)
    expect(result.current.recent?.playlistId).toBe('new1')
  })

  it('has nothing to swap before a session was built or for a place that does not exist', async () => {
    const empty = setup()
    let outcome: string | undefined
    await act(async () => {
      outcome = await empty.result.current.swap(0, {
        id: 'z',
        role: 'any',
        key: null,
        bpm: 0,
        rating: 0,
        plays: 0,
        secs: 0,
        fresh: false,
        title: 'z',
        artist: '',
      })
    })
    expect(outcome).toBe('refused')
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('useSessionRun keeping and editing', () => {
  it('drops the band when the session is kept, writing nothing', async () => {
    const { result } = await built()
    act(() => result.current.keep())
    expect(result.current.recent).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it('drops the band when the user edits that playlist', async () => {
    const { result } = await built()
    act(() => result.current.noteEdit('new1'))
    expect(result.current.recent).toBeNull()
  })

  it('keeps the band when the edit was on another playlist', async () => {
    const { result } = await built()
    act(() => result.current.noteEdit('other'))
    expect(result.current.recent).not.toBeNull()
  })
})

const EMPTY = { id: 'empty', name: 'Session 11-9', parentId: 'folder' }

describe('useSessionRun fill', () => {
  it('puts the session into the playlist that already exists, without making another one', async () => {
    const { deps, result } = setup()

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.fill(EMPTY, ANSWERS, ROLES)
    })

    expect(outcome).toBe('built')
    expect(create).not.toHaveBeenCalled()
    expect(fill).toHaveBeenCalledOnce()
    const [id, name, refs] = fill.mock.calls[0] as unknown as [string, string, unknown[]]
    expect(id).toBe('empty')
    expect(name).toBe('Session 11-9')
    expect(refs.length).toBeGreaterThan(0)
    expect(deps.saveAnswers).toHaveBeenCalledExactlyOnceWith(ANSWERS)
    expect(deps.openPlaylist).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'empty', name: 'Session 11-9', kind: 'playlist' }),
    )
  })

  it('shows the band over that playlist, so it can be redone, adjusted or swapped', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.fill(EMPTY, ANSWERS, ROLES)
    })
    expect(result.current.recent).toMatchObject({
      playlistId: 'empty',
      parentId: 'folder',
      name: 'Session 11-9',
      seed: 100,
    })
  })

  it('redoes it by replacing that playlist, under the other name', async () => {
    const { result } = setup({ namesIn: () => new Set(['Session 11-9']) })
    await act(async () => {
      await result.current.fill(EMPTY, ANSWERS, ROLES)
    })
    await act(async () => {
      await result.current.redo()
    })
    expect(replace).toHaveBeenCalledOnce()
    expect(replace.mock.calls[0].slice(0, 3)).toEqual(['folder', 'empty', 'Session 11-9 (2)'])
  })

  it('reports a refused write and leaves no band behind', async () => {
    const { deps, result } = setup()
    fill.mockResolvedValue(false)

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.fill(EMPTY, ANSWERS, ROLES)
    })

    expect(outcome).toBe('refused')
    expect(result.current.recent).toBeNull()
    expect(deps.openPlaylist).not.toHaveBeenCalled()
  })

  it('writes nothing when there is not a single track to put in', async () => {
    const { result } = setup({
      rows: { load: vi.fn(async () => new Map()), reset: vi.fn(), loading: false, failed: [] },
    })
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.fill(EMPTY, ANSWERS, ROLES)
    })
    expect(outcome).toBe('empty')
    expect(fill).not.toHaveBeenCalled()
  })

  it('writes nothing while a DJ program is open', async () => {
    const { result } = setup({ canWrite: async () => false })
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.fill(EMPTY, ANSWERS, ROLES)
    })
    expect(outcome).toBe('closed')
    expect(fill).not.toHaveBeenCalled()
  })
})
