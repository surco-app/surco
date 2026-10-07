// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { MusicReview as Review, ReviewRun } from '../hooks/useMusicReview'
import { MusicReview } from './MusicReview'
import { useReviewSelection } from './MusicReviewColumn'
import { MusicReviewDetail, type ReviewSync } from './MusicReviewDetail'

afterEach(cleanup)

const part = {
  key: 'artist||case|djlara',
  field: 'artist' as const,
  kind: 'case' as const,
  variants: [
    { value: 'DJ Lara', persistentIds: ['A', 'B'] },
    { value: 'Dj Lara', persistentIds: ['C'] },
  ],
  suggested: 'DJ Lara',
}
const group = { ...part, fields: ['artist' as const], parts: [part] }

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
    affected: () => [],
    ...over,
  }
}

const run = (over: Partial<ReviewRun> = {}): ReviewRun => ({
  outcomes: [],
  removed: [],
  replaced: [],
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

const NO_SYNC: ReviewSync = { rekordbox: false, engineDj: false, traktor: false }

function Panes({
  review: base,
  busy,
  sync = NO_SYNC,
}: {
  review: Review
  busy?: boolean
  sync?: ReviewSync
}) {
  const [staged, setStaged] = useState(base.staged)
  const r: Review = {
    ...base,
    staged,
    toggleStaged: (key) => {
      base.toggleStaged(key)
      setStaged((s) => {
        const next = new Set(s)
        if (!next.delete(key)) next.add(key)
        return next
      })
    },
  }
  const { selectedKey, select } = useReviewSelection(r)
  return (
    <>
      <MusicReview
        review={r}
        selectedKey={selectedKey}
        onSelect={select}
        onClose={vi.fn()}
        busy={busy}
      />
      <MusicReviewDetail review={r} selectedKey={selectedKey} sync={sync} />
    </>
  )
}

const other = {
  ...group,
  key: 'genre||case|house',
  fields: ['genre' as const],
  variants: [
    { value: 'House', persistentIds: ['D', 'E'] },
    { value: 'house', persistentIds: ['F'] },
  ],
  suggested: 'House',
}
const rows = () => screen.getAllByTestId('music-review-row')
const detail = () => screen.getByTestId('music-review-detail')

describe('MusicReview', () => {
  // The column is for finding a group; deciding happens in the detail beside it, so a
  // row holds no control that could change what gets written.
  it('lists each group as a row with no choice in it and opens its detail on click', () => {
    const merged = { ...group, fields: ['artist' as const, 'albumArtist' as const] }
    render(<Panes review={review({ spelling: [merged, other], choice: () => null })} />)
    const list = screen.getByTestId('music-review')
    expect(within(list).queryAllByRole('radio')).toHaveLength(0)
    expect(within(list).queryByTestId('music-review-stage')).toBeNull()
    expect(rows()[0]).toHaveTextContent('Artist and album artist · capitals or accents')
    expect(rows()[0]).toHaveTextContent('3 tracks')
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true')
    expect(detail()).toHaveTextContent('DJ Lara')
    fireEvent.click(rows()[1])
    expect(rows()[1]).toHaveAttribute('aria-selected', 'true')
    expect(detail()).toHaveTextContent('House')
    expect(detail()).not.toHaveTextContent('DJ Lara')
  })

  it('dims a row staged from the detail and says it is in the batch', () => {
    render(<Panes review={review({ spelling: [group, other] })} />)
    expect(rows()[0]).not.toHaveTextContent('in the batch')
    fireEvent.click(screen.getByTestId('music-review-stage'))
    expect(rows()[0]).toHaveTextContent('in the batch')
    expect(rows()[0]).toHaveAttribute('data-staged', 'true')
    expect(rows()[1]).not.toHaveAttribute('data-staged')
  })

  // Ignoring is how the user walks the list; jumping back to the top loses their place.
  it('selects the next group after the selected one is ignored, or the previous at the end', () => {
    const third = {
      ...other,
      key: 'genre||case|techno',
      variants: [
        { value: 'Techno', persistentIds: ['G'] },
        { value: 'techno', persistentIds: ['H'] },
      ],
    }
    function Ignoring() {
      const [spelling, setSpelling] = useState([group, other, third])
      return (
        <Panes
          review={review({
            spelling,
            ignore: (k) => setSpelling((s) => s.filter((g) => g.key !== k)),
          })}
        />
      )
    }
    render(<Ignoring />)
    fireEvent.click(rows()[1])
    fireEvent.click(screen.getByTestId('music-review-ignore'))
    expect(rows()[1]).toHaveAttribute('aria-selected', 'true')
    expect(detail()).toHaveTextContent('Techno')
    fireEvent.click(screen.getByTestId('music-review-ignore'))
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps Space on a row from scrolling the list', () => {
    render(<Panes review={review({ spelling: [group, other] })} />)
    expect(fireEvent.keyDown(rows()[1], { key: ' ' })).toBe(false)
    expect(rows()[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('moves the selection with the arrow keys', () => {
    render(<Panes review={review({ spelling: [group, other] })} />)
    fireEvent.keyDown(rows()[0], { key: 'ArrowDown' })
    expect(rows()[1]).toHaveAttribute('aria-selected', 'true')
    expect(rows()[1]).toHaveFocus()
    fireEvent.keyDown(rows()[1], { key: 'ArrowDown' })
    expect(rows()[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(rows()[1], { key: 'ArrowUp' })
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true')
  })

  // A filter that hides the selected group must not leave the detail showing it.
  it('selects the first visible group when the filter hides the selected one', () => {
    const dup = {
      group: { key: 'k#1', kind: 'duplicate' as const, ids: ['1', '2'] },
      entries: [
        { persistentId: '1', artist: 'Ann', title: 'Song', album: '', genre: '', albumArtist: '' },
        { persistentId: '2', artist: 'Ann', title: 'Song', album: '', genre: '', albumArtist: '' },
      ],
      formats: {},
      locations: {},
    }
    render(<Panes review={review({ filter: 'duplicates', duplicates: [dup] })} />)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true')
    expect(detail()).toHaveTextContent('Ann · Song')
  })

  it('shows each spelling with its track count and stages the group on Unify', () => {
    const r = review()
    render(<Panes review={r} />)
    expect(detail()).toHaveTextContent('Dj Lara')
    fireEvent.click(screen.getByTestId('music-review-stage'))
    expect(r.toggleStaged).toHaveBeenCalledWith(group.key)
  })

  // "Undo" already names the button that reverts a whole run; a staged group's button
  // only takes it back out of the tray.
  it('labels a staged group so it does not read as undoing the run', () => {
    render(<Panes review={review({ staged: new Set([group.key]) })} />)
    expect(screen.getByTestId('music-review-stage')).toHaveTextContent('Unstage')
  })

  it('marks a safe kind and a risky one with a different dot', () => {
    const typo = { ...group, key: 'typo', kind: 'typo' as const }
    render(<Panes review={review({ spelling: [group, typo] })} />)
    const list = screen.getByTestId('music-review')
    expect(
      within(list)
        .getAllByRole('img')
        .map((d) => d.getAttribute('aria-label')),
    ).toEqual(['Safe', 'Review'])
  })

  // Nothing touches a file from the list itself: the tray opens a confirmation first.
  it('asks before applying and lists what stays untouched', () => {
    const r = review({
      staged: new Set([group.key]),
      summary: { tracks: 1, byField: { artist: 1 }, duplicates: 0 },
    })
    render(<Panes review={r} />)
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
    const { unmount } = render(<Panes review={staged} busy />)
    expect(screen.getByTestId('music-review-tray-apply')).toBeDisabled()
    unmount()
    render(<Panes review={done(run({ outcomes: [written] }))} busy />)
    expect(screen.getByTestId('music-review-undo')).toBeDisabled()
  })

  it('disables the tray while nothing is staged', () => {
    render(<Panes review={review()} />)
    expect(screen.getByTestId('music-review-tray-apply')).toBeDisabled()
  })

  it('offers undo after a run', () => {
    const r = done(run({ outcomes: [written] }))
    render(<Panes review={r} />)
    fireEvent.click(screen.getByTestId('music-review-undo'))
    expect(r.undo).toHaveBeenCalled()
  })

  // A run that only removed copies has nothing Undo can bring back; the button would
  // report success and change nothing.
  it('hides undo and says removed copies stay removed when nothing can be undone', () => {
    render(
      <Panes
        review={done(run({ removed: [{ outcome: 'removed', playlists: 0, fileTrashed: true }] }))}
      />,
    )
    expect(screen.queryByTestId('music-review-undo')).toBeNull()
    expect(screen.getByTestId('music-review-done')).toHaveTextContent(
      "Removed copies don't come back with Undo. Their files stay in the Trash.",
    )
  })

  it('hides undo for a file written without a backup', () => {
    render(<Panes review={done(run({ outcomes: [{ ...written, backupId: undefined }] }))} />)
    expect(screen.queryByTestId('music-review-undo')).toBeNull()
  })

  it('warns before applying that removed copies do not come back with Undo', () => {
    const r = review({
      staged: new Set([group.key]),
      summary: { tracks: 0, byField: {}, duplicates: 1 },
    })
    render(<Panes review={r} />)
    fireEvent.click(screen.getByTestId('music-review-tray-apply'))
    expect(screen.getByTestId('music-review-confirm')).toHaveTextContent(
      "Removed copies don't come back with Undo.",
    )
  })

  it('says the library is empty', () => {
    render(<Panes review={review({ status: 'empty', spelling: [] })} />)
    expect(screen.getByTestId('music-review-empty')).toBeInTheDocument()
  })

  // A removal that never reached the library must not read as a removed copy.
  it('counts a duplicate as removed only when it was, and the rest as failures', () => {
    render(
      <Panes
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
      />,
    )
    const sheet = screen.getByTestId('music-review-done')
    expect(sheet).toHaveTextContent('1 track updated')
    expect(sheet).toHaveTextContent('3 could not be changed')
  })

  // The copy left Music but its file did not go to the Trash; the user should know why.
  it('says how many files stayed on disk for the DJ libraries', () => {
    render(
      <Panes
        review={done(
          run({
            replaced: [
              { from: '/a', engine: 'replaced', fileTrashed: false, keptForLibrary: true },
              { from: '/b', rekordbox: 'skipped', fileTrashed: false, keptForLibrary: true },
              { from: '/c', fileTrashed: true, keptForLibrary: false },
            ],
          }),
        )}
      />,
    )
    expect(screen.getByTestId('music-review-done')).toHaveTextContent(
      '2 files stay on disk because rekordbox, Engine DJ or Traktor use them.',
    )
  })

  // Each library is named apart: the DJ checks the one they play from.
  it('says how many removed copies each DJ library moved to the kept copy', () => {
    render(
      <Panes
        review={done(
          run({
            replaced: [
              {
                from: '/a',
                rekordbox: 'replaced',
                traktor: 'repointed',
                fileTrashed: true,
                keptForLibrary: false,
              },
              {
                from: '/b',
                rekordbox: 'repointed',
                traktor: 'none',
                engine: 'skipped',
                fileTrashed: false,
                keptForLibrary: true,
              },
            ],
          }),
        )}
      />,
    )
    const lines = screen.getAllByTestId('music-review-done-replaced').map((p) => p.textContent)
    expect(lines).toEqual([
      '2 copies replaced by the kept ones in rekordbox',
      '1 copy replaced by the kept one in Traktor',
    ])
  })

  it('warns when the other libraries did not follow and when Music refused the batch', () => {
    render(<Panes review={done(run({ librarySync: 'failed', applyError: 'boom' }))} />)
    const sheet = screen.getByTestId('music-review-done')
    expect(sheet).toHaveTextContent("rekordbox, Engine DJ or Traktor weren't updated")
    expect(sheet).toHaveTextContent("Couldn't apply in Apple Music.")
  })

  it('hides the groups-left line when the recount failed', () => {
    render(<Panes review={done(run({ after: null }))} />)
    expect(screen.getByTestId('music-review-done')).not.toHaveTextContent('to review')
  })

  it('keeps the sheet open after a partial undo and says how many changes stayed', () => {
    render(<Panes review={review({ status: 'ready', lastRun: run({ undoFailures: 2 }) })} />)
    expect(screen.getByTestId('music-review-done')).toHaveTextContent(
      '2 changes could not be undone',
    )
  })

  it('does not show the sheet while a run is still going', () => {
    render(<Panes review={review({ status: 'applying', lastRun: run() })} />)
    expect(screen.queryByTestId('music-review-done')).toBeNull()
  })

  // The sheet stands between the user and a write to their library: it must be
  // dismissible from the keyboard and announced by its title.
  it('names the confirmation by its title, focuses Apply and cancels on Escape', () => {
    const r = review({
      staged: new Set([group.key]),
      summary: { tracks: 1, byField: { artist: 1 }, duplicates: 0 },
    })
    render(<Panes review={r} />)
    fireEvent.click(screen.getByTestId('music-review-tray-apply'))
    expect(screen.getByRole('dialog', { name: "You're about to change 1 track" })).toBeVisible()
    expect(screen.getByTestId('music-review-confirm-apply')).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('music-review-confirm')).toBeNull()
    expect(r.apply).not.toHaveBeenCalled()
  })

  it('names the done sheet by its title and Escape keeps reviewing', () => {
    render(<Panes review={done(run())} />)
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
      locations: {},
    }
    render(
      <Panes
        review={review({
          status: 'applying',
          lastRun: run(),
          duplicates: [dup as unknown as Review['duplicates'][number]],
          progress: { done: 1, total: 2 },
        })}
      />,
    )
    const controls = () => [
      screen.getByTestId('music-review-stage'),
      screen.getByTestId('music-review-ignore'),
      ...screen.getAllByRole('radio'),
    ]
    const spelling = controls()
    fireEvent.click(rows()[1])
    const locked = [
      ...spelling,
      ...controls(),
      screen.getByTestId('music-review-filter-all'),
      screen.getByTestId('music-review-filter-spelling'),
      screen.getByTestId('music-review-filter-duplicates'),
      screen.getByTestId('music-review-close'),
    ]
    expect(locked).toHaveLength(4 + 4 + 3 + 1)
    for (const el of locked) expect(el).toBeDisabled()
    expect(screen.getByTestId('music-review-stop')).toBeEnabled()
  })

  it('groups the radios under a name and announces the loading state', () => {
    const { unmount } = render(<Panes review={review()} />)
    expect(screen.getByRole('radiogroup', { name: 'Artist DJ Lara' })).toBeVisible()
    unmount()
    render(<Panes review={review({ status: 'loading', spelling: [] })} />)
    expect(screen.getByTestId('music-review-loading')).toHaveTextContent('Reading the library')
  })

  describe('spelling detail', () => {
    const dirty = {
      ...group,
      key: 'artist||invisible|djlara',
      kind: 'invisible' as const,
      variants: [{ value: ' DJ  Lara\u200B', persistentIds: ['A'] }],
      suggested: 'DJ Lara',
    }

    // An invisible character or a stray space reads as nothing on screen; without a mark
    // the user is asked to choose between two values that look identical.
    it('marks invisible characters and extra spaces and offers the clean value', () => {
      render(
        <Panes
          review={review({ spelling: [{ ...dirty, parts: [dirty] }], choice: () => 'DJ Lara' })}
        />,
      )
      const options = screen.getAllByTestId('music-review-option')
      expect(options.map((o) => o.textContent)).toEqual([
        expect.stringContaining('␣DJ␣␣Lara·'),
        expect.stringContaining('DJ Lara'),
      ])
      expect(within(options[1]).getByRole('radio')).toBeChecked()
      expect(detail()).toHaveTextContent('· is an invisible character and ␣ a space too many')
    })

    it('explains no marks when the group shows none', () => {
      render(<Panes review={review()} />)
      expect(detail()).not.toHaveTextContent('invisible character')
      expect(detail()).not.toHaveTextContent('␣')
    })

    it('checks nothing on a tie and says so', () => {
      render(<Panes review={review({ choice: () => null })} />)
      for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked()
      expect(detail()).toHaveTextContent('Tied. Pick the one to keep.')
    })

    // The user should see every write before staging it, and which libraries follow it,
    // since only the ones with sync on are touched.
    it('lists each track and field it would change and where the change goes', () => {
      const affected = vi.fn(() => [
        {
          persistentId: 'A',
          title: 'Song A',
          field: 'artist' as const,
          from: 'Dj Lara',
          to: 'DJ Lara',
        },
        {
          persistentId: 'A',
          title: 'Song A',
          field: 'albumArtist' as const,
          from: 'Dj Lara',
          to: 'DJ Lara',
        },
        {
          persistentId: 'C',
          title: 'Song C',
          field: 'artist' as const,
          from: 'Dj Lara ',
          to: 'DJ Lara',
        },
      ])
      render(
        <Panes
          review={review({ affected })}
          sync={{ rekordbox: true, engineDj: false, traktor: true }}
        />,
      )
      expect(affected).toHaveBeenCalledWith(group.key)
      const rowsOf = screen.getAllByTestId('music-review-affected')
      expect(rowsOf).toHaveLength(3)
      expect(rowsOf[1]).toHaveTextContent('Song A')
      expect(rowsOf[1]).toHaveTextContent('Album artist')
      expect(rowsOf[2]).toHaveTextContent('Dj Lara␣')
      expect(detail()).toHaveTextContent('Libraries only change if they still hold the old value.')
      for (const row of rowsOf) {
        expect(row).toHaveTextContent('Music')
        expect(row).toHaveTextContent('File')
        expect(row).toHaveTextContent('rekordbox')
        expect(row).toHaveTextContent('Traktor')
        expect(row).not.toHaveTextContent('Engine DJ')
      }
    })
  })

  describe('duplicate detail', () => {
    const copy = (persistentId: string, extra = {}) => ({
      persistentId,
      artist: 'Ann',
      title: 'Song',
      albumArtist: '',
      album: 'First',
      genre: 'House',
      durationSec: 200,
      ...extra,
    })
    const card = (locations: Record<string, string>) => ({
      group: { key: 'k#1', kind: 'duplicate' as const, ids: ['1', '2'] },
      entries: [copy('1'), copy('2', { album: 'Second' })],
      formats: Object.fromEntries(
        Object.entries(locations).map(([id, path]) => [id, path ? 'AIFF' : '']),
      ),
      locations,
    })
    const dupReview = (locations: Record<string, string>, keep = '2') =>
      review({ spelling: [], duplicates: [card(locations)], choice: () => keep })

    // Keeping the copy without a file would leave the track with no audio in Music.
    it('does not let a copy without a file stay while another has one', () => {
      render(<Panes review={dupReview({ '1': '', '2': '/Music/Ann/Song.aiff' })} />)
      const [noFile, withFile] = screen.getAllByTestId('music-review-copy')
      expect(noFile).toHaveTextContent('No file')
      expect(within(noFile).getByRole('radio')).toBeDisabled()
      expect(within(withFile).getByRole('radio')).toBeEnabled()
      expect(within(withFile).getByRole('radio')).toBeChecked()
      expect(withFile).toHaveTextContent('Ann/Song.aiff')
      expect(withFile).not.toHaveTextContent('/Music/')
    })

    it('says a copy whose file could not be checked is unknown and holds the removal', () => {
      render(<Panes review={dupReview({ '2': '/Music/Ann/Song.aiff' })} />)
      const [unknown] = screen.getAllByTestId('music-review-copy')
      expect(unknown).not.toHaveTextContent('No file')
      expect(unknown).toHaveTextContent('File not checked')
      expect(within(unknown).getByRole('radio')).toBeEnabled()
      expect(screen.getByTestId('music-review-stage')).toBeDisabled()
    })

    it('names each copy radio by its format and file', () => {
      render(<Panes review={dupReview({ '1': '/a/x/1.aiff', '2': '' })} />)
      expect(screen.getByRole('radio', { name: 'Kept AIFF x/1.aiff' })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Kept No file' })).toBeInTheDocument()
    })

    it('lets any copy stay when none has a file', () => {
      render(<Panes review={dupReview({ '1': '', '2': '' }, '1')} />)
      for (const c of screen.getAllByTestId('music-review-copy'))
        expect(within(c).getByRole('radio')).toBeEnabled()
    })

    // What tells two copies apart is what the user weighs before removing one.
    it('marks the values that differ between copies', () => {
      render(<Panes review={dupReview({ '1': '/a/1.aiff', '2': '/a/2.aiff' })} />)
      const [first, second] = screen.getAllByTestId('music-review-copy')
      expect(within(first).getByText('First')).toHaveAttribute('data-differs', 'true')
      expect(within(second).getByText('Second')).toHaveAttribute('data-differs', 'true')
      expect(within(first).getByText('House')).not.toHaveAttribute('data-differs')
      expect(within(first).getByText('3:20')).not.toHaveAttribute('data-differs')
    })

    it('keeps a copy on its radio and stages the removal', () => {
      const r = dupReview({ '1': '/a/1.aiff', '2': '/a/2.aiff' })
      render(<Panes review={r} />)
      fireEvent.click(within(screen.getAllByTestId('music-review-copy')[0]).getByRole('radio'))
      expect(r.choose).toHaveBeenCalledWith('k#1', '1')
      fireEvent.click(screen.getByTestId('music-review-stage'))
      expect(r.toggleStaged).toHaveBeenCalledWith('k#1')
      expect(screen.getByTestId('music-review-stage')).toHaveTextContent('Unstage')
    })
  })
})
