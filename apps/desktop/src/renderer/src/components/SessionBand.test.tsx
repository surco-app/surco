// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionPlan, SessionSummary } from '../../../shared/sessionBuild'
import '../i18n'
import { SessionBand } from './SessionBand'

afterEach(cleanup)

const SUMMARY: SessionSummary = {
  secs: 5440,
  tracks: 24,
  combos: 4,
  fresh: 3,
  harmonic: 21,
  withKey: 23,
  shortBySecs: 0,
  missingDurations: 0,
  audioSecs: 9840,
}

function setup(
  summary: Partial<SessionSummary> = {},
  busy = false,
  extra: { playMinutes?: number; preferCombos?: boolean } = {},
) {
  const plan: SessionPlan = { items: [], summary: { ...SUMMARY, ...summary } }
  const handlers = { onRedo: vi.fn(), onAdjust: vi.fn(), onKeep: vi.fn() }
  render(
    <SessionBand
      plan={plan}
      busy={busy}
      playMinutes={extra.playMinutes ?? 2}
      preferCombos={extra.preferCombos ?? true}
      {...handlers}
    />,
  )
  return handlers
}

describe('SessionBand', () => {
  it('summarises the session: length as minutes and seconds, tracks, combos, new and harmonic mixes', () => {
    setup()
    const stats = screen.getByTestId('session-band-stats')
    expect(stats).toHaveTextContent('90:40')
    expect(stats).toHaveTextContent('24')
    expect(stats).toHaveTextContent('4')
    expect(stats).toHaveTextContent('3')
    expect(stats).toHaveTextContent('21/23')
  })

  it('pads the seconds of the length', () => {
    setup({ secs: 3605 })
    expect(screen.getByTestId('session-band-stats')).toHaveTextContent('60:05')
  })

  it('leaves out the harmonic count when no mix had keys on both sides', () => {
    setup({ withKey: 0, harmonic: 0 })
    expect(screen.getByTestId('session-band-stats').textContent).not.toContain('/')
  })

  it('hands each button to its handler', () => {
    const { onRedo, onAdjust, onKeep } = setup()
    fireEvent.click(screen.getByTestId('session-band-redo'))
    fireEvent.click(screen.getByTestId('session-band-adjust'))
    fireEvent.click(screen.getByTestId('session-band-keep'))
    expect(onRedo).toHaveBeenCalledOnce()
    expect(onAdjust).toHaveBeenCalledOnce()
    expect(onKeep).toHaveBeenCalledOnce()
  })

  it('blocks the buttons while it is working', () => {
    setup({}, true)
    for (const id of ['redo', 'adjust', 'keep']) {
      expect(screen.getByTestId(`session-band-${id}`)).toBeDisabled()
    }
  })

  it('says how long the session could be when the tracks ran out', () => {
    setup({ secs: 2700, shortBySecs: 2700 })
    expect(screen.getByTestId('session-band-short')).toHaveTextContent('45')
  })

  it('says nothing about running short when the time was reached', () => {
    setup()
    expect(screen.queryByTestId('session-band-short')).toBeNull()
  })

  it('tells how many tracks had no length and were counted as six minutes', () => {
    setup({ missingDurations: 3 })
    expect(screen.getByTestId('session-band-assumed')).toHaveTextContent('3')
  })

  it('says nothing about lengths when every track had one', () => {
    setup()
    expect(screen.queryByTestId('session-band-assumed')).toBeNull()
  })

  it('says the length is counted at the minutes each track plays and gives the length of the files', () => {
    setup({ secs: 3600, audioSecs: 9840 }, false, { playMinutes: 2 })
    const counted = screen.getByTestId('session-band-counted')
    expect(counted).toHaveTextContent('2')
    expect(counted).toHaveTextContent('2 h 44 min')
  })

  it('keeps the hours and the minutes of the files together, so the line never breaks inside them', () => {
    setup({ audioSecs: 9840 })
    expect(screen.getByTestId('session-band-counted').textContent).toContain(
      '2\u00a0h\u00a044\u00a0min',
    )
  })

  it('gives the files in minutes when they last less than an hour', () => {
    setup({ secs: 1800, audioSecs: 2820 })
    expect(screen.getByTestId('session-band-counted')).toHaveTextContent('47 min')
  })

  it('says the files add up to at least that when some track has no length', () => {
    setup({ missingDurations: 2, audioSecs: 3600 })
    expect(screen.getByTestId('session-band-counted')).toHaveTextContent(/at least|al menos/i)
  })

  it('explains why there are no combos when proven combos were asked for', () => {
    setup({ combos: 0 })
    expect(screen.getByTestId('session-band-nocombos')).toBeInTheDocument()
  })

  it('stays quiet about combos when there are some, or when they were not asked for', () => {
    setup()
    expect(screen.queryByTestId('session-band-nocombos')).toBeNull()
    cleanup()
    setup({ combos: 0 }, false, { preferCombos: false })
    expect(screen.queryByTestId('session-band-nocombos')).toBeNull()
  })

  it('counts a track with no length at the time it plays, not at six minutes', () => {
    setup({ missingDurations: 1 }, false, { playMinutes: 2 })
    expect(screen.getByTestId('session-band-assumed')).toHaveTextContent('2')
    expect(screen.getByTestId('session-band-assumed').textContent).not.toContain('6')
  })

  it('counts a track with no length as six minutes at most', () => {
    setup({ missingDurations: 1 }, false, { playMinutes: 9 })
    expect(screen.getByTestId('session-band-assumed')).toHaveTextContent('6')
  })
})
