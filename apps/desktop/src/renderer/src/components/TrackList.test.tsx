// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// TrackContextMenu reads window.api at render; install a stub before importing it.
const api = {
  platform: 'darwin',
  reveal: vi.fn(),
  openFile: vi.fn(),
  copyText: vi.fn(),
  startTrackDrag: vi.fn(),
}
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = {}
})

import '../i18n'
import type { TrackMetadata } from '../../../shared/types'
import { trackSignature } from '../lib/dirty'
import type { TrackItem } from '../types'
import { TrackList } from './TrackList'

beforeEach(() => {
  Object.assign(window, { api })
  api.platform = 'darwin'
  vi.clearAllMocks()
})
afterEach(cleanup)

// A full TrackItem so the list renders exactly as it does in the app; callers
// override only the fields the assertion cares about.
function track(
  over: Partial<Omit<TrackItem, 'meta'>> & { id: string; meta?: Partial<TrackMetadata> },
): TrackItem {
  const fileName = over.fileName ?? `${over.id}.wav`
  return {
    inputPath: `/music/${over.id}.wav`,
    fileName,
    query: '',
    status: 'idle',
    listLabel: over.meta?.title || fileName,
    ...over,
    meta: {
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
      ...over.meta,
    },
  }
}

function renderList(
  tracks: TrackItem[],
  selectedId: string | null = null,
  selectedIds: string[] = selectedId ? [selectedId] : [],
  { canPasteMeta = false }: { canPasteMeta?: boolean } = {},
) {
  const onSelect = vi.fn()
  const onActivate = vi.fn()
  const onRemove = vi.fn()
  const onPrefetch = vi.fn()
  const onSearch = vi.fn()
  const onSearchWeb = vi.fn()
  const onStartOver = vi.fn()
  const onTrash = vi.fn()
  const onCopyMeta = vi.fn()
  const onCopyPath = vi.fn()
  const onPasteMeta = vi.fn()
  render(
    <TrackList
      tracks={tracks}
      selectedId={selectedId}
      selectedIds={new Set(selectedIds)}
      outputFormat="aiff"
      onSelect={onSelect}
      onActivate={onActivate}
      onRemove={onRemove}
      onPrefetch={onPrefetch}
      onSearch={onSearch}
      onSearchWeb={onSearchWeb}
      onStartOver={onStartOver}
      onTrash={onTrash}
      onCopyMeta={onCopyMeta}
      onCopyPath={onCopyPath}
      onPasteMeta={onPasteMeta}
      canPasteMeta={canPasteMeta}
    />,
  )
  return {
    onSelect,
    onActivate,
    onRemove,
    onPrefetch,
    onSearch,
    onSearchWeb,
    onStartOver,
    onTrash,
    onCopyMeta,
    onCopyPath,
    onPasteMeta,
  }
}

