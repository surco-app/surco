// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { qualityCounts } from '../lib/triage'
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
  inLibrary: 0,
  notInLibrary: 0,
  ...over,
})

function renderBar(over: Partial<Parameters<typeof QualityFilterBar>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <QualityFilterBar
      filterRef={createRef()}
      value="all"
      onChange={onChange}
      tally={tally()}
      formats={[]}
      trackCount={498}
      visibleCount={498}
      selectedPosition={null}
      {...over}
    />,
  )
  return { onChange }
}

describe('QualityFilterBar', () => {
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

  it('picks a bucket from the menu and closes', () => {
    const { onChange } = renderBar({ tally: tally({ unconverted: 459 }) })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-unconverted'))
    expect(onChange).toHaveBeenCalledWith('unconverted')
    expect(screen.queryByTestId('quality-filter-unconverted')).toBeNull()
  })

  // Counts stay the point of the bar — at-a-glance triage — so the trigger carries the
  // active bucket's count and each menu row its own.
  it('shows the active bucket count on the trigger and every bucket count in the menu', () => {
    renderBar({ value: 'all', trackCount: 498, tally: tally({ unconverted: 459 }) })
    expect(screen.getByTestId('quality-filter-trigger')).toHaveTextContent('498')
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.getByTestId('quality-filter-unconverted')).toHaveTextContent('459')
  })

  // The Apple Music buckets stay conditional — only listed once the snapshot has a verdict.
  it('lists the library buckets only when they have something to show', () => {
    const { onChange } = renderBar()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.queryByTestId('quality-filter-notInLibrary')).toBeNull()
    cleanup()
    onChange.mockClear()
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

  it('selects a per-format bucket by its ext: value', () => {
    const { onChange } = renderBar({ formats: [{ format: 'WAV', count: 3 }] })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:WAV'))
    expect(onChange).toHaveBeenCalledWith('ext:WAV')
  })

  // The x/total position indicator the user relies on must stay visible beside the
  // collapsed control, not fold away into a chip that no longer exists.
  it('keeps the x/total position counter visible next to the dropdown', () => {
    renderBar({ selectedPosition: 250, visibleCount: 498 })
    expect(screen.getByTestId('track-position')).toHaveTextContent('250/498')
  })

  // The counter must stay visible even when the selected track is filtered out of the
  // current bucket: the user relies on it to know how many tracks are left to go through,
  // so it falls back to "–/total" rather than disappearing.
  it('still shows the total (–/total) when no selected track is in the current view', () => {
    renderBar({ selectedPosition: null, visibleCount: 4 })
    expect(screen.getByTestId('track-position')).toHaveTextContent('–/4')
  })

  it('hides the counter only when there are no tracks in view at all', () => {
    renderBar({ selectedPosition: null, visibleCount: 0 })
    expect(screen.queryByTestId('track-position')).toBeNull()
  })
})
