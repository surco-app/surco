// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackItem } from '../types'
import '../i18n'
import type { ConfirmModal } from './useOverlays'
import { useConfirmFlows } from './useConfirmFlows'

function track(id: string): TrackItem {
  return {
    id,
    inputPath: `/${id}.wav`,
    fileName: `Artist - ${id}.wav`,
    listLabel: id,
    query: '',
    status: 'idle',
    meta: { ...emptyMetadata(), title: id, artist: 'A' },
  }
}

function setup(
  allTracks: TrackItem[],
  extra: {
    onOldMusicCopyRemoved?: ReturnType<typeof vi.fn>
    reportOldCopyRemoveFailure?: ReturnType<typeof vi.fn>
  } = {},
) {
  const opened: ConfirmModal[] = []
  const { result } = renderHook(() =>
    useConfirmFlows({
      settings: null,
      removeTrack: vi.fn(),
      updateTrack: vi.fn(),
      emptyTracks: vi.fn(),
      deriveTracks: vi.fn(),
      processAll: vi.fn(),
      openConfirm: (c) => opened.push(c),
      reportTrashFailure: vi.fn(),
      onOldMusicCopyRemoved: extra.onOldMusicCopyRemoved ?? vi.fn(),
      reportOldCopyRemoveFailure: extra.reportOldCopyRemoveFailure ?? vi.fn(),
      tracksRef: { current: allTracks },
    }),
  )
  return { flows: result.current, opened }
}

describe('useConfirmFlows scope wording', () => {
  // The toolbar's clear acts on the filtered-visible rows while the palette's acts on
  // everything — two buttons that read the same but sweep different sets. The dialog is
  // the last chance to say which: with a filter active it must state that hidden tracks
  // survive, so the user can predict what the list looks like after confirming.
  it('says hidden tracks survive when clearing a filtered view', () => {
    const all = [track('a'), track('b'), track('c')]
    const { flows, opened } = setup(all)
    flows.askClearAll(all.slice(0, 2))
    expect(opened[0].message).toContain('visible')
    expect(opened[0].message).toContain('2')
  })

  it('keeps the plain wording when clearing the whole list', () => {
    const all = [track('a'), track('b')]
    const { flows, opened } = setup(all)
    flows.askClearAll(all)
    expect(opened[0].message).not.toContain('visible')
  })

  // Fill-all overwrites tags across the visible set; when a filter hides part of the
  // list the dialog must scope its promise to the visible rows only.
  it('scopes the fill-all wording to the visible rows under a filter', () => {
    const all = [track('a'), track('b'), track('c')]
    const { flows, opened } = setup(all)
    flows.askFillAll(all.slice(0, 2))
    expect(opened[0].message).toContain('visible')
  })

  it('keeps the plain fill-all wording without a filter', () => {
    const all = [track('a'), track('b')]
    const { flows, opened } = setup(all)
    flows.askFillAll(all)
    expect(opened[0].message).not.toContain('visible')
  })
})

describe('useConfirmFlows remove old Apple Music copy', () => {
  // Removing a track from the user's Apple Music library is destructive and rides on a
  // scored hint (the stale-copy match), so nothing may fire before the confirmation —
  // and the outcome must be reported so the library snapshot refreshes.
  it('deletes the superseded copy only after the confirmation and reports the removal', async () => {
    const deleteAppleMusic = vi.fn().mockResolvedValue('deleted')
    ;(window as unknown as { api: { deleteAppleMusic: unknown } }).api = { deleteAppleMusic }
    const onOldMusicCopyRemoved = vi.fn()
    const { flows, opened } = setup([], { onOldMusicCopyRemoved })
    flows.askRemoveOldMusicCopy(track('a'), 'OLDCOPY123456789')
    expect(opened[0].destructive).toBe(true)
    expect(deleteAppleMusic).not.toHaveBeenCalled()
    opened[0].onConfirm()
    expect(deleteAppleMusic).toHaveBeenCalledWith('OLDCOPY123456789', 'A - a')
    await waitFor(() => expect(onOldMusicCopyRemoved).toHaveBeenCalled())
  })

  // The user confirmed a destructive dialog; a silent failure would read as "the old
  // copy is gone" when it isn't.
  it('reports a failed removal out loud', async () => {
    const deleteAppleMusic = vi.fn().mockRejectedValue(new Error('osascript failed'))
    ;(window as unknown as { api: { deleteAppleMusic: unknown } }).api = { deleteAppleMusic }
    const reportOldCopyRemoveFailure = vi.fn()
    const { flows, opened } = setup([], { reportOldCopyRemoveFailure })
    flows.askRemoveOldMusicCopy(track('a'), 'OLDCOPY123456789')
    opened[0].onConfirm()
    await waitFor(() => expect(reportOldCopyRemoveFailure).toHaveBeenCalled())
  })
})
