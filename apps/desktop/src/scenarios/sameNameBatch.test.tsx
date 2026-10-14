// @vitest-environment jsdom
import { join } from 'node:path'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import type { Destination } from '../renderer/src/lib/destination'
import { type AppScenario, openApp } from './app'
import { audioMd5, listFiles, makeTrack, scenarioDir } from './fixtures'

function aiffs(folder: string): string[] {
  return listFiles(folder).filter((f) => f.endsWith('.aiff') && !f.startsWith('.'))
}

function settled(folder: string): boolean {
  return !listFiles(folder).some((f) => f.startsWith('.'))
}

// A crate collects the same song twice under one name, a FLAC from the shop and a WAV
// from a promo. Both become Song.aiff, and the batch writes them in parallel: unless the
// second one notices the first, it lands on top of it and one recording is gone without
// a word. Replacing the originals raises the stakes, since then the sources go too.
describe('Convert two files that share a name in one go, without one replacing the other', () => {
  let surco: AppScenario | undefined

  afterEach(() => {
    surco?.close()
    surco = undefined
  })

  it.each<[string, Destination]>([
    ['beside the originals', 'beside'],
    ['replacing the originals', 'overwrite'],
  ])(
    'keeps both recordings when converting %s',
    async (_, destination) => {
      const folder = scenarioDir(`same-name-${destination}`)
      const flac = makeTrack(join(folder, 'Song.flac'), { title: 'Song', artist: 'A' })
      const wav = makeTrack(join(folder, 'Song.wav'), {
        title: 'Song',
        artist: 'A',
        signal: 'noise',
      })
      const sounds = [audioMd5(flac), audioMd5(wav)].sort()
      const asked: string[] = []
      surco = await openApp({
        settings: {},
        destination,
        onConflict: (name) => {
          asked.push(name)
          return 'overwrite'
        },
      })
      await surco.drop(folder)
      await surco.convertAll()
      if (destination === 'overwrite') fireEvent.click(await screen.findByTestId('confirm-ok'))
      await vi.waitFor(
        () => {
          expect(settled(folder)).toBe(true)
          expect(aiffs(folder)).toHaveLength(2)
        },
        { timeout: 60_000, interval: 200 },
      )
      expect(surco.errors).toEqual([])
      expect(asked).toEqual(destination === 'overwrite' ? ['Song.aiff'] : [])
      expect(
        aiffs(folder)
          .map((f) => audioMd5(join(folder, f)))
          .sort(),
      ).toEqual(sounds)
    },
    120_000,
  )
})
