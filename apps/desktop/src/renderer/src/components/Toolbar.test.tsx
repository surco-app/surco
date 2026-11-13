// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { formatCount } from '../lib/stats'
import { Toolbar } from './Toolbar'

afterEach(cleanup)

function count(done: number, total: number): string {
  return i18n.t('header.sweepCount', {
    done: formatCount(done, i18n.language),
    total: formatCount(total, i18n.language),
  })
}

function said(labelKey: string, done: number, total: number): string {
  return `${i18n.t(labelKey)} · ${count(done, total)}`
}

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
    const slowed = said('header.sweepAnalyzeSlowed', 0, 4)
    expect(screen.getByRole('status').textContent).toBe(slowed)
    expect(screen.getByTestId('analyze-slowed')).toBeInTheDocument()
    fireEvent.focus(screen.getByTestId('analyze-quality'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(slowed)
  })

  it('keeps the running count while the window is in front', () => {
    renderBar({ analysis: { done: 1, total: 4 }, analysisSlowed: false })
    expect(screen.queryByTestId('analyze-slowed')).toBeNull()
    fireEvent.focus(screen.getByTestId('analyze-quality'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(said('header.sweepAnalyze', 1, 4))
  })

  it('tells the details pass apart from the quality pass, since its count starts over', () => {
    renderBar({ analysis: { done: 1, total: 4, stage: 'details' }, analysisSlowed: false })
    fireEvent.focus(screen.getByTestId('analyze-quality'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(said('header.sweepAnalyzeDetails', 1, 4))
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

  it('keeps the sweep buttons as words while they run, since a bare 118/1842 said nothing about what it counted', () => {
    renderBar({ matching: { done: 1, total: 4 }, analysis: { done: 2, total: 10 } })
    expect(screen.getByTestId('auto-match')).toHaveTextContent(i18n.t('header.autoMatchLabel'))
    expect(screen.getByTestId('auto-match')).not.toHaveTextContent(/\d/)
    expect(screen.getByTestId('analyze-quality')).toHaveTextContent(
      i18n.t('header.analyzeQualityLabel'),
    )
    expect(screen.getByTestId('analyze-quality')).not.toHaveTextContent(/\d/)
  })

  it('gathers every running sweep in one pill that shows how far the leading one is', () => {
    renderBar()
    expect(screen.queryByTestId('sweeps-pill')).toBeNull()
    cleanup()
    renderBar({ importing: { done: 1842, total: 5303 }, matching: { done: 118, total: 1842 } })
    const pill = screen.getByTestId('sweeps-pill')
    expect(within(pill).getByTestId('sweep-icon-import')).toBeInTheDocument()
    expect(within(pill).getByTestId('sweep-icon-match')).toBeInTheDocument()
    expect(within(pill).queryByTestId('sweep-icon-analyze')).toBeNull()
    expect(within(pill).getByTestId('sweeps-percent')).toHaveTextContent(
      new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(1842 / 5303),
    )
  })

  it('opens one row per sweep with its count in words against a total that does not move', () => {
    renderBar({ importing: { done: 1842, total: 5303 }, matching: { done: 118, total: 1842 } })
    expect(screen.queryByTestId('sweeps-menu')).toBeNull()
    fireEvent.click(screen.getByTestId('sweeps-pill'))
    expect(screen.getByTestId('sweep-import')).toHaveTextContent(i18n.t('header.sweepImport'))
    expect(screen.getByTestId('sweep-import')).toHaveTextContent(count(1842, 5303))
    expect(screen.getByTestId('sweep-match')).toHaveTextContent(i18n.t('header.sweepMatch'))
    expect(screen.getByTestId('sweep-match')).toHaveTextContent(count(118, 5303))
    expect(screen.getByTestId('sweep-match')).toHaveTextContent(
      i18n.t('header.sweepWaiting', { count: 1724, formatted: formatCount(1724, i18n.language) }),
    )
  })

  it('stops each sweep from its own row', () => {
    const props = renderBar({
      importing: { done: 5, total: 9 },
      analysis: { done: 2, total: 10 },
      matching: { done: 1, total: 4 },
    })
    fireEvent.click(screen.getByTestId('sweeps-pill'))
    fireEvent.click(screen.getByTestId('sweep-import-stop'))
    expect(props.onCancelImport).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByTestId('sweep-analyze-stop'))
    expect(props.onCancelAnalyze).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByTestId('sweep-match-stop'))
    expect(props.onCancelAutoMatch).toHaveBeenCalledOnce()
  })

  it('closes the sweeps menu with Escape', () => {
    renderBar({ importing: { done: 5, total: 9 } })
    fireEvent.click(screen.getByTestId('sweeps-pill'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('sweeps-menu')).toBeNull()
  })

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
      said('header.sweepImport', 5, 9),
      said('header.sweepAnalyze', 2, 10),
      said('header.sweepMatch', 1, 8),
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
