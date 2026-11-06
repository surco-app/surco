// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { EMPTY_FILTER, type FilterSelection, type qualityCounts } from '../lib/triage'
import { hoverTooltip } from '../test/tooltip'
import { SECTION_HOVER_DELAY } from './FilterBar'
import { ModalShell } from './ModalShell'
import { QualityFilterBar } from './QualityFilterBar'

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
  // are fixed, always in this order, so where a filter lives never changes.
  it('lists the same sections in the same order whatever the crate holds', () => {
    const order = (): (string | null)[] =>
      screen.getAllByRole('tab').map((el) => el.getAttribute('data-testid'))
    const expected = [
      'status',
      'quality',
      'tags',
      'match',
      'attention',
      'library',
      'format',
      'duplicates',
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
    for (const key of ['status', 'quality', 'tags', 'match', 'attention', 'format']) {
      expect(screen.getByTestId(`quality-filter-section-${key}`)).toHaveTextContent(
        i18n.t(`sidebar.filter.section.${key}`),
      )
    }
    expect(screen.getByTestId('quality-filter-section-library')).toHaveTextContent('Apple Music')
    expect(screen.getByTestId('quality-filter-section-duplicates')).toHaveTextContent('Duplicates')
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
    openMenu()
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
      openMenu()
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
    expect(screen.getByTestId('quality-filter-section-status')).toHaveFocus()
  })

  it('walks the sections with the arrows, steps into the filters with → and back with ←', () => {
    renderBar({ tally: tally({ good: 2, suspect: 1 }) })
    openMenu()
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    const quality = screen.getByTestId('quality-filter-section-quality')
    expect(quality).toHaveFocus()
    expect(quality).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(quality, { key: 'ArrowRight' })
    expect(screen.getByTestId('quality-filter-unanalyzed')).toHaveFocus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    expect(screen.getByTestId('quality-filter-suspect')).toHaveFocus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' })
    expect(quality).toHaveFocus()
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
      gridMeasure: { offered: true, done: 0, total: 0 },
    })
    openMenu('attention')
    fireEvent.click(screen.getByTestId('quality-filter-badGrid'))
    expect(onChange).toHaveBeenCalledWith(sel({ attention: 'badGrid' }))
  })

  it('says how far the measuring got beside the bad-grid filter, with the amber nudge once some are found', () => {
    renderBar({
      tally: tally({ badGrid: 3 }),
      gridMeasure: { offered: true, done: 344, total: 2077 },
    })
    openMenu('attention')
    const option = screen.getByTestId('quality-filter-badGrid')
    expect(option).toHaveTextContent(/^Bad grid16 %3$/)
    expect(hoverTooltip(screen.getByTestId('quality-filter-badGrid-progress'))).toEqual(
      'Measuring 344 of 2077',
    )
    expect(screen.getByTestId('quality-filter-badGrid-dot')).toBeInTheDocument()
  })

  it('offers the better-than-the-library filter among the library buckets, since picking it is what starts the measuring', () => {
    const { onChange } = renderBar({
      tally: tally({ inLibrary: 4 }),
      libraryMeasure: { offered: true, done: 0, total: 4 },
    })
    openMenu('library')
    fireEvent.click(screen.getByTestId('quality-filter-betterThanLibrary'))
    expect(onChange).toHaveBeenCalledWith(sel({ library: 'betterThanLibrary' }))
  })

  it('says how far the comparison with the library got beside its filter', () => {
    renderBar({
      tally: tally({ inLibrary: 40, betterThanLibrary: 3 }),
      libraryMeasure: { offered: true, done: 10, total: 40 },
    })
    openMenu('library')
    expect(screen.getByTestId('quality-filter-betterThanLibrary')).toHaveTextContent(
      /^Better than Music25 %3$/,
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
    expect(screen.queryByTestId('quality-filter-unconverted')).toBeNull()
    openMenu()
    expect(screen.getByTestId('quality-filter-unconverted')).toBeInTheDocument()
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
    openMenu()
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
