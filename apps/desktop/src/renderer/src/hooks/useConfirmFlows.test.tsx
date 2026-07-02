// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
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

function setup(allTracks: TrackItem[]) {
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
