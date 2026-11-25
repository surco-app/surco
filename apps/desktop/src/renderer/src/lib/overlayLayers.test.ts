import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import {
  type OverlayLayers,
  overlayOpenOf,
  type ShowListContext,
  showListOf,
} from './overlayLayers'

const closed: OverlayLayers = {
  activeModal: null,
  copiesOpen: null,
  review: null,
  usbModal: null,
  pasteTracklist: null,
  sessionWizard: null,
}

describe('overlayOpenOf', () => {
  // Nothing open: space, j/k and ⌘⏎ belong to the list.
  it('leaves the shortcuts to the list while no layer is open', () => {
    expect(overlayOpenOf(closed).overlayOpen).toBe(false)
  })

  // Any one layer swallows the global shortcuts, or a key would act on the list behind it
  // (a conversion started behind a confirm prompt).
  it('holds the shortcuts while any one layer is open', () => {
    const layers: Partial<OverlayLayers>[] = [
      { activeModal: { type: 'help' } },
      { copiesOpen: { openMusic: false, query: '', key: 1 } },
      { review: { source: 'list', filter: 'all' } },
      { usbModal: { preselect: null, source: 'rekordbox' } },
      { pasteTracklist: { node: { id: 'p', name: 'Set', kind: 'playlist' }, create: false } },
      { sessionWizard: { parentId: 'root', adjust: false } },
    ]
    for (const layer of layers)
      expect(overlayOpenOf({ ...closed, ...layer }).overlayOpen).toBe(true)
  })
})

describe('showListOf', () => {
  const track = { id: 'a', inputPath: '/m/A.wav' } as TrackItem
  const ctx = (over: Partial<ShowListContext> = {}): ShowListContext => ({
    copiesOpen: null,
    browser: { source: null, playlist: null },
    filesView: [],
    review: null,
    playerMounted: false,
    ...over,
  })

  // An empty Files list shows the drop zone instead of an empty column; a loaded one shows.
  it('shows the list in Files once it holds tracks', () => {
    expect(showListOf(ctx()).showList).toBe(false)
    expect(showListOf(ctx({ filesView: [track] })).showList).toBe(true)
  })

  // In a library the list is the open playlist; the working list's tracks do not count there.
  it('shows the list in a library once a playlist is open', () => {
    const library = { source: 'rekordbox' as const, playlist: null }
    expect(showListOf(ctx({ browser: library, filesView: [track] })).showList).toBe(false)
    const open = { source: 'rekordbox' as const, playlist: { id: 'p', name: 'Set', folders: [] } }
    expect(showListOf(ctx({ browser: open })).showList).toBe(true)
  })

  // The review and the player live in the list column, so they keep it up on an empty list.
  it('keeps the column for an open review or a mounted player', () => {
    expect(showListOf(ctx({ review: { source: 'music', filter: 'all' } })).showList).toBe(true)
    expect(showListOf(ctx({ playerMounted: true })).showList).toBe(true)
  })

  // The copies screen takes the whole column, whatever else would show there.
  it('hides the list while the copies screen is open', () => {
    const copiesOpen = { openMusic: true, query: '', key: 1 }
    expect(showListOf(ctx({ copiesOpen, filesView: [track], playerMounted: true })).showList).toBe(
      false,
    )
  })
})
