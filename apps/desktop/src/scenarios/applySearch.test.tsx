// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { readTags } from '../main/ffmpeg'
import { type AppScenario, openApp } from './app'
import { makeTrack, release, scenarioDir } from './fixtures'

const MOVIN_MELODIES = release({
  tracklist: [
    { position: '1', title: 'Underwater World', duration: '5:12' },
    { position: '2', title: '9 PM (Till I Come)', duration: '5:30' },
  ],
})

// A promo arrives as "track02.flac" with a bare title. The DJ searches the release in the
// editor, opens it, picks the track, and converts: everything the release knows (album,
// label, catalogue number, the full title) has to end up in the file, since the file is
// what the decks and every other library read. The editor shows it applied the moment the
// track is picked; only the converted file shows it was written.
describe('Tag a single track from a release found in the editor', () => {
  let surco: AppScenario
  let out: string

  beforeAll(async () => {
    const folder = scenarioDir('apply-search')
    out = join(folder, 'track02.aiff')
    makeTrack(join(folder, 'track02.flac'), { title: '9 PM', artist: 'ATB' })
    surco = await openApp({ settings: {}, destination: 'beside' }, [MOVIN_MELODIES])
    await surco.drop(folder)
    await surco.select('9 PM')
    fireEvent.change(screen.getByTestId('discogs-query'), {
      target: { value: 'ATB Movin Melodies' },
    })
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
    fireEvent.click(await screen.findByTestId('discogs-result'))
    const tracks = await screen.findAllByTestId('discogs-track')
    const picked = tracks.find((t) => t.textContent?.includes('9 PM (Till I Come)'))
    if (!picked) throw new Error('scenario: the release does not list 9 PM (Till I Come)')
    fireEvent.click(picked)
    fireEvent.click(screen.getByTestId('process-btn'))
    await vi.waitFor(() => expect(existsSync(out)).toBe(true), { timeout: 60_000, interval: 200 })
  }, 120_000)

  afterAll(() => {
    surco.close()
  })

  it('writes what the release knows about the track into the file', async () => {
    expect(await readTags(out)).toMatchObject({
      title: '9 PM (Till I Come)',
      artist: 'ATB',
      album: 'Movin Melodies',
      publisher: 'Kontor',
      catalogNumber: 'KON-123',
    })
    expect(surco.errors).toEqual([])
  })
})
