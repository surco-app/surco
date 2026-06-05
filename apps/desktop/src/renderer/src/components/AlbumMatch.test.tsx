// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { DiscogsRelease, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { AlbumMatch } from './AlbumMatch'

afterEach(cleanup)

const emptyMeta: TrackMetadata = {
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

function track(id: string, title: string, durationSec: number): TrackItem {
  return {
    id,
    inputPath: `/music/${id}.flac`,
    fileName: `${id}.flac`,
    query: 'album',
    status: 'idle',
    duration: durationSec,
    meta: { ...emptyMeta, title },
  }
}

const release: DiscogsRelease = {
  id: 5,
  title: 'Hard House Nation',
  artists: [{ name: 'Various' }],
  year: 2000,
  tracklist: [
    { position: 'A1', title: 'Radio Edit', duration: '3:00' },
    { position: 'A2', title: 'Extended Mix', duration: '6:00' },
  ],
}

function mockApi() {
  const api = {
    searchDiscogs: vi.fn().mockResolvedValue([{ id: 5, title: 'Hard House Nation', year: '2000' }]),
    getRelease: vi.fn().mockResolvedValue(release),
  }
  ;(window as unknown as { api: unknown }).api = api
  return api
}

// Loads the album into the panel and waits for the mapping rows to render, the common
// setup for every assertion about the assignment.
async function loadMatched(files: TrackItem[], onApply = vi.fn()) {
  mockApi()
  render(<AlbumMatch files={files} onApply={onApply} />)
  fireEvent.click(screen.getByTestId('match-search'))
  fireEvent.click(await screen.findByTestId('match-result'))
  await screen.findAllByTestId('match-row')
  return { onApply }
}

describe('AlbumMatch', () => {
  it('auto-assigns each file to the tracklist entry nearest in duration', async () => {
    await loadMatched([track('short', 'radio edit', 181), track('long', 'extended mix', 359)])
    // A1 is index 0, A2 is index 1 — the short rip lands on the radio edit, the long one
    // on the extended mix, without the user touching anything.
    expect(screen.getByTestId('match-select-short')).toHaveValue('0')
    expect(screen.getByTestId('match-select-long')).toHaveValue('1')
  })

  it('applies the matched track title to each file when confirmed', async () => {
    const { onApply } = await loadMatched([
      track('short', 'radio edit', 181),
      track('long', 'extended mix', 359),
    ])
    fireEvent.click(screen.getByTestId('match-apply'))
    const patches = onApply.mock.calls[0][0] as { id: string; patch: { meta: TrackMetadata } }[]
    expect(patches.find((p) => p.id === 'short')?.patch.meta.title).toBe('Radio Edit')
    expect(patches.find((p) => p.id === 'long')?.patch.meta.title).toBe('Extended Mix')
  })

  it('swaps the held entry when a file is reassigned to a track another file has', async () => {
    // Pointing the short file at the extended mix must hand the radio edit to the long
    // file, so the two trade rather than both claiming one track.
    await loadMatched([track('short', 'radio edit', 181), track('long', 'extended mix', 359)])
    fireEvent.change(screen.getByTestId('match-select-short'), { target: { value: '1' } })
    await waitFor(() => expect(screen.getByTestId('match-select-long')).toHaveValue('0'))
    expect(screen.getByTestId('match-select-short')).toHaveValue('1')
  })
})
