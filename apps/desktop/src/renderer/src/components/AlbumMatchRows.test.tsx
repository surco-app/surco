// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { Release, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { AlbumMatchRows } from './AlbumMatchRows'

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
    listLabel: title,
    query: '',
    status: 'idle',
    duration: durationSec,
    meta: { ...emptyMeta, title },
  }
}

const release: Release = {
  provider: 'discogs',
  id: 5,
  title: 'Hard House Nation',
  artists: [{ name: 'Various' }],
  year: 2000,
  tracklist: [
    { position: 'A1', title: 'Radio Edit', duration: '3:00' },
    { position: 'A2', title: 'Extended Mix', duration: '6:00' },
  ],
}

function renderRows(files: TrackItem[], onApply = vi.fn()) {
  render(<AlbumMatchRows files={files} release={release} onApply={onApply} />)
  return { onApply }
}

// The picker is the app's themed Select (a button + popover, not a native <select>): open
// it, then click the option whose value indexes the tracklist.
function pickTrack(id: string, optionValue: string): void {
  fireEvent.click(screen.getByTestId(`match-select-${id}`))
  fireEvent.click(screen.getByTestId(`match-select-${id}-option-${optionValue}`))
}

describe('AlbumMatchRows', () => {
  it('auto-assigns each file to the tracklist entry nearest in duration', async () => {
    renderRows([track('short', 'radio edit', 181), track('long', 'extended mix', 359)])
    await waitFor(() =>
      expect(screen.getByTestId('match-select-short')).toHaveTextContent('Radio Edit'),
    )
    expect(screen.getByTestId('match-select-long')).toHaveTextContent('Extended Mix')
  })

  // The confidence tick is the only signal a row was auto-suggested; as a bare icon it
  // was invisible to a screen reader, so it carries an explicit name.
  it('announces the suggested-match badge to screen readers', async () => {
    renderRows([track('short', 'radio edit', 181)])
    expect(await screen.findByTestId('match-confidence-short')).toHaveAccessibleName()
  })

  it('applies the matched track title to each file when confirmed', async () => {
    const { onApply } = renderRows([
      track('short', 'radio edit', 181),
      track('long', 'extended mix', 359),
    ])
    await screen.findAllByTestId('match-row')
    fireEvent.click(screen.getByTestId('match-apply'))
    const patches = onApply.mock.calls[0][0] as { id: string; patch: { meta: TrackMetadata } }[]
    expect(patches.find((p) => p.id === 'short')?.patch.meta.title).toBe('Radio Edit')
    expect(patches.find((p) => p.id === 'long')?.patch.meta.title).toBe('Extended Mix')
  })

  it('acknowledges the apply by flashing the button to "Applied"', async () => {
    renderRows([track('short', 'radio edit', 181)])
    await screen.findAllByTestId('match-row')
    const button = screen.getByTestId('match-apply')
    expect(button).toHaveTextContent('Apply to 1')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Applied')
  })

  // Bug report: after applying once you can't apply again without reloading. Re-applying —
  // and re-applying after correcting an assignment — must keep firing.
  it('can apply again, including after changing a track, without reloading', async () => {
    const { onApply } = renderRows([track('short', 'radio edit', 181)])
    await screen.findAllByTestId('match-row')
    fireEvent.click(screen.getByTestId('match-apply'))
    expect(onApply).toHaveBeenCalledTimes(1)
    // Change the assignment, then apply again.
    pickTrack('short', '1')
    fireEvent.click(screen.getByTestId('match-apply'))
    expect(onApply).toHaveBeenCalledTimes(2)
    expect(onApply.mock.calls[1][0][0].patch.meta.title).toBe('Extended Mix')
  })

  // The file's title must be cleaned (feat./bracket noise stripped) before scoring, the
  // same as the single-track tick and the editor browser. Here the two cuts share a
  // duration, so the title is the only thing that can tell them apart: an uncleaned
  // "Sunrise (feat. Moonlight Drive)" matches the decoy "Moonlight Drive" better than the
  // real "Sunrise" and lands on the wrong track. Cleaning collapses it back to "Sunrise".
  it('cleans feat./bracket noise off the title before matching', async () => {
    const sameDuration: Release = {
      provider: 'discogs',
      id: 9,
      title: 'Night Cuts',
      artists: [{ name: 'Various' }],
      year: 2001,
      tracklist: [
        { position: 'A1', title: 'Sunrise', duration: '3:00' },
        { position: 'A2', title: 'Moonlight Drive', duration: '3:00' },
      ],
    }
    render(
      <AlbumMatchRows
        files={[track('noisy', 'Sunrise (feat. Moonlight Drive)', 181)]}
        release={sameDuration}
        onApply={vi.fn()}
      />,
    )
    await waitFor(() =>
      expect(screen.getByTestId('match-select-noisy')).toHaveTextContent('Sunrise'),
    )
  })

  it('reassigns only the chosen file, leaving the others put', async () => {
    // Duplicates are allowed, so pointing the short file at the extended mix must not
    // reshuffle the long file — a manual pick touches exactly one row.
    renderRows([track('short', 'radio edit', 181), track('long', 'extended mix', 359)])
    await waitFor(() =>
      expect(screen.getByTestId('match-select-short')).toHaveTextContent('Radio Edit'),
    )
    pickTrack('short', '1')
    expect(screen.getByTestId('match-select-short')).toHaveTextContent('Extended Mix')
    expect(screen.getByTestId('match-select-long')).toHaveTextContent('Extended Mix')
  })
})
