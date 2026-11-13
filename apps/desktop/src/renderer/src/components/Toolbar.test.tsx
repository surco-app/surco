// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { Toolbar } from './Toolbar'

afterEach(cleanup)

type Props = React.ComponentProps<typeof Toolbar>

function renderBar(over: Partial<Props> = {}): Props {
  const props: Props = {
    hintFor: () => '',
    trackCount: 3,
    importing: null,
    batchSummary: null,
    onShowFailed: vi.fn(),
    onShowSkipped: vi.fn(),
    batching: false,
    analysis: null,
    analysisSlowed: false,
    allAnalyzed: false,
    batchProgress: { done: 0, total: 0 },
    matching: null,
    canAutoMatch: true,
    needsToken: false,
    tokenMissing: false,
    autoMatchable: 2,
    onAnalyzeAll: vi.fn(),
    onFixToken: vi.fn(),
    onCancelAnalyze: vi.fn(),
    onAutoMatch: vi.fn(),
    onCancelAutoMatch: vi.fn(),
    onCancelImport: vi.fn(),
    onReview: vi.fn(),
    canReview: true,
    onPalette: vi.fn(),
    onStats: vi.fn(),
    onActivity: vi.fn(),
    activityRunning: false,
    onSettings: vi.fn(),
    onHelp: vi.fn(),
    onFeedback: vi.fn(),
    ...over,
  }
  render(<Toolbar {...props} />)
  return props
}

