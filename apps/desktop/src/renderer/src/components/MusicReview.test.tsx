// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { Api } from '../../../preload/api'
import type { MusicReview as Review, ReviewRun } from '../hooks/useMusicReview'
import { stubApi } from '../test/api'
import { MusicReview, MusicReviewAction, MusicReviewProgress, type ReviewSort } from './MusicReview'
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
    phase: null,
    apply: vi.fn(),
    cancel: vi.fn(),
    undo: vi.fn(),
    lastRun: null,
    libraries: null,
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

const status = (over: Partial<Record<'rekordbox' | 'engine' | 'traktor', boolean>> = {}) => {
  const lib = (found: boolean | undefined) => ({ enabled: true, found: found ?? true })
  return {
    rekordbox: lib(over.rekordbox),
    engine: lib(over.engine),
    traktor: lib(over.traktor),
  }
}

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
  const [search, setSearch] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [sort, setSort] = useState<ReviewSort>('default')
  const { selectedKey, select } = useReviewSelection(r, search, sort)
  return (
    <>
      <MusicReview
        review={r}
        selectedKey={selectedKey}
        onSelect={select}
        onClose={vi.fn()}
        busy={busy}
        search={search}
        onSearch={setSearch}
        sort={sort}
        onSort={setSort}
        confirming={confirming}
        onConfirming={setConfirming}
      />
      <MusicReviewAction review={r} busy={busy ?? false} onConfirm={() => setConfirming(true)} />
      <MusicReviewProgress review={r} />
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
const ignoreFromMenu = () => {
  fireEvent.click(screen.getByTestId('music-review-more'))
  fireEvent.click(screen.getByTestId('music-review-ignore'))
}

describe('MusicReview', () => {
  // The column is for finding a group; deciding happens in the detail beside it, so a
  // row holds no control that could change what gets written.
  // Apply lives in the toolbar's main button, so the column holds no tray of its own.
  it('keeps the header outside the only scrolling area and has no tray', () => {
    render(<Panes review={review()} />)
    const scroll = screen.getByTestId('music-review-scroll')
    expect(scroll.className).toContain('overflow-y-auto')
    expect(scroll).toContainElement(rows()[0])
    expect(screen.queryByTestId('music-review-tray')).toBeNull()
    expect(scroll).not.toContainElement(screen.getByTestId('music-review-search'))
    expect(scroll).not.toContainElement(screen.getByTestId('music-review-filter-trigger'))
  })

  // The same row as the track list: a cover tile, the name with the count beside it, and
  // the secondary line with the kind as a pill where the format sits.
  it('lays a row out like a track row, with the count on the first line and the kind below', () => {
    render(<Panes review={review()} />)
    const row = rows()[0]
    expect(within(row).getByTestId('music-review-row-cover')).toBeVisible()
    expect(within(row).queryByTestId('track-cover-placeholder')).toBeNull()
    expect(within(row).queryByTestId('track-quality')).toBeNull()
    const first = within(row).getByTestId('music-review-row-title-line')
    expect(first).toContainElement(within(row).getByTestId('music-review-row-name'))
    expect(first).toContainElement(within(row).getByTestId('music-review-row-count'))
    const second = within(row).getByTestId('music-review-row-detail-line')
    expect(second).toContainElement(within(row).getByTestId('music-review-row-detail'))
    expect(second).toContainElement(within(row).getByTestId('music-review-row-kind'))
    expect(row.className).toContain('is-primary')
  })

  it('lists each group as a row with no choice in it and opens its detail on click', () => {
    const merged = { ...group, fields: ['artist' as const, 'albumArtist' as const] }
    render(<Panes review={review({ spelling: [merged, other], choice: () => null })} />)
    const list = screen.getByTestId('music-review')
    expect(within(list).queryAllByRole('radio')).toHaveLength(0)
    expect(within(list).queryByTestId('music-review-stage')).toBeNull()
    expect(within(rows()[0]).getByTestId('music-review-row-detail')).toHaveTextContent(
      'Artist and album artist',
    )
    expect(within(rows()[0]).getByTestId('music-review-row-kind')).toHaveTextContent('Capitals')
    expect(rows()[0]).toHaveTextContent('3 tracks')
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true')
    expect(detail()).toHaveTextContent('DJ Lara')
    fireEvent.click(rows()[1])
    expect(rows()[1]).toHaveAttribute('aria-selected', 'true')
    expect(detail()).toHaveTextContent('House')
    expect(detail()).not.toHaveTextContent('DJ Lara')
  })

  // A staged group is a change not applied yet, which the track list marks with the amber
  // ring on the cover.
  it('marks a row staged from the detail with the pending ring and says it is in the batch', () => {
    render(<Panes review={review({ spelling: [group, other] })} />)
    expect(rows()[0]).not.toHaveTextContent('in the batch')
    expect(within(rows()[0]).queryByTestId('music-review-row-staged')).toBeNull()
    fireEvent.click(screen.getByTestId('music-review-stage'))
    expect(rows()[0]).toHaveTextContent('in the batch')
    expect(rows()[0]).toHaveAttribute('data-staged', 'true')
    expect(within(rows()[0]).getByTestId('music-review-row-staged')).toHaveAttribute(
      'data-tone',
      'attention',
    )
    expect(rows()[1]).not.toHaveAttribute('data-staged')
  })

  it('narrows the groups to the ones whose spellings match the search', () => {
    render(<Panes review={review({ spelling: [group, other], choice: () => null })} />)
    fireEvent.change(screen.getByTestId('music-review-search'), { target: { value: 'hous' } })
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true')
    expect(detail()).toHaveTextContent('House')
    fireEvent.change(screen.getByTestId('music-review-search'), { target: { value: 'lara' } })
    expect(rows().map((r) => within(r).getByTestId('music-review-row-name').textContent)).toEqual([
      'DJ Lara',
    ])
    fireEvent.change(screen.getByTestId('music-review-search'), { target: { value: 'nobody' } })
    expect(screen.queryAllByTestId('music-review-row')).toHaveLength(0)
    expect(screen.getByTestId('music-review-no-match')).toBeVisible()
  })

  it('finds a duplicate by its title', () => {
    const dup = {
      group: { key: 'k#1', kind: 'duplicate' as const, ids: ['1', '2'] },
      entries: [
        { persistentId: '1', artist: 'Ann', title: 'Song', album: '', genre: '', albumArtist: '' },
        { persistentId: '2', artist: 'Ann', title: 'Song', album: '', genre: '', albumArtist: '' },
      ],
      formats: {},
      locations: {},
    }
    render(<Panes review={review({ duplicates: [dup] })} />)
    fireEvent.change(screen.getByTestId('music-review-search'), { target: { value: 'song' } })
    expect(rows()).toHaveLength(1)
    expect(within(rows()[0]).getByTestId('music-review-row-kind')).toHaveTextContent('Duplicate')
  })

  it('picks the view from the filter menu, each with its count', () => {
    const r = review({ spelling: [group, other] })
    render(<Panes review={r} />)
    const trigger = screen.getByTestId('music-review-filter-trigger')
    expect(trigger).toHaveTextContent('All2')
    fireEvent.click(trigger)
    expect(screen.getByTestId('music-review-filter-spelling')).toHaveTextContent('Spellings2')
    expect(screen.getByTestId('music-review-filter-duplicates')).toHaveTextContent('Duplicates0')
    fireEvent.click(screen.getByTestId('music-review-filter-duplicates'))
    expect(r.setFilter).toHaveBeenCalledWith('duplicates')
    expect(screen.queryByTestId('music-review-filter-listbox')).toBeNull()
  })

  it('counts the selected group among the visible ones', () => {
    render(<Panes review={review({ spelling: [group, other] })} />)
    expect(screen.getByTestId('music-review-position')).toHaveTextContent('1/2')
    fireEvent.click(rows()[1])
    expect(screen.getByTestId('music-review-position')).toHaveTextContent('2/2')
  })

  it('sorts the groups by name or by tracks', () => {
    const big = {
      ...other,
      key: 'genre||case|ambient',
      variants: [
        { value: 'Ambient', persistentIds: ['G', 'H', 'I', 'J'] },
        { value: 'ambient', persistentIds: ['K'] },
      ],
    }
    const names = () =>
      rows().map((r) => within(r).getByTestId('music-review-row-name').textContent)
    render(<Panes review={review({ spelling: [group, other, big], choice: () => null })} />)
    expect(names()).toEqual(['DJ Lara', 'House', 'Ambient'])
    fireEvent.click(screen.getByTestId('music-review-sort'))
    fireEvent.click(screen.getByTestId('music-review-sort-option-name'))
    expect(names()).toEqual(['Ambient', 'DJ Lara', 'House'])
    fireEvent.click(screen.getByTestId('music-review-sort'))
    fireEvent.click(screen.getByTestId('music-review-sort-option-tracks'))
    expect(names()).toEqual(['Ambient', 'DJ Lara', 'House'])
  })

  it('closes from an icon button named Close', () => {
    render(<Panes review={review()} />)
    expect(screen.getByTestId('music-review-close')).toHaveAccessibleName('Close')
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
    ignoreFromMenu()
    expect(rows()[1]).toHaveAttribute('aria-selected', 'true')
    expect(detail()).toHaveTextContent('Techno')
    ignoreFromMenu()
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

  it('tints a safe kind like a good pill and a risky one like a warning', () => {
    const typo = { ...group, key: 'typo', kind: 'typo' as const }
    render(<Panes review={review({ spelling: [group, typo] })} />)
    expect(
      rows().map((r) => within(r).getByTestId('music-review-row-pill').getAttribute('data-tone')),
    ).toEqual(['good', 'warn'])
    expect(within(rows()[1]).getByTestId('music-review-row-kind')).toHaveTextContent('Typo')
  })

  // Nothing touches a file from the list itself: the tray opens a confirmation first.
  it('asks before applying and lists what stays untouched', () => {
    const r = review({
      staged: new Set([group.key]),
      summary: { tracks: 1, byField: { artist: 1 }, duplicates: 0 },
    })
    render(<Panes review={r} />)
    fireEvent.click(screen.getByTestId('music-review-apply'))
    expect(r.apply).not.toHaveBeenCalled()
    expect(screen.getByTestId('music-review-confirm')).toHaveTextContent('rekordbox, Engine DJ')
    fireEvent.click(screen.getByTestId('music-review-confirm-apply'))
    expect(r.apply).toHaveBeenCalled()
  })

  // A locked, always-ticked checkbox reads as a broken control; the backup is a promise,
  // not a choice, so it is said as text.
  it('says a backup is kept without offering a checkbox for it', () => {
    render(
      <Panes
        review={review({
          staged: new Set([group.key]),
          summary: { tracks: 1, byField: { artist: 1 }, duplicates: 0 },
        })}
      />,
    )
    fireEvent.click(screen.getByTestId('music-review-apply'))
    const sheet = screen.getByTestId('music-review-confirm')
    expect(within(sheet).queryByRole('checkbox')).toBeNull()
    expect(sheet).toHaveTextContent('A copy of every file is kept in Backups.')
  })

  // A conversion writes the same files and library databases; applying or undoing on top
  // of it would race those writes.
  it('holds Apply and Undo while a conversion is running', () => {
    const staged = review({
      staged: new Set([group.key]),
      summary: { tracks: 1, byField: { artist: 1 }, duplicates: 0 },
    })
    const { unmount } = render(<Panes review={staged} busy />)
    expect(screen.getByTestId('music-review-apply')).toBeDisabled()
    unmount()
    render(<Panes review={done(run({ outcomes: [written] }))} busy />)
    expect(screen.getByTestId('music-review-undo')).toBeDisabled()
  })

  it('disables Apply while nothing is staged and counts the changes once some are', () => {
    const { unmount } = render(<Panes review={review()} />)
    expect(screen.getByTestId('music-review-apply')).toBeDisabled()
    expect(screen.getByTestId('music-review-apply')).toHaveTextContent('Apply 0 changes')
    unmount()
    render(
      <Panes
        review={review({
          staged: new Set([group.key]),
          summary: { tracks: 2, byField: { artist: 2 }, duplicates: 1 },
        })}
      />,
    )
    expect(screen.getByTestId('music-review-apply')).toBeEnabled()
    expect(screen.getByTestId('music-review-apply')).toHaveTextContent('Apply 3 changes')
  })

  describe('while a run goes', () => {
    const applying = (over: Partial<Review>) => review({ status: 'applying', ...over })
    const bar = () => screen.getByTestId('top-progress').firstElementChild as HTMLElement

    it('slides the bar until the first track is done, then fills it', () => {
      const { rerender } = render(
        <MusicReviewProgress
          review={applying({
            progress: { done: 0, total: 4 },
            phase: { name: 'writing', current: 1, total: 4 },
          })}
        />,
      )
      expect(bar().className).toContain('animate-top-progress')
      rerender(
        <MusicReviewProgress
          review={applying({
            progress: { done: 1, total: 4 },
            phase: { name: 'writing', current: 2, total: 4 },
          })}
        />,
      )
      expect(bar().className).not.toContain('animate-top-progress')
      expect(bar().style.width).toBe('25%')
    })

    // The libraries and the reread have no count to fill with; a full bar there would say
    // the run had ended.
    it('slides the bar while the libraries update and the library is reread', () => {
      render(
        <MusicReviewProgress
          review={applying({ progress: { done: 2, total: 2 }, phase: { name: 'libraries' } })}
        />,
      )
      expect(bar().className).toContain('animate-top-progress')
    })

    // Two bars on one line read as one bar jumping between two runs.
    it('draws only its own bar over a sweep while applying, and the sweep otherwise', () => {
      const sweep = <span data-testid="sweep-bar" />
      const { rerender } = render(
        <MusicReviewProgress
          review={applying({ progress: { done: 0, total: 2 }, phase: null })}
          fallback={sweep}
        />,
      )
      expect(screen.getByTestId('top-progress')).toBeInTheDocument()
      expect(screen.queryByTestId('sweep-bar')).toBeNull()
      rerender(<MusicReviewProgress review={review()} fallback={sweep} />)
      expect(screen.getByTestId('sweep-bar')).toBeInTheDocument()
      expect(screen.queryByTestId('top-progress')).toBeNull()
    })

    it('shows no bar when nothing runs', () => {
      render(<MusicReviewProgress review={review()} />)
      expect(screen.queryByTestId('top-progress')).toBeNull()
    })

    it('names the step the run is on in the main button', () => {
      const label = (phase: Review['phase']) => {
        const { unmount } = render(
          <MusicReviewAction
            review={applying({ progress: { done: 0, total: 3 }, phase })}
            busy={false}
            onConfirm={vi.fn()}
          />,
        )
        const text = screen.getByTestId('music-review-apply').textContent
        unmount()
        return text
      }
      expect(label({ name: 'writing', current: 1, total: 3 })).toBe(
        'Writing to Music and files 1 of 3',
      )
      expect(label({ name: 'duplicates', current: 2, total: 2 })).toBe('Removing duplicates 2 of 2')
      expect(label({ name: 'libraries' })).toBe('Updating rekordbox, Engine DJ and Traktor')
      expect(label({ name: 'verifying' })).toBe('Checking the library')
      expect(label({ name: 'restoring', current: 1, total: 5 })).toBe('Restoring 1 of 5')
    })

    it('stops the run from the same button', () => {
      const r = applying({ progress: { done: 0, total: 3 }, phase: null })
      render(<MusicReviewAction review={r} busy={false} onConfirm={vi.fn()} />)
      expect(screen.getByTestId('music-review-apply')).toHaveAccessibleName('Stop')
      fireEvent.click(screen.getByTestId('music-review-apply'))
      expect(r.cancel).toHaveBeenCalled()
    })
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
      "Removed copies don't come back with Undo.",
    )
    expect(screen.getByTestId('music-review-done')).not.toHaveTextContent('Trash')
  })

  describe('removed copies in the DJ libraries', () => {
    const lines = () => screen.getAllByTestId('music-review-done-library').map((p) => p.textContent)

    // The Trash line counts what really went there.
    it('says how many files went to the Trash only when some did', () => {
      const { unmount } = render(
        <Panes
          review={done(
            run({
              replaced: [
                { from: '/a', fileTrashed: true, keptForLibrary: false },
                { from: '/b', fileTrashed: true, keptForLibrary: false },
                { from: '/c', fileTrashed: false, keptForLibrary: false },
              ],
            }),
          )}
        />,
      )
      expect(screen.getByTestId('music-review-done')).toHaveTextContent('2 files went to the Trash')
      unmount()
      render(<Panes review={done(run({ replaced: [] }))} />)
      expect(screen.getByTestId('music-review-done')).not.toHaveTextContent('Trash')
    })

    it('says which collections still hold a removed copy out of the playlists', () => {
      render(
        <Panes
          review={done(
            run({
              replaced: [
                {
                  from: '/a',
                  rekordbox: 'replaced',
                  engine: 'replaced',
                  fileTrashed: false,
                  keptForLibrary: true,
                },
                { from: '/b', rekordbox: 'replaced', fileTrashed: false, keptForLibrary: true },
              ],
            }),
          )}
        />,
      )
      expect(lines()).toEqual([
        "2 copies are still in rekordbox's collection, out of the playlists",
        "1 copy is still in Engine DJ's collection, out of the playlists",
      ])
    })

    // The Music entries are gone already; the user has to know which library lags behind.
    it('names each library that was skipped or failed and says Music is already done', () => {
      render(
        <Panes
          review={done(
            run({
              replaced: [
                {
                  from: '/a',
                  rekordbox: 'skipped',
                  traktor: 'failed',
                  fileTrashed: false,
                  keptForLibrary: true,
                },
              ],
            }),
          )}
        />,
      )
      expect(lines()).toEqual([
        "rekordbox wasn't updated because it was open or couldn't be read. The copies are already out of Music.",
        "Traktor couldn't be updated. The copies are already out of Music.",
      ])
    })

    it('says the libraries were not touched when the run was stopped', () => {
      render(<Panes review={done(run({ librariesUntouched: true }))} />)
      expect(screen.getByTestId('music-review-done')).toHaveTextContent(
        "You stopped the run, so rekordbox, Engine DJ and Traktor weren't touched.",
      )
    })
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
    fireEvent.click(screen.getByTestId('music-review-apply'))
    expect(screen.getByTestId('music-review-confirm')).toHaveTextContent(
      "Removed copies don't come back with Undo.",
    )
  })

  // A file a DJ library still has stays on disk, so the sheet cannot promise the Trash.
  it('says before applying that a file a DJ library still uses stays on disk', () => {
    const r = review({
      staged: new Set([group.key]),
      summary: { tracks: 0, byField: {}, duplicates: 1 },
    })
    render(<Panes review={r} />)
    fireEvent.click(screen.getByTestId('music-review-apply'))
    expect(screen.getByTestId('music-review-confirm')).toHaveTextContent(
      'Their files go to the Trash, except those rekordbox, Engine DJ or Traktor still use.',
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

  // Reported 08/10: rekordbox pointed at a deleted copy, the review applied to Music and
  // files, and the screens still promised rekordbox.
  describe('a library that is on but whose collection is missing', () => {
    const staged = () =>
      review({
        staged: new Set([group.key]),
        summary: { tracks: 1, byField: { artist: 1 }, duplicates: 0 },
        libraries: status({ rekordbox: false }),
        affected: () => [
          { persistentId: 'C', title: 'Song C', field: 'artist' as const, from: 'a', to: 'b' },
        ],
      })

    it('shows its chip struck and explained instead of promising the sync', () => {
      render(<Panes review={staged()} sync={{ rekordbox: true, engineDj: true, traktor: false }} />)
      const chip = screen.getByTestId('music-review-where-missing')
      expect(chip).toHaveTextContent('rekordbox')
      expect(chip).toHaveAttribute('title', 'Collection not found')
      expect(screen.getByTestId('music-review-affected')).toHaveTextContent('Engine DJ')
    })

    it('names each missing library on the confirmation sheet', () => {
      render(<Panes review={staged()} />)
      fireEvent.click(screen.getByTestId('music-review-apply'))
      expect(screen.getByTestId('music-review-confirm-missing')).toHaveTextContent(
        'rekordbox will not be updated because its collection was not found.',
      )
    })

    it('tells Settings is the place to look once the files were written', () => {
      render(
        <Panes
          review={{
            ...done(run({ outcomes: [written] })),
            libraries: status({ rekordbox: false }),
          }}
        />,
      )
      expect(screen.getByTestId('music-review-done-missing')).toHaveTextContent(
        'The configured rekordbox collection was not found. Check it in Settings.',
      )
    })

    it('does not also say the missing library was open or unreadable', () => {
      render(
        <Panes
          review={{
            ...done(
              run({
                replaced: [
                  {
                    from: '/a',
                    rekordbox: 'skipped',
                    traktor: 'failed',
                    fileTrashed: false,
                    keptForLibrary: true,
                  },
                ],
              }),
            ),
            libraries: status({ rekordbox: false }),
          }}
        />,
      )
      expect(screen.getByTestId('music-review-done-missing')).toHaveTextContent('rekordbox')
      expect(screen.getAllByTestId('music-review-done-library').map((p) => p.textContent)).toEqual([
        "Traktor couldn't be updated. The copies are already out of Music.",
      ])
    })

    it('stays quiet when every library is found', () => {
      render(<Panes review={{ ...done(run({ outcomes: [written] })), libraries: status() }} />)
      expect(screen.queryByTestId('music-review-done-missing')).toBeNull()
    })
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
    fireEvent.click(screen.getByTestId('music-review-apply'))
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
      screen.getByTestId('music-review-more'),
      ...screen.getAllByRole('radio'),
    ]
    const spelling = controls()
    fireEvent.click(rows()[1])
    const locked = [...spelling, ...controls(), screen.getByTestId('music-review-close')]
    expect(locked).toHaveLength(4 + 4 + 1)
    for (const el of locked) expect(el).toBeDisabled()
    expect(screen.getByTestId('music-review-apply')).toBeEnabled()
    expect(screen.getByTestId('music-review-apply')).toHaveAccessibleName('Stop')
  })

  it('groups the radios under a name and announces the loading state', () => {
    const { unmount } = render(<Panes review={review()} />)
    expect(screen.getByRole('radiogroup', { name: 'Artist DJ Lara' })).toBeVisible()
    unmount()
    render(<Panes review={review({ status: 'loading', spelling: [] })} />)
    expect(screen.getByTestId('music-review-loading')).toHaveTextContent('Reading the library')
  })

  describe('detail sections', () => {
    const affectedFix = {
      persistentId: 'C',
      field: 'artist' as const,
      from: 'Dj Lara',
      to: 'DJ Lara',
      title: 'Song',
    }

    // The detail reads like the editor: the group's name opens it, then sections that fold
    // from their header.
    it('opens with the group name and folds a section from its header', () => {
      render(<Panes review={review({ affected: () => [affectedFix] })} />)
      expect(screen.getByTestId('music-review-detail-heading')).toHaveTextContent('DJ Lara')
      const header = screen.getByRole('button', { name: 'Affected tracks' })
      expect(header).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByTestId('music-review-affected')).toBeVisible()
      fireEvent.click(header)
      expect(header).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByRole('button', { name: 'How it is and how it ends up' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
    })

    it('keeps a folded section folded on the next group', () => {
      render(<Panes review={review({ spelling: [group, other], affected: () => [affectedFix] })} />)
      fireEvent.click(screen.getByRole('button', { name: 'Affected tracks' }))
      fireEvent.click(rows()[1])
      expect(screen.getByRole('button', { name: 'Affected tracks' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    })

    it('puts the copies of a duplicate in their own section', () => {
      const dup = {
        group: { key: 'k#1', kind: 'duplicate' as const, ids: ['1', '2'] },
        entries: [
          {
            persistentId: '1',
            artist: 'Ann',
            title: 'Song',
            album: '',
            genre: '',
            albumArtist: '',
          },
          {
            persistentId: '2',
            artist: 'Ann',
            title: 'Song',
            album: '',
            genre: '',
            albumArtist: '',
          },
        ],
        formats: {},
        locations: {},
      }
      render(<Panes review={review({ spelling: [], duplicates: [dup] })} />)
      expect(screen.getByTestId('music-review-detail-heading')).toHaveTextContent('Ann · Song')
      expect(screen.getByRole('button', { name: 'Copies' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
    })
  })

  describe('group footer', () => {
    const affected = () => [
      { persistentId: 'C', field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara', title: 'S' },
      {
        persistentId: 'C',
        field: 'albumArtist' as const,
        from: 'Dj Lara',
        to: 'DJ Lara',
        title: 'S',
      },
      { persistentId: 'D', field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara', title: 'S' },
    ]

    // The group's own action sits where the editor puts Convert: the full-width split
    // button at the foot of the pane, with the rarer choices behind its chevron.
    it('stages from the main button at the foot of the detail and counts the tracks it changes', () => {
      const r = review({ affected })
      render(<Panes review={r} />)
      const stage = screen.getByTestId('music-review-stage')
      expect(screen.getByTestId('music-review-footer')).toContainElement(stage)
      expect(screen.getByTestId('music-review-detail-scroll')).not.toContainElement(stage)
      expect(stage).toHaveTextContent('Unify in 2 tracks')
      expect(screen.getByTestId('music-review-stage-fill')).toHaveAttribute('data-on')
      fireEvent.click(stage)
      expect(r.ignore).not.toHaveBeenCalled()
      expect(screen.getByTestId('music-review-stage')).toHaveTextContent('Unstage')
    })

    it('ignores a group from the menu and names it by kind', () => {
      const r = review()
      const { unmount } = render(<Panes review={r} />)
      expect(screen.queryByTestId('music-review-ignore')).toBeNull()
      fireEvent.click(screen.getByTestId('music-review-more'))
      expect(screen.getByRole('menu')).toBeVisible()
      expect(screen.getByTestId('music-review-ignore')).toHaveTextContent('Ignore')
      fireEvent.click(screen.getByTestId('music-review-ignore'))
      expect(r.ignore).toHaveBeenCalledWith(group.key)
      unmount()
      render(<Panes review={review({ spelling: [{ ...group, kind: 'typo' }] })} />)
      fireEvent.click(screen.getByTestId('music-review-more'))
      expect(screen.getByTestId('music-review-ignore')).toHaveTextContent('Not the same')
    })

    it('removes copies from the main button and says a version differs from the menu', () => {
      const version = {
        group: { key: 'v#1', kind: 'version' as const, ids: ['1', '2'] },
        entries: [
          {
            persistentId: '1',
            artist: 'Ann',
            title: 'Song',
            album: '',
            genre: '',
            albumArtist: '',
          },
          {
            persistentId: '2',
            artist: 'Ann',
            title: 'Song',
            album: '',
            genre: '',
            albumArtist: '',
          },
        ],
        formats: {},
        locations: {},
      }
      render(<Panes review={review({ spelling: [], duplicates: [version] })} />)
      expect(screen.getByTestId('music-review-stage')).toHaveTextContent('Remove 1 copy')
      expect(screen.getByTestId('music-review-stage-fill')).not.toHaveAttribute('data-on')
      fireEvent.click(screen.getByTestId('music-review-more'))
      expect(screen.getByTestId('music-review-ignore')).toHaveTextContent('They differ')
    })
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

    it('highlights only the part of a credit that changes, in both columns', () => {
      const affected = () => [
        {
          persistentId: 'A',
          title: 'Song A',
          field: 'artist' as const,
          from: 'Cultura Arcade & Dj Napo feat. Galaxiah',
          to: 'Cultura Arcade & DJ Napo feat. Galaxiah',
        },
      ]
      render(
        <Panes
          review={review({ affected })}
          sync={{ rekordbox: false, engineDj: false, traktor: false }}
        />,
      )
      expect(screen.getByTestId('music-review-diff-from')).toHaveTextContent(/^j$/)
      expect(screen.getByTestId('music-review-diff-to')).toHaveTextContent(/^J$/)
      expect(screen.getByTestId('music-review-affected')).toHaveTextContent(
        'Cultura Arcade & Dj Napo feat. Galaxiah',
      )
    })

    it('keeps a decomposed accent with its letter when highlighting what changes', () => {
      const affected = () => [
        {
          persistentId: 'A',
          title: 'Song A',
          field: 'artist' as const,
          from: 'Cafe\u0301 Del Mar',
          to: 'Cafe\u0300 Del Mar',
        },
      ]
      render(
        <Panes
          review={review({ affected })}
          sync={{ rekordbox: false, engineDj: false, traktor: false }}
        />,
      )
      expect(screen.getByTestId('music-review-diff-from')).toHaveTextContent(/^e\u0301$/)
      expect(screen.getByTestId('music-review-diff-to')).toHaveTextContent(/^e\u0300$/)
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
    const setApi = (over: Partial<Api> = {}) => {
      const api = stubApi(over)
      ;(window as unknown as { api: Api }).api = api
      return api
    }

    beforeEach(() => setApi())

    // The screenshot showed "Kept" on both cards, so nothing said which one goes.
    it('labels the copy that stays and the one that goes', () => {
      render(<Panes review={dupReview({ '1': '/a/1.aiff', '2': '/a/2.aiff' })} />)
      const roles = screen.getAllByTestId('music-review-copy-role').map((r) => r.textContent)
      expect(roles).toEqual(['Removed', 'Kept'])
    })

    // Two Music entries on one file: removing one leaves the audio where it is.
    it('says when both copies are the same file', () => {
      render(
        <Panes review={dupReview({ '1': '/Music/Ann/Song.aiff', '2': '/music/ann/song.aiff' })} />,
      )
      expect(screen.getAllByTestId('music-review-same-file')).toHaveLength(2)
      expect(screen.getAllByTestId('music-review-same-file')[0]).toHaveTextContent('Same file')
    })

    it('says nothing about the file when the copies have different files', () => {
      render(<Panes review={dupReview({ '1': '/a/1.aiff', '2': '/a/2.aiff' })} />)
      expect(screen.queryByTestId('music-review-same-file')).toBeNull()
    })

    it('shows what each DJ library holds for each copy and warns that cues do not move', async () => {
      const libraryCopyInfo = vi.fn<Api['libraryCopyInfo']>().mockResolvedValue({
        '/a/1.aiff': { rekordbox: { cues: 11, playlists: 4 }, traktor: null },
        '/a/2.aiff': {
          rekordbox: { cues: 1, playlists: 1 },
          traktor: { cues: 0, playlists: 2 },
          engine: { playlists: 2 },
        },
      })
      setApi({ libraryCopyInfo })
      render(<Panes review={dupReview({ '1': '/a/1.aiff', '2': '/a/2.aiff' })} />)
      const [first, second] = screen.getAllByTestId('music-review-copy')
      await within(first).findAllByTestId('music-review-copy-library')
      expect(libraryCopyInfo).toHaveBeenCalledWith(['/a/1.aiff', '/a/2.aiff'])
      expect(
        within(first)
          .getAllByTestId('music-review-copy-library')
          .map((l) => l.textContent),
      ).toEqual(['rekordbox · 11 cues · 4 playlists', 'Not in Traktor'])
      expect(
        within(second)
          .getAllByTestId('music-review-copy-library')
          .map((l) => l.textContent),
      ).toEqual([
        'rekordbox · 1 cue · 1 playlist',
        'Engine DJ · 2 playlists',
        'Traktor · 0 cues · 2 playlists',
      ])
      expect(screen.getByTestId('music-review-cues-note')).toHaveTextContent(
        "The removed copy's cues don't move to the one that stays.",
      )
    })

    it('leaves out the cues note when no library has both copies', async () => {
      setApi({
        libraryCopyInfo: vi.fn<Api['libraryCopyInfo']>().mockResolvedValue({
          '/a/1.aiff': { rekordbox: { cues: 3, playlists: 1 } },
          '/a/2.aiff': { rekordbox: null },
        }),
      })
      render(<Panes review={dupReview({ '1': '/a/1.aiff', '2': '/a/2.aiff' })} />)
      await screen.findByText('Not in rekordbox')
      expect(screen.queryByTestId('music-review-cues-note')).toBeNull()
    })

    // Two Music entries on one file are one track in the library: no cues are lost.
    it('leaves out the cues note when both copies are the same file', async () => {
      setApi({
        libraryCopyInfo: vi.fn<Api['libraryCopyInfo']>().mockResolvedValue({
          '/a/same.aiff': { rekordbox: { cues: 3, playlists: 1 } },
        }),
      })
      render(<Panes review={dupReview({ '1': '/a/same.aiff', '2': '/a/same.aiff' })} />)
      await screen.findAllByText('rekordbox · 3 cues · 1 playlist')
      expect(screen.queryByTestId('music-review-cues-note')).toBeNull()
    })

    it('shows no library line when the libraries cannot be read', async () => {
      const libraryCopyInfo = vi.fn<Api['libraryCopyInfo']>().mockRejectedValue(new Error('x'))
      setApi({ libraryCopyInfo })
      render(<Panes review={dupReview({ '1': '/a/1.aiff', '2': '/a/2.aiff' })} />)
      await vi.waitFor(() => expect(libraryCopyInfo).toHaveBeenCalled())
      expect(screen.queryByTestId('music-review-copy-library')).toBeNull()
    })

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