describe('TrackList', () => {
  it('renders one row per track', () => {
    renderList([track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })])
    expect(screen.getAllByTestId('track-row')).toHaveLength(3)
  })

  it('shows the track title and artist', () => {
    renderList([track({ id: 'a', meta: { title: 'Song A', artist: 'Artist A' } })])
    expect(screen.getByText('Song A')).toBeInTheDocument()
    expect(screen.getByText('Artist A')).toBeInTheDocument()
  })

  // A high-confidence auto-match shows the applied sparkle; a review-tier one shows a
  // distinct flag so the user knows to confirm it in the editor before trusting the tags.
  it('flags a review-tier auto-match for the user to confirm', () => {
    renderList([track({ id: 'a', matchReview: true, matchConfidence: 0.7 })])
    expect(screen.getByTestId('track-match-review')).toBeInTheDocument()
    expect(screen.queryByTestId('track-automatched')).not.toBeInTheDocument()
  })

  // Once the user (or a later high match) actually tags the track, the pending-review flag
  // is moot — the row must not keep nagging to confirm an already-applied match.
  it('hides the review flag once the track has been matched', () => {
    renderList([track({ id: 'a', matchReview: true, matched: true })])
    expect(screen.queryByTestId('track-match-review')).not.toBeInTheDocument()
  })

  // A file whose tag read failed shows only its file-name parse — without a mark, that row
  // is indistinguishable from a file that simply has no tags, and the user would retag by
  // hand data that was actually there. The mark must vanish once a re-read succeeds.
  it('marks a row whose metadata read failed, and only that row', () => {
    renderList([track({ id: 'a', metaReadFailed: true }), track({ id: 'b' })])
    expect(screen.getAllByTestId('track-meta-failed')).toHaveLength(1)
  })

  it('shows the stable list label, not in-progress metadata edits', () => {
    // The label freezes what the row was when imported (or last applied a match), so typing
    // a new title into the editor on the right never renames the pill on the left mid-edit.
    renderList([track({ id: 'a', listLabel: 'Frozen Name', meta: { title: 'Edited Title' } })])
    expect(screen.getByText('Frozen Name')).toBeInTheDocument()
    expect(screen.queryByText('Edited Title')).not.toBeInTheDocument()
  })

  it('falls back to the file name and a no-artist label when metadata is empty', () => {
    renderList([track({ id: 'untitled' })])
    expect(screen.getByText('untitled.wav')).toBeInTheDocument()
    expect(screen.getByText('No artist')).toBeInTheDocument()
  })

  // Title and artist truncate in the narrow column, but they shared the row through two
  // separate tooltips that could both show as the pointer crossed between the stacked
  // lines. Each line carries the same tooltip, scoped to its own text — not the flex-1
  // layout slot, which stretches past a short title and used to fire the tooltip across the
  // empty tail. Hovering either the frozen label or the artist reveals both; the two never
  // double up because a width-fit title and a width-fit artist don't overlap.
  it('reveals the label and artist by hovering either text line', () => {
    renderList([
      track({
        id: 'a',
        listLabel: 'Frozen Name',
        meta: { title: 'Edited Title', artist: 'Boards of Canada' },
      }),
    ])
    const titleTrigger = screen.getByText('Frozen Name')
    fireEvent.focusIn(titleTrigger)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Frozen Name — Boards of Canada')
    fireEvent.focusOut(titleTrigger)

    const artistTrigger = screen.getByText('Boards of Canada')
    fireEvent.focusIn(artistTrigger)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Frozen Name — Boards of Canada')
  })

  it('drags a row out to external apps using its source file and cover', () => {
    // DJs drop a track straight onto Spek to eyeball its spectrum without exporting
    // first, so the row hands the OS the untouched source path on dragstart. The
    // draggable element is the row wrapper, not the button: Chromium won't start a native
    // drag from a <button>, so dragging it must lift the whole row. The cover rides
    // along so the OS drag thumbnail is the track's art, not a generic icon.
    renderList([track({ id: 'a', embeddedCover: 'data:image/jpeg;base64,AAA' })])
    const li = screen.getByTestId('track-row').closest('[draggable]')
    expect(li).toHaveAttribute('draggable', 'true')
    expect(screen.getByTestId('track-row')).not.toHaveAttribute('draggable')
    fireEvent.dragStart(li as Element)
    expect(api.startTrackDrag).toHaveBeenCalledWith(['/music/a.wav'], 'data:image/jpeg;base64,AAA')
  })

  it('drags every selected file out when the dragged row is part of the selection', () => {
    // Dragging one of several selected rows lifts the whole selection (Finder's rule),
    // so a DJ can drop a batch onto another app at once. List order is preserved.
    renderList([track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })], 'a', ['a', 'b'])
    const li = screen.getAllByTestId('track-row')[0].closest('[draggable]')
    fireEvent.dragStart(li as Element)
    expect(api.startTrackDrag).toHaveBeenCalledWith(['/music/a.wav', '/music/b.wav'], undefined)
  })

  it('drags only the row under the cursor when it is not part of the selection', () => {
    // Dragging an unselected row must not sweep up the current selection — it lifts just
    // that one file, matching how Finder treats a drag that starts off the selection.
    renderList([track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })], 'a', ['a', 'b'])
    const li = screen.getAllByTestId('track-row')[2].closest('[draggable]')
    fireEvent.dragStart(li as Element)
    expect(api.startTrackDrag).toHaveBeenCalledWith(['/music/c.wav'], undefined)
  })

  it('shows the album art so a crate can be scanned by cover, not just by name', () => {
    renderList([track({ id: 'a', embeddedCover: 'file:///cover.jpg' })])
    expect(screen.getByTestId('track-cover')).toHaveAttribute('src', 'file:///cover.jpg')
    expect(screen.queryByTestId('track-cover-placeholder')).toBeNull()
  })

  it('falls back to a placeholder thumbnail when the track has no cover', () => {
    renderList([track({ id: 'a' })])
    expect(screen.queryByTestId('track-cover')).toBeNull()
    expect(screen.getByTestId('track-cover-placeholder')).toBeInTheDocument()
  })

  // The row is a view of the file on disk, so it shows the cover embedded in the file —
  // never the one the user dropped into the editor form. coverUrl is the live/edited
  // field (the form and a release match write it); the row reads embeddedCover, the art
  // captured once at import and never overwritten, so editing the artwork can't repaint
  // the crate behind the user's back.
  it('shows the embedded cover, not the edited one the form wrote', () => {
    renderList([track({ id: 'a', embeddedCover: 'file:///original.jpg', coverUrl: 'blob:edited' })])
    expect(screen.getByTestId('track-cover')).toHaveAttribute('src', 'file:///original.jpg')
  })

  // A file with no embedded art shows the placeholder even after the user drops a cover
  // in the form — the row must not borrow the edited coverUrl to fill the gap, or the
  // form would leak into the crate for exactly those tracks.
  it('keeps the placeholder when the file has no embedded art, ignoring an edited cover', () => {
    renderList([track({ id: 'a', coverUrl: 'blob:edited' })])
    expect(screen.queryByTestId('track-cover')).toBeNull()
    expect(screen.getByTestId('track-cover-placeholder')).toBeInTheDocument()
  })

  it('shows the stage progress only while a track is processing', () => {
    renderList([
      track({ id: 'busy', status: 'processing', stage: 'converting' }),
      track({ id: 'idle' }),
    ])
    const stages = screen.getAllByTestId('track-stage')
    expect(stages).toHaveLength(1)
    expect(stages[0]).toHaveTextContent(/AIFF/)
  })

  // A track converted via the Export menu carries its own chosen format; the
  // stage label must show that, not the Settings default, or it lies about what
  // the user picked.
  it('labels the stage with the track’s own format over the default', () => {
    renderList([track({ id: 'busy', status: 'processing', stage: 'converting', format: 'mp3' })])
    expect(screen.getByTestId('track-stage')).toHaveTextContent(/MP3/)
  })

  it('shows the track length so similar takes can be told apart by time', () => {
    // Vinyl rips of one title differ mostly by length (radio edit vs extended
    // mix); surfacing the duration on the row lets the user pick by time.
    renderList([track({ id: 'a', duration: 287 })])
    expect(screen.getByTestId('track-duration')).toHaveTextContent('4:47')
  })

  it('omits the duration until it has been probed', () => {
    renderList([track({ id: 'a' })])
    expect(screen.queryByTestId('track-duration')).toBeNull()
  })

  // A converted track edited afterwards would look identical to an untouched done
  // one (green dot), making it unsafe to defer Updates: the user could never tell
  // which tracks still carry unapplied changes. The amber dot makes batching
  // Updates for later a workflow the list actually supports.
  it('flags a done track edited after conversion as having unapplied changes', () => {
    const untouched = track({ id: 'a', status: 'done', meta: { title: 'Same' } })
    const edited = track({ id: 'b', status: 'done', meta: { title: 'New title' } })
    renderList([
      { ...untouched, processedSignature: trackSignature(untouched) },
      {
        ...edited,
        processedSignature: trackSignature({
          ...edited,
          meta: { ...edited.meta, title: 'Old title' },
        }),
      },
    ])
    const dots = screen.getAllByTestId('track-status')
    fireEvent.focusIn(dots[0])
    expect(screen.getByRole('tooltip')).toHaveTextContent('Done')
    fireEvent.focusOut(dots[0])
    fireEvent.focusIn(dots[1])
    expect(screen.getByRole('tooltip')).toHaveTextContent('Unapplied changes')
  })

  it('selects a track when its row is clicked', () => {
    const { onSelect } = renderList([track({ id: 'a' }), track({ id: 'b' })])
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    expect(onSelect).toHaveBeenCalledWith('b', { meta: false, shift: false })
  })

  // Double-click is the "play this" gesture: it hands the whole track up so the player
  // can open straight on it, independent of the click-to-select that fires alongside.
  it('activates a track for playback on double-click', () => {
    const { onActivate } = renderList([track({ id: 'a' }), track({ id: 'b' })])
    fireEvent.doubleClick(screen.getAllByTestId('track-row')[1])
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
  })

  // Double-click and Space are the only other ways to play and neither is visible, so the
  // hover ▶ over the cover is the discoverable path — it must activate the same track.
  it('activates a track for playback from the hover play overlay', () => {
    const { onActivate } = renderList([track({ id: 'a' }), track({ id: 'b' })])
    fireEvent.click(screen.getAllByRole('button', { name: 'Play' })[1])
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
  })

  // Cmd/Shift reach the reducer so it can toggle or range-extend; without forwarding
  // the modifiers every click would collapse to a single selection.
  it('forwards the Cmd modifier so the click can toggle the selection', () => {
    const { onSelect } = renderList([track({ id: 'a' }), track({ id: 'b' })])
    fireEvent.click(screen.getAllByTestId('track-row')[1], { metaKey: true })
    expect(onSelect).toHaveBeenCalledWith('b', { meta: true, shift: false })
  })

  it('forwards the Shift modifier so the click can extend a range', () => {
    const { onSelect } = renderList([track({ id: 'a' }), track({ id: 'b' })])
    fireEvent.click(screen.getAllByTestId('track-row')[1], { shiftKey: true })
    expect(onSelect).toHaveBeenCalledWith('b', { meta: false, shift: true })
  })

  it('marks every selected row, including ones that are not the primary', () => {
    renderList([track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })], 'a', ['a', 'b'])
    const rows = screen.getAllByTestId('track-row')
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    expect(rows[2]).toHaveAttribute('aria-selected', 'false')
  })

  // The list is a multi-select listbox of options, so a screen reader announces it as one
  // and the rows as selectable — not a stack of unrelated buttons.
  it('exposes a multi-select listbox of option rows', () => {
    renderList([track({ id: 'a' }), track({ id: 'b' })], 'a')
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true')
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  // Roving tabindex: only the active (primary) row is a tab stop, so Tab lands on the list
  // once and the arrow keys move within it — instead of Tab walking through 500 rows.
  it('keeps a single tab stop on the primary row', () => {
    renderList([track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })], 'b')
    const rows = screen.getAllByTestId('track-row')
    expect(rows[0]).toHaveAttribute('tabindex', '-1')
    expect(rows[1]).toHaveAttribute('tabindex', '0')
    expect(rows[2]).toHaveAttribute('tabindex', '-1')
  })

  // With nothing selected yet the list must still be reachable by Tab, so the first row
  // holds the tab stop until a selection takes over.
  it('puts the tab stop on the first row when nothing is selected', () => {
    renderList([track({ id: 'a' }), track({ id: 'b' })])
    const rows = screen.getAllByTestId('track-row')
    expect(rows[0]).toHaveAttribute('tabindex', '0')
    expect(rows[1]).toHaveAttribute('tabindex', '-1')
  })

  // Plain ⌫/Supr on a focused row is the keyboard ✕ — the list is a no-typing surface,
  // so the bare key is unambiguous there (the global ⌘⌫ chord stays for everywhere
  // else). Removal deselects, which would strand the keyboard: selection and focus
  // must hop to a neighbour so ⌫ ⌫ ⌫ can walk down the list.
  it('removes the focused row with plain Backspace and moves selection to the next row', () => {
    const { onSelect, onRemove } = renderList(
      [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })],
      'b',
    )
    fireEvent.keyDown(screen.getAllByTestId('track-row')[1], { key: 'Backspace' })
    expect(onRemove).toHaveBeenCalledWith('b')
    expect(onSelect).toHaveBeenCalledWith('c', {})
  })

  it('falls back to the previous row when the last row is removed with Delete', () => {
    const { onSelect, onRemove } = renderList([track({ id: 'a' }), track({ id: 'b' })], 'b')
    fireEvent.keyDown(screen.getAllByTestId('track-row')[1], { key: 'Delete' })
    expect(onRemove).toHaveBeenCalledWith('b')
    expect(onSelect).toHaveBeenCalledWith('a', {})
  })

  // With the row part of a multi-selection, onRemove routes through App's selection-aware
  // removal — the neighbour must be the first row OUTSIDE the doomed set, or selection
  // would land on a row that is about to vanish.
  it('hops selection past the rest of a multi-selection being removed', () => {
    const { onSelect, onRemove } = renderList(
      [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })],
      'a',
      ['a', 'b'],
    )
    fireEvent.keyDown(screen.getAllByTestId('track-row')[0], { key: 'Backspace' })
    expect(onRemove).toHaveBeenCalledWith('a')
    expect(onSelect).toHaveBeenCalledWith('c', {})
  })

  // ⌘⌫ is the global remove command's chord; the row must leave it alone or the same
  // press would remove two tracks.
  it('ignores Backspace with a modifier held', () => {
    const { onRemove } = renderList([track({ id: 'a' }), track({ id: 'b' })], 'a')
    fireEvent.keyDown(screen.getAllByTestId('track-row')[0], { key: 'Backspace', metaKey: true })
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('removes a track without selecting it when the remove control is clicked', () => {
    const { onSelect, onRemove } = renderList([track({ id: 'a' }), track({ id: 'b' })])
    fireEvent.click(screen.getAllByLabelText('Remove')[0])
    expect(onRemove).toHaveBeenCalledWith('a')
    expect(onSelect).not.toHaveBeenCalled()
  })

  // Hovering a row signals intent to open it; the app warms that track's spectrum
  // (and, with a token, its Discogs match) so opening it feels instant.
  it('asks to prefetch a track when its row is hovered', () => {
    const { onPrefetch } = renderList([track({ id: 'a' }), track({ id: 'b' })])
    fireEvent.mouseEnter(screen.getAllByTestId('track-row')[1])
    expect(onPrefetch).toHaveBeenCalledWith('b')
  })

  // Keyboard users never fire mouseenter, so focusing a row by tabbing warms it too.
  it('asks to prefetch a track when its row receives focus', () => {
    const { onPrefetch } = renderList([track({ id: 'a' })])
    fireEvent.focus(screen.getByTestId('track-row'))
    expect(onPrefetch).toHaveBeenCalledWith('a')
  })
})

