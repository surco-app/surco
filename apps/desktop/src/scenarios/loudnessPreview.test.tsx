// @vitest-environment jsdom
import { join } from 'node:path'
import { waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import type { NormalizeConfig } from '../shared/types'
import { makeTrack, scenarioDir } from './fixtures'
import { type LoudnessSection, openSurco, type Scenario } from './harness'

const STREAMING: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

// The gain chip is the one legend figure computed with the predicted wave itself (the
// LUFS beside it only echoes the dial), so following the target proves the wave was
// redrawn: a dial moved by x dB moves the gain by the same x.
function gainFollows(section: LoudnessSection): (target: number) => void {
  const offset = section.gainDb() - section.targetLufs()
  return (target) => expect(section.gainDb()).toBeCloseTo(target + offset, 1)
}

// The wave's preview is how a DJ picks a target: touch the field, watch where the track
// lands. djotas reported it frozen (v1.7.4 to v1.8.2) after the field was changed to
// apply only on Enter or blur; every piece kept passing its own tests, because nothing
// joined the field to the preview.
describe('Tune a track’s loudness target while watching its wave', () => {
  let surco: Scenario

  beforeAll(async () => {
    const folder = scenarioDir('loudness-preview')
    makeTrack(join(folder, 'Loud.flac'), { title: 'Loud', artist: 'A', signal: 'kick' })
    surco = await openSurco({ settings: { normalize: STREAMING }, destination: 'beside' })
    await surco.drop(folder)
  }, 60_000)

  afterAll(() => {
    surco.close()
  })

  it('moves the preview with each step of the arrows, without leaving the field', async () => {
    const section = await surco.openLoudness('Loud.flac')
    const expectGainAt = gainFollows(section)
    section.stepTarget('-13.9')
    await waitFor(() => expect(section.preview()).toContain('-13.9 LUFS'))
    expectGainAt(-13.9)
  })

  it('moves the preview once the user stops typing, without leaving the field', async () => {
    const section = await surco.openLoudness('Loud.flac')
    const expectGainAt = gainFollows(section)
    section.typeTarget('-1')
    section.typeTarget('-11')
    await waitFor(() => expect(section.preview()).toContain('-11.0 LUFS'), { timeout: 2000 })
    expectGainAt(-11)
  })

  // What the preview shows is what the conversion is handed, or the preview is a promise
  // the file breaks.
  it('stages for the conversion the target the preview shows', async () => {
    const section = await surco.openLoudness('Loud.flac')
    const expectGainAt = gainFollows(section)
    section.stepTarget('-12')
    await waitFor(() => expect(section.preview()).toContain('-12.0 LUFS'))
    expectGainAt(-12)
    expect(surco.errors).toEqual([])
    expect(section.staged()?.targetLufs).toBe(-12)
  })
})
