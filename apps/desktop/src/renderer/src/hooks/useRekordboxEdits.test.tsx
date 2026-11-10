// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RekordboxEditResult, SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import '../i18n'
import { takeOwnRemoval } from '../lib/ownRemovals'
import { djReads, type ProgramReads } from '../test/api'
import { useRekordboxEdits } from './useRekordboxEdits'

afterEach(cleanup)

const row = (linkId: string): SourcePlaylistEntry => ({
  path: `/m/${linkId}.wav`,
  separator: false,
  meta: {},
  linkId,
})
const ORDER = [row('a'), row('b'), row('c')]
const playlist = (id: string): SourceNode => ({ id, name: id, kind: 'playlist', count: 1 })
const TREE: SourceNode[] = [
  { id: 'A', name: 'A', kind: 'folder', count: 1, children: [playlist('a1')] },
  playlist('b'),
]

function setup(answer: Promise<RekordboxEditResult>) {
  const loadRekordboxPlaylist = vi.fn().mockResolvedValue(ORDER)
  const loadRekordboxTree = vi.fn().mockResolvedValue(TREE)
  ;(window as unknown as { api: unknown }).api = {
    dj: djReads({
      rekordbox: {
        playlist: loadRekordboxPlaylist,
        tree: loadRekordboxTree,
        editPlaylist: vi.fn(() => answer),
      },
    }),
  }
  const notify = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    () => ({
      edit: useRekordboxEdits(notify),
      entries: useQuery({
        queryKey: ['source-playlist', 'rekordbox', 'f'],
        queryFn: () => window.api.dj.playlist('rekordbox', 'f'),
        staleTime: Number.POSITIVE_INFINITY,
      }).data,
      tree: useQuery({
        queryKey: ['source-tree', 'rekordbox'],
        queryFn: () => window.api.dj.tree('rekordbox'),
        staleTime: Number.POSITIVE_INFINITY,
      }).data,
    }),
    { wrapper },
  )
  return { ...hook, notify, loadRekordboxPlaylist, loadRekordboxTree, client }
}

