// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RekordboxEditResult, SourcePlaylistEntry } from '../../../shared/types'
import '../i18n'
import { useRekordboxEdits } from './useRekordboxEdits'

afterEach(cleanup)

const row = (linkId: string): SourcePlaylistEntry => ({
  path: `/m/${linkId}.wav`,
  separator: false,
  meta: {},
  linkId,
})
const ORDER = [row('a'), row('b'), row('c')]

function setup(answer: Promise<RekordboxEditResult>) {
  const loadRekordboxPlaylist = vi.fn().mockResolvedValue(ORDER)
  ;(window as unknown as { api: unknown }).api = {
    loadRekordboxPlaylist,
    editRekordboxPlaylist: vi.fn(() => answer),
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
        queryFn: () => window.api.loadRekordboxPlaylist('f'),
        staleTime: Number.POSITIVE_INFINITY,
      }).data,
    }),
    { wrapper },
  )
  return { ...hook, notify, loadRekordboxPlaylist, client }
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
    expect(notify).toHaveBeenCalledWith('Nothing changed because rekordbox is still open', 'danger')
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
