// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { app } from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { getSettings } from '../main/settings'
import type { NormalizeConfig } from '../shared/types'
import { type AppScenario, openApp, openSection, stepTo } from './app'
import { loudness, makeTrack, scenarioDir } from './fixtures'

const STREAMING: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

function targetField(): HTMLInputElement {
  return screen.getByTestId('normalize-target-lufs') as HTMLInputElement
}

function savedSession(): string {
  const path = join(app.getPath('userData'), 'session.json')
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

// A DJ preps a crate over several evenings: dials a quiet opener down and sets a repair on
// its dusty pressing, quits, and comes back the next day to convert. The dials live on the
// track, not in Settings, so only the saved session carries them across the quit. The
// editor has to show them too: it can open on a track before its restored dials have
// arrived, and showing Settings' target there contradicts what the conversion will do.
describe('Come back to a crate the next day and find each track as it was left', () => {
  let surco: AppScenario
  let out: string

  beforeAll(async () => {
    const folder = scenarioDir('reopen-session')
    out = join(folder, 'Opener.aiff')
    makeTrack(join(folder, 'Opener.flac'), { title: 'Opener', artist: 'A', signal: 'kick' })
    makeTrack(join(folder, 'Closer.flac'), { title: 'Closer', artist: 'B', signal: 'kick' })
    const evening = await openApp({ settings: { normalize: STREAMING }, destination: 'beside' })
    await evening.drop(folder)
    await evening.select('Opener')
    await openSection('editor-normalize')
    stepTo(targetField(), '-20')
    await openSection('editor-declick')
    fireEvent.click(screen.getByTestId('declick-mode-strong'))
    await evening.select('Closer')
    stepTo(targetField(), '-12')
    await vi.waitFor(() => expect(savedSession()).toContain('-12'), {
      timeout: 10_000,
      interval: 200,
    })
    const leftAs = getSettings()
    evening.close()
    surco = await openApp({ settings: leftAs })
    fireEvent.click(
      await screen.findByTestId('last-session-action', undefined, { timeout: 10_000 }),
    )
    await waitFor(() => expect(screen.queryAllByTestId('track-loading')).toHaveLength(0), {
      timeout: 30_000,
    })
  }, 120_000)

  afterAll(() => {
    surco.close()
  })

  it('opens the track at the loudness left on it', async () => {
    await surco.select('Opener')
    await openSection('editor-normalize')
    await waitFor(() => expect(targetField().value).toBe('-20'))
  })

  it('opens the track at the click repair left on it', async () => {
    await openSection('editor-declick')
    expect(screen.getByTestId('declick-mode-strong').getAttribute('aria-pressed')).toBe('true')
  })

  it('converts it at that loudness', async () => {
    fireEvent.click(screen.getByTestId('process-btn'))
    await vi.waitFor(() => expect(existsSync(out)).toBe(true), { timeout: 60_000, interval: 200 })
    await waitFor(() => expect(screen.queryByTestId('done-more')).not.toBeNull(), {
      timeout: 60_000,
    })
    expect(Math.abs(loudness(out).integrated + 20)).toBeLessThanOrEqual(0.5)
    expect(surco.errors).toEqual([])
  }, 90_000)
})