describe('TrackList context menu', () => {
  it('opens on right click', () => {
    renderList([track({ id: 'a' })])
    expect(screen.queryByTestId('track-menu')).toBeNull()
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    expect(screen.getByTestId('track-menu')).toBeInTheDocument()
  })

  // Right-clicking an unselected row makes it the active track so the single-track
  // menu acts on what the user clicked, not the previous selection.
  it('selects an unselected row before opening', () => {
    const { onSelect } = renderList([track({ id: 'a' }), track({ id: 'b' })], 'a', ['a'])
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
    expect(onSelect).toHaveBeenCalledWith('b', {})
  })

  it('reveals and opens the original file, and delegates the path copy to the list owner', () => {
    const { onCopyPath } = renderList([track({ id: 'a' })])
    const row = () => screen.getByTestId('track-row')
    fireEvent.contextMenu(row())
    fireEvent.click(screen.getByTestId('track-menu-reveal'))
    fireEvent.contextMenu(row())
    fireEvent.click(screen.getByTestId('track-menu-open'))
    fireEvent.contextMenu(row())
    fireEvent.click(screen.getByTestId('track-menu-copy'))
    expect(api.reveal).toHaveBeenCalledWith('/music/a.wav')
    expect(api.openFile).toHaveBeenCalledWith('/music/a.wav')
    // Copy path routes through App (so it can toast), not straight to the clipboard here.
    expect(onCopyPath).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  // "Start over" rebuilds the row from the file as if it had just been dropped, so a
  // bad match or stray edits can be discarded in one move; the reset itself lives in App.
  it('delegates start over to the list owner', () => {
    const t = track({ id: 'a' })
    const { onStartOver } = renderList([t])
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-startover'))
    expect(onStartOver).toHaveBeenCalledWith(t)
  })

  it('delegates search and trash to the list owner', () => {
    const t = track({ id: 'a' })
    const { onSearch, onTrash } = renderList([t])
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-search'))
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-trash'))
    expect(onSearch).toHaveBeenCalledWith('a')
    expect(onTrash).toHaveBeenCalledWith(t)
  })

  // Copying a track's tags from the menu lets the user stamp them onto another track —
  // the fast way to share release-level metadata across a crate.
  it('delegates copy-metadata to the list owner', () => {
    const t = track({ id: 'a', meta: { title: 'Song A', artist: 'Artist A' } })
    const { onCopyMeta } = renderList([t])
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-copy-meta'))
    expect(onCopyMeta).toHaveBeenCalledWith(t)
  })

  // Paste applies whatever was copied onto the right-clicked track.
  it('delegates paste-metadata to the list owner when something has been copied', () => {
    const t = track({ id: 'b' })
    const { onPasteMeta } = renderList([t], null, [], { canPasteMeta: true })
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-paste-meta'))
    expect(onPasteMeta).toHaveBeenCalledWith(t)
  })

  // Nothing copied yet → no paste item, so the menu never offers a no-op action.
  it('hides paste-metadata until something has been copied', () => {
    renderList([track({ id: 'a' })], null, [], { canPasteMeta: false })
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    expect(screen.getByTestId('track-menu-copy-meta')).toBeInTheDocument()
    expect(screen.queryByTestId('track-menu-paste-meta')).toBeNull()
  })

  it('closes after an action runs', () => {
    renderList([track({ id: 'a' })])
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-reveal'))
    expect(screen.queryByTestId('track-menu')).toBeNull()
  })

  it('closes on backdrop click without acting', () => {
    renderList([track({ id: 'a' })])
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-backdrop'))
    expect(screen.queryByTestId('track-menu')).toBeNull()
    expect(api.reveal).not.toHaveBeenCalled()
  })

  // The OS file manager and recycle location are named differently per platform.
  it('uses Windows labels on win32', () => {
    api.platform = 'win32'
    renderList([track({ id: 'a' })])
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    expect(screen.getByTestId('track-menu-reveal')).toHaveTextContent('Show in File Explorer')
    expect(screen.getByTestId('track-menu-trash')).toHaveTextContent('Move to Recycle Bin')
  })
})

describe('TrackList format pill', () => {
  // A mixed crate (vinyl rips in WAV next to bought MP3s) reads faster when each
  // row says its source format, so the user can spot what still needs converting.
  // The format must come from the path — the parsed fileName drops its extension.
  it('shows the source format taken from the file path', () => {
    renderList([track({ id: 'a', inputPath: '/music/song.mp3', fileName: 'song' })])
    expect(screen.getByTestId('track-format')).toHaveTextContent('MP3')
  })

  it('omits the pill when the path has no extension', () => {
    renderList([track({ id: 'a', inputPath: '/music/song', fileName: 'song' })])
    expect(screen.queryByTestId('track-format')).toBeNull()
  })

  it('ignores dots in directory names when reading the extension', () => {
    renderList([track({ id: 'a', inputPath: '/music/My.Crate/song', fileName: 'song' })])
    expect(screen.queryByTestId('track-format')).toBeNull()
  })

  // The trailing indicators (sparkle, verdict, pill, duration) read as columns the
  // eye scans down. The pill and duration render inside fixed-width slots that stay
  // put whether the row has them or not — otherwise a FLAC pill next to an MP3 one,
  // or a missing duration, shifts every icon to its left row by row.
  it('reserves the pill and duration slots so the indicator columns never shift', () => {
    renderList([
      track({ id: 'flac', inputPath: '/music/a.flac', fileName: 'a', duration: 189 }),
      track({ id: 'mp3', inputPath: '/music/b.mp3', fileName: 'b', duration: 412 }),
      track({ id: 'bare', inputPath: '/music/c', fileName: 'c' }),
    ])
    expect(screen.getAllByTestId('track-format-slot')).toHaveLength(3)
    expect(screen.getAllByTestId('track-duration-slot')).toHaveLength(3)
  })
})

describe('TrackList quality badge', () => {
  const spectrum = (cutoffHz: number | null) => ({
    image: '',
    cutoffHz,
    sampleRateHz: 44100,
    processed: false,
  })

  // The badge is the whole point of batch triage: a re-encoded MP3 (cutoff far below
  // Nyquist) must be flaggable in the list without opening each track. An honest lossy
  // container keeps the plain 'bad' — the deception verdict is reserved for lossless ones.
  it('flags a deeply brick-walled lossy track in red', () => {
    renderList([track({ id: 'a', inputPath: '/music/a.mp3', spectrum: spectrum(16000) })])
    expect(screen.getByTestId('track-quality')).toHaveAttribute('data-quality', 'bad')
  })

  // Same cut, but hidden inside a lossless container: the editor's headline is "fake
  // lossless", and the row must say the same so the fake is spottable without opening it.
  it('flags a lossless container hiding a codec cut as transcoded', () => {
    renderList([track({ id: 'a', inputPath: '/music/a.flac', spectrum: spectrum(16000) })])
    expect(screen.getByTestId('track-quality')).toHaveAttribute('data-quality', 'transcoded')
  })

  it('flags a moderate shortfall in amber', () => {
    renderList([track({ id: 'a', inputPath: '/music/a.mp3', spectrum: spectrum(18000) })])
    expect(screen.getByTestId('track-quality')).toHaveAttribute('data-quality', 'warn')
  })

  it('marks a clean track as good', () => {
    renderList([track({ id: 'a', spectrum: spectrum(21000) })])
    expect(screen.getByTestId('track-quality')).toHaveAttribute('data-quality', 'good')
  })

  it('shows no badge until the track has been analyzed', () => {
    renderList([track({ id: 'a' })])
    expect(screen.queryByTestId('track-quality')).not.toBeInTheDocument()
  })

  // While the spectrum worker runs, the empty slot would read as "never analyzed";
  // the pulsing placeholder tells the user the verdict is on its way.
  it('shows a pulsing placeholder while the spectrum analysis is in flight', () => {
    renderList([track({ id: 'a', analyzing: true })])
    expect(screen.getByTestId('track-quality-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('track-quality')).not.toBeInTheDocument()
  })

  it('drops the placeholder once the verdict lands', () => {
    renderList([track({ id: 'a', spectrum: spectrum(21000) })])
    expect(screen.queryByTestId('track-quality-loading')).not.toBeInTheDocument()
  })
})
