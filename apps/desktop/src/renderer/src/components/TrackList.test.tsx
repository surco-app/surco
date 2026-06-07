// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// TrackContextMenu reads window.api at render; install a stub before importing it.
const api = { platform: 'darwin', reveal: vi.fn(), openFile: vi.fn(), copyText: vi.fn() }
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = {}
})

import '../i18n'
import type { TrackMetadata } from '../../../shared/types'
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
  return {
    inputPath: `/music/${over.id}.wav`,
    fileName: `${over.id}.wav`,
    query: '',
    status: 'idle',
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
) {
  const onSelect = vi.fn()
  const onRemove = vi.fn()
  const onPrefetch = vi.fn()
  const onSearch = vi.fn()
  const onTrash = vi.fn()
  render(
    <TrackList
      tracks={tracks}
      selectedId={selectedId}
      selectedIds={selectedIds}
      outputFormat="aiff"
      onSelect={onSelect}
      onRemove={onRemove}
      onPrefetch={onPrefetch}
      onSearch={onSearch}
      onTrash={onTrash}
    />,
  )
  return { onSelect, onRemove, onPrefetch, onSearch, onTrash }
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

  it('falls back to the file name and a no-artist label when metadata is empty', () => {
    renderList([track({ id: 'untitled' })])
    expect(screen.getByText('untitled.wav')).toBeInTheDocument()
    expect(screen.getByText('No artist')).toBeInTheDocument()
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

  it('selects a track when its row is clicked', () => {
    const { onSelect } = renderList([track({ id: 'a' }), track({ id: 'b' })])
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    expect(onSelect).toHaveBeenCalledWith('b', { meta: false, shift: false })
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
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true')
    expect(rows[1]).toHaveAttribute('aria-pressed', 'true')
    expect(rows[2]).toHaveAttribute('aria-pressed', 'false')
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

  it('reveals, opens and copies the path of the original file', () => {
    renderList([track({ id: 'a' })])
    const row = () => screen.getByTestId('track-row')
    fireEvent.contextMenu(row())
    fireEvent.click(screen.getByTestId('track-menu-reveal'))
    fireEvent.contextMenu(row())
    fireEvent.click(screen.getByTestId('track-menu-open'))
    fireEvent.contextMenu(row())
    fireEvent.click(screen.getByTestId('track-menu-copy'))
    expect(api.reveal).toHaveBeenCalledWith('/music/a.wav')
    expect(api.openFile).toHaveBeenCalledWith('/music/a.wav')
    expect(api.copyText).toHaveBeenCalledWith('/music/a.wav')
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

describe('TrackList quality badge', () => {
  const spectrum = (cutoffHz: number | null) => ({ image: '', cutoffHz, sampleRateHz: 44100 })

  // The badge is the whole point of batch triage: a re-encoded MP3 (cutoff far below
  // Nyquist) must be flaggable in the list without opening each track.
  it('flags a suspect track in the row', () => {
    renderList([track({ id: 'a', spectrum: spectrum(16000) })])
    expect(screen.getByTestId('track-quality')).toHaveAttribute('data-quality', 'suspect')
  })

  it('marks a clean track as good', () => {
    renderList([track({ id: 'a', spectrum: spectrum(21000) })])
    expect(screen.getByTestId('track-quality')).toHaveAttribute('data-quality', 'good')
  })

  it('shows no badge until the track has been analyzed', () => {
    renderList([track({ id: 'a' })])
    expect(screen.queryByTestId('track-quality')).not.toBeInTheDocument()
  })
})
