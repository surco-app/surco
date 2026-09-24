// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

import { resolveBindings } from '../../../shared/shortcutDefaults'
import type { Chord } from '../../../shared/shortcuts'
import type { TrackMetadata } from '../../../shared/types'
import i18n from '../i18n'
import { trackSignature } from '../lib/dirty'
import * as triage from '../lib/triage'
import type { TrackItem } from '../types'
import { TrackContextMenu } from './TrackContextMenu'
import { TrackList } from './TrackList'

const bindings = resolveBindings()

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
  {
    canPasteMeta = false,
    bindings: overrideBindings = bindings,
  }: { canPasteMeta?: boolean; bindings?: Map<string, Chord> } = {},
) {
  const onSelect = vi.fn()
  const onActivate = vi.fn()
  const onRemove = vi.fn()
  const onSwipeRemove = vi.fn()
  const onAcceptReview = vi.fn()
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
      bindings={overrideBindings}
      onSelect={onSelect}
      onActivate={onActivate}
      onRemove={onRemove}
      onSwipeRemove={onSwipeRemove}
      onAcceptReview={onAcceptReview}
      onPrefetch={onPrefetch}
      // Composed here exactly as App composes it: the list owns when/where the menu
      // opens, the caller owns what it offers.
      renderMenu={(menu, close) => (
        <TrackContextMenu
          track={menu.track}
          x={menu.x}
          y={menu.y}
          onClose={close}
          onSearch={onSearch}
          onSearchWeb={onSearchWeb}
          onStartOver={onStartOver}
          onCopyMeta={onCopyMeta}
          onCopyPath={onCopyPath}
          onPasteMeta={onPasteMeta}
          canPasteMeta={canPasteMeta}
          onRemove={onRemove}
          onTrash={onTrash}
          onInfo={vi.fn()}
        />
      )}
    />,
  )
  return {
    onSelect,
    onActivate,
    onRemove,
    onSwipeRemove,
    onAcceptReview,
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

  // The sweep falls back from Discogs to Bandcamp and Deezer, so a sparkle claiming
  // "from Discogs" on a Bandcamp hit sends the user to verify the wrong catalog. A row
  // restored without its provider must not guess one either.
  it('names the source that actually auto-matched the row, and none when unknown', () => {
    renderList([
      track({ id: 'a', autoMatched: true, matchProvider: 'bandcamp', matchConfidence: 0.96 }),
      track({ id: 'b', autoMatched: true, matchConfidence: 0.9 }),
    ])
    const sparks = screen.getAllByTestId('track-automatched')
    fireEvent.focusIn(sparks[0])
    expect(screen.getByRole('tooltip')).toHaveTextContent('Auto-matched from Bandcamp · 96%')
    fireEvent.focusOut(sparks[0])
    fireEvent.focusIn(sparks[1])
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^Auto-matched · 90%$/)
  })

  // The spark is the click the sweep promised: useAutoMatch stores the release so the
  // suggestion can be accepted "in one action (shortcut or click)", but the click never
  // existed — the spark was inert, accept-review ships with no default chord, and the
  // only path was hunting the command palette while the release sat loaded and unused.
  it('accepts the review suggestion when its spark is clicked', () => {
    const { onAcceptReview, onSelect } = renderList([
      track({ id: 'a', matchReview: true, matchConfidence: 0.7 }),
    ])
    fireEvent.click(screen.getByTestId('track-match-review'))
    expect(onAcceptReview).toHaveBeenCalledWith('a')
    // The click must not double as a row select: accepting 40 sparks in a sweep should
    // not drag the editor through 40 remounts.
    expect(onSelect).not.toHaveBeenCalled()
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
    expect(screen.getByRole('tooltip')).toHaveTextContent('Frozen Name · Boards of Canada')
    fireEvent.focusOut(titleTrigger)

    const artistTrigger = screen.getByText('Boards of Canada')
    fireEvent.focusIn(artistTrigger)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Frozen Name · Boards of Canada')
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

  // Art fetched from Apple Music at import belongs on the row for the same reason the
  // file's own does: it was captured once, at import, and describes the track rather than
  // anything the user edited. Over half a real library carries no embedded picture (almost
  // all WAVs) while Music holds the art, and those rows showed the placeholder while the
  // editor showed the cover — reported with a screenshot of exactly that.
  it('shows art captured from the library at import', () => {
    renderList([track({ id: 'a', embeddedCover: 'data:image/jpeg;base64,FROMMUSIC' })])
    expect(screen.getByTestId('track-cover')).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,FROMMUSIC',
    )
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
  // The bar is a bare coloured span, so a screen reader heard the stage but never how far
  // the conversion had come. The option flattens any role inside it, so the amount is
  // spoken as text rather than as a nested progressbar.
  it('speaks how far a processing track has come', () => {
    renderList([track({ id: 'busy', status: 'processing', stage: 'converting' })])
    expect(screen.getByRole('option')).toHaveTextContent(
      i18n.t('trackList.progress', { percent: 55 }),
    )
  })

  // The ring round the cover is the only visual measure of how far a conversion has come,
  // so it has to advance with each phase; a ring stuck at one value would read as a stall.
  it('fills the ring round the cover as the conversion moves through its phases', () => {
    renderList([
      track({ id: 'a', status: 'processing', stage: 'cover' }),
      track({ id: 'b', status: 'processing', stage: 'converting' }),
      track({ id: 'c', status: 'processing', stage: 'appleMusic' }),
    ])
    const rings = screen.getAllByTestId('track-progress-ring')
    expect(rings.map((r) => r.style.getPropertyValue('--progress'))).toEqual([
      '0.2',
      '0.55',
      '0.85',
    ])
  })

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

  // Six fixed columns on the artist line left the artist ~68px of a 290px sidebar
  // ("DJ Miguel…"). The duration moves up beside the title, the way Mail puts the time
  // beside the sender, and the format pill sits under it as one trailing column.
  it('puts the duration on the title line and the format under it', () => {
    renderList([
      track({
        id: 'a',
        inputPath: '/music/a.mp3',
        fileName: 'a',
        duration: 287,
        meta: { title: 'Dance 4 Me', artist: 'DJ Miguel' } as TrackMetadata,
      }),
    ])
    expect(screen.getByTestId('track-title-line')).toContainElement(
      screen.getByTestId('track-duration'),
    )
    expect(screen.getByTestId('track-detail-line')).toContainElement(
      screen.getByTestId('track-format'),
    )
    expect(screen.getByTestId('track-detail-line')).not.toContainElement(
      screen.getByTestId('track-duration'),
    )
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

  // Amber means "this needs you": a doubtful file, a match to confirm, a failed tag read,
  // changes not yet applied. A conversion in progress needs nothing from the user, so it
  // pulses in the accent instead of wearing the same amber as the rows that do.
  it('keeps amber for unapplied changes and marks a running conversion as busy', () => {
    const edited = track({ id: 'b', status: 'done', meta: { title: 'New title' } })
    renderList([
      track({ id: 'a', status: 'processing' }),
      {
        ...edited,
        processedSignature: trackSignature({
          ...edited,
          meta: { ...edited.meta, title: 'Old title' },
        }),
      },
      track({ id: 'c', status: 'error' }),
    ])
    const badges = screen.getAllByTestId('track-status-badge')
    expect(badges.map((b) => b.dataset.tone)).toEqual(['busy', 'attention', 'danger'])
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

  // ↑/↓ and j/k walk this list all day, so the row taking the selection fill has to paint
  // it on the keystroke. Easing it in means the blue arrives a step after the cursor has
  // already moved on — the highlight visibly chases the selection down the list. Rows that
  // are NOT selected keep the transition: that one is the mouse-paced hover tint, which
  // wants the fade.
  it('fills the selected row with no colour transition', () => {
    renderList([track({ id: 'a' }), track({ id: 'b' })], 'a', ['a'])
    const rows = screen.getAllByTestId('track-row')
    expect(rows[0].className).not.toMatch(/transition-(colors|\[[^\]]*background-color)/)
    expect(rows[1].className).toMatch(/transition-\[[^\]]*background-color/)
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

  // The context menu otherwise only opens with a right click; Shift+F10 is its only
  // other door, and four of its actions (copy/paste metadata, start over, copy path)
  // have no other path at all.
  it('opens the track menu with the keyboard', () => {
    renderList([track({ id: 'a' })])
    const row = screen.getAllByTestId('track-row')[0]
    row.focus()
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
    expect(screen.getByTestId('track-menu')).toBeInTheDocument()
  })

  // Opening the menu from an unselected row must select it first, exactly like a right
  // click does, so the single-track actions in the menu are unambiguous.
  it('selects an unselected row before opening the menu with the keyboard', () => {
    const { onSelect } = renderList([track({ id: 'a' }), track({ id: 'b' })], 'a', ['a'])
    const row = screen.getAllByTestId('track-row')[1]
    row.focus()
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
    expect(onSelect).toHaveBeenCalledWith('b', {})
  })

  // The row must read the chord from the bindings, never compare F10 literally: djotas's
  // macro keyboard almost certainly doesn't emit F10, so a rebind is this feature's real
  // safety net. Both halves matter — a hardcoded `e.key === 'F10'` would still pass the
  // second assertion.
  it('opens the track menu on its rebound chord instead of the default', () => {
    const rebound = resolveBindings({ 'track-menu': ['shift', 'k'] })
    renderList([track({ id: 'a' })], null, [], { bindings: rebound })
    const row = screen.getAllByTestId('track-row')[0]
    row.focus()
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
    expect(screen.queryByTestId('track-menu')).toBeNull()
    fireEvent.keyDown(row, { key: 'K', shiftKey: true })
    expect(screen.getByTestId('track-menu')).toBeInTheDocument()
  })

  // El ámbito vive en la fila, que es quien maneja la tecla. Si estuviera en un contenedor
  // de la lista entera, capturaría el chord sobre los controles que no lo manejan y lo
  // dejaría muerto — el error que ya se corrigió en el editor de silencios.
  it('declara el ámbito de atajos en la fila que maneja la tecla', () => {
    renderList([track({ id: 'a' })])
    expect(screen.getByTestId('track-row')).toHaveAttribute('data-shortcut-scope', 'track-list')
  })

  it('removes a track without selecting it when the remove control is clicked', () => {
    vi.useFakeTimers()
    const { onSelect, onSwipeRemove } = renderList([track({ id: 'a' }), track({ id: 'b' })])
    fireEvent.wheel(screen.getAllByTestId('track-row')[0].parentElement as Element, { deltaX: 70 })
    act(() => vi.advanceTimersByTime(500))
    vi.useRealTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onSwipeRemove).toHaveBeenCalledWith('a')
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

  // The duration and the pill under it read as one trailing column the eye scans down.
  // Both render inside fixed-width slots that stay put whether the row has them or not —
  // otherwise a FLAC pill next to an MP3 one, or a missing duration, shifts the column
  // row by row.
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

  // The badge is the whole point of batch triage: a deep cut must be flaggable in the list
  // without opening each track. Shown on .m4a, which can hold AAC or ALAC — the extension
  // promises nothing, so it is graded strictly. A plain .mp3 is exempt (its lowpass is the
  // format) and a lossless container gets the deception verdict instead.
  it('flags a deeply brick-walled track in red', () => {
    renderList([track({ id: 'a', inputPath: '/music/a.m4a', spectrum: spectrum(16000) })])
    expect(screen.getByTestId('track-quality')).toHaveAttribute('data-quality', 'bad')
  })

  // The complaint that drove the container gating: a healthy 320 cutting at 19 kHz was
  // amber in every row of a crate of MP3s. Its lowpass is what the format IS, so the row
  // stays green and triage highlights only what the user can act on.
  it('leaves an honest lossy track green whatever its cut', () => {
    renderList([track({ id: 'a', inputPath: '/music/a.mp3', spectrum: spectrum(16000) })])
    expect(screen.getByTestId('track-quality')).toHaveAttribute('data-quality', 'good')
  })

  // Same cut, but hidden inside a lossless container: the editor's headline is "fake
  // lossless", and the row must say the same so the fake is spottable without opening it.
  it('flags a lossless container hiding a codec cut as transcoded', () => {
    renderList([track({ id: 'a', inputPath: '/music/a.flac', spectrum: spectrum(16000) })])
    expect(screen.getByTestId('track-quality')).toHaveAttribute('data-quality', 'transcoded')
  })

  it('shows a possible reprocessing as an amber suspicion, never as the red of a measured defect', () => {
    renderList([
      track({
        id: 'a',
        inputPath: '/music/a.flac',
        spectrum: { ...spectrum(16000), processed: true },
      }),
      track({ id: 'b', inputPath: '/music/b.flac', spectrum: spectrum(16000) }),
    ])
    const [processed, transcoded] = screen.getAllByTestId('track-quality')
    expect(processed).toHaveAttribute('data-quality', 'processed')
    expect(processed).toHaveAttribute('data-tone', 'warn')
    expect(transcoded).toHaveAttribute('data-tone', 'danger')
    const stripes = screen.getAllByTestId('track-quality-stripe')
    expect(stripes.map((s) => s.getAttribute('data-tone'))).toEqual(['warn', 'danger'])
  })

  it('flags a moderate shortfall in amber', () => {
    renderList([track({ id: 'a', inputPath: '/music/a.m4a', spectrum: spectrum(18000) })])
    expect(screen.getByTestId('track-quality')).toHaveAttribute('data-quality', 'warn')
  })

  it('marks a clean track as good', () => {
    renderList([track({ id: 'a', spectrum: spectrum(21000) })])
    expect(screen.getByTestId('track-quality')).toHaveAttribute('data-quality', 'good')
  })

  // A clean track must look different from one that was never analyzed: artexjay scanned
  // whole albums by this mark to confirm they were fine, and with the good verdict drawn as
  // nothing, "good" and "not analyzed yet" read the same. The verdict tints the format pill,
  // so a clean track's pill is the one that carries a verdict, and it answers hover with the
  // same verdict a screen reader hears.
  it('tints the format pill of a clean track and names its verdict on hover', () => {
    renderList([
      track({ id: 'a', inputPath: '/music/a.flac', spectrum: spectrum(21000) }),
      track({ id: 'b', inputPath: '/music/b.flac' }),
    ])
    const [clean, unanalyzed] = screen.getAllByTestId('track-format')
    const mark = screen.getByTestId('track-quality')
    expect(mark).toHaveAttribute('data-tone', 'good')
    expect(mark).toContainElement(clean)
    expect(mark).not.toContainElement(unanalyzed)
    expect(mark).toHaveTextContent(i18n.t('editor.qualityGood'))
    fireEvent.focusIn(mark)
    expect(screen.getByRole('tooltip')).toHaveTextContent(i18n.t('editor.qualityGood'))
  })

  // artexjay 24/09: the verdict moved into the format pill to hand its own 12px slot back to
  // the artist. Scanning down the list still needs it in one column, so it rides the format
  // slot at the row's end whatever other marks the row carries.
  it('carries the verdict inside the format slot, whatever else the row marks', () => {
    renderList([
      track({ id: 'a', inputPath: '/music/a.flac', spectrum: spectrum(21000) }),
      track({
        id: 'b',
        inputPath: '/music/b.flac',
        spectrum: spectrum(16000),
        autoMatched: true,
        metaReadFailed: true,
      }),
      track({ id: 'c', inputPath: '/music/c.flac' }),
      track({ id: 'd', inputPath: '/music/d.flac', analyzing: true }),
    ])
    expect(screen.queryByTestId('track-quality-slot')).not.toBeInTheDocument()
    const slots = screen.getAllByTestId('track-format-slot')
    expect(slots).toHaveLength(4)
    expect(within(slots[0]).getByTestId('track-quality')).toHaveAttribute('data-quality', 'good')
    expect(within(slots[1]).getByTestId('track-quality')).toHaveAttribute(
      'data-quality',
      'transcoded',
    )
    expect(within(slots[2]).queryByTestId('track-quality')).not.toBeInTheDocument()
    expect(within(slots[2]).getByTestId('track-format')).toHaveTextContent('FLAC')
    expect(within(slots[3]).getByTestId('track-quality-loading')).toHaveTextContent('FLAC')
  })

  // Colour alone can't tell amber from red for a colour-blind user, so the two verdicts that
  // ask for attention keep their shape inside the pill. A clean pill goes without, so a good
  // album doesn't fill with symbols.
  it('keeps a shape inside the pill only for the verdicts that ask for attention', () => {
    renderList([
      track({ id: 'a', inputPath: '/music/a.flac', spectrum: spectrum(21000) }),
      track({
        id: 'b',
        inputPath: '/music/b.flac',
        spectrum: { ...spectrum(16000), processed: true },
      }),
      track({ id: 'c', inputPath: '/music/c.flac', spectrum: spectrum(16000) }),
    ])
    const [good, processed, transcoded] = screen.getAllByTestId('track-quality')
    expect(good.querySelector('svg')).toBeNull()
    expect(processed.querySelector('svg')).not.toBeNull()
    expect(transcoded.querySelector('svg')).not.toBeNull()
  })

  // With no extension there is no format to tint, but an analysed file still owes its
  // verdict: the pill falls back to the bare shape, good included.
  it('draws the bare shape when the file has no format to tint', () => {
    renderList([track({ id: 'a', inputPath: '/music/a', spectrum: spectrum(21000) })])
    expect(screen.getByTestId('track-quality').querySelector('svg')).not.toBeNull()
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

  // El relleno azul dice qué track se está editando; no dice dónde está el teclado. Al
  // recorrer la lista con ↑/↓ hace falta un contorno propio, el mismo que marca la tarjeta
  // enfocada en la columna de resultados. Va con `focus-visible:` y no con `focus:` porque
  // aquí sí distingue el clic de ratón (que no debe pintarlo) del recorrido con flechas.
  it('marca con contorno la fila que tiene el foco de teclado', () => {
    renderList([track({ id: 'a' }), track({ id: 'b' })])
    const row = screen.getAllByTestId('track-row')[0]
    expect(row.className).toContain('focus-visible:outline-[var(--color-accent)]')
    expect(row.className).toContain('focus-visible:outline-1')
    expect(row.className).toContain('focus-visible:-outline-offset-1')
  })
})

// Play sits over every row at opacity 0 until the pointer hovers it. It was still a Tab
// stop, so a keyboard user walked through an invisible button per track with no ring to
// show where the focus went. The row already answers Space (play), so it stays pointer-only.
describe('TrackList hover overlays', () => {
  it('keeps play out of the Tab order on every row', () => {
    renderList([track({ id: 'a' }), track({ id: 'b' })], 'a')
    const overlays = screen.getAllByRole('button', { name: i18n.t('player.play') })
    expect(overlays).toHaveLength(2)
    for (const button of overlays) expect(button).toHaveAttribute('tabindex', '-1')
  })
})

// The hover X used to take the place of the duration and the format pill, so the quality
// verdict vanished right when the pointer was on the row. Removing moved to a two-finger
// swipe, the way Mail deletes: a short one reveals Remove, a full one removes outright.
// ⌫/Supr and the context menu still remove for a mouse with no horizontal scroll.
describe('TrackList swipe to remove', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const swipe = (deltaX: number, deltaY = 0) => {
    fireEvent.wheel(screen.getByTestId('track-row').parentElement as Element, { deltaX, deltaY })
    act(() => vi.advanceTimersByTime(500))
  }

  it('keeps the duration and the format in place when the pointer is on the row', () => {
    renderList([track({ id: 'a', inputPath: '/music/a.flac', duration: 200 })])
    expect(screen.queryByRole('button', { name: i18n.t('trackList.remove') })).toBeNull()
    expect(screen.getByTestId('track-format-slot').className).not.toContain('group-hover:opacity-0')
    expect(screen.getByTestId('track-duration-slot').className).not.toContain(
      'group-hover:opacity-0',
    )
  })

  it('reveals Remove on a short swipe and removes the track from it', () => {
    const { onSwipeRemove } = renderList([track({ id: 'a' })])
    swipe(70)
    expect(onSwipeRemove).not.toHaveBeenCalled()
    const remove = screen.getByRole('button', { name: i18n.t('trackList.remove') })
    expect(remove).toHaveAttribute('tabindex', '-1')
    fireEvent.click(remove)
    expect(onSwipeRemove).toHaveBeenCalledWith('a')
  })

  // Flush against the row, the button read as part of it (seen in the app 24/09); Mail keeps
  // a gap between the slid row and its action, so the action is a thing of its own.
  it('leaves a gap between the slid row and the Remove button', () => {
    renderList([track({ id: 'a' })])
    swipe(70)
    const slid = Number.parseFloat(
      screen.getByTestId('track-row').style.transform.replace(/[^\d.]/g, ''),
    )
    const width = Number.parseFloat(
      screen.getByRole('button', { name: i18n.t('trackList.remove') }).style.width,
    )
    expect(slid - width).toBeGreaterThanOrEqual(6)
  })

  it('removes the track outright on a full swipe', () => {
    const { onSwipeRemove } = renderList([track({ id: 'a' })])
    swipe(400)
    expect(onSwipeRemove).toHaveBeenCalledWith('a')
  })

  it('closes again on a swipe back or a nudge too small to mean it', () => {
    renderList([track({ id: 'a' })])
    swipe(70)
    swipe(-70)
    expect(screen.queryByRole('button', { name: i18n.t('trackList.remove') })).toBeNull()
    swipe(20)
    expect(screen.queryByRole('button', { name: i18n.t('trackList.remove') })).toBeNull()
  })

  // How far the row travels tells the user what letting go will do. One to one with the
  // fingers it overshot the list (Vicent 24/09: "llegaba a más del final"); held back all the
  // way, the grey never reached the end ("se queda a mitad"). So, like Mail: it resists while
  // the swipe is undecided, and once letting go would remove, the grey fills the row exactly.
  const slidBy = () =>
    Number.parseFloat(screen.getByTestId('track-row').style.transform.replace(/[^\d.]/g, ''))
  const swipeWithoutLetting = (total: number) => {
    const wrapper = screen.getByTestId('track-row').parentElement as Element
    for (let i = 0; i < 8; i++) fireEvent.wheel(wrapper, { deltaX: total / 8 })
  }

  it('holds the row back while the swipe is still undecided', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
    renderList([track({ id: 'a' })])
    swipeWithoutLetting(150)
    expect(slidBy()).toBeGreaterThan(90)
    expect(slidBy()).toBeLessThan(150)
  })

  it('fills the row to its edge and no further once letting go would remove', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
    const { onSwipeRemove } = renderList([track({ id: 'a' })])
    swipeWithoutLetting(1000)
    expect(slidBy()).toBe(300)
    act(() => vi.advanceTimersByTime(500))
    expect(onSwipeRemove).toHaveBeenCalledWith('a')
  })

  // Full height, the grey touched the rows above and below and read as glued to them (seen
  // in the app 24/09). It sits inset from the row's top and bottom edges as well as its side.
  it('keeps the Remove button off the rows above and below', () => {
    renderList([track({ id: 'a' })])
    swipe(70)
    const remove = screen.getByRole('button', { name: i18n.t('trackList.remove') })
    expect(remove.className).not.toMatch(/\binset-y-0\b/)
    expect(remove.className).toMatch(/\binset-y-1\b/)
  })

  // Crossing the threshold moves the row from half way to the edge in one event, which read
  // as a jump (Vicent 24/09: "da un salto hasta el final, no va fino"). The row's position and
  // the grey's width ease into place, on the selected row too, whose fill must not ease.
  it('eases the row and the grey into place instead of jumping', () => {
    renderList([track({ id: 'a' }), track({ id: 'b' })], 'b')
    fireEvent.wheel(screen.getAllByTestId('track-row')[0].parentElement as Element, { deltaX: 70 })
    act(() => vi.advanceTimersByTime(500))
    for (const row of screen.getAllByTestId('track-row'))
      expect(row.className).toMatch(/transition-\[[^\]]*transform/)
    expect(screen.getAllByTestId('track-row')[1].className).not.toMatch(/background-color/)
    expect(screen.getByRole('button', { name: i18n.t('trackList.remove') }).className).toMatch(
      /transition-\[width\]/,
    )
  })

  // A trackpad scroll is never perfectly vertical; the list must not start sliding rows
  // sideways while the user is just scrolling it.
  it('ignores a mostly vertical scroll', () => {
    const { onSwipeRemove } = renderList([track({ id: 'a' })])
    swipe(300, 600)
    expect(onSwipeRemove).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: i18n.t('trackList.remove') })).toBeNull()
  })

  it('closes when the pointer leaves the row', () => {
    renderList([track({ id: 'a' })])
    swipe(70)
    fireEvent.mouseLeave(screen.getByTestId('track-row').parentElement as Element)
    expect(screen.queryByRole('button', { name: i18n.t('trackList.remove') })).toBeNull()
  })
})

describe('TrackList keyboard selection', () => {
  // Shift+↓ used to fall through to plain "next", collapsing the multi-selection the user
  // was building: the keyboard had no way to select a range. It must extend from the anchor
  // to the row below the focused one, exactly like a Shift-click there, and carry the focus
  // along so the next press keeps growing the range.
  it('extends the selection from the focused row with Shift and the arrows', () => {
    const { onSelect } = renderList(
      [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })],
      'a',
    )
    const rows = screen.getAllByTestId('track-row')
    fireEvent.keyDown(rows[1], { key: 'ArrowDown', shiftKey: true })
    expect(onSelect).toHaveBeenCalledWith('c', { shift: true })
    fireEvent.keyDown(rows[1], { key: 'ArrowUp', shiftKey: true })
    expect(onSelect).toHaveBeenLastCalledWith('a', { shift: true })
  })

  // The global handler maps ↓ to "next" and would move the selection a second time,
  // collapsing the range the row just extended.
  it('claims the Shift-arrow press so the global next/prev does not also run', () => {
    renderList([track({ id: 'a' }), track({ id: 'b' })], 'a')
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    screen.getAllByTestId('track-row')[0].dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('stays put at the ends of the list', () => {
    const { onSelect } = renderList([track({ id: 'a' }), track({ id: 'b' })], 'a')
    fireEvent.keyDown(screen.getAllByTestId('track-row')[1], { key: 'ArrowDown', shiftKey: true })
    expect(onSelect).not.toHaveBeenCalled()
  })

  // Plain Space plays the track, so toggling one row in or out of a multi-selection from
  // the keyboard needs its own chord: ⌘Space / Ctrl+Space, the file-manager convention.
  it('toggles the focused row in or out of the selection with Cmd/Ctrl+Space', () => {
    const { onSelect } = renderList([track({ id: 'a' }), track({ id: 'b' })], 'a')
    const rows = screen.getAllByTestId('track-row')
    fireEvent.keyDown(rows[1], { key: ' ', metaKey: true })
    expect(onSelect).toHaveBeenCalledWith('b', { meta: true })
    fireEvent.keyDown(rows[1], { key: ' ', ctrlKey: true })
    expect(onSelect).toHaveBeenCalledTimes(2)
  })
})

describe('TrackList error badge', () => {
  // A failed conversion and unapplied changes were the same hollow ring told apart only by
  // red versus amber, which a colour-blind user cannot separate. The error has to carry a
  // glyph of its own, and the pending ring must stay a plain ring.
  it('marks a failed conversion with an alert glyph, not just a red ring', () => {
    const edited = track({ id: 'b', status: 'done', meta: { title: 'New title' } })
    renderList([
      track({ id: 'a', status: 'error' }),
      {
        ...edited,
        processedSignature: trackSignature({ ...edited, meta: { ...edited.meta, title: 'Old' } }),
      },
    ])
    const [error, stale] = screen.getAllByTestId('track-status-badge')
    expect(error).toHaveAttribute('data-tone', 'danger')
    expect(within(error).getByTestId('track-status-error-glyph')).toBeInTheDocument()
    expect(within(stale).queryByTestId('track-status-error-glyph')).not.toBeInTheDocument()
  })
})

describe('TrackList row state for screen readers', () => {
  // The row's marks are aria-hidden glyphs whose words live only in a hover tooltip, so a
  // screen reader user heard the title and artist and nothing about a failed conversion, a
  // doubtful rip, an unread tag or an applied auto-match. The words must be in the name.
  it('names the conversion, quality, tag-read and auto-match state in the row', () => {
    renderList([
      track({
        id: 'a',
        status: 'error',
        metaReadFailed: true,
        autoMatched: true,
        inputPath: '/music/a.m4a',
        spectrum: { cutoffHz: 16000, sampleRateHz: 44100, processed: false },
      }),
    ])
    const name = screen.getByRole('option').textContent
    expect(name).toContain(i18n.t('trackList.status.error'))
    expect(name).toContain(i18n.t('editor.qualityBad'))
    expect(name).toContain(i18n.t('trackList.metaReadFailed'))
    expect(name).toContain(i18n.t('trackList.autoMatched'))
  })
})

describe('TrackList review spark', () => {
  // A button inside the row's option button is invalid HTML: screen readers flatten the
  // inner control into the option's name and the accept action is lost. It must be a
  // sibling of the row, like play and remove.
  it('keeps the accept-review button outside the row button', () => {
    renderList([track({ id: 'a', matchReview: true, matchConfidence: 0.7 })])
    const row = screen.getByTestId('track-row')
    const spark = screen.getByTestId('track-match-review')
    expect(row).not.toContainElement(spark)
    expect(row.parentElement).toContainElement(spark)
  })

  // The spark glyph is 12px, half the 24px minimum target (WCAG 2.5.8), so accepting a
  // suggestion took a precise aim. The button grows its hit area, not the glyph.
  it('gives the accept-review button a 24px hit area around the small glyph', () => {
    renderList([track({ id: 'a', matchReview: true, matchConfidence: 0.7 })])
    const spark = screen.getByTestId('track-match-review')
    expect(spark.className).toMatch(/\bh-6\b/)
    expect(spark.className).toMatch(/\bw-6\b/)
  })
})

describe('TrackList current row', () => {
  // Several rows can be selected, but only one is open in the editor. Sighted users see it
  // by its solid fill; a screen reader needs aria-current to tell it from the others.
  it('marks only the row open in the editor as current', () => {
    renderList([track({ id: 'a' }), track({ id: 'b' })], 'b', ['a', 'b'])
    const rows = screen.getAllByTestId('track-row')
    expect(rows[0]).not.toHaveAttribute('aria-current')
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
  })
})

// A track whose file Surco backed up before rewriting it carries a quiet mark on its
// row, in place of the toolbar count that climbed with every conversion. The mark has
// to say what it is to a screen reader too, and a click on it opens that backup rather
// than just selecting the row, since that is what someone clicking it is after.
describe('TrackList backup mark', () => {
  it('marks only the rows whose file has a backup, and names it', () => {
    renderListWithBackups([track({ id: 'a' }), track({ id: 'b' })], { '/music/a.wav': Date.now() })
    const marks = screen.getAllByTestId('track-backup')
    expect(marks).toHaveLength(1)
    expect(within(screen.getAllByTestId('track-row')[0]).getByTestId('track-backup')).toBe(marks[0])
    expect(marks[0]).toHaveTextContent(/backup/i)
  })

  // The mark is an undo arrow, which reads as "revert now"; its label has to say the click
  // leads back to the original (the ellipsis: a panel opens first) so it doesn't surprise.
  it('names the mark as the way back to the original', () => {
    renderListWithBackups([track({ id: 'a' })], { '/music/a.wav': Date.now() })
    expect(screen.getByTestId('track-backup')).toHaveTextContent(/back to the original…/i)
  })

  it('opens the backup when its mark is clicked, instead of only selecting the row', () => {
    const { onOpenBackup, onSelect } = renderListWithBackups([track({ id: 'a' })], {
      '/music/a.wav': Date.now(),
    })
    fireEvent.click(screen.getByTestId('track-backup'))
    expect(onOpenBackup).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

function renderListWithBackups(tracks: TrackItem[], backups: Record<string, number>) {
  const onSelect = vi.fn()
  const onOpenBackup = vi.fn()
  render(
    <TrackList
      tracks={tracks}
      selectedId={null}
      selectedIds={new Set()}
      outputFormat="aiff"
      bindings={bindings}
      onSelect={onSelect}
      onActivate={vi.fn()}
      onRemove={vi.fn()}
      onSwipeRemove={vi.fn()}
      onAcceptReview={vi.fn()}
      onPrefetch={vi.fn()}
      renderMenu={() => null}
      backupAtByPath={new Map(Object.entries(backups))}
      onOpenBackup={onOpenBackup}
    />,
  )
  return { onSelect, onOpenBackup }
}

describe('TrackList row positions', () => {
  const stable = {
    selectedIds: new Set<string>(),
    onSelect: vi.fn(),
    onActivate: vi.fn(),
    onRemove: vi.fn(),
    onSwipeRemove: vi.fn(),
    onAcceptReview: vi.fn(),
    onPrefetch: vi.fn(),
    renderMenu: () => null,
  }
  const list = (tracks: TrackItem[]) => (
    <TrackList
      tracks={tracks}
      selectedId={null}
      outputFormat="aiff"
      bindings={bindings}
      {...stable}
    />
  )

  // The rows are real DOM, not a window over the list, so a screen reader needs each one to
  // say where it sits: "row 3 of 4", and 4 again for every row once a track is added.
  it('announces each row as its position out of the whole list', () => {
    const tracks = [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })]
    const { rerender } = render(list(tracks))

    rerender(list([...tracks, track({ id: 'd' })]))

    const rows = screen.getAllByTestId('track-row')
    expect(rows.map((r) => r.getAttribute('aria-posinset'))).toEqual(['1', '2', '3', '4'])
    expect(rows.map((r) => r.getAttribute('aria-setsize'))).toEqual(['4', '4', '4', '4'])
  })

  // An import lands folder by folder, one batch per directory, so a big library grows the
  // list hundreds of times over. Re-rendering every row already listed on each batch made
  // an import of N tracks cost on the order of N² row renders.
  it('does not re-render the rows already listed when a track is appended', () => {
    const tracks = [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })]
    const { rerender } = render(list(tracks))
    const rowRenders = vi.spyOn(triage, 'trackQuality')

    rerender(list([...tracks, track({ id: 'd' })]))

    expect(rowRenders).toHaveBeenCalledTimes(1)
  })
})
