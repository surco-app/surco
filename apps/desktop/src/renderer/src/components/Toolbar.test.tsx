// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { Toolbar } from './Toolbar'

afterEach(cleanup)

type Props = React.ComponentProps<typeof Toolbar>

function renderBar(over: Partial<Props> = {}): Props {
  const props: Props = {
    isMac: true,
    hintFor: () => '',
    trackCount: 3,
    convertibleCount: 3,
    canConvertAll: true,
    onConvertAll: vi.fn(),
    importing: null,
    batchSummary: null,
    batching: false,
    analysis: null,
    allAnalyzed: false,
    batchProgress: { done: 0, total: 0 },
    matching: null,
    hasToken: true,
    needsToken: false,
    autoMatchable: 2,
    onAnalyzeAll: vi.fn(),
    onFixToken: vi.fn(),
    onCancelAnalyze: vi.fn(),
    onAutoMatch: vi.fn(),
    onCancelAutoMatch: vi.fn(),
    onCancelBatch: vi.fn(),
    onCancelImport: vi.fn(),
    onPalette: vi.fn(),
    onStats: vi.fn(),
    onActivity: vi.fn(),
    activityRunning: false,
    onSettings: vi.fn(),
    ...over,
  }
  render(<Toolbar {...props} />)
  return props
}

