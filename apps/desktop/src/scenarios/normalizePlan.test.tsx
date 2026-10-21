// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import type { NormalizeConfig } from '../shared/types'
import { type AppScenario, openApp, openSection, stepTo } from './app'
import { loudness, makeTrack, scenarioDir } from './fixtures'

const CEILING = -1
const STREAMING: NormalizeConfig = {
  mode: 'loudness',
  targetLufs: -14,
  truePeakDb: CEILING,
  peakDb: -1,
}

interface Plan {
  kind: string | null
  lufs: number
  peak: number
}

function decibels(text: string, unit: string): number {
  const match = text.match(new RegExp(`([−-]?\\d+(?:[.,]\\d+)?)\\s*${unit}`))
  if (!match) throw new Error(`scenario: the plan names no ${unit} in "${text}"`)
  return Number.parseFloat(match[1].replace('−', '-').replace(',', '.'))
}

async function planFor(surco: AppScenario, title: string, target: string): Promise<Plan> {
  await surco.select(title)
  await openSection('editor-normalize')
  stepTo(screen.getByTestId('normalize-target-lufs') as HTMLInputElement, target)
  const card = await screen.findByTestId('normalize-plan', undefined, { timeout: 30_000 })
  await waitFor(() => expect(decibels(card.textContent ?? '', 'LUFS')).toBe(Number(target)))
  const text = card.textContent ?? ''
  return {
    kind: card.getAttribute('data-plan'),
    lufs: decibels(text, 'LUFS'),
    peak: decibels(text, 'dBTP'),
  }
}

async function convert(surco: AppScenario, out: string): Promise<void> {
  fireEvent.click(screen.getByTestId('process-btn'))
  await waitFor(() => expect(existsSync(out)).toBe(true), { timeout: 60_000 })
  await waitFor(() => expect(screen.queryByTestId('done-more')).not.toBeNull(), {
    timeout: 60_000,
  })
  expect(surco.errors).toEqual([])
}

// The plan card is the one place a DJ reads what normalizing will do to THIS track
// before any file is touched: one constant gain that leaves the dynamics alone, or a
// limiter holding peaks that would cross the ceiling. It is a prediction computed in the
// renderer, apart from the conversion in main, so nothing but the converted file can say
// whether the promise held.
describe('Read what normalizing will do to a track, then find it done in the file', () => {
  let surco: AppScenario
  let folder: string

  beforeAll(async () => {
    folder = scenarioDir('normalize-plan')
    makeTrack(join(folder, 'Ambient.flac'), { title: 'Ambient', artist: 'A' })
    makeTrack(join(folder, 'Banger.flac'), { title: 'Banger', artist: 'B', signal: 'kick' })
    surco = await openApp({ settings: { normalize: STREAMING }, destination: 'beside' })
    await surco.drop(folder)
  }, 90_000)

  afterAll(() => {
    surco.close()
  })

  it('lands a track the plan moves with one constant gain at the loudness and peak it names', async () => {
    const plan = await planFor(surco, 'Ambient', '-16')
    expect(plan.kind).toBe('gain')
    const out = join(folder, 'Ambient.aiff')
    await convert(surco, out)
    const measured = loudness(out)
    expect(Math.abs(measured.integrated - plan.lufs)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(measured.truePeak - plan.peak)).toBeLessThanOrEqual(0.5)
  }, 120_000)

  it('holds under the ceiling a track the plan says the limiter will hold', async () => {
    const plan = await planFor(surco, 'Banger', '-10')
    expect(plan.kind).toBe('limited')
    expect(plan.peak).toBe(CEILING)
    const out = join(folder, 'Banger.aiff')
    await convert(surco, out)
    const measured = loudness(out)
    expect(measured.truePeak).toBeLessThanOrEqual(CEILING + 0.1)
    expect(measured.integrated).toBeLessThanOrEqual(plan.lufs + 0.5)
    expect(measured.integrated).toBeGreaterThanOrEqual(plan.lufs - 0.5)
  }, 120_000)
})
