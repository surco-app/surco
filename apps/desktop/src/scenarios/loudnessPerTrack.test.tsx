// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import type { NormalizeConfig } from '../shared/types'
import { type AppScenario, openApp, stepTo } from './app'
import { loudness, makeTrack, scenarioDir } from './fixtures'

const STREAMING: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

function targetField(): HTMLInputElement {
  return screen.getByTestId('normalize-target-lufs') as HTMLInputElement
}

function openLoudnessSection(): void {
  const toggle = within(screen.getByTestId('editor-normalize')).getAllByRole('button')[0]
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
}

async function dial(surco: AppScenario, title: string, target: string): Promise<void> {
  await surco.select(title)
  openLoudnessSection()
  stepTo(targetField(), target)
  await waitFor(() => expect(targetField().value).toBe(target))
}

// A crate mixes a quiet ambient opener with a peak-time banger, and a DJ dials each one
// to where it sits in the set before converting the lot. The batch used to flatten every
// row onto whichever target the editor held last, so the opener came out as loud as the
// banger and nothing on screen said so. The dial belongs to the track it was set on.
describe('Give each track of a folder its own loudness target, then convert them together', () => {
  let surco: AppScenario
  let folder: string

  beforeAll(async () => {
    folder = scenarioDir('loudness-per-track')
    makeTrack(join(folder, 'Opener.flac'), { title: 'Opener', artist: 'A', signal: 'kick' })
    makeTrack(join(folder, 'Banger.flac'), { title: 'Banger', artist: 'B', signal: 'kick' })
    surco = await openApp({ settings: { normalize: STREAMING }, destination: 'beside' })
    await surco.drop(folder)
    await dial(surco, 'Opener', '-20')
    await dial(surco, 'Banger', '-12')
  }, 90_000)

  afterAll(() => {
    surco.close()
  })

  it('finds each track at the target dialled on it when coming back to it', async () => {
    await surco.select('Opener')
    await waitFor(() => expect(targetField().value).toBe('-20'))
    await surco.select('Banger')
    await waitFor(() => expect(targetField().value).toBe('-12'))
  })

  it('converts every track of the folder to its own target', async () => {
    await surco.convertAll()
    const opener = join(folder, 'Opener.aiff')
    const banger = join(folder, 'Banger.aiff')
    await waitFor(() => expect(existsSync(opener) && existsSync(banger)).toBe(true), {
      timeout: 90_000,
    })
    await waitFor(() => expect(screen.getByTestId('convert-all').textContent).not.toMatch(/\//), {
      timeout: 60_000,
    })
    expect(surco.errors).toEqual([])
    expect(Math.abs(loudness(opener).integrated + 20)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(loudness(banger).integrated + 12)).toBeLessThanOrEqual(0.5)
  }, 120_000)
})
