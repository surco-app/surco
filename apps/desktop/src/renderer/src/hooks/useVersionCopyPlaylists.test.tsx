// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import { djReads, installApi, type ProgramReads } from '../test/api'
import type { TrackItem } from '../types'
import { useVersionCopyPlaylists } from './useVersionCopyPlaylists'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 't1',
    inputPath: '/new/strobe.flac',
    fileName: 'strobe.flac',
    listLabel: 'Strobe',
    query: '',
    status: 'idle',
    meta: emptyMetadata(),
    ...over,
  }
}

const makina = [
  { id: '3000', name: 'Makina', kind: 'playlist' as const, count: 1 },
  { id: '3001', name: 'Bases', kind: 'playlist' as const, count: 1 },
]

function programs(membership: ProgramReads['membership'], traktor?: ProgramReads['membership']) {
  installApi({
    dj: djReads({
      rekordbox: {
        available: async () => true,
        tree: async () => makina,
        membership,
      },
      ...(traktor
        ? {
            traktor: {
              available: async () => true,
              tree: async () => [{ id: 'fri', name: 'Friday', kind: 'playlist', count: 1 }],
              membership: traktor,
            },
          }
        : {}),
    }),
  })
}

const settle = () => new Promise((r) => setTimeout(r, 30))

describe('useVersionCopyPlaylists', () => {
  // The DJ filed the other edit of this track in its playlists: the new file belongs there too,
  // so the field shows them ticked and the convert files it there.
  it("stages the playlists of the program's copy that is another version", async () => {
    programs(vi.fn<ProgramReads['membership']>(async () => ({ '/r/strobe.mp3': ['3001'] })))
    const onChange = vi.fn()
    renderHook(
      () =>
        useVersionCopyPlaylists({
          item: track(),
          copies: { rekordbox: '/r/strobe.mp3' },
          onChange,
        }),
      { wrapper },
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange).toHaveBeenCalledWith({
      playlists: { rekordbox: { targets: [{ id: '3001', name: 'Bases' }], base: [] } },
      copyPlaylistsFilled: ['rekordbox'],
    })
  })

  // The open file is in rekordbox too: staging the copy's playlists alone would leave Friday
  // out of the picks while it stays in the base, and the convert would take the file out.
  it("keeps the playlists the track's own file is in beside the copy's", async () => {
    programs(
      vi.fn<ProgramReads['membership']>(async () => ({
        '/new/strobe.flac': ['3000'],
        '/r/strobe.mp3': ['3001'],
      })),
    )
    const onChange = vi.fn()
    renderHook(
      () =>
        useVersionCopyPlaylists({
          item: track(),
          copies: { rekordbox: '/r/strobe.mp3' },
          onChange,
        }),
      { wrapper },
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange).toHaveBeenCalledWith({
      playlists: {
        rekordbox: {
          targets: [
            { id: '3000', name: 'Makina' },
            { id: '3001', name: 'Bases' },
          ],
          base: ['3000'],
        },
      },
      copyPlaylistsFilled: ['rekordbox'],
    })
  })

  // Staging what the field already shows is no edit: it would only add an undo step and mark
  // the track as changed on opening.
  it("stages nothing when the copy's playlists add none to the track's own", async () => {
    programs(
      vi.fn<ProgramReads['membership']>(async () => ({
        '/new/strobe.flac': ['3000', '3001'],
        '/r/strobe.mp3': ['3001'],
      })),
    )
    const onChange = vi.fn()
    const onRecordUndo = vi.fn()
    renderHook(
      () =>
        useVersionCopyPlaylists({
          item: track(),
          copies: { rekordbox: '/r/strobe.mp3' },
          onChange,
          onRecordUndo,
        }),
      { wrapper },
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange).toHaveBeenCalledWith({ copyPlaylistsFilled: ['rekordbox'] })
    expect(onRecordUndo).not.toHaveBeenCalled()
  })

  it('records an undo step first, so ⌘Z takes the staged playlists back', async () => {
    programs(vi.fn<ProgramReads['membership']>(async () => ({ '/r/strobe.mp3': ['3000'] })))
    const order: string[] = []
    const onRecordUndo = vi.fn(() => order.push('undo'))
    const onChange = vi.fn(() => order.push('change'))
    renderHook(
      () =>
        useVersionCopyPlaylists({
          item: track(),
          copies: { rekordbox: '/r/strobe.mp3' },
          onChange,
          onRecordUndo,
        }),
      { wrapper },
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onRecordUndo).toHaveBeenCalledWith(['t1'])
    expect(order).toEqual(['undo', 'change'])
  })

  // Nothing to stage, but the copy was looked at: a later pick of the DJ is not waited on.
  it('marks a copy in no playlists as seen without staging nor an undo step', async () => {
    programs(vi.fn<ProgramReads['membership']>(async () => ({})))
    const onChange = vi.fn()
    const onRecordUndo = vi.fn()
    renderHook(
      () =>
        useVersionCopyPlaylists({
          item: track(),
          copies: { rekordbox: '/r/strobe.mp3' },
          onChange,
          onRecordUndo,
        }),
      { wrapper },
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange).toHaveBeenCalledWith({ copyPlaylistsFilled: ['rekordbox'] })
    expect(onRecordUndo).not.toHaveBeenCalled()
  })

  // Once per track: after ⌘Z or after the DJ emptied the field, staging again would undo them.
  it('stages nothing again for a program already filled from its copy', async () => {
    const membership = vi.fn<ProgramReads['membership']>(async () => ({
      '/r/strobe.mp3': ['3000'],
    }))
    programs(membership)
    const onChange = vi.fn()
    renderHook(
      () =>
        useVersionCopyPlaylists({
          item: track({ copyPlaylistsFilled: ['rekordbox'] }),
          copies: { rekordbox: '/r/strobe.mp3' },
          onChange,
        }),
      { wrapper },
    )
    await settle()
    expect(onChange).not.toHaveBeenCalled()
    expect(membership).not.toHaveBeenCalled()
  })

  it('keeps what the DJ already staged for that program', async () => {
    programs(vi.fn<ProgramReads['membership']>(async () => ({ '/r/strobe.mp3': ['3000'] })))
    const onChange = vi.fn()
    renderHook(
      () =>
        useVersionCopyPlaylists({
          item: track({ playlists: { rekordbox: { targets: [], base: [] } } }),
          copies: { rekordbox: '/r/strobe.mp3' },
          onChange,
        }),
      { wrapper },
    )
    await settle()
    expect(onChange).not.toHaveBeenCalled()
  })

  // Clear all asks for an empty track: nothing the library holds comes back after it.
  it('stages nothing after Clear all', async () => {
    programs(vi.fn<ProgramReads['membership']>(async () => ({ '/r/strobe.mp3': ['3000'] })))
    const onChange = vi.fn()
    renderHook(
      () =>
        useVersionCopyPlaylists({
          item: track({ metaCleared: true }),
          copies: { rekordbox: '/r/strobe.mp3' },
          onChange,
        }),
      { wrapper },
    )
    await settle()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('stages each program from its own copy, in one change when both are ready together', async () => {
    programs(
      vi.fn<ProgramReads['membership']>(async () => ({ '/r/strobe.mp3': ['3000'] })),
      vi.fn<ProgramReads['membership']>(async () => ({ '/t/strobe.wav': ['fri'] })),
    )
    const onChange = vi.fn()
    renderHook(
      () =>
        useVersionCopyPlaylists({
          item: track(),
          copies: { rekordbox: '/r/strobe.mp3', traktor: '/t/strobe.wav' },
          onChange,
        }),
      { wrapper },
    )
    await waitFor(() =>
      expect(onChange.mock.calls.flatMap(([p]) => p.copyPlaylistsFilled)).toHaveLength(2),
    )
    const staged = Object.assign({}, ...onChange.mock.calls.map(([p]) => p.playlists))
    expect(staged).toEqual({
      rekordbox: { targets: [{ id: '3000', name: 'Makina' }], base: [] },
      traktor: { targets: [{ id: 'fri', name: 'Friday' }], base: [] },
    })
  })
})
