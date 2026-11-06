// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { EMPTY_FILTER, type FilterSelection, type qualityCounts } from '../lib/triage'
import { hoverTooltip } from '../test/tooltip'
import { SECTION_HOVER_DELAY } from './FilterBar'
import { ModalShell } from './ModalShell'
import { ActiveFilters, QualityFilterBar } from './QualityFilterBar'

afterEach(cleanup)

type Tally = ReturnType<typeof qualityCounts>
const tally = (over: Partial<Tally> = {}): Tally => ({
  suspect: 0,
  good: 0,
  unanalyzed: 0,
  damaged: 0,
  unconverted: 0,
  failed: 0,
  skipped: 0,
  automatched: 0,
  matchReview: 0,
  matchedDiscogs: 0,
  matchedBandcamp: 0,
  silence: 0,
  clipping: 0,
  noCues: 0,
  offGrid: 0,
  badGrid: 0,
  unanalysedRekordbox: 0,
  unanalysedEngine: 0,
  noCover: 0,
  smallCover: 0,
  noBpm: 0,
  noKey: 0,
  missingRequired: 0,
  unsaved: 0,
  mismatch: 0,
  inLibrary: 0,
  notInLibrary: 0,
  betterThanLibrary: 0,
  duplicates: 0,
  unplayed: 0,
  played: 0,
  noStars: 0,
  stars3: 0,
  stars4: 0,
  stars5: 0,
  ...over,
})

const sel = (over: Partial<FilterSelection> = {}): FilterSelection => ({ ...EMPTY_FILTER, ...over })

function renderBar(over: Partial<Parameters<typeof QualityFilterBar>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <QualityFilterBar
      filterRef={createRef()}
      librarySource="appleMusic"
      value={sel()}
      onChange={onChange}
      tally={over.tally ?? tally()}
      formats={over.formats ?? []}
      facets={{
        tally: over.tally ?? tally(),
        formats: Object.fromEntries((over.formats ?? []).map((f) => [f.format, f.count])),
      }}
      trackCount={498}
      visibleCount={498}
      selectedPosition={null}
      selectedCount={1}
      onRevealSelected={() => {}}
      onTrashSuspects={() => {}}
      {...over}
    />,
  )
  return { onChange }
}

// Opens the menu, and the section whose filters a test is about.
function openMenu(section?: string) {
  fireEvent.click(screen.getByTestId('quality-filter-trigger'))
  if (section) fireEvent.click(screen.getByTestId(`quality-filter-section-${section}`))
}

describe('QualityFilterBar menu', () => {
  // The review dialog has this filter too. Portaled out of it, a backdrop under the
  // dialog's overlay let a click beside the menu land in the review instead of closing it.
  it('keeps its backdrop over the dialog it opened from', () => {
    const layer = (el: Element): number => Number(/\bz-\[?(\d+)\]?/.exec(el.className)?.[1] ?? 0)
    render(
      <ModalShell onClose={vi.fn()} backdropTestId="shell-backdrop" className="w-80">
        <p>review</p>
      </ModalShell>,
    )
    renderBar()
    openMenu()
    const overlay = screen.getByTestId('shell-backdrop').parentElement as Element
    expect(layer(screen.getByTestId('quality-filter-backdrop'))).toBeGreaterThanOrEqual(
      layer(overlay),
    )
  })

  // In the app at 650 px tall, with 97 tracks and the player open, the last bucket sat
  // behind the player and the menu's own scroll could not reach it: it measured its room
  // to the window's floor from inside a list the player cuts short. Placed in the window
  // from its trigger, it gets exactly the room under the trigger and scrolls inside it.
  it('fits the menu in the window below its trigger', () => {
    window.innerHeight = 650
    renderBar({ tally: tally({ suspect: 3, good: 5, unanalyzed: 2 }) })
    const trigger = screen.getByTestId('quality-filter-trigger')
    trigger.getBoundingClientRect = () =>
      ({ top: 100, bottom: 132, left: 8, width: 200, height: 32 }) as DOMRect
    fireEvent.click(trigger)
    const style = screen.getByTestId('quality-filter-menu').style
    expect(Number.parseFloat(style.top)).toBeGreaterThanOrEqual(132)
    expect(Number.parseFloat(style.maxHeight)).toBeLessThanOrEqual(650 - 132)
  })

  // The menu hangs from the sticky header over a 500-row list. Focusing a section or an
  // option without preventScroll let the browser scroll that list to reveal it, so walking
  // the menu with the arrows lost the user's place in the crate behind it.
  it('focuses sections and options without scrolling anything outside the menu', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    renderBar({ tally: tally({ suspect: 3, good: 5, unanalyzed: 2 }) })
    openMenu()
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' })
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' })
    const calls = focus.mock.contexts
      .map((el, i) => [el, focus.mock.calls[i][0]] as const)
      .filter(([el]) => ['tab', 'option'].includes((el as HTMLElement).getAttribute('role') ?? ''))
    expect(calls.length).toBeGreaterThanOrEqual(4)
    for (const [, opts] of calls) expect(opts).toEqual({ preventScroll: true })
    focus.mockRestore()
  })

  // Tab leaves the menu like a native one. Left open, its full-window backdrop swallowed
  // the next click wherever the user aimed it.
  it('closes when Tab leaves it', () => {
    renderBar({ tally: tally({ suspect: 3, good: 5 }) })
    openMenu()
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' })
    expect(screen.queryByTestId('quality-filter-menu')).toBeNull()
  })
})

