// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { Toolbar } from './Toolbar'

afterEach(cleanup)

type Props = React.ComponentProps<typeof Toolbar>

function renderBar(over: Partial<Props> = {}): Props {
  const props: Props = {
    isMac: true,
    hintFor: () => '',
    trackCount: 3,
    focusPreset: 'balanced',
    onFocusPreset: vi.fn(),
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
  it('shows the batch progress pill while converting and cancels on click', () => {
    const props = renderBar({ batching: true, batchProgress: { done: 3, total: 12 } })
    const pill = screen.getByTestId('batch-progress')
    expect(pill).toHaveTextContent('3/12')
    fireEvent.click(pill)
    expect(props.onCancelBatch).toHaveBeenCalledOnce()
  })

  it('hides the batch pill when no batch is running', () => {
    renderBar({ batchProgress: { done: 5, total: 5 } })
    expect(screen.queryByTestId('batch-progress')).toBeNull()
  })

  // A big drop used to be an opaque wait; the counter is the import's only progress
  // surface, so it must reflect the exact done/total the library reports.
  it('shows the metadata-read progress while importing', () => {
    renderBar({ importing: { done: 212, total: 319 } })
    expect(screen.getByTestId('import-progress')).toHaveTextContent('212/319')
  })

  // A focus preset reparks both columns in one click — the reason the control exists over
  // dragging two dividers. Clicking a segment must fire with that segment's id.
  it('applies the clicked focus preset', () => {
    const props = renderBar()
    fireEvent.click(screen.getByTestId('focus-preset-edit'))
    expect(props.onFocusPreset).toHaveBeenCalledWith('edit')
  })

  // The active preset is lit (aria-pressed) so the user can see which layout they're in;
  // the others stay unpressed. A drag off every preset (focusPreset null) lights none.
  it('marks only the active preset, and none once dragged off', () => {
    renderBar({ focusPreset: 'match' })
    expect(screen.getByTestId('focus-preset-match')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('focus-preset-edit')).toHaveAttribute('aria-pressed', 'false')
    cleanup()
    renderBar({ focusPreset: null })
    expect(screen.getByTestId('focus-preset-balanced')).toHaveAttribute('aria-pressed', 'false')
  })

  // The presets act on the results and editor columns, which don't exist until the crate
  // has tracks — an empty list hides the whole control.
  it('hides the focus presets when the list is empty', () => {
    renderBar({ trackCount: 0 })
    expect(screen.queryByTestId('focus-presets')).toBeNull()
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
