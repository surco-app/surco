// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { type AppScenario, openApp, openSection } from './app'
import { audioMd5, makeTrack, scenarioDir, vinylSource } from './fixtures'

// A rip session mixes a dusty pressing with a clean one. The DJ sets the repair on the
// dusty side only and converts both: the repair is a filter over the audio, so applied to
// the clean side it would rewrite a recording that needed nothing, and left off the dusty
// one it would keep every click the DJ listened for and chose to remove.
describe('Repair the clicks of one rip in a batch and leave the clean one untouched', () => {
  let surco: AppScenario
  let folder: string
  const original = new Map<string, string>()

  beforeAll(async () => {
    folder = scenarioDir('declick-per-track')
    for (const side of ['Dusty', 'Clean'])
      original.set(
        side,
        audioMd5(
          makeTrack(join(folder, `${side}.wav`), {
            title: side,
            artist: 'A',
            lavfi: vinylSource(12),
          }),
        ),
      )
    surco = await openApp({ settings: {}, destination: 'beside' })
    await surco.drop(folder)
    await surco.select('Dusty')
    await openSection('editor-declick')
    fireEvent.click(await screen.findByTestId('declick-mode-strong'))
    await surco.select('Clean')
    await surco.convertAll()
    await vi.waitFor(
      () => {
        for (const side of original.keys())
          expect(existsSync(join(folder, `${side}.aiff`))).toBe(true)
      },
      { timeout: 60_000, interval: 200 },
    )
  }, 120_000)

  afterAll(() => {
    surco.close()
  })

  it('repairs the rip the repair was set on', () => {
    expect(audioMd5(join(folder, 'Dusty.aiff'))).not.toBe(original.get('Dusty'))
  })

  it('leaves the sound of the other rip exactly as it was', () => {
    expect(audioMd5(join(folder, 'Clean.aiff'))).toBe(original.get('Clean'))
    expect(surco.errors).toEqual([])
  })
})