describe('useRekordboxEdits', () => {
  // The dragged row must not snap back while rekordbox is written; if the write is refused,
  // the re-read puts the collection's real order back and the notice says why.
  it('shows a move at once and returns to the real order when it is refused', async () => {
    let refuse: (r: RekordboxEditResult) => void = () => {}
    const { result, notify, loadRekordboxPlaylist } = setup(
      new Promise((resolve) => {
        refuse = resolve
      }),
    )
    await waitFor(() => expect(result.current.entries).toHaveLength(3))
    let done: Promise<RekordboxEditResult> = Promise.resolve({ applied: true })
    act(() => {
      done = result.current.edit(
        { kind: 'move', playlistId: 'f', linkIds: ['c'], beforeLinkId: 'a' },
        'Factory',
      )
    })
    await waitFor(() =>
      expect(result.current.entries?.map((e) => e.linkId)).toEqual(['c', 'a', 'b']),
    )
    await act(async () => {
      refuse({ applied: false, reason: 'cancelled' })
      await done
    })
    expect(loadRekordboxPlaylist).toHaveBeenCalledTimes(2)
    await waitFor(() =>
      expect(result.current.entries?.map((e) => e.linkId)).toEqual(['a', 'b', 'c']),
    )
    expect(notify).toHaveBeenCalledWith(
      'rekordbox is still open. The change will apply when you close it',
      'neutral',
    )
  })

  it('sends the playlist name with the edit, for the queue to show', async () => {
    const { result } = setup(Promise.resolve({ applied: true }))
    await act(async () => {
      await result.current.edit({ kind: 'rename', playlistId: 'f', name: 'Factory 26' }, 'Factory')
    })
    expect(window.api.dj.editPlaylist).toHaveBeenCalledWith(
      'rekordbox',
      { kind: 'rename', playlistId: 'f', name: 'Factory 26' },
      'Factory',
    )
  })

  it('re-reads the membership after an edit, since a deleted playlist changes the dots', async () => {
    const { result, client } = setup(Promise.resolve({ applied: true }))
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await act(async () => {
      await result.current.edit({ kind: 'delete', playlistId: 'f' }, 'Factory')
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rekordbox-membership'] })
  })

  // A focus re-read already in flight when the row is dropped answers with the order from
  // before the move; landing over the drawn move, it flashed the old order until the
  // re-read after the write put the new one back.
  it('keeps the drawn move over a re-read that started before it', async () => {
    const { result, loadRekordboxPlaylist, client } = setup(new Promise(() => {}))
    await waitFor(() => expect(result.current.entries).toHaveLength(3))
    let stale: (rows: SourcePlaylistEntry[]) => void = () => {}
    loadRekordboxPlaylist.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          stale = resolve
        }),
    )
    act(() => {
      void client.invalidateQueries({ queryKey: ['source-playlist'] })
    })
    await waitFor(() => expect(loadRekordboxPlaylist).toHaveBeenCalledTimes(2))
    act(() => {
      void result.current.edit(
        { kind: 'move', playlistId: 'f', linkIds: ['c'], beforeLinkId: 'a' },
        'Factory',
      )
    })
    await act(async () => {
      stale(ORDER)
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(result.current.entries?.map((e) => e.linkId)).toEqual(['c', 'a', 'b'])
  })

  it('reports an add by what it did with each track', async () => {
    const { result, notify } = setup(
      Promise.resolve({
        applied: true,
        report: { added: 1, already: 0, notInCollection: 1, ambiguous: 0 },
      }),
    )
    await act(async () => {
      await result.current.edit({ kind: 'add', playlistId: 'h', tracks: [] }, 'House')
    })
    expect(notify).toHaveBeenCalledWith(
      '1 track added to “House”. 1 is not in the rekordbox collection',
      'neutral',
    )
  })

  // A move that lands where it already was comes back applied with no write: the collection
  // is still re-read, but there is nothing to announce.
  it('re-reads and stays quiet for a move that changed nothing', async () => {
    const { result, notify, loadRekordboxPlaylist } = setup(Promise.resolve({ applied: true }))
    await waitFor(() => expect(result.current.entries).toHaveLength(3))
    await act(async () => {
      await result.current.edit(
        { kind: 'move', playlistId: 'f', linkIds: ['c'], beforeLinkId: null },
        'Factory',
      )
    })
    expect(loadRekordboxPlaylist).toHaveBeenCalledTimes(2)
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('useRekordboxEdits drawing the tree', () => {
  it('draws a created playlist in the tree at once, pending, and re-reads the tree after the write', async () => {
    let answer: (r: RekordboxEditResult) => void = () => {}
    const { result, loadRekordboxTree } = setup(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    await waitFor(() => expect(result.current.tree).toHaveLength(2))
    let done: Promise<RekordboxEditResult> = Promise.resolve({ applied: true })
    act(() => {
      done = result.current.edit(
        { kind: 'create', parentId: 'A', name: 'New', folder: false },
        'New',
      )
    })
    await waitFor(() =>
      expect(result.current.tree?.[0].children?.map((n) => n.name)).toEqual(['a1', 'New']),
    )
    expect(result.current.tree?.[0].children?.[1].id.startsWith('pending:')).toBe(true)
    await act(async () => {
      answer({ applied: true, createdId: '777' })
      await done
    })
    expect(loadRekordboxTree).toHaveBeenCalledTimes(2)
  })

  it('draws a rename, a delete and a node move before the program answers', async () => {
    const { result } = setup(new Promise(() => {}))
    await waitFor(() => expect(result.current.tree).toHaveLength(2))
    act(() => {
      void result.current.edit({ kind: 'rename', playlistId: 'b', name: 'B2' }, 'b')
    })
    await waitFor(() => expect(result.current.tree?.[1].name).toBe('B2'))
    act(() => {
      void result.current.edit(
        { kind: 'moveNode', playlistId: 'b', parentId: 'A', beforeId: 'a1' },
        'b',
      )
    })
    await waitFor(() =>
      expect(result.current.tree?.[0].children?.map((n) => n.id)).toEqual(['b', 'a1']),
    )
    act(() => {
      void result.current.edit({ kind: 'delete', playlistId: 'A' }, 'A')
    })
    await waitFor(() => expect(result.current.tree).toEqual([]))
  })

  it('returns to the real tree when the write is refused', async () => {
    let refuse: (r: RekordboxEditResult) => void = () => {}
    const { result } = setup(
      new Promise((resolve) => {
        refuse = resolve
      }),
    )
    await waitFor(() => expect(result.current.tree).toHaveLength(2))
    let done: Promise<RekordboxEditResult> = Promise.resolve({ applied: true })
    act(() => {
      done = result.current.edit({ kind: 'delete', playlistId: 'b' }, 'b')
    })
    await waitFor(() => expect(result.current.tree).toHaveLength(1))
    await act(async () => {
      refuse({ applied: false, reason: 'cancelled' })
      await done
    })
    await waitFor(() => expect(result.current.tree).toHaveLength(2))
  })

  it('marks what a delete takes as Surco’s own removal, so the open playlist closes quietly', async () => {
    const { result } = setup(new Promise(() => {}))
    await waitFor(() => expect(result.current.tree).toHaveLength(2))
    act(() => {
      void result.current.edit({ kind: 'delete', playlistId: 'A' }, 'A')
    })
    expect(takeOwnRemoval('a1')).toBe(true)
  })

  it('leaves no own-removal mark behind once a refused delete has settled', async () => {
    let refuse: (r: RekordboxEditResult) => void = () => {}
    const { result } = setup(
      new Promise((resolve) => {
        refuse = resolve
      }),
    )
    await waitFor(() => expect(result.current.tree).toHaveLength(2))
    let done: Promise<RekordboxEditResult> = Promise.resolve({ applied: true })
    act(() => {
      done = result.current.edit({ kind: 'delete', playlistId: 'b' }, 'b')
    })
    await act(async () => {
      refuse({ applied: false, reason: 'cancelled' })
      await done
    })
    expect(takeOwnRemoval('b')).toBe(false)
  })

  it('marks nothing for a move in rekordbox, whose ids survive it, so the moved open playlist stays open', async () => {
    const { result } = setup(new Promise(() => {}))
    await waitFor(() => expect(result.current.tree).toHaveLength(2))
    act(() => {
      void result.current.edit(
        { kind: 'moveNode', playlistId: 'b', parentId: 'A', beforeId: null },
        'b',
      )
    })
    await waitFor(() =>
      expect(result.current.tree?.[0].children?.map((n) => n.id)).toEqual(['a1', 'b']),
    )
    expect(takeOwnRemoval('b')).toBe(false)
  })

  it('keeps the drawn tree over a re-read that started before the edit', async () => {
    const { result, loadRekordboxTree, client } = setup(new Promise(() => {}))
    await waitFor(() => expect(result.current.tree).toHaveLength(2))
    let stale: (nodes: SourceNode[]) => void = () => {}
    loadRekordboxTree.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          stale = resolve
        }),
    )
    act(() => {
      void client.invalidateQueries({ queryKey: ['source-tree'] })
    })
    await waitFor(() => expect(loadRekordboxTree).toHaveBeenCalledTimes(2))
    act(() => {
      void result.current.edit({ kind: 'rename', playlistId: 'b', name: 'B2' }, 'b')
    })
    await act(async () => {
      stale(TREE)
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(result.current.tree?.[1].name).toBe('B2')
  })
})

describe('useRekordboxEdits on Traktor', () => {
  it('sends the edit to Traktor and names Traktor in what it reports', async () => {
    const editTraktorPlaylist = vi.fn(async () => ({
      applied: true as const,
      report: { added: 1, already: 0, notInCollection: 1, ambiguous: 0 },
    }))
    const editRekordboxPlaylist = vi.fn<ProgramReads['editPlaylist']>()
    ;(window as unknown as { api: unknown }).api = {
      dj: djReads({
        rekordbox: { editPlaylist: editRekordboxPlaylist },
        traktor: { editPlaylist: editTraktorPlaylist },
      }),
    }
    const notify = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useRekordboxEdits(notify, 'traktor'), { wrapper })
    await act(async () => {
      await result.current(
        { kind: 'add', playlistId: 'fri', tracks: [{ paths: ['/m/a.wav'] }] },
        'Friday',
      )
    })
    expect(editTraktorPlaylist).toHaveBeenCalled()
    expect(editRekordboxPlaylist).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(
      '1 track added to “Friday”. 1 is not in the Traktor collection',
      'neutral',
    )
  })

  function traktorEdits(answer: RekordboxEditResult) {
    ;(window as unknown as { api: unknown }).api = {
      dj: djReads({
        rekordbox: { editPlaylist: vi.fn() },
        traktor: { editPlaylist: vi.fn(async () => answer) },
      }),
    }
    const notify = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useRekordboxEdits(notify, 'traktor'), { wrapper })
    return { edit: result, notify, client }
  }

  it('names Traktor, not rekordbox, when Traktor refuses an edit', async () => {
    const { edit, notify } = traktorEdits({ applied: false, reason: 'read-only' })
    await act(async () => {
      await edit.current({ kind: 'rename', playlistId: 'fri', name: 'Sat' }, 'Friday')
    })
    expect(notify).toHaveBeenCalledWith(
      'The Traktor collection is read-only, so nothing changed',
      'danger',
    )
  })

  it('re-reads which rekordbox and Traktor playlists hold each track after an edit, and leaves Engine DJ’s alone since no edit reaches it', async () => {
    const { edit, client } = traktorEdits({ applied: true })
    for (const p of ['rekordbox', 'traktor', 'engine'])
      client.setQueryData([`${p}-membership`, ['/m/a.wav']], {})
    await act(async () => {
      await edit.current({ kind: 'rename', playlistId: 'fri', name: 'Sat' }, 'Friday')
    })
    const invalidated = (p: string) =>
      client.getQueryState([`${p}-membership`, ['/m/a.wav']])?.isInvalidated
    expect(invalidated('rekordbox')).toBe(true)
    expect(invalidated('traktor')).toBe(true)
    expect(invalidated('engine')).toBe(false)
  })
})

describe('useRekordboxEdits on Serato', () => {
  function seratoEdits(answer: RekordboxEditResult) {
    const editRekordboxPlaylist = vi.fn<ProgramReads['editPlaylist']>()
    const editSeratoPlaylist = vi.fn<ProgramReads['editPlaylist']>(async () => answer)
    ;(window as unknown as { api: unknown }).api = {
      dj: djReads({
        rekordbox: { editPlaylist: editRekordboxPlaylist },
        serato: { editPlaylist: editSeratoPlaylist },
      }),
    }
    const notify = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useRekordboxEdits(notify, 'serato'), { wrapper })
    return { edit: result, notify, client, editRekordboxPlaylist, editSeratoPlaylist }
  }

  it('sends the edit to Serato and names Serato and its crate in what it reports', async () => {
    const { edit, notify, editRekordboxPlaylist, editSeratoPlaylist } = seratoEdits({
      applied: true,
      report: { added: 1, already: 0, notInCollection: 1, ambiguous: 0 },
    })
    await act(async () => {
      await edit.current(
        { kind: 'add', playlistId: 'fri', tracks: [{ paths: ['/m/a.wav'] }] },
        'Friday',
      )
    })
    expect(editSeratoPlaylist).toHaveBeenCalled()
    expect(editRekordboxPlaylist).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(
      '1 track added to “Friday”. 1 is on another drive or no longer exists',
      'neutral',
    )
  })

  it('re-reads which Serato crates hold each track after an edit', async () => {
    const { edit, client } = seratoEdits({ applied: true })
    client.setQueryData(['serato-membership', ['/m/a.wav']], {})
    await act(async () => {
      await edit.current({ kind: 'rename', playlistId: 'fri', name: 'Sat' }, 'Friday')
    })
    expect(client.getQueryState(['serato-membership', ['/m/a.wav']])?.isInvalidated).toBe(true)
  })
})
