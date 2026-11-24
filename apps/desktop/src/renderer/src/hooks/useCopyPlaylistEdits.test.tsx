// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DjProgram } from '../../../shared/djProgram'
import type {
  PlaylistLibrary,
  RekordboxEditResult,
  SourcePlaylistEntry,
} from '../../../shared/types'
import '../i18n'
import type { Membership } from '../lib/rekordboxPlaylists'
import { takeShortcutUndo } from '../lib/shortcutUndo'
import { ToastProvider } from '../lib/toastContext'
import { djReads, installApi } from '../test/api'
import { queuedKey, useCopyPlaylistEdits } from './useCopyPlaylistEdits'

const COPY = '/r/a.aiff'

const row = (path: string | null, linkId: string): SourcePlaylistEntry => ({
  path,
  separator: false,
  meta: {} as SourcePlaylistEntry['meta'],
  linkId,
})

const ADDED_ONE: RekordboxEditResult = {
  applied: true,
  report: { added: 1, already: 0, notInCollection: 0, ambiguous: 0 },
}

function setup({
  library = 'rekordbox',
  edits = [],
  playlists = [],
  membership = {},
}: {
  library?: PlaylistLibrary
  edits?: RekordboxEditResult[]
  playlists?: SourcePlaylistEntry[][]
  membership?: Membership
} = {}) {
  const editPlaylist = vi.fn<(...args: unknown[]) => Promise<RekordboxEditResult>>()
  for (const result of edits) editPlaylist.mockResolvedValueOnce(result)
  editPlaylist.mockResolvedValue({ applied: true })
  const playlist = vi.fn<(id: string) => Promise<SourcePlaylistEntry[]>>()
  for (const entries of playlists) playlist.mockResolvedValueOnce(entries)
  playlist.mockResolvedValue([])
  const dj = djReads({ [library as DjProgram]: { editPlaylist, playlist } })
  installApi({ dj })
  const reportUndo = vi.fn((_message: string, _onUndo: () => void) => () => {})
  const reportNotice = vi.fn()
  const reportError = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider value={{ reportUndo, reportNotice, reportError }}>{children}</ToastProvider>
    </QueryClientProvider>
  )
  const hook = renderHook(
    ({ membership: m }: { membership: Membership }) => useCopyPlaylistEdits(library, m),
    { wrapper, initialProps: { membership } },
  )
  const undo = async () => {
    await act(async () => {
      reportUndo.mock.calls[0][1]()
    })
    await waitFor(() => expect(dj.editPlaylist).toHaveBeenCalledTimes(edits.length + 1))
  }
  return { hook, dj, playlist, reportUndo, reportNotice, reportError, undo }
}

afterEach(() => {
  takeShortcutUndo()
})

