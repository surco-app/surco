// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { getSettings } from '../main/settings'
import type { NormalizeConfig } from '../shared/types'
import { type AppScenario, openApp, stepTo, typeInto } from './app'
import { loudness, makeTrack, scenarioDir } from './fixtures'

const STREAMING: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

function targetField(): HTMLInputElement {
  return screen.getByTestId('normalize-target-lufs') as HTMLInputElement
}

// The gain chip is the one legend figure computed with the predicted wave itself (the
// LUFS beside it only echoes the dial), so reading it proves the wave was redrawn.
function gainDb(): number {
  return Number.parseFloat(
    (screen.getByTestId('waveform-gain-delta').textContent ?? '').replace('−', '-'),
  )
}

// A dial moved by x dB moves the gain by the same x.
function gainFollows(): (target: number) => Promise<void> {
  const offset = gainDb() - Number.parseFloat(targetField().value)
  return (target) => waitFor(() => expect(gainDb()).toBeCloseTo(target + offset, 1))
}

// The wave's preview is how a DJ picks a target: touch the field, watch where the track
// lands, convert. djotas reported it frozen (v1.7.4 to v1.8.2) after the field was changed
// to apply only on Enter or blur; every piece kept passing its own tests, because nothing
// joined the field to the preview. This walks it through the whole app, so the wiring
// between the editor, the dials and the conversion is the app's own.
describe('Tune a track’s loudness target while watching its wave', () => {
  let surco: AppScenario
  let folder: string

  beforeAll(async () => {
    folder = scenarioDir('loudness-preview')
    makeTrack(join(folder, 'Loud.flac'), { title: 'Loud', artist: 'A', signal: 'kick' })
    makeTrack(join(folder, 'Quiet.wav'), { title: 'Quiet', artist: 'B' })
    surco = await openApp({ settings: { normalize: STREAMING }, destination: 'beside' })
    await surco.drop(folder)
    await surco.select('Loud')
    const section = screen.getByTestId('editor-normalize')
    const toggle = within(section).getAllByRole('button')[0]
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
    await screen.findByTestId('waveform-gain-delta', undefined, { timeout: 30_000 })
  }, 90_000)

  afterAll(() => {
    surco.close()
  })

  it('moves the preview with each step of the arrows, without leaving the field', async () => {
    const expectGainAt = gainFollows()
    stepTo(targetField(), '-13.9')
    await expectGainAt(-13.9)
  })

  it('moves the preview once the user stops typing, without leaving the field', async () => {
    const expectGainAt = gainFollows()
    typeInto(targetField(), '-1')
    typeInto(targetField(), '-11')
    await expectGainAt(-11)
  })

  // What the preview shows is what the conversion does, or the preview is a promise the
  // file breaks.
  it('converts the track to the target the preview shows', async () => {
    const expectGainAt = gainFollows()
    stepTo(targetField(), '-12')
    await expectGainAt(-12)
    fireEvent.click(screen.getByTestId('process-btn'))
    const out = join(folder, 'Loud.aiff')
    await waitFor(() => expect(existsSync(out)).toBe(true), { timeout: 60_000 })
    await waitFor(() => expect(screen.queryByTestId('done-more')).not.toBeNull(), {
      timeout: 60_000,
    })
    expect(surco.errors).toEqual([])
    expect(Math.abs(loudness(out).integrated + 12)).toBeLessThanOrEqual(0.5)
  }, 90_000)

  // The target is a lasting preference: users asked that the next track, and the app
  // after a relaunch, find it as they left it.
  it('opens the next track at the target left on this one, and keeps it for the next launch', async () => {
    await surco.select('Quiet')
    await waitFor(() => expect(targetField().value).toBe('-12'))
    expect(getSettings().normalize.targetLufs).toBe(-12)
  })
})
