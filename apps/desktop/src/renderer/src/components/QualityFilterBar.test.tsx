// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_FILTER, type FilterSelection, type qualityCounts } from '../lib/triage'
import '../i18n'
import { createRef } from 'react'
import { QualityFilterBar } from './QualityFilterBar'

afterEach(cleanup)

type Tally = ReturnType<typeof qualityCounts>
const tally = (over: Partial<Tally> = {}): Tally => ({
  suspect: 0,
  good: 0,
  unanalyzed: 0,
  unconverted: 0,
  automatched: 0,
  matchedDiscogs: 0,
  matchedBandcamp: 0,
  silence: 0,
  clipping: 0,
  inLibrary: 0,
  notInLibrary: 0,
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
      tally={tally()}
      formats={[]}
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

describe('QualityFilterBar', () => {
  // A sweep over a mixed crate fills rows from two catalogs; the per-provider buckets
  // let each source be reviewed on its own (a Bandcamp match carries no Discogs id or
  // catalog number). They join the menu only once a match from that catalog exists, so
  // a Discogs-only user never sees a permanently-empty Bandcamp row.
  it('lists a per-provider match bucket only once that catalog has matched something', () => {
    renderBar({ tally: tally({ automatched: 3, matchedDiscogs: 2, matchedBandcamp: 1 }) })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.getByTestId('quality-filter-matchedDiscogs')).toBeInTheDocument()
    expect(screen.getByTestId('quality-filter-matchedBandcamp')).toBeInTheDocument()
  })

  it('hides the per-provider buckets while nothing has matched from them', () => {
    renderBar({ tally: tally({ automatched: 3 }) })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.queryByTestId('quality-filter-matchedDiscogs')).toBeNull()
    expect(screen.queryByTestId('quality-filter-matchedBandcamp')).toBeNull()
  })

  // djotas's retouch buckets: while editing the collection, isolate the tracks with
  // work left — silence still to trim, or true clipping. Each row appears only once
  // a decoded wave actually put a track in it, and picking one filters its own axis.
  it('lists the retouch buckets once their facts exist and filters the attention axis', () => {
    const { onChange } = renderBar({ tally: tally({ silence: 4, clipping: 2 }) })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.getByTestId('quality-filter-silence')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('quality-filter-silence'))
    expect(onChange).toHaveBeenCalledWith(sel({ attention: 'silence' }))
  })

  it('hides a retouch bucket while no decoded wave has filled it', () => {
    renderBar({ tally: tally({ clipping: 2 }) })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.queryByTestId('quality-filter-silence')).toBeNull()
    expect(screen.getByTestId('quality-filter-clipping')).toBeInTheDocument()
  })

  it('picking a provider bucket filters the conversion axis', () => {
    const { onChange } = renderBar({ tally: tally({ matchedDiscogs: 2 }) })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-matchedDiscogs'))
    expect(onChange).toHaveBeenCalledWith(sel({ conversion: 'matchedDiscogs' }))
  })

  // The whole reason for the dropdown: a wide crate's chips overflowed the narrow
  // sidebar, so the filters collapse into one control that can't run out of width.
  it('collapses the filters into a single trigger that opens the bucket list on click', () => {
    renderBar()
    // The buckets aren't in the DOM until the menu opens — that's what keeps the bar
    // one fixed-width control no matter how many filters or how large the counts.
    expect(screen.queryByTestId('quality-filter-unconverted')).toBeNull()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.getByTestId('quality-filter-unconverted')).toBeInTheDocument()
  })

  // A pick toggles its axis and closes the menu like a native select — the common
  // single-filter case shouldn't need a click outside to dismiss the popover.
  it('reports a bucket pick on its axis and closes the menu', () => {
    const { onChange } = renderBar({ tally: tally({ unconverted: 459 }) })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-unconverted'))
    expect(onChange).toHaveBeenCalledWith(sel({ conversion: 'unconverted' }))
    expect(screen.queryByTestId('quality-filter-listbox')).toBeNull()
  })

  // The point of the split: picking a second section's bucket (after reopening) must NOT
  // replace the first — it layers, so the callback carries both choices.
  it('stacks a second axis onto an existing selection instead of replacing it', () => {
    const { onChange } = renderBar({
      value: sel({ quality: 'good' }),
      tally: tally({ good: 11, unconverted: 459 }),
    })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-unconverted'))
    expect(onChange).toHaveBeenCalledWith(sel({ quality: 'good', conversion: 'unconverted' }))
  })

  // Clicking the already-active bucket in a section clears that axis (back to "any") without
  // touching the others.
  it('toggles an active bucket off when picked again', () => {
    const { onChange } = renderBar({ value: sel({ quality: 'good' }), tally: tally({ good: 11 }) })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-good'))
    expect(onChange).toHaveBeenCalledWith(sel())
  })

  // Counts stay the point of the bar — at-a-glance triage — so each menu row carries its own
  // count, and a single active axis surfaces its count on the trigger.
  it('shows the active bucket count on the trigger and every bucket count in the menu', () => {
    renderBar({ value: sel({ conversion: 'unconverted' }), tally: tally({ unconverted: 459 }) })
    expect(screen.getByTestId('quality-filter-trigger')).toHaveTextContent('459')
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.getByTestId('quality-filter-unconverted')).toHaveTextContent('459')
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

  // The Apple Music buckets stay conditional — only listed once the snapshot has a verdict.
  it('lists the library buckets only when they have something to show', () => {
    renderBar()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.queryByTestId('quality-filter-notInLibrary')).toBeNull()
    cleanup()
    renderBar({ tally: tally({ notInLibrary: 459, inLibrary: 2 }) })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.getByTestId('quality-filter-notInLibrary')).toBeInTheDocument()
  })

  // Per-format buckets only appear for a mixed crate, and each carries its own count so a
  // DJ can isolate "just the MP3s" before converting.
  it('lists a per-format bucket for each source format present, with its count', () => {
    renderBar({
      formats: [
        { format: 'FLAC', count: 12 },
        { format: 'MP3', count: 27 },
      ],
    })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.getByTestId('quality-filter-ext:MP3')).toHaveTextContent('MP3')
    expect(screen.getByTestId('quality-filter-ext:MP3')).toHaveTextContent('27')
    expect(screen.getByTestId('quality-filter-ext:FLAC')).toHaveTextContent('12')
  })

  // Format is its own axis: picking it reports a selection with format set and closes the
  // menu like any other bucket.
  it('reports a format pick on the format axis and closes the menu', () => {
    const { onChange } = renderBar({ formats: [{ format: 'WAV', count: 3 }] })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:WAV'))
    expect(onChange).toHaveBeenCalledWith(sel({ format: 'WAV' }))
    expect(screen.queryByTestId('quality-filter-listbox')).toBeNull()
  })

  it('toggles the active format off when picked again', () => {
    const { onChange } = renderBar({
      formats: [{ format: 'WAV', count: 3 }],
      value: sel({ format: 'WAV' }),
    })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
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
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.getByTestId('quality-filter-good')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('quality-filter-ext:WAV')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('quality-filter-ext:FLAC')).toHaveAttribute('aria-selected', 'false')
  })

  // "All" means "no filter at all", so any live axis must visibly clear its tick — otherwise
  // it reads as "everything AND only WAV", which is a contradiction.
  it('shows All unchecked once a format is selected', () => {
    renderBar({ value: sel({ format: 'WAV' }), formats: [{ format: 'WAV', count: 5 }] })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.getByTestId('quality-filter-all')).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByTestId('quality-filter-ext:WAV')).toHaveAttribute('aria-selected', 'true')
  })

  it('clears every axis when All is picked', () => {
    const { onChange } = renderBar({
      value: sel({ quality: 'good', format: 'WAV' }),
      formats: [{ format: 'WAV', count: 5 }],
    })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-all'))
    expect(onChange).toHaveBeenCalledWith(sel())
  })

  // With only a format active the trigger surfaces it (the single-axis case), so a closed
  // menu still shows that WAV is filtering rather than a bare "All".
  it('surfaces the active format on the trigger when it is the only axis', () => {
    renderBar({ value: sel({ format: 'WAV' }), formats: [{ format: 'WAV', count: 5 }] })
    const trigger = screen.getByTestId('quality-filter-trigger')
    expect(trigger).toHaveTextContent('WAV')
    expect(trigger).toHaveTextContent('5')
  })

  // "Unconverted" is the primary call to action (the whole backlog still to convert), so it
  // sits right under "All", ahead of the format and quality groups, rather than trailing the
  // menu where it was easy to miss.
  it('lists the conversion bucket directly under All, before the format and quality groups', () => {
    renderBar({
      tally: tally({ good: 3, unconverted: 288 }),
      formats: [
        { format: 'FLAC', count: 5 },
        { format: 'WAV', count: 5 },
      ],
    })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    const order = screen.getAllByRole('option').map((el) => el.getAttribute('data-testid'))
    expect(order.slice(0, 2)).toEqual(['quality-filter-all', 'quality-filter-unconverted'])
    expect(order.indexOf('quality-filter-unconverted')).toBeLessThan(
      order.indexOf('quality-filter-ext:FLAC'),
    )
    expect(order.indexOf('quality-filter-unconverted')).toBeLessThan(
      order.indexOf('quality-filter-good'),
    )
  })

  // The buckets span several dimensions (quality, conversion, library, format); a divider
  // between each group keeps the now-long menu scannable instead of one flat run. The
  // dividers track the groups that actually show, so an extra dimension adds exactly one.
  it('separates the bucket groups with a divider, one per gap between shown groups', () => {
    // Bare crate: All | conversion | quality → three groups, two dividers.
    renderBar()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.getAllByTestId('quality-filter-separator')).toHaveLength(2)
    cleanup()
    // Add the library and format dimensions → five groups, four dividers.
    renderBar({
      tally: tally({ notInLibrary: 6, inLibrary: 4 }),
      formats: [
        { format: 'FLAC', count: 5 },
        { format: 'WAV', count: 5 },
      ],
    })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.getAllByTestId('quality-filter-separator')).toHaveLength(4)
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

  // During a multi-select the size of the selection is what the DJ cares about, so the
  // counter shows "N selected" in place of the single-track position/reveal control.
  it('shows the selection size instead of the position when multiple are selected', () => {
    renderBar({ selectedCount: 3, selectedPosition: 2, visibleCount: 498 })
    expect(screen.getByTestId('track-selected-count')).toHaveTextContent('3 selected')
    expect(screen.queryByTestId('track-position')).toBeNull()
  })

  // The payoff of the quality sweep at the exact moment the DJ is looking at it: once they've
  // filtered to the suspect bucket, a one-click "trash them all" sits right there in the bar,
  // so acting on the fakes doesn't mean opening ⌘K or the row menu one file at a time.
  it('offers a trash-suspects button only while the suspect filter is active and holds fakes', () => {
    const onTrashSuspects = vi.fn()
    renderBar({ value: sel({ quality: 'suspect' }), tally: tally({ suspect: 13 }), onTrashSuspects })
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
})