describe('Toolbar', () => {
  it('keeps the list sweeps together above the list, apart from the app controls', () => {
    renderBar({ trackCount: 3 })
    const list = screen.getByTestId('toolbar-list-actions')
    for (const id of ['analyze-quality', 'auto-match', 'toolbar-review']) {
      expect(within(list).getByTestId(id)).toBeInTheDocument()
    }
    for (const id of ['open-palette', 'open-settings', 'open-help']) {
      expect(within(list).queryByTestId(id)).toBeNull()
    }
  })

  it.each([
    ['a list', {}],
    ['one track', { trackCount: 1 }],
    ['a running batch', { batching: true, batchProgress: { done: 3, total: 12 } }],
  ] as [string, Partial<Props>][])(
    'has no convert button over %s, since the editor footer is the one place to convert',
    (_, over) => {
      renderBar(over)
      expect(screen.queryByTestId('convert-all')).toBeNull()
      expect(
        screen.getAllByRole('button').filter((b) => /3\/12/.test(b.textContent ?? '')),
      ).toEqual([])
    },
  )

  // The pill subscribes to the export itself; the toolbar only places it, so a byte tick
  // never re-renders the toolbar.
  it('places the USB export pill it is given', () => {
    renderBar({ usbPill: <span data-testid="pill-slot">USB 7/12</span> })
    expect(screen.getByTestId('pill-slot')).toHaveTextContent('USB 7/12')
  })

  // Another view (the Music review) can own the screen's main action; the convert button
  // would then act on a list the user cannot see.
  it('shows a given main action in place of Convert, even with no tracks', () => {
    renderBar({ trackCount: 0, primary: <button type="button" data-testid="other-action" /> })
    expect(screen.getByTestId('other-action')).toBeInTheDocument()
    expect(screen.queryByTestId('convert-all')).toBeNull()
    cleanup()
    renderBar({ primary: <button type="button" data-testid="other-action" /> })
    expect(screen.getByTestId('other-action')).toBeInTheDocument()
    expect(screen.queryByTestId('convert-all')).toBeNull()
  })

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

  // Mid-run a press cancels, but the name still offered to start the sweep: a screen
  // reader user heard "Analyze quality of all tracks" and stopped a 500-track run.
  it('names the sweep buttons as cancel controls while they run', () => {
    renderBar()
    expect(screen.getByTestId('auto-match')).toHaveAccessibleName(i18n.t('header.autoMatch'))
    expect(screen.getByTestId('analyze-quality')).toHaveAccessibleName(
      i18n.t('header.analyzeQuality'),
    )
    cleanup()
    renderBar({ matching: { done: 1, total: 4 }, analysis: { done: 2, total: 10 } })
    expect(screen.getByTestId('auto-match')).toHaveAccessibleName(i18n.t('header.cancelAutoMatch'))
    expect(screen.getByTestId('analyze-quality')).toHaveAccessibleName(
      i18n.t('header.cancelAnalyze'),
    )
  })

  // A sweep with nothing to do must not be startable: no usable source means nothing can be
  // queried at all, and an all-analyzed list has nothing left to measure.
  it('disables the sweeps when they have nothing to work on', () => {
    renderBar({ canAutoMatch: false, allAnalyzed: true })
    expect(screen.getByTestId('auto-match')).toBeDisabled()
    expect(screen.getByTestId('analyze-quality')).toBeDisabled()
  })

  it('says everything is already analyzed instead of greying Analyze out unexplained', () => {
    renderBar({ allAnalyzed: true })
    const button = screen.getByTestId('analyze-quality')
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleName(i18n.t('header.allAnalyzed'))
    cleanup()
    renderBar({ allAnalyzed: false })
    expect(screen.getByTestId('analyze-quality')).toHaveAccessibleName(
      i18n.t('header.analyzeQuality'),
    )
  })

  // An icon alone did not say what the sparkle did; the word does, in every state.
  it('names auto-match with a visible word', () => {
    renderBar()
    expect(screen.getByTestId('auto-match')).toHaveTextContent(i18n.t('header.autoMatchLabel'))
  })

  it('names the quality sweep with a visible word, like its sibling auto-match', () => {
    renderBar()
    expect(screen.getByTestId('analyze-quality')).toHaveTextContent(
      i18n.t('header.analyzeQualityLabel'),
    )
  })

  // Auto-match on but no usable token is a silent dead end: the sweep can't run and the
  // only hint was a tooltip on a greyed-out button. Surface it as a live "add a token"
  // affordance that isn't disabled and takes the user straight to where they fix it.
  it('offers a clickable fix when auto-match is on but the token is missing', () => {
    const props = renderBar({ needsToken: true, canAutoMatch: false })
    const button = screen.getByTestId('auto-match')
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(props.onFixToken).toHaveBeenCalledOnce()
    // It must not misfire the sweep it can't run.
    expect(props.onAutoMatch).not.toHaveBeenCalled()
  })

  it('says the quality sweep goes slower while a DJ program is open, so a count that ticks slowly is not taken for a hang', () => {
    renderBar({ analysis: { done: 0, total: 4 }, analysisSlowed: true })
    const slowed = i18n.t('header.analyzingSlowed', { done: 0, total: 4 })
    expect(screen.getByRole('status').textContent).toBe(slowed)
    expect(screen.getByTestId('analyze-slowed')).toBeInTheDocument()
    fireEvent.focus(screen.getByTestId('analyze-quality'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(slowed)
  })

  it('keeps the running count while the window is in front', () => {
    renderBar({ analysis: { done: 1, total: 4 }, analysisSlowed: false })
    expect(screen.queryByTestId('analyze-slowed')).toBeNull()
    fireEvent.focus(screen.getByTestId('analyze-quality'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      i18n.t('header.analyzingCount', { done: 1, total: 4 }),
    )
  })

  it('tells the details pass apart from the quality pass, since its count starts over', () => {
    renderBar({ analysis: { done: 1, total: 4, stage: 'details' }, analysisSlowed: false })
    fireEvent.focus(screen.getByTestId('analyze-quality'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      i18n.t('header.analyzingDetails', { done: 1, total: 4 }),
    )
  })

  it('says why Match cannot run without a Discogs token and takes the user to add one', () => {
    const props = renderBar({ tokenMissing: true, canAutoMatch: false })
    const button = screen.getByTestId('auto-match')
    expect(button).not.toBeDisabled()
    expect(button).toHaveAccessibleName(i18n.t('header.autoMatchNoToken'))
    expect(button).toHaveTextContent(i18n.t('header.autoMatchLabel'))
    fireEvent.click(button)
    expect(props.onFixToken).toHaveBeenCalledOnce()
    expect(props.onAutoMatch).not.toHaveBeenCalled()
  })

  // A big drop used to be an opaque wait; the counter is the import's only progress
  // surface, so it must reflect the exact done/total the library reports.
  it('shows the metadata-read progress while importing', () => {
    renderBar({ importing: { done: 212, total: 319 } })
    expect(screen.getByTestId('import-progress')).toHaveTextContent('212/319')
  })

  // The bar is pinned to the trailing edge, so a counter gaining a digit (9 → 10, 999 →
  // 1000) pushed every icon to its left sideways mid-run. Each counter holds the width of
  // the widest value it can reach, so the bar stays still while the numbers tick.
  it('reserves every counter the width of its final value so the bar holds still', () => {
    renderBar({
      importing: { done: 7, total: 1642 },
      matching: { done: 3, total: 266 },
      analysis: { done: 31, total: 200 },
    })
    expect(screen.getByTestId('import-progress-sizer')).toHaveTextContent(
      i18n.t('header.importingCount', { done: 1642, total: 1642 }),
    )
    expect(screen.getByTestId('auto-match-progress-sizer')).toHaveTextContent('266/266')
    expect(screen.getByTestId('analyze-progress-sizer')).toHaveTextContent('200/200')
  })

  // Importing is the longest operation in the app — thousands of files on a NAS — and
  // was the only sweep with no way out: the other three pills cancel on click and this
  // one was an inert span, so a wrong folder meant waiting it out.
  it('cancels the import when its pill is clicked', () => {
    const props = renderBar({ importing: { done: 212, total: 319 } })
    fireEvent.click(screen.getByTestId('import-progress'))
    expect(props.onCancelImport).toHaveBeenCalledOnce()
  })

  // The counters were visible-only: without sight, a 500-track run is silence between the
  // click and the final toast. Each sweep speaks its count through a status region. The
  // region sits outside the buttons (a button flattens what it holds into its own name,
  // which here is the cancel action) and is mounted empty from the start: a live region
  // born together with its text is often never announced. One region carries the four
  // counters, so a reader walking the header meets one empty status, not four.
  it('announces every sweep through one persistent status region outside the buttons', () => {
    const region = (): HTMLElement => screen.getByRole('status')
    renderBar()
    expect(region()).toHaveTextContent('')
    expect(region().closest('button')).toBeNull()
    cleanup()
    renderBar({
      batching: true,
      batchProgress: { done: 3, total: 12 },
      importing: { done: 5, total: 9 },
      matching: { done: 1, total: 4 },
      analysis: { done: 2, total: 10 },
    })
    expect([...region().children].map((r) => r.textContent)).toEqual([
      i18n.t('header.convertingCount', { done: 3, total: 12 }),
      i18n.t('header.importingCount', { done: 5, total: 9 }),
      i18n.t('header.autoMatchingCount', { done: 1, total: 4 }),
      i18n.t('header.analyzingCount', { done: 2, total: 10 }),
    ])
  })

  it('announces how far the run has got, once', () => {
    renderBar({ batching: true, batchProgress: { done: 12, total: 40 } })
    const name = i18n.t('header.convertingCount', { done: 12, total: 40 })
    expect(screen.getByRole('status').textContent).toBe(name)
  })

  // The three sweeps read in the order the work happens: judge the files, fill their tags,
  // then fix what is still wrong. Review used to sit two levels down in the list's menu,
  // the least visible of the three although it is where every fix ends up.
  it('lays the sweeps out as analyze, then auto-match, then review', () => {
    renderBar()
    const analyze = screen.getByTestId('analyze-quality')
    const match = screen.getByTestId('auto-match')
    const review = screen.getByTestId('toolbar-review')
    expect(analyze.compareDocumentPosition(match) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(match.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens the review from the bar, and greys it while there is nothing it may review', () => {
    const props = renderBar()
    const review = screen.getByTestId('toolbar-review')
    expect(review).toHaveAccessibleName(i18n.t('header.menu.review'))
    expect(review).toHaveTextContent(i18n.t('header.reviewLabel'))
    fireEvent.click(review)
    expect(props.onReview).toHaveBeenCalledOnce()
    cleanup()
    renderBar({ canReview: false })
    expect(screen.getByTestId('toolbar-review')).toBeDisabled()
  })

  // A bare magnifier read as "search", with the list's own search field right below it;
  // naming it and showing its chord tells it apart and teaches the shortcut.
  it('names the palette in words and shows its chord, so it is not taken for the list search', () => {
    renderBar({ hintFor: (id) => (id === 'palette' ? '⌘K' : '') })
    const palette = screen.getByTestId('open-palette')
    expect(palette).toHaveAccessibleName(i18n.t('header.palette'))
    expect(palette).toHaveTextContent(i18n.t('header.paletteLabel'))
    expect(palette).toHaveTextContent('⌘K')
  })

  // The chord already shows ⌘; a ⌘ glyph before the word said it twice in one button.
  it('says ⌘ once on the palette button, in its chord', () => {
    renderBar({ hintFor: (id) => (id === 'palette' ? '⌘K' : '') })
    expect(screen.getByTestId('open-palette').querySelector('svg')).toBeNull()
  })

  // The menus gained these entries, but the bar is where the user has always found them:
  // the palette, the stats and the activity log stay one click away.
  it('opens the palette, the stats and the activity log from the bar', () => {
    const props = renderBar()
    fireEvent.click(screen.getByTestId('open-palette'))
    fireEvent.click(screen.getByTestId('open-stats'))
    fireEvent.click(screen.getByTestId('open-activity'))
    expect(props.onPalette).toHaveBeenCalledOnce()
    expect(props.onStats).toHaveBeenCalledOnce()
    expect(props.onActivity).toHaveBeenCalledOnce()
  })

  // The help only opened by typing "ayuda" into the command palette, so a DJ who had never
  // opened the palette had no way to learn it existed; it sits in the bar like the rest.
  it('opens the help from the bar, where a first-time user looks for it', () => {
    const props = renderBar()
    fireEvent.click(screen.getByTestId('open-help'))
    expect(props.onHelp).toHaveBeenCalledOnce()
  })

  it('opens the feedback dialog from the bar, so a DJ who never opens the menu can still write', () => {
    const props = renderBar()
    fireEvent.click(screen.getByTestId('open-feedback'))
    expect(props.onFeedback).toHaveBeenCalledOnce()
  })

  // The backups icon counted every copy Surco keeps, so it climbed with each conversion
  // and never came down until they expired: a user who updated one track twice read it
  // as the file going to the trash. The backups live on the track rows, the palette and
  // the View menu now; the bar has no icon and nothing counting up.
  it('has no backups button or running count', () => {
    renderBar()
    expect(screen.queryByTestId('open-trash')).toBeNull()
    expect(screen.queryByTestId('trash-count')).toBeNull()
  })

  // The dot is the only always-visible signal that background work is running while
  // the activity panel is closed.
  it('marks the activity button while background work runs', () => {
    renderBar({ activityRunning: true })
    expect(screen.getByTestId('activity-running')).toBeInTheDocument()
    cleanup()
    renderBar()
    expect(screen.queryByTestId('activity-running')).toBeNull()
  })
})
