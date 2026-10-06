// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { MusicReview as Review, ReviewRun } from '../hooks/useMusicReview'
import { MusicReview } from './MusicReview'

afterEach(cleanup)

const group = {
  key: 'artist||case|djlara',
  field: 'artist' as const,
  kind: 'case' as const,
  variants: [
    { value: 'DJ Lara', persistentIds: ['A', 'B'] },
    { value: 'Dj Lara', persistentIds: ['C'] },
  ],
  suggested: 'DJ Lara',
}

function review(over: Partial<Review> = {}): Review {
  return {
    status: 'ready',
    filter: 'all',
    setFilter: vi.fn(),
    spelling: [group],
    duplicates: [],
    choice: () => 'DJ Lara',
    choose: vi.fn(),
    staged: new Set(),
    toggleStaged: vi.fn(),
    ignore: vi.fn(),
    summary: { tracks: 0, byField: {}, duplicates: 0 },
    progress: null,
    apply: vi.fn(),
    cancel: vi.fn(),
    undo: vi.fn(),
    lastRun: null,
    ...over,
  }
}

const run = (over: Partial<ReviewRun> = {}): ReviewRun => ({
  outcomes: [],
  removed: [],
  before: 3,
  after: 2,
  librarySync: 'none',
  ...over,
})

const removal = (outcome: ReviewRun['removed'][number]['outcome']) => ({
  outcome,
  playlists: 0,
  fileTrashed: false,
})

const done = (lastRun: ReviewRun) => review({ status: 'done', lastRun })

describe('MusicReview', () => {
  it('shows each spelling with its track count and stages the group on Unify', () => {
    const r = review()
    render(<MusicReview review={r} onClose={vi.fn()} />)
    expect(screen.getByTestId('music-review-group')).toHaveTextContent('Dj Lara')
    fireEvent.click(screen.getByTestId('music-review-stage'))
    expect(r.toggleStaged).toHaveBeenCalledWith(group.key)
  })

  it('marks a safe kind and a risky one with a different dot', () => {
    const typo = { ...group, key: 'typo', kind: 'typo' as const }
    render(<MusicReview review={review({ spelling: [group, typo] })} onClose={vi.fn()} />)
    expect(screen.getAllByRole('img').map((d) => d.getAttribute('aria-label'))).toEqual([
      'Safe',
      'Review',
    ])
  })

  // Nothing touches a file from the list itself: the tray opens a confirmation first.
  it('asks before applying and lists what stays untouched', () => {
    const r = review({
      staged: new Set([group.key]),
      summary: { tracks: 1, byField: { artist: 1 }, duplicates: 0 },
    })
    render(<MusicReview review={r} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('music-review-tray-apply'))
    expect(r.apply).not.toHaveBeenCalled()
    expect(screen.getByTestId('music-review-confirm')).toHaveTextContent('rekordbox, Engine DJ')
    fireEvent.click(screen.getByTestId('music-review-confirm-apply'))
    expect(r.apply).toHaveBeenCalled()
  })

  it('disables the tray while nothing is staged', () => {
    render(<MusicReview review={review()} onClose={vi.fn()} />)
    expect(screen.getByTestId('music-review-tray-apply')).toBeDisabled()
  })

  it('offers undo after a run', () => {
    const r = done(run())
    render(<MusicReview review={r} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('music-review-undo'))
    expect(r.undo).toHaveBeenCalled()
  })

  it('says the library is empty', () => {
    render(<MusicReview review={review({ status: 'empty', spelling: [] })} onClose={vi.fn()} />)
    expect(screen.getByTestId('music-review-empty')).toBeInTheDocument()
  })

  // A removal that never reached the library must not read as a removed copy.
  it('counts a duplicate as removed only when it was, and the rest as failures', () => {
    render(
      <MusicReview
        review={done(
          run({
            removed: [
              removal('removed'),
              removal('missing'),
              removal('playlist-failed'),
              removal('failed'),
              removal('mismatch'),
            ],
          }),
        )}
        onClose={vi.fn()}
      />,
    )
    const sheet = screen.getByTestId('music-review-done')
    expect(sheet).toHaveTextContent('1 track updated')
    expect(sheet).toHaveTextContent('3 could not be changed')
  })

  it('warns when the other libraries did not follow and when Music refused the batch', () => {
    render(
      <MusicReview
        review={done(run({ librarySync: 'failed', applyError: 'boom' }))}
        onClose={vi.fn()}
      />,
    )
    const sheet = screen.getByTestId('music-review-done')
    expect(sheet).toHaveTextContent("rekordbox, Engine DJ or Traktor weren't updated")
    expect(sheet).toHaveTextContent("Couldn't apply in Apple Music.")
  })

  it('hides the groups-left line when the recount failed', () => {
    render(<MusicReview review={done(run({ after: null }))} onClose={vi.fn()} />)
    expect(screen.getByTestId('music-review-done')).not.toHaveTextContent('to review')
  })

  it('keeps the sheet open after a partial undo and says how many changes stayed', () => {
    render(
      <MusicReview
        review={review({ status: 'ready', lastRun: run({ undoFailures: 2 }) })}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('music-review-done')).toHaveTextContent(
      '2 changes could not be undone',
    )
  })

  it('does not show the sheet while a run is still going', () => {
    render(
      <MusicReview review={review({ status: 'applying', lastRun: run() })} onClose={vi.fn()} />,
    )
    expect(screen.queryByTestId('music-review-done')).toBeNull()
  })
})
