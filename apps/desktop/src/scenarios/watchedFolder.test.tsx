// @vitest-environment jsdom
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'

describe('Have your downloads arrive already tagged', () => {
  let downloads: string
  let surco: Scenario
  let offeredFirst: string[]
  let offeredAfterDismiss: string[]
  let offeredAfterConvert: string[] | 'nothing'

  beforeAll(async () => {
    downloads = scenarioDir('downloads')
    makeTrack(join(downloads, 'old.flac'), { title: 'Old', artist: 'A' })
    surco = await openSurco({ settings: {}, destination: 'beside' })
    await surco.drop(downloads)

    makeTrack(join(downloads, 'Label', 'fresh.flac'), { title: 'Fresh', artist: 'B' })
    offeredFirst = await surco.waitForNewTracks()
    await surco.loadNewTracks()

    makeTrack(join(downloads, 'unwanted.flac'), { title: 'Unwanted', artist: 'C' })
    await surco.waitForNewTracks()
    surco.dismissNewTracks()
    makeTrack(join(downloads, 'later.flac'), { title: 'Later', artist: 'D' })
    offeredAfterDismiss = await surco.waitForNewTracks()
    surco.dismissNewTracks()

    await surco.convertAll()
    offeredAfterConvert = await surco.waitForNewTracks().catch(() => 'nothing' as const)
  }, 90_000)

  afterAll(() => surco.close())

  it('offers a track that lands in the folder, subfolders included', () => {
    expect(offeredFirst.map((p) => basename(p))).toEqual(['fresh.flac'])
  })

  it('loads it with its tags when the user presses Load', () => {
    const fresh = surco.tracks().find((t) => basename(t.inputPath) === 'fresh.flac')
    expect(fresh?.meta).toMatchObject({ title: 'Fresh', artist: 'B' })
  })

  it('never offers again a track the user turned down', () => {
    expect(offeredAfterDismiss.map((p) => basename(p))).toEqual(['later.flac'])
  })

  it('does not offer the copies Surco itself writes into the folder', () => {
    expect(offeredAfterConvert).toBe('nothing')
  })

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
  })
})
