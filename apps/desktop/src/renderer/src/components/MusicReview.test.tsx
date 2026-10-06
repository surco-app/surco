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

const written = {
  persistentId: 'C',
  path: '/m/c.mp3',
  fixes: [{ persistentId: 'C', field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara' }],
  music: ['set' as const],
  file: 'written' as const,
  written: ['artist' as const],
  backupId: 'b1',
}

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

  // A conversion writes the same files and library databases; applying or undoing on top
  // of it would race those writes.
  it('holds Apply and Undo while a conversion is running', () => {
    const staged = review({
      staged: new Set([group.key]),
      summary: { tracks: 1, byField: { artist: 1 }, duplicates: 0 },
    })
    const { unmount } = render(<MusicReview review={staged} onClose={vi.fn()} busy />)
    expect(screen.getByTestId('music-review-tray-apply')).toBeDisabled()
    unmount()
    render(<MusicReview review={done(run({ outcomes: [written] }))} onClose={vi.fn()} busy />)
    expect(screen.getByTestId('music-review-undo')).toBeDisabled()
  })

  it('disables the tray while nothing is staged', () => {
    render(<MusicReview review={review()} onClose={vi.fn()} />)
    expect(screen.getByTestId('music-review-tray-apply')).toBeDisabled()
  })

  it('offers undo after a run', () => {
    const r = done(run({ outcomes: [written] }))
    render(<MusicReview review={r} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('music-review-undo'))
    expect(r.undo).toHaveBeenCalled()
  })

  // A run that only removed copies has nothing Undo can bring back; the button would
  // report success and change nothing.
  it('hides undo and says removed copies stay removed when nothing can be undone', () => {
    render(
      <MusicReview
        review={done(run({ removed: [{ outcome: 'removed', playlists: 0, fileTrashed: true }] }))}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('music-review-undo')).toBeNull()
    expect(screen.getByTestId('music-review-done')).toHaveTextContent(
      "Removed copies don't come back with Undo. Their files stay in the Trash.",
    )
  })

  it('hides undo for a file written without a backup', () => {
    render(
      <MusicReview
        review={done(run({ outcomes: [{ ...written, backupId: undefined }] }))}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('music-review-undo')).toBeNull()
  })

  it('warns before applying that removed copies do not come back with Undo', () => {
    const r = review({
      staged: new Set([group.key]),
      summary: { tracks: 0, byField: {}, duplicates: 1 },
    })
    render(<MusicReview review={r} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('music-review-tray-apply'))
    expect(screen.getByTestId('music-review-confirm')).toHaveTextContent(
      "Removed copies don't come back with Undo.",
    )
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

  // The sheet stands between the user and a write to their library: it must be
  // dismissible from the keyboard and announced by its title.
  it('names the confirmation by its title, focuses Apply and cancels on Escape', () => {
    const r = review({
      staged: new Set([group.key]),
      summary: { tracks: 1, byField: { artist: 1 }, duplicates: 0 },
    })
    render(<MusicReview review={r} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('music-review-tray-apply'))
    expect(screen.getByRole('dialog', { name: "You're about to change 1 track" })).toBeVisible()
    expect(screen.getByTestId('music-review-confirm-apply')).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('music-review-confirm')).toBeNull()
    expect(r.apply).not.toHaveBeenCalled()
  })

  it('names the done sheet by its title and Escape keeps reviewing', () => {
    render(<MusicReview review={done(run())} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Library reviewed' })).toBeVisible()
    expect(screen.getByTestId('music-review-continue')).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('music-review-done')).toBeNull()
  })

  // Closing mid-run would unmount the view that is still writing.
  it('locks every control that changes state while a run is going', () => {
    const dup = {
      group: { key: 'k#1', kind: 'duplicate' as const, ids: ['1', '2'] },
      entries: [
        { persistentId: '1', artist: 'A', title: 'T', durationSec: 60 },
        { persistentId: '2', artist: 'A', title: 'T', durationSec: 60 },
      ],
      formats: {},
    }
    render(
      <MusicReview
        review={review({
          status: 'applying',
          lastRun: run(),
          duplicates: [dup as unknown as Review['duplicates'][number]],
          progress: { done: 1, total: 2 },
        })}
        onClose={vi.fn()}
      />,
    )
    const locked = [
      ...screen.getAllByTestId('music-review-stage'),
      ...screen.getAllByTestId('music-review-ignore'),
      ...screen.getAllByRole('radio'),
      screen.getByTestId('music-review-filter-all'),
      screen.getByTestId('music-review-filter-spelling'),
      screen.getByTestId('music-review-filter-duplicates'),
      screen.getByTestId('music-review-close'),
    ]
    expect(locked).toHaveLength(2 + 2 + 4 + 3 + 1)
    for (const el of locked) expect(el).toBeDisabled()
    expect(screen.getByTestId('music-review-stop')).toBeEnabled()
  })

  it('groups the radios under a name and announces the loading state', () => {
    const { unmount } = render(<MusicReview review={review()} onClose={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: 'Artist DJ Lara' })).toBeVisible()
    unmount()
    render(<MusicReview review={review({ status: 'loading', spelling: [] })} onClose={vi.fn()} />)
    expect(screen.getByTestId('music-review-loading')).toHaveTextContent('Reading the library')
  })
})