describe('QualityFilterBar sections', () => {
  // The old single list grew past 1,100 px once every filter showed, so it hid each one
  // while nothing was in it, and a filter was there one day and gone the next. The sections
  // are fixed, always in this order, so where a filter lives never changes. The order is the
  // one a crate is worked in, from whether the file is worth keeping to converting it.
  it('lists the same sections, in the order a crate is worked, whatever the crate holds', () => {
    const order = (): (string | null)[] =>
      screen.getAllByRole('tab').map((el) => el.getAttribute('data-testid'))
    const expected = [
      'quality',
      'library',
      'list',
      'stars',
      'match',
      'tags',
      'attention',
      'status',
      'format',
    ].map((k) => `quality-filter-section-${k}`)
    renderBar()
    openMenu()
    expect(order()).toEqual(expected)
    cleanup()
    renderBar({ tally: tally({ silence: 4, duplicates: 2, automatched: 3 }) })
    openMenu()
    expect(order()).toEqual(expected)
  })

  it('names each section, the library one after the library its filters read', () => {
    renderBar()
    openMenu()
    for (const key of [
      'status',
      'list',
      'stars',
      'quality',
      'tags',
      'match',
      'attention',
      'format',
    ]) {
      expect(screen.getByTestId(`quality-filter-section-${key}`)).toHaveTextContent(
        i18n.t(`sidebar.filter.section.${key}`),
      )
    }
    expect(screen.getByTestId('quality-filter-section-library')).toHaveTextContent('Apple Music')
    cleanup()
    renderBar({ librarySource: 'engineDj' })
    openMenu()
    expect(screen.getByTestId('quality-filter-section-library')).toHaveTextContent('Engine DJ')
  })

  // Folder conversions land in no library, so there is nothing to compare membership with.
  it('leaves the library section out when conversions land in no library', () => {
    renderBar({ librarySource: null })
    openMenu()
    expect(screen.queryByTestId('quality-filter-section-library')).toBeNull()
  })

  // What the user did with the list, not with the file: the selection, what was heard and the
  // songs loaded twice share one section, each under its own heading, instead of three
  // sections where two held a single filter.
  it('gathers the selection, the listening and the duplicates in one section, under headings', () => {
    renderBar({ selectedCount: 2, tally: tally({ unplayed: 4, played: 1, duplicates: 2 }) })
    openMenu('list')
    const groups = screen.getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Selection',
      'Listening',
      'Repeats',
    ])
    expect(groups.map((g) => within(g).getAllByRole('option').length)).toEqual([1, 2, 1])
    expect(within(groups[2]).getByTestId('quality-filter-duplicates')).toHaveTextContent(/2$/)
  })

  // Only the chosen section's filters show, so the menu keeps its height as filters grow.
  it('shows only the chosen section’s filters, every one of them', () => {
    renderBar({ tally: tally({ clipping: 2 }) })
    openMenu('attention')
    const shown = screen.getAllByRole('option').map((el) => el.getAttribute('data-testid'))
    expect(shown).toEqual(
      [
        'silence',
        'clipping',
        'noCues',
        'offGrid',
        'badGrid',
        'unanalysedRekordbox',
        'unanalysedEngine',
      ].map((m) => `quality-filter-${m}`),
    )
    expect(screen.queryByTestId('quality-filter-unconverted')).toBeNull()
  })

  // An empty filter stays where it is, dimmed with its 0, instead of vanishing: the user
  // learns where "No cues" lives once and finds it there every time.
  it('keeps an empty filter in its place, dimmed with its zero', () => {
    renderBar({ tally: tally({ clipping: 2 }) })
    openMenu('attention')
    expect(screen.getByTestId('quality-filter-silence')).toHaveAttribute('data-empty')
    expect(screen.getByTestId('quality-filter-silence')).toHaveTextContent(/0$/)
    expect(screen.getByTestId('quality-filter-clipping')).not.toHaveAttribute('data-empty')
  })

  it('dims a section with nothing in it, but never one with a filter picked', () => {
    renderBar({
      value: sel({ tags: 'noBpm' }),
      tally: tally({ unconverted: 3 }),
      facets: { tally: tally({ unconverted: 3 }), formats: {} },
    })
    openMenu()
    expect(screen.getByTestId('quality-filter-section-attention')).toHaveAttribute('data-empty')
    expect(screen.getByTestId('quality-filter-section-tags')).not.toHaveAttribute('data-empty')
    expect(screen.getByTestId('quality-filter-section-status')).not.toHaveAttribute('data-empty')
  })

  it('switches the filters on the right when a section is clicked', () => {
    renderBar({ tally: tally({ unconverted: 3, good: 2 }) })
    openMenu('status')
    expect(screen.getByTestId('quality-filter-unconverted')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('quality-filter-section-quality'))
    expect(screen.getByTestId('quality-filter-good')).toBeInTheDocument()
    expect(screen.queryByTestId('quality-filter-unconverted')).toBeNull()
    expect(screen.getByTestId('quality-filter-section-quality')).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  // On the way from a section to its filters the pointer crosses the sections below it.
  // Switching on the first touch swapped the filters out from under the pointer; a section
  // takes over only once the pointer rests on it.
  it('switches section on hover only once the pointer rests there', () => {
    vi.useFakeTimers()
    try {
      renderBar({ tally: tally({ unconverted: 3, good: 2, noCover: 1 }) })
      openMenu('status')
      const quality = screen.getByTestId('quality-filter-section-quality')
      const tags = screen.getByTestId('quality-filter-section-tags')
      fireEvent.mouseEnter(quality)
      act(() => vi.advanceTimersByTime(SECTION_HOVER_DELAY / 2))
      fireEvent.mouseLeave(quality)
      fireEvent.mouseEnter(tags)
      fireEvent.mouseLeave(tags)
      act(() => vi.advanceTimersByTime(SECTION_HOVER_DELAY * 2))
      expect(screen.getByTestId('quality-filter-unconverted')).toBeInTheDocument()
      fireEvent.mouseEnter(quality)
      act(() => vi.advanceTimersByTime(SECTION_HOVER_DELAY))
      expect(screen.getByTestId('quality-filter-good')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  // A pick from another section layers onto the first, so the menu has to tell at a glance
  // which sections hold one: a count on the section, and the amber dot where work waits.
  it('counts the picked filters on their section and flags the sections with work waiting', () => {
    renderBar({
      value: sel({ quality: 'good', conversion: 'matchedDiscogs' }),
      tally: tally({ good: 3, matchedDiscogs: 2, clipping: 4 }),
    })
    openMenu()
    expect(screen.getByTestId('quality-filter-section-quality-picked')).toHaveTextContent('1')
    expect(screen.getByTestId('quality-filter-section-match-picked')).toHaveTextContent('1')
    expect(screen.queryByTestId('quality-filter-section-status-picked')).toBeNull()
    expect(screen.getByTestId('quality-filter-section-attention-dot')).toBeInTheDocument()
    expect(screen.queryByTestId('quality-filter-section-tags-dot')).toBeNull()
  })

  // Reopening lands on the filter in use, so the arrows continue from the current choice.
  it('opens on the section of the picked filter, focused on it', () => {
    renderBar({ value: sel({ attention: 'clipping' }), tally: tally({ clipping: 4 }) })
    openMenu()
    expect(screen.getByTestId('quality-filter-section-attention')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('quality-filter-clipping')).toHaveFocus()
  })

  it('opens on the first section, focused on it, when nothing is picked', () => {
    renderBar()
    openMenu()
    expect(screen.getByTestId('quality-filter-section-quality')).toHaveFocus()
  })

  // Someone finishing the tags opens the menu again and again on the same section: it comes
  // back where they left it instead of making them walk down to it every time.
  it('opens again on the section last looked at, while nothing is picked', () => {
    renderBar()
    openMenu('tags')
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    openMenu()
    expect(screen.getByTestId('quality-filter-section-tags')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('quality-filter-section-tags')).toHaveFocus()
  })

  it('walks the sections with the arrows, steps into the filters with → and back with ←', () => {
    renderBar({ tally: tally({ unplayed: 2, played: 1 }) })
    openMenu()
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    expect(screen.getByTestId('quality-filter-section-library')).toHaveFocus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    const list = screen.getByTestId('quality-filter-section-list')
    expect(list).toHaveFocus()
    expect(list).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(screen.getByTestId('quality-filter-selected')).toHaveFocus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    expect(screen.getByTestId('quality-filter-unplayed')).toHaveFocus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' })
    expect(list).toHaveFocus()
  })

  // The arrows move inside the menu only: the window's shortcuts would otherwise also move
  // the track selection behind it.
  it('keeps the arrows from reaching the list behind the menu', () => {
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    renderBar()
    openMenu()
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    window.removeEventListener('keydown', onWindowKey)
    expect(onWindowKey).not.toHaveBeenCalled()
  })

  it('says how many tracks the filters leave and clears them all from the foot', () => {
    const { onChange } = renderBar({
      value: sel({ quality: 'good', format: 'WAV' }),
      formats: [{ format: 'WAV', count: 5 }],
      trackCount: 498,
      visibleCount: 7,
    })
    openMenu()
    expect(screen.getByTestId('quality-filter-shown')).toHaveTextContent('7 of 498 tracks')
    fireEvent.click(screen.getByTestId('quality-filter-clear'))
    expect(onChange).toHaveBeenCalledWith(sel())
    expect(screen.queryByTestId('quality-filter-menu')).toBeNull()
  })

  it('offers nothing to clear while no filter is on', () => {
    renderBar()
    openMenu()
    expect(screen.getByTestId('quality-filter-clear')).toBeDisabled()
  })

  // A crate in a single format has no format to pick; the section says why it is empty.
  it('says every track shares one format when there is none to pick', () => {
    renderBar({ formats: [] })
    openMenu('format')
    expect(screen.getByTestId('quality-filter-empty')).toHaveTextContent(
      'Every track has the same format',
    )
    expect(screen.getByTestId('quality-filter-section-format')).toHaveAttribute('data-empty')
  })
})

describe('QualityFilterBar', () => {
  it('lists the failed and review buckets with what landed in them', () => {
    renderBar({ tally: tally({ failed: 20, matchReview: 4 }) })
    openMenu('status')
    expect(screen.getByTestId('quality-filter-failed')).toHaveTextContent(/20$/)
    fireEvent.click(screen.getByTestId('quality-filter-section-match'))
    expect(screen.getByTestId('quality-filter-matchReview')).toHaveTextContent(/4$/)
  })

  // djotas's retouch buckets: while editing the collection, isolate the tracks with
  // work left — silence still to trim, or true clipping. Picking one filters its own axis.
  it('filters the attention axis from a retouch bucket', () => {
    const { onChange } = renderBar({ tally: tally({ silence: 4, clipping: 2 }) })
    openMenu('attention')
    fireEvent.click(screen.getByTestId('quality-filter-silence'))
    expect(onChange).toHaveBeenCalledWith(sel({ attention: 'silence' }))
  })

  it('filters the attention axis from the tracks without cues', () => {
    const { onChange } = renderBar({ tally: tally({ noCues: 3 }) })
    openMenu('attention')
    fireEvent.click(screen.getByTestId('quality-filter-noCues'))
    expect(onChange).toHaveBeenCalledWith(sel({ attention: 'noCues' }))
  })

  it('nudges in amber toward the tracks whose cues miss the grid', () => {
    const { onChange } = renderBar({ tally: tally({ offGrid: 2 }) })
    openMenu('attention')
    expect(screen.getByTestId('quality-filter-offGrid-dot')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('quality-filter-offGrid'))
    expect(onChange).toHaveBeenCalledWith(sel({ attention: 'offGrid' }))
  })

  it('lets the bad-grid filter be picked before anything is measured, since picking it is what starts the measuring', () => {
    const { onChange } = renderBar({
      tally: tally(),
      gridMeasure: { offered: true, measuring: false, done: 0, total: 0 },
    })
    openMenu('attention')
    fireEvent.click(screen.getByTestId('quality-filter-badGrid'))
    expect(onChange).toHaveBeenCalledWith(sel({ attention: 'badGrid' }))
  })

  // The measuring shows as a ring closing round the filter's own icon: a second number
  // beside the count read as another count, and took width the labels need.
  it('rings the bad-grid icon with how far the measuring got, in place of a percentage', () => {
    renderBar({
      tally: tally({ badGrid: 3 }),
      gridMeasure: { offered: true, measuring: true, done: 344, total: 2077 },
    })
    openMenu('attention')
    expect(screen.getByTestId('quality-filter-badGrid')).toHaveTextContent(/^Bad grid3$/)
    const ring = screen.getByTestId('quality-filter-badGrid-progress')
    expect(ring).toHaveAttribute('role', 'progressbar')
    expect(ring).toHaveAttribute('aria-valuenow', '16')
    expect(ring).toHaveAccessibleName('Measuring 344 of 2077')
    expect(hoverTooltip(ring)).toEqual('Measuring 344 of 2077')
  })

  // A filter still measuring has found nothing yet, which is not the same as holding nothing:
  // dimmed like an empty one, its ring faded to where it could not be read.
  it('never dims a filter or its section while it measures', () => {
    renderBar({ gridMeasure: { offered: true, measuring: true, done: 10, total: 40 } })
    openMenu('attention')
    expect(screen.getByTestId('quality-filter-badGrid')).not.toHaveAttribute('data-empty')
    expect(screen.getByTestId('quality-filter-noCues')).toHaveAttribute('data-empty')
    expect(screen.getByTestId('quality-filter-section-attention')).not.toHaveAttribute('data-empty')
  })

  // Better than Music is measured only once its filter is picked: before that, a 0 read as
  // "measured, none better" while everything else said the crate was fully analysed.
  it('says a filter not measured yet holds an unknown count, with no progress to show', () => {
    renderBar({
      tally: tally({ inLibrary: 3 }),
      libraryMeasure: { offered: true, measuring: false, done: 0, total: 3 },
    })
    openMenu('library')
    const option = screen.getByTestId('quality-filter-betterThanLibrary')
    expect(option).toHaveTextContent(/^Better than Music–$/)
    expect(option).not.toHaveAttribute('data-empty')
    expect(screen.queryByTestId('quality-filter-betterThanLibrary-progress')).toBeNull()
    expect(screen.queryByTestId('quality-filter-section-library-progress')).toBeNull()
  })

  // Once measured the number is real, even a 0, picked or not.
  it('counts a filter measured to the end like any other', () => {
    renderBar({ libraryMeasure: { offered: true, measuring: false, done: 3, total: 3 } })
    openMenu('library')
    expect(screen.getByTestId('quality-filter-betterThanLibrary')).toHaveTextContent(
      /^Better than Music0$/,
    )
  })

  // The ring and the amber dot sit on the same icon: the dot waits for the measuring to end,
  // then says there is something to fix.
  it('holds the amber dot back until the measuring ends', () => {
    renderBar({
      tally: tally({ badGrid: 3 }),
      gridMeasure: { offered: true, measuring: true, done: 344, total: 2077 },
    })
    openMenu('attention')
    expect(screen.queryByTestId('quality-filter-badGrid-dot')).toBeNull()
    cleanup()
    renderBar({
      tally: tally({ badGrid: 3 }),
      gridMeasure: { offered: true, measuring: true, done: 2077, total: 2077 },
    })
    openMenu('attention')
    expect(screen.queryByTestId('quality-filter-badGrid-progress')).toBeNull()
    expect(screen.getByTestId('quality-filter-badGrid-dot')).toBeInTheDocument()
  })

  // From another section the filter measuring is out of sight, so its section carries the
  // same ring, unless a filter picked there already claims the spot with its count.
  it('rings the section whose filter is measuring, its picked count winning the spot', () => {
    renderBar({ gridMeasure: { offered: true, measuring: true, done: 10, total: 40 } })
    openMenu()
    expect(screen.getByTestId('quality-filter-section-attention-progress')).toHaveAttribute(
      'aria-valuenow',
      '25',
    )
    cleanup()
    renderBar({
      value: sel({ attention: 'clipping' }),
      tally: tally({ clipping: 2 }),
      gridMeasure: { offered: true, measuring: true, done: 10, total: 40 },
    })
    openMenu()
    expect(screen.queryByTestId('quality-filter-section-attention-progress')).toBeNull()
    expect(screen.getByTestId('quality-filter-section-attention-picked')).toHaveTextContent('1')
  })

  it('offers the better-than-the-library filter among the library buckets, since picking it is what starts the measuring', () => {
    const { onChange } = renderBar({
      tally: tally({ inLibrary: 4 }),
      libraryMeasure: { offered: true, measuring: false, done: 0, total: 4 },
    })
    openMenu('library')
    fireEvent.click(screen.getByTestId('quality-filter-betterThanLibrary'))
    expect(onChange).toHaveBeenCalledWith(sel({ library: 'betterThanLibrary' }))
  })

  it('says how far the comparison with the library got beside its filter', () => {
    renderBar({
      tally: tally({ inLibrary: 40, betterThanLibrary: 3 }),
      libraryMeasure: { offered: true, measuring: true, done: 10, total: 40 },
    })
    openMenu('library')
    expect(screen.getByTestId('quality-filter-betterThanLibrary')).toHaveTextContent(
      /^Better than Music3$/,
    )
    expect(screen.getByTestId('quality-filter-betterThanLibrary-progress')).toHaveAttribute(
      'aria-valuenow',
      '25',
    )
    expect(hoverTooltip(screen.getByTestId('quality-filter-betterThanLibrary-progress'))).toEqual(
      'Measuring 10 of 40',
    )
  })

  it('names the DJ program a track is waiting on in its unanalysed bucket', () => {
    const { onChange } = renderBar({ tally: tally({ unanalysedEngine: 5 }) })
    openMenu('attention')
    expect(screen.getByTestId('quality-filter-unanalysedEngine')).toHaveTextContent(
      i18n.t('sidebar.filter.unanalysedEngine'),
    )
    fireEvent.click(screen.getByTestId('quality-filter-unanalysedEngine'))
    expect(onChange).toHaveBeenCalledWith(sel({ attention: 'unanalysedEngine' }))
  })

  // Going through a long crate over several days, the tracks still to hear are one pick away.
  it('filters the listen axis from the unplayed and played buckets', () => {
    const { onChange } = renderBar({ tally: tally({ unplayed: 412, played: 306 }) })
    openMenu('list')
    expect(screen.getByTestId('quality-filter-unplayed')).toHaveTextContent(/^Unplayed412$/)
    expect(screen.getByTestId('quality-filter-played')).toHaveTextContent(/^Played306$/)
    fireEvent.click(screen.getByTestId('quality-filter-unplayed'))
    expect(onChange).toHaveBeenCalledWith(sel({ listen: 'unplayed' }))
  })

  // The count is the selection's own size, the number the counter beside the menu shows.
  it('filters the selection axis from the selected bucket, counted as the selection', () => {
    const { onChange } = renderBar({ selectedCount: 2 })
    openMenu('list')
    expect(screen.getByTestId('quality-filter-selected')).toHaveTextContent(/^Selected2$/)
    fireEvent.click(screen.getByTestId('quality-filter-selected'))
    expect(onChange).toHaveBeenCalledWith(sel({ selection: 'selected' }))
  })

  // The DJ's own verdict: the unrated still to judge, or a floor of stars worth a set.
  it('filters the stars axis from the unrated bucket and the star floors', () => {
    const { onChange } = renderBar({ tally: tally({ noStars: 540, stars3: 121, stars4: 61 }) })
    openMenu('stars')
    expect(screen.getAllByRole('option').map((el) => el.getAttribute('data-testid'))).toEqual(
      ['noStars', 'stars3', 'stars4', 'stars5'].map((m) => `quality-filter-${m}`),
    )
    expect(screen.getByTestId('quality-filter-stars4')).toHaveTextContent(/^4 or more61$/)
    fireEvent.click(screen.getByTestId('quality-filter-stars4'))
    expect(onChange).toHaveBeenCalledWith(sel({ stars: 'stars4' }))
  })

  it('filters the tags axis from a tag bucket', () => {
    const { onChange } = renderBar({ tally: tally({ noCover: 3, noKey: 2 }) })
    openMenu('tags')
    fireEvent.click(screen.getByTestId('quality-filter-noKey'))
    expect(onChange).toHaveBeenCalledWith(sel({ tags: 'noKey' }))
  })

  it('offers the tracks missing required fields and the ones with unsaved changes', () => {
    const { onChange } = renderBar({ tally: tally({ missingRequired: 4, unsaved: 2 }) })
    openMenu('tags')
    expect(screen.getByTestId('quality-filter-missingRequired')).toHaveTextContent(/4$/)
    fireEvent.click(screen.getByTestId('quality-filter-section-status'))
    fireEvent.click(screen.getByTestId('quality-filter-unsaved'))
    expect(onChange).toHaveBeenCalledWith(sel({ conversion: 'unsaved' }))
  })

  it('keeps the dot for problems, so a backlog to convert or save never reads as one', () => {
    renderBar({
      value: sel({ conversion: 'unconverted' }),
      tally: tally({ unconverted: 2044, unsaved: 1040, missingRequired: 77 }),
    })
    openMenu()
    expect(screen.queryByTestId('quality-filter-unconverted-dot')).toBeNull()
    expect(screen.queryByTestId('quality-filter-unsaved-dot')).toBeNull()
    expect(screen.queryByTestId('quality-filter-trigger-dot')).toBeNull()
    fireEvent.click(screen.getByTestId('quality-filter-section-tags'))
    expect(screen.getByTestId('quality-filter-missingRequired-dot')).toBeInTheDocument()
  })

  it('offers the tracks that do not add up, with their count and the amber dot', () => {
    const { onChange } = renderBar({ tally: tally({ mismatch: 2 }) })
    openMenu('status')
    const option = screen.getByTestId('quality-filter-mismatch')
    expect(option).toHaveTextContent(/^Don’t add up2$/)
    expect(screen.getByTestId('quality-filter-mismatch-dot')).toBeInTheDocument()
    fireEvent.click(option)
    expect(onChange).toHaveBeenCalledWith(sel({ conversion: 'mismatch' }))
  })

  it('picking a provider bucket filters the conversion axis', () => {
    const { onChange } = renderBar({ tally: tally({ matchedDiscogs: 2 }) })
    openMenu('match')
    fireEvent.click(screen.getByTestId('quality-filter-matchedDiscogs'))
    expect(onChange).toHaveBeenCalledWith(sel({ conversion: 'matchedDiscogs' }))
  })

  // The whole reason for the dropdown: a wide crate's chips overflowed the narrow
  // sidebar, so the filters collapse into one control that can't run out of width.
  it('collapses the filters into a single trigger that opens the menu on click', () => {
    renderBar()
    expect(screen.queryByTestId('quality-filter-good')).toBeNull()
    openMenu()
    expect(screen.getByTestId('quality-filter-good')).toBeInTheDocument()
  })

  // A dropdown that rises from below reads as arriving from somewhere else; it has to
  // grow out of its trigger's corner like every other anchored menu in the app.
  it('grows the menu out of the trigger instead of rising like a modal', () => {
    renderBar()
    openMenu()
    const menu = screen.getByTestId('quality-filter-menu')
    expect(menu).toHaveClass('animate-pop-flat', 'origin-top-left')
    expect(menu).not.toHaveClass('animate-pop')
  })

  // A pick toggles its axis and closes the menu like a native select — the common
  // single-filter case shouldn't need a click outside to dismiss the popover.
  it('reports a bucket pick on its axis and closes the menu', () => {
    const { onChange } = renderBar({ tally: tally({ unconverted: 459 }) })
    openMenu('status')
    fireEvent.click(screen.getByTestId('quality-filter-unconverted'))
    expect(onChange).toHaveBeenCalledWith(sel({ conversion: 'unconverted' }))
    expect(screen.queryByTestId('quality-filter-menu')).toBeNull()
  })

  // The point of the split: picking a second section's bucket (after reopening) must NOT
  // replace the first — it layers, so the callback carries both choices.
  it('stacks a second axis onto an existing selection instead of replacing it', () => {
    const { onChange } = renderBar({
      value: sel({ quality: 'good' }),
      tally: tally({ good: 11, unconverted: 459 }),
    })
    openMenu('status')
    fireEvent.click(screen.getByTestId('quality-filter-unconverted'))
    expect(onChange).toHaveBeenCalledWith(sel({ quality: 'good', conversion: 'unconverted' }))
  })

  it('offers the damaged files as a quality bucket with their count so a broken rip can be isolated and replaced', () => {
    const { onChange } = renderBar({ tally: tally({ damaged: 2, suspect: 5 }) })
    openMenu('quality')
    const option = screen.getByTestId('quality-filter-damaged')
    expect(option).toHaveTextContent(i18n.t('sidebar.filter.damaged'))
    expect(option).toHaveTextContent('2')
    fireEvent.click(option)
    expect(onChange).toHaveBeenCalledWith(sel({ quality: 'damaged' }))
  })

  it('never offers to trash the damaged files, since a broken rip is not a fake and only needs replacing', () => {
    renderBar({ value: sel({ quality: 'damaged' }), tally: tally({ damaged: 2, suspect: 5 }) })
    expect(screen.getByTestId('quality-filter-trigger')).toHaveTextContent(
      i18n.t('sidebar.filter.damaged'),
    )
    expect(screen.queryByTestId('trash-suspects')).toBeNull()
  })

  // Clicking the already-active bucket in a section clears that axis (back to "any") without
  // touching the others.
  it('toggles an active bucket off when picked again', () => {
    const { onChange } = renderBar({ value: sel({ quality: 'good' }), tally: tally({ good: 11 }) })
    openMenu()
    fireEvent.click(screen.getByTestId('quality-filter-good'))
    expect(onChange).toHaveBeenCalledWith(sel())
  })

  // Counts stay the point of the bar — at-a-glance triage — so each menu row carries its own
  // count, and a single active axis surfaces its count on the trigger.
  it('shows the active bucket count on the trigger and every bucket count in the menu', () => {
    renderBar({ value: sel({ conversion: 'unconverted' }), tally: tally({ unconverted: 459 }) })
    expect(screen.getByTestId('quality-filter-trigger')).toHaveTextContent('459')
    openMenu()
    expect(screen.getByTestId('quality-filter-unconverted')).toHaveTextContent('459')
  })

  // The trigger is the only thing on screen once the menu closes; with just a retouch bucket
  // active it read "All" over the whole crate while the list showed a handful of rows.
  it('names an active retouch bucket and its count on the trigger', () => {
    renderBar({ value: sel({ attention: 'clipping' }), tally: tally({ clipping: 4 }) })
    const trigger = screen.getByTestId('quality-filter-trigger')
    expect(trigger).toHaveTextContent('Clipping')
    expect(trigger).toHaveTextContent('4')
    expect(trigger).not.toHaveTextContent('498')
  })

  // With nothing filtered the trigger reads "All" over the whole crate.
  it('shows the full track count on the trigger when nothing is filtered', () => {
    renderBar({ value: sel(), trackCount: 498 })
    expect(screen.getByTestId('quality-filter-trigger')).toHaveTextContent('498')
  })

  // With several axes active no single per-axis count describes the intersection, so the
  // trigger collapses to a generic "Filters" badge counting the surviving tracks.
  it('shows the visible count on the trigger when more than one axis is active', () => {
    renderBar({
      value: sel({ quality: 'good', conversion: 'unconverted' }),
      tally: tally({ good: 11, unconverted: 459 }),
      visibleCount: 7,
    })
    expect(screen.getByTestId('quality-filter-trigger')).toHaveTextContent('7')
  })

  // Per-format buckets carry their own count so a DJ can isolate "just the MP3s" before
  // converting.
  it('lists a per-format bucket for each source format present, with its count', () => {
    renderBar({
      formats: [
        { format: 'FLAC', count: 12 },
        { format: 'MP3', count: 27 },
      ],
    })
    openMenu('format')
    expect(screen.getByTestId('quality-filter-ext:MP3')).toHaveTextContent('MP3')
    expect(screen.getByTestId('quality-filter-ext:MP3')).toHaveTextContent('27')
    expect(screen.getByTestId('quality-filter-ext:FLAC')).toHaveTextContent('12')
  })

  it('counts each bucket within the sections already picked, so a number says what picking it shows', () => {
    renderBar({
      value: sel({ quality: 'good' }),
      tally: tally({ good: 15, unsaved: 1040 }),
      formats: [
        { format: 'AIFF', count: 565 },
        { format: 'WAV', count: 1224 },
      ],
      facets: { tally: tally({ good: 15, unsaved: 3 }), formats: { AIFF: 0, WAV: 2 } },
    })
    openMenu('status')
    expect(screen.getByTestId('quality-filter-unsaved')).toHaveTextContent(/3$/)
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    expect(screen.getByTestId('quality-filter-ext:WAV')).toHaveTextContent(/2$/)
    expect(screen.getByTestId('quality-filter-ext:AIFF')).toHaveTextContent(/0$/)
  })

  // Format is its own axis: picking it reports a selection with format set and closes the
  // menu like any other bucket.
  it('reports a format pick on the format axis and closes the menu', () => {
    const { onChange } = renderBar({ formats: [{ format: 'WAV', count: 3 }] })
    openMenu('format')
    fireEvent.click(screen.getByTestId('quality-filter-ext:WAV'))
    expect(onChange).toHaveBeenCalledWith(sel({ format: 'WAV' }))
    expect(screen.queryByTestId('quality-filter-menu')).toBeNull()
  })

  it('toggles the active format off when picked again', () => {
    const { onChange } = renderBar({
      formats: [{ format: 'WAV', count: 3 }],
      value: sel({ format: 'WAV' }),
    })
    openMenu()
    fireEvent.click(screen.getByTestId('quality-filter-ext:WAV'))
    expect(onChange).toHaveBeenCalledWith(sel())
  })

  // The whole point of the combine: a bucket and a format can be checked at once, so
  // "good AND only WAV" shows two ticks, not one replacing the other.
  it('shows the primary bucket and the format checked together', () => {
    renderBar({
      value: sel({ quality: 'good', format: 'WAV' }),
      formats: [
        { format: 'FLAC', count: 5 },
        { format: 'WAV', count: 5 },
      ],
    })
    openMenu('quality')
    expect(screen.getByTestId('quality-filter-good')).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    expect(screen.getByTestId('quality-filter-ext:WAV')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('quality-filter-ext:FLAC')).toHaveAttribute('aria-selected', 'false')
  })

  // With only a format active the trigger surfaces it (the single-axis case), so a closed
  // menu still shows that WAV is filtering rather than a bare "All".
  it('surfaces the active format on the trigger when it is the only axis', () => {
    renderBar({ value: sel({ format: 'WAV' }), formats: [{ format: 'WAV', count: 5 }] })
    const trigger = screen.getByTestId('quality-filter-trigger')
    expect(trigger).toHaveTextContent('WAV')
    expect(trigger).toHaveTextContent('5')
  })

  it('draws the library buckets with their own glyph, so the selection tick is never mistaken for one', () => {
    renderBar({ tally: tally({ notInLibrary: 6, inLibrary: 4 }) })
    openMenu('library')
    const paths = (svg: Element): string =>
      Array.from(svg.querySelectorAll('path'), (p) => p.getAttribute('d')).join(' ')
    for (const id of ['inLibrary', 'notInLibrary']) {
      const glyphs = screen.getByTestId(`quality-filter-${id}`).querySelectorAll('svg')
      expect(paths(glyphs[0])).not.toBe(paths(glyphs[glyphs.length - 1]))
    }
  })

  it('marks a bucket the picked sections leave empty, but never the one that is picked', () => {
    renderBar({
      value: sel({ quality: 'good', tags: 'noBpm' }),
      tally: tally({ good: 15, noBpm: 5, noKey: 4 }),
      facets: { tally: tally({ good: 0, noBpm: 0, noKey: 0, unconverted: 3 }), formats: {} },
    })
    openMenu('tags')
    expect(screen.getByTestId('quality-filter-noKey')).toHaveAttribute('data-empty')
    expect(screen.getByTestId('quality-filter-noBpm')).not.toHaveAttribute('data-empty')
  })

  // The trigger shows the active filter ("Unconverted 12") but its name was a fixed
  // "Filter", so a screen reader never heard which view the list was in, and voice
  // control could not target it by the words on screen.
  it('names the filter trigger with the filter it shows', () => {
    renderBar({ value: sel({ conversion: 'unconverted' }), tally: tally({ unconverted: 12 }) })
    const trigger = screen.getByTestId('quality-filter-trigger')
    expect(trigger).toHaveAccessibleName(/Unconverted/)
    expect(trigger).toHaveAccessibleName(/Filter/)
  })

  // Several buckets can be on at once, so the filters list declares itself multi-select;
  // the sections are tabs that say which filters the list shows.
  it('marks the menu as a dropdown, its sections as tabs and its filters as a multi-select list', () => {
    renderBar()
    openMenu()
    expect(screen.getByTestId('quality-filter-menu')).toHaveAttribute('data-menu')
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')
    const listbox = screen.getByRole('listbox')
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true')
    expect(screen.getByRole('tabpanel')).toContainElement(listbox)
    expect(screen.getByRole('tab', { selected: true })).toHaveAttribute(
      'aria-controls',
      screen.getByRole('tabpanel').id,
    )
  })

  // The x/total position indicator the user relies on must stay visible beside the
  // collapsed control, not fold away into a chip that no longer exists.
  it('keeps the x/total position counter visible next to the dropdown', () => {
    renderBar({ selectedPosition: 250, visibleCount: 498 })
    expect(screen.getByTestId('track-position')).toHaveTextContent('250/498')
  })

  // The counter must stay visible even when the selected track is filtered out of the
  // current bucket: the user relies on it to know how many tracks are left to go through,
  // so it falls back to "‒/total" rather than disappearing.
  it('still shows the total (‒/total) when no selected track is in the current view', () => {
    renderBar({ selectedPosition: null, visibleCount: 4 })
    expect(screen.getByTestId('track-position')).toHaveTextContent('‒/4')
  })

  it('hides the counter only when there are no tracks in view at all', () => {
    renderBar({ selectedPosition: null, visibleCount: 0 })
    expect(screen.queryByTestId('track-position')).toBeNull()
  })

  // With a track selected the counter doubles as a way back to it: a long, scrolled list
  // leaves the selected row off-screen, so clicking the number the DJ can see scrolls to it.
  it('reveals the selected track when the position counter is clicked', () => {
    const onRevealSelected = vi.fn()
    renderBar({ selectedPosition: 250, visibleCount: 498, onRevealSelected })
    fireEvent.click(screen.getByTestId('track-position'))
    expect(onRevealSelected).toHaveBeenCalledOnce()
  })

  // Announced as bare digits, "250/498" said neither what the numbers were nor that
  // pressing it scrolls back to the track: the button's purpose lived only in a tooltip.
  it('names the position counter as the way back to the selected track', () => {
    renderBar({ selectedPosition: 250, visibleCount: 498 })
    expect(screen.getByTestId('track-position')).toHaveAccessibleName(
      i18n.t('sidebar.positionReveal', { current: 250, total: 498 }),
    )
  })

  // During a multi-select the size of the selection is what the DJ cares about, so the
  // counter shows "N selected" in place of the single-track position/reveal control.
  it('shows the selection size instead of the position when multiple are selected', () => {
    renderBar({ selectedCount: 3, selectedPosition: 2, visibleCount: 498 })
    expect(screen.getByTestId('track-selected-count')).toHaveTextContent('3 selected')
    expect(screen.queryByTestId('track-position')).toBeNull()
  })

  // The header's crosshair is gone, so the counter is the one way back to the open track
  // in every state; during a multi-select that track is as easy to scroll away from.
  it('reveals the open track from the selection count too', () => {
    const onRevealSelected = vi.fn()
    renderBar({ selectedCount: 3, selectedPosition: 2, visibleCount: 498, onRevealSelected })
    fireEvent.click(screen.getByTestId('track-selected-count'))
    expect(onRevealSelected).toHaveBeenCalledOnce()
  })

  // The payoff of the quality sweep at the exact moment the DJ is looking at it: once they've
  // filtered to the suspect bucket, a one-click "trash them all" sits right there in the bar,
  // so acting on the fakes doesn't mean opening ⌘K or the row menu one file at a time.
  it('offers a trash-suspects button only while the suspect filter is active and holds fakes', () => {
    const onTrashSuspects = vi.fn()
    renderBar({
      value: sel({ quality: 'suspect' }),
      tally: tally({ suspect: 13 }),
      onTrashSuspects,
    })
    fireEvent.click(screen.getByTestId('trash-suspects'))
    expect(onTrashSuspects).toHaveBeenCalledOnce()
  })

  // Guard the destructive shortcut: it must not appear when another bucket is filtered, nor
  // when the suspect bucket is empty — the DJ should only ever see it when there is genuinely
  // something to purge in front of them.
  it('hides the trash-suspects button outside the suspect filter or when nothing is flagged', () => {
    renderBar({ value: sel({ quality: 'good' }), tally: tally({ suspect: 13 }) })
    expect(screen.queryByTestId('trash-suspects')).toBeNull()
    cleanup()
    renderBar({ value: sel({ quality: 'suspect' }), tally: tally({ suspect: 0 }) })
    expect(screen.queryByTestId('trash-suspects')).toBeNull()
  })

  // The list only shows what lacks a field; the review is where it gets filled, all at once.
  it('offers to fill the tracks missing required data in the review', () => {
    const onReviewIncomplete = vi.fn()
    renderBar({
      value: sel({ tags: 'missingRequired' }),
      tally: tally({ missingRequired: 4 }),
      onReviewIncomplete,
    })
    fireEvent.click(screen.getByTestId('review-incomplete'))
    expect(onReviewIncomplete).toHaveBeenCalledOnce()
  })

  // The filter counts what the app shows: once a match fills the rows unsaved it empties,
  // while the files still lack those fields. The way to the review must stay.
  it('keeps offering the review when the filter has emptied', () => {
    renderBar({
      value: sel({ tags: 'missingRequired' }),
      tally: tally({ missingRequired: 0 }),
      onReviewIncomplete: vi.fn(),
    })
    expect(screen.getByTestId('review-incomplete')).toBeInTheDocument()
  })

  it('offers the review only on that filter and with a review to open', () => {
    const onReviewIncomplete = vi.fn()
    renderBar({
      value: sel({ tags: 'noCover' }),
      tally: tally({ missingRequired: 4 }),
      onReviewIncomplete,
    })
    expect(screen.queryByTestId('review-incomplete')).toBeNull()
    cleanup()

    cleanup()
    renderBar({ value: sel({ tags: 'missingRequired' }), tally: tally({ missingRequired: 4 }) })
    expect(screen.queryByTestId('review-incomplete')).toBeNull()
  })
})

describe('ActiveFilters', () => {
  function renderStrip(value: FilterSelection) {
    const onChange = vi.fn()
    render(<ActiveFilters value={value} onChange={onChange} librarySource="engineDj" />)
    return { onChange }
  }

  // With two or more filters on, the trigger only says "Filters 23": this row is where the
  // user reads which ones are on, without opening the menu.
  it('names every filter in use once two are on, in the menu’s order', () => {
    renderStrip(
      sel({ format: 'WAV', quality: 'good', library: 'notInLibrary', listen: 'unplayed' }),
    )
    const chips = screen.getAllByRole('listitem')
    expect(chips.map((c) => c.textContent)).toEqual(['Good', 'Not in Engine DJ', 'Unplayed', 'WAV'])
  })

  // One filter already reads on the trigger itself; a second line repeating it would only
  // push the list down.
  it('stays out of the way while one filter or none is on', () => {
    renderStrip(sel({ quality: 'good' }))
    expect(screen.queryByTestId('active-filters')).toBeNull()
    cleanup()
    renderStrip(sel())
    expect(screen.queryByTestId('active-filters')).toBeNull()
  })

  it('drops one filter from its ✕ and keeps the rest', () => {
    const { onChange } = renderStrip(sel({ quality: 'good', tags: 'noCover' }))
    const remove = screen.getByTestId('active-filter-tags-remove')
    expect(remove).toHaveAccessibleName('Remove No artwork')
    fireEvent.click(remove)
    expect(onChange).toHaveBeenCalledWith(sel({ quality: 'good' }))
  })
})

describe('QualityFilterBar search', () => {
  const type = (text: string): void => {
    for (const key of text) fireEvent.keyDown(document.activeElement as Element, { key })
  }

  // Whoever knows the filter's name should not have to know which section it lives in.
  it('finds a filter from any section by typing its name, ignoring case', () => {
    renderBar({ tally: tally({ noCover: 3, smallCover: 2, unconverted: 4 }) })
    openMenu()
    type('ARTW')
    const shown = screen.getAllByRole('option').map((el) => el.getAttribute('data-testid'))
    expect(shown).toEqual(['quality-filter-noCover', 'quality-filter-smallCover'])
    expect(screen.getByRole('group', { name: 'Tags' })).toContainElement(
      screen.getByTestId('quality-filter-noCover'),
    )
    expect(screen.getByTestId('quality-filter-search')).toHaveTextContent('Filters matching “ARTW”')
  })

  it('lands on the first match, so Enter or a click picks it', () => {
    const { onChange } = renderBar({ tally: tally({ clipping: 2 }) })
    openMenu()
    type('clip')
    const clipping = screen.getByTestId('quality-filter-clipping')
    expect(clipping).toHaveFocus()
    fireEvent.click(clipping)
    expect(onChange).toHaveBeenCalledWith(sel({ attention: 'clipping' }))
  })

  it('lists a whole section when its name is what was typed', () => {
    renderBar({
      formats: [
        { format: 'FLAC', count: 2 },
        { format: 'WAV', count: 3 },
      ],
    })
    openMenu()
    type('form')
    expect(screen.getAllByRole('option').map((el) => el.textContent)).toEqual(['FLAC2', 'WAV3'])
  })

  // With nothing left to focus the keys must still stay in the menu; landing on the page
  // they would move the track selection behind it.
  it('says nothing matches and keeps the keys in the menu', () => {
    const onWindowKey = vi.fn()
    renderBar()
    openMenu()
    type('zzq')
    expect(screen.getByTestId('quality-filter-empty')).toHaveTextContent('No filter matches “zzq”')
    window.addEventListener('keydown', onWindowKey)
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    window.removeEventListener('keydown', onWindowKey)
    expect(onWindowKey).not.toHaveBeenCalled()
  })

  it('edits the search with Backspace', () => {
    renderBar({ tally: tally({ clipping: 2 }) })
    openMenu()
    type('clipx')
    fireEvent.keyDown(document.activeElement as Element, { key: 'Backspace' })
    expect(screen.getByTestId('quality-filter-clipping')).toBeInTheDocument()
  })

  it('drops the search on Escape before closing the menu on the next one', () => {
    renderBar({ tally: tally({ unconverted: 2 }) })
    openMenu('status')
    type('clip')
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(screen.queryByTestId('quality-filter-search')).toBeNull()
    expect(screen.getByTestId('quality-filter-unconverted')).toBeInTheDocument()
    expect(screen.getByTestId('quality-filter-section-status')).toHaveFocus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(screen.queryByTestId('quality-filter-menu')).toBeNull()
  })

  it('ends the search when a section is picked', () => {
    renderBar({ tally: tally({ good: 2 }) })
    openMenu()
    type('clip')
    fireEvent.click(screen.getByTestId('quality-filter-section-quality'))
    expect(screen.queryByTestId('quality-filter-search')).toBeNull()
    expect(screen.getByTestId('quality-filter-good')).toBeInTheDocument()
  })

  // A shortcut held with ⌘ belongs to the app, not to the search.
  it('leaves keys held with a modifier alone', () => {
    renderBar()
    openMenu()
    fireEvent.keyDown(document.activeElement as Element, { key: 'k', metaKey: true })
    expect(screen.queryByTestId('quality-filter-search')).toBeNull()
  })
})
