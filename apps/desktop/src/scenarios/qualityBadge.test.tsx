// @vitest-environment jsdom
import { join } from 'node:path'
import { screen, within } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { type AppScenario, openApp } from './app'
import { lossyCopy, makeTrack, scenarioDir } from './fixtures'

interface Verdict {
  tone: string | null
  label: string
}

async function inList(title: string): Promise<Verdict> {
  const row = screen.getAllByTestId('track-row').find((r) => r.textContent?.includes(title))
  if (!row) throw new Error(`scenario: no row shows ${title}`)
  const pill = await within(row).findByTestId('track-quality', undefined, { timeout: 60_000 })
  return {
    tone: pill.getAttribute('data-tone'),
    label: pill.querySelector('.sr-only')?.textContent ?? '',
  }
}

async function inEditor(surco: AppScenario, title: string): Promise<Verdict> {
  await surco.select(title)
  const badge = await screen.findByTestId('quality-badge', undefined, { timeout: 60_000 })
  return { tone: badge.getAttribute('data-tone'), label: badge.textContent ?? '' }
}

// The list is where a DJ triages a download folder at a glance, the editor where they
// open the doubtful one to decide. Each derives the verdict on its own (the row from the
// spectrum copied onto the track, the editor from its own query), so a file could read
// clean in the row and red once opened, and the triage would point at the wrong tracks.
describe('See the same quality verdict in the list and in the editor', () => {
  let surco: AppScenario

  beforeAll(async () => {
    const folder = scenarioDir('quality-badge')
    makeTrack(join(folder, 'Real Lossless.flac'), {
      title: 'Real Lossless',
      artist: 'A',
      signal: 'noise',
    })
    makeTrack(join(folder, 'Promo.mp3'), { title: 'Promo', artist: 'B', signal: 'noise' })
    const master = makeTrack(join(scenarioDir('quality-badge-master'), 'Master.flac'), {
      title: 'Fake Lossless',
      artist: 'C',
      signal: 'noise',
    })
    lossyCopy(master, join(folder, 'Fake Lossless.flac'))
    surco = await openApp({
      settings: { showSpectrum: true, autoAnalyze: true },
      destination: 'beside',
    })
    await surco.drop(folder)
  }, 90_000)

  afterAll(() => {
    surco.close()
  })

  it.each([
    ['Real Lossless', 'good'],
    ['Promo', 'good'],
    ['Fake Lossless', 'danger'],
  ])(
    'gives %s the same verdict and colour in both places',
    async (title, tone) => {
      const list = await inList(title)
      expect(list.tone).toBe(tone)
      expect(await inEditor(surco, title)).toEqual(list)
      expect(surco.errors).toEqual([])
    },
    120_000,
  )
})