describe('Toolbar', () => {
  // The two sweep buttons flip meaning mid-run: the same control must start the sweep
  // when idle and cancel it while running, or a misfired 500-track sweep could not be
  // stopped from where it was started.
  it('starts the analyze sweep when idle and cancels it while running', () => {
    const idle = renderBar()
    fireEvent.click(screen.getByTestId('analyze-quality'))
    expect(idle.onAnalyzeAll).toHaveBeenCalledOnce()
    cleanup()

    const running = renderBar({ analysis: { done: 2, total: 10 } })
    expect(screen.getByTestId('analyze-progress')).toHaveTextContent('2/10')
    fireEvent.click(screen.getByTestId('analyze-quality'))
    expect(running.onCancelAnalyze).toHaveBeenCalledOnce()
    expect(running.onAnalyzeAll).not.toHaveBeenCalled()
  })

  it('starts the auto-match sweep when idle and cancels it while running', () => {
    const idle = renderBar()
    fireEvent.click(screen.getByTestId('auto-match'))
    expect(idle.onAutoMatch).toHaveBeenCalledOnce()
    cleanup()

    const running = renderBar({ matching: { done: 1, total: 4 } })
    fireEvent.click(screen.getByTestId('auto-match'))
    expect(running.onCancelAutoMatch).toHaveBeenCalledOnce()
  })

  // A sweep with nothing to do must not be startable: no token means Discogs can't be
  // queried at all, and an all-analyzed list has nothing left to measure.
  it('disables the sweeps when they have nothing to work on', () => {
    renderBar({ hasToken: false, allAnalyzed: true })
    expect(screen.getByTestId('auto-match')).toBeDisabled()
    expect(screen.getByTestId('analyze-quality')).toBeDisabled()
  })

  // Auto-match on but no usable token is a silent dead end: the sweep can't run and the
  // only hint was a tooltip on a greyed-out button. Surface it as a live "add a token"
  // affordance that isn't disabled and takes the user straight to where they fix it.
  it('offers a clickable fix when auto-match is on but the token is missing', () => {
    const props = renderBar({ needsToken: true, hasToken: false })
    const button = screen.getByTestId('auto-match')
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(props.onFixToken).toHaveBeenCalledOnce()
    // It must not misfire the sweep it can't run.
    expect(props.onAutoMatch).not.toHaveBeenCalled()
  })

  // A misfired Convert all used to be unstoppable from anywhere in the UI. The batch
  // pill is the conversion's counterpart of the sweep buttons: visible only while a
  // batch runs, naming its done/total, and clicking it cancels — queued tracks bail,
  // the ones already converting finish.
  // The run's progress lives on the convert button itself now, not a pill beside it — see
  // the convert-all cases below, which cover the same counter and cancel.
  it('shows the count on the convert button while a run is going', () => {
    renderBar({ batching: true, batchProgress: { done: 3, total: 12 } })
    expect(screen.getByTestId('convert-all')).toHaveTextContent('3/12')
  })

  // A big drop used to be an opaque wait; the counter is the import's only progress
  // surface, so it must reflect the exact done/total the library reports.
  it('shows the metadata-read progress while importing', () => {
    renderBar({ importing: { done: 212, total: 319 } })
    expect(screen.getByTestId('import-progress')).toHaveTextContent('212/319')
  })

  // Importing is the longest operation in the app — thousands of files on a NAS — and
  // was the only sweep with no way out: the other three pills cancel on click and this
  // one was an inert span, so a wrong folder meant waiting it out.
  it('cancels the import when its pill is clicked', () => {
    const props = renderBar({ importing: { done: 212, total: 319 } })
    fireEvent.click(screen.getByTestId('import-progress'))
    expect(props.onCancelImport).toHaveBeenCalledOnce()
  })

  // The other three counters were visible-only: without sight, a 500-track run is
  // silence between the click and the final toast. Each live counter is a named status
  // region — the exact pattern the import pill already had — so a screen reader hears
  // the sweep advance.
  it('announces the batch, auto-match and analyze progress as status regions', () => {
    renderBar({
      batching: true,
      batchProgress: { done: 3, total: 12 },
      matching: { done: 1, total: 4 },
      analysis: { done: 2, total: 10 },
    })
    for (const name of [
      i18n.t('header.convertingCount', { done: 3, total: 12 }),
      i18n.t('header.autoMatchingCount', { done: 1, total: 4 }),
      i18n.t('header.analyzingCount', { done: 2, total: 10 }),
    ]) {
      expect(screen.getByRole('status', { name })).toBeInTheDocument()
    }
  })

  // Converting the whole list is what Surco is for, and it had no button anywhere: only a
  // shortcut and a palette entry. The toolbar carried the two sweeps that PREPARE the work
  // (match, analyze) and nothing that runs it.
  it('converts the whole list', () => {
    const props = renderBar()
    fireEvent.click(screen.getByTestId('convert-all'))
    expect(props.onConvertAll).toHaveBeenCalled()
  })

  // The editor footer carries its own "Convert to AIFF" for the open track. Seen together
  // on one screen the two read as the same action, so this one names its scope: the count
  // is what says "the list", not "this track".
  it('names how many tracks it would convert', () => {
    renderBar({ convertibleCount: 12 })
    expect(screen.getByTestId('convert-all')).toHaveTextContent('12')
  })

  // On a one-track crate "convert them all" and the editor footer's "Convert to AIFF" are
  // the same click, and no wording can tell them apart — so the header stays out of the way
  // and lets the footer, which names the format, own it.
  it('stays away on a single-track crate', () => {
    renderBar({ trackCount: 1, convertibleCount: 1 })
    expect(screen.queryByTestId('convert-all')).toBeNull()
  })

  // Same shape as the sweeps beside it: the control that shows a run is the one that stops
  // it, so a misfired convert-all doesn't have to be waited out.
  it('cancels the run from the same button', () => {
    const props = renderBar({ batching: true, batchProgress: { done: 12, total: 40 } })
    fireEvent.click(screen.getByTestId('convert-all'))
    expect(props.onCancelBatch).toHaveBeenCalled()
    expect(props.onConvertAll).not.toHaveBeenCalled()
  })

  // The count has to reach a screen reader as one label; the digits alone are silent. And
  // exactly once: this button replaced a separate progress pill that announced the same
  // run, which would have read the count out twice.
  it('announces how far the run has got, once', () => {
    renderBar({ batching: true, batchProgress: { done: 12, total: 40 } })
    const name = i18n.t('header.convertingCount', { done: 12, total: 40 })
    expect(screen.getAllByRole('status', { name })).toHaveLength(1)
  })

  // Nothing eligible (every track converted, or a run already going) leaves the button
  // visible but dead, like the sweeps — not hidden, which would make it hard to find again.
  it('disables itself when there is nothing to convert', () => {
    renderBar({ canConvertAll: false })
    expect(screen.getByTestId('convert-all')).toBeDisabled()
  })

  // It acts on the list, which doesn't exist until the crate has tracks.
  it('hides the convert button when the list is empty', () => {
    renderBar({ trackCount: 0 })
    expect(screen.queryByTestId('convert-all')).toBeNull()
  })

  // The dot is the only always-visible signal that background work is running while
  // the activity panel is closed.
  it('marks the activity button while background work runs', () => {
    renderBar({ activityRunning: true })
    expect(screen.getByTestId('open-activity').querySelector('.bg-good')).not.toBeNull()
    cleanup()
    renderBar()
    expect(screen.getByTestId('open-activity').querySelector('.bg-good')).toBeNull()
  })
})