describe('useCopyPlaylistEdits', () => {
  it('adds the copy to the playlist right away and offers Undo, so the DJ never leaves Surco to file it', async () => {
    const { hook, dj, reportUndo } = setup({ edits: [ADDED_ONE] })
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, true))
    expect(dj.editPlaylist).toHaveBeenCalledWith(
      'rekordbox',
      { kind: 'add', playlistId: 'p1', tracks: [{ paths: [COPY] }] },
      'Verano',
    )
    expect(reportUndo).toHaveBeenCalledWith(
      expect.stringContaining('1 track added'),
      expect.any(Function),
      expect.any(Function),
    )
  })

  it('offers no Undo when the copy was already in the playlist, so Undo never takes out a row the DJ filed', async () => {
    const { hook, reportUndo, reportNotice } = setup({
      edits: [
        { applied: true, report: { added: 0, already: 1, notInCollection: 0, ambiguous: 0 } },
      ],
    })
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, true))
    expect(reportNotice).toHaveBeenCalled()
    expect(reportUndo).not.toHaveBeenCalled()
  })

  it('takes out only the rows it added on Undo, leaving a copy the DJ had filed before', async () => {
    const OTHER = '/r/b.aiff'
    const { hook, dj, undo } = setup({
      edits: [
        { applied: true, report: { added: 1, already: 1, notInCollection: 0, ambiguous: 0 } },
      ],
      playlists: [[row(OTHER, 'L1')], [row(OTHER, 'L1'), row(COPY, 'L5')]],
    })
    await act(() => hook.result.current.toggle([COPY, OTHER], { id: 'p1', name: 'Verano' }, true))
    await undo()
    expect(dj.editPlaylist).toHaveBeenLastCalledWith(
      'rekordbox',
      { kind: 'remove', playlistId: 'p1', linkIds: ['L5'] },
      'Verano',
    )
  })

  it('says in red when Undo cannot read the playlist, so the DJ knows the copy is still there', async () => {
    const { hook, playlist, reportUndo, reportError } = setup({ edits: [ADDED_ONE] })
    playlist.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('locked'))
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, true))
    await act(async () => {
      reportUndo.mock.calls[0][1]()
    })
    await waitFor(() => expect(reportError).toHaveBeenCalledWith(expect.stringContaining('Surco')))
  })

  it('says nothing went in, without Undo, when the program had nothing to add', async () => {
    const { hook, reportUndo, reportNotice, reportError } = setup({
      edits: [
        {
          applied: false,
          reason: 'nothing-to-add',
          report: { added: 0, already: 0, notInCollection: 1, ambiguous: 0 },
        },
      ],
    })
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, true))
    expect(reportNotice).toHaveBeenCalledWith(expect.stringContaining('Verano'))
    expect(reportUndo).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
  })

  it('asks to apply now or later first, like the sidebar', async () => {
    const { hook, dj } = setup({ edits: [ADDED_ONE] })
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, true))
    expect(dj.askToApply).toHaveBeenCalledWith(['rekordbox'])
    expect(vi.mocked(dj.askToApply).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(dj.editPlaylist).mock.invocationCallOrder[0],
    )
  })

  it('takes the added copy back out on Undo', async () => {
    const { hook, dj, undo } = setup({
      edits: [ADDED_ONE],
      playlists: [[row('/r/other.aiff', 'L1')], [row('/r/other.aiff', 'L1'), row(COPY, 'L7')]],
    })
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, true))
    await undo()
    expect(dj.editPlaylist).toHaveBeenLastCalledWith(
      'rekordbox',
      { kind: 'remove', playlistId: 'p1', linkIds: ['L7'] },
      'Verano',
    )
  })

  it('removes every row of the copy and on Undo puts one row back before the row that followed it', async () => {
    const { hook, dj, reportUndo } = setup({
      edits: [{ applied: true }, ADDED_ONE, { applied: true }],
      playlists: [
        [row('/r/x.aiff', 'a'), row(COPY, 'L2'), row(COPY, 'L4'), row('/r/y.aiff', 'b')],
        [row('/r/x.aiff', 'a'), row('/r/y.aiff', 'b'), row(COPY, 'L9')],
      ],
      membership: { [COPY]: ['p1'] },
    })
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, false))
    expect(dj.editPlaylist).toHaveBeenCalledWith(
      'rekordbox',
      { kind: 'remove', playlistId: 'p1', linkIds: ['L2', 'L4'] },
      'Verano',
    )
    expect(reportUndo.mock.calls[0][0]).toBe('2 tracks removed from “Verano”')
    await act(async () => {
      reportUndo.mock.calls[0][1]()
    })
    await waitFor(() => expect(dj.editPlaylist).toHaveBeenCalledTimes(3))
    expect(dj.editPlaylist).toHaveBeenNthCalledWith(
      2,
      'rekordbox',
      { kind: 'add', playlistId: 'p1', tracks: [{ paths: [COPY] }] },
      'Verano',
    )
    expect(dj.editPlaylist).toHaveBeenNthCalledWith(
      3,
      'rekordbox',
      { kind: 'move', playlistId: 'p1', linkIds: ['L9'], beforeLinkId: 'b' },
      'Verano',
    )
  })

  it('puts the copy back in its place on Undo in a program whose row handles are positions, like Traktor', async () => {
    const { hook, dj, undo } = setup({
      library: 'traktor',
      edits: [{ applied: true }, ADDED_ONE],
      playlists: [
        [row('/r/x.aiff', 'u:0:x'), row(COPY, 'u:1:c'), row('/r/y.aiff', 'u:2:y')],
        [row('/r/x.aiff', 'u:0:x'), row('/r/y.aiff', 'u:1:y'), row(COPY, 'u:2:c')],
      ],
      membership: { [COPY]: ['p1'] },
    })
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, false))
    await undo()
    await waitFor(() => expect(dj.editPlaylist).toHaveBeenCalledTimes(3))
    expect(dj.editPlaylist).toHaveBeenLastCalledWith(
      'traktor',
      { kind: 'move', playlistId: 'p1', linkIds: ['u:2:c'], beforeLinkId: 'u:1:y' },
      'Verano',
    )
  })

  it('creates the playlist with the copy inside and deletes it on Undo', async () => {
    const { hook, dj, undo } = setup({
      edits: [{ ...ADDED_ONE, createdId: 'n1' }],
    })
    await act(() => hook.result.current.toggle([COPY], { name: 'Nueva' }, true))
    expect(dj.editPlaylist).toHaveBeenCalledWith(
      'rekordbox',
      {
        kind: 'create',
        parentId: 'root',
        name: 'Nueva',
        folder: false,
        tracks: [{ paths: [COPY] }],
      },
      'Nueva',
    )
    await undo()
    expect(dj.editPlaylist).toHaveBeenLastCalledWith(
      'rekordbox',
      { kind: 'delete', playlistId: 'n1' },
      'Nueva',
    )
  })

  it('keeps a queued change ticked and offers no Undo while the program is open', async () => {
    const { hook, reportUndo, reportNotice } = setup({
      edits: [{ applied: false, queued: true, opId: 'o' }],
      membership: { [COPY]: [] },
    })
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, true))
    expect(reportNotice).toHaveBeenCalled()
    expect(reportUndo).not.toHaveBeenCalled()
    expect(hook.result.current.queued.get(queuedKey(COPY, 'p1'))).toBe(true)
    hook.rerender({ membership: { [COPY]: ['p2'] } })
    expect(hook.result.current.queued.get(queuedKey(COPY, 'p1'))).toBe(true)
    hook.rerender({ membership: { [COPY]: ['p1', 'p2'] } })
    await waitFor(() => expect(hook.result.current.queued.has(queuedKey(COPY, 'p1'))).toBe(false))
  })

  it('says the refusal in red and changes nothing when the write fails', async () => {
    const { hook, reportUndo, reportError } = setup({
      edits: [{ applied: false, reason: 'write-failed' }],
    })
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, true))
    expect(reportError).toHaveBeenCalled()
    expect(reportUndo).not.toHaveBeenCalled()
    expect(hook.result.current.queued.size).toBe(0)
  })

  it('never removes from Engine DJ, which cannot take a track out of a playlist', async () => {
    const { hook, dj } = setup({ library: 'engine', membership: { [COPY]: ['p1'] } })
    expect(hook.result.current.canRemove).toBe(false)
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, false))
    expect(dj.editPlaylist).not.toHaveBeenCalled()
    expect(dj.playlist).not.toHaveBeenCalled()
  })

  it('adds to Engine DJ without Undo, since Engine cannot take it back out', async () => {
    const { hook, reportUndo, reportNotice } = setup({ library: 'engine', edits: [ADDED_ONE] })
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, true))
    expect(reportNotice).toHaveBeenCalledWith(expect.stringContaining('Verano'))
    expect(reportUndo).not.toHaveBeenCalled()
  })

  it('undoes on the copy it edited even after the DJ moved to another track', async () => {
    const { hook, dj, undo } = setup({
      edits: [ADDED_ONE],
      playlists: [[row('/r/b.aiff', 'L8')], [row(COPY, 'L7'), row('/r/b.aiff', 'L8')]],
      membership: { [COPY]: [] },
    })
    await act(() => hook.result.current.toggle([COPY], { id: 'p1', name: 'Verano' }, true))
    hook.rerender({ membership: { '/r/b.aiff': ['p1'] } })
    await undo()
    expect(dj.playlist).toHaveBeenCalledWith('rekordbox', 'p1')
    expect(dj.editPlaylist).toHaveBeenLastCalledWith(
      'rekordbox',
      { kind: 'remove', playlistId: 'p1', linkIds: ['L7'] },
      'Verano',
    )
  })
})
