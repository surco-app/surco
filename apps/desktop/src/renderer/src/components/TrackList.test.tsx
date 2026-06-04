// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { TrackList } from './TrackList'

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

function renderList(tracks: TrackItem[], selectedId: string | null = null) {
  const onSelect = vi.fn()
  const onRemove = vi.fn()
  const onPrefetch = vi.fn()
  render(
    <TrackList
      tracks={tracks}
      selectedId={selectedId}
      outputFormat="aiff"
      onSelect={onSelect}
      onRemove={onRemove}
      onPrefetch={onPrefetch}
    />,
  )
  return { onSelect, onRemove, onPrefetch }
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
    expect(onSelect).toHaveBeenCalledWith('b')
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
