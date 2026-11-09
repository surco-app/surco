// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = {}
})

import { resolveBindings } from '../../../shared/shortcutDefaults'
import type { TrackMetadata } from '../../../shared/types'
import '../i18n'
import type { TrackItem } from '../types'
import { TrackList } from './TrackList'

afterEach(cleanup)

function track(id: string): TrackItem {
  const meta: TrackMetadata = {
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
  }
  return {
    id,
    inputPath: `/music/${id}.wav`,
    fileName: `${id}.wav`,
    query: '',
    status: 'idle',
    listLabel: `${id}.wav`,
    meta,
  }
}

function renderList(sessionNoteOf?: (t: TrackItem) => React.ReactNode) {
  render(
    <TrackList
      tracks={[track('a'), track('b')]}
      selectedId={null}
      selectedIds={new Set()}
      outputFormat="aiff"
      bindings={resolveBindings()}
      onSelect={vi.fn()}
      onActivate={vi.fn()}
      onRemove={vi.fn()}
      onSwipeRemove={vi.fn()}
      onAcceptReview={vi.fn()}
      onPrefetch={vi.fn()}
      renderMenu={() => null}
      sessionNoteOf={sessionNoteOf}
    />,
  )
  return [screen.getByTestId('track-drag-a'), screen.getByTestId('track-drag-b')]
}

describe('TrackList session notes', () => {
  it('puts the note under the row of the track it is for, and only there', () => {
    const [first, second] = renderList((t) =>
      t.id === 'a' ? <span data-testid="session-note">why a</span> : undefined,
    )
    expect(within(first).getByTestId('session-note')).toHaveTextContent('why a')
    expect(within(second).queryByTestId('session-note')).toBeNull()
  })

  it('draws the note after the artist line, not beside the title', () => {
    const [first] = renderList(() => <span data-testid="session-note">why</span>)
    const artist = within(first).getByTestId('track-artist')
    const note = within(first).getByTestId('session-note')
    expect(artist.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('leaves every row as it was when there are no session notes', () => {
    renderList()
    expect(screen.queryByTestId('session-note')).toBeNull()
  })
})
