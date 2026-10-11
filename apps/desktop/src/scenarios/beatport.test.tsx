// @vitest-environment jsdom
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/beatport', async (original) => {
  const real = await original<typeof import('../main/beatport')>()
  const { despechaRelease, despechaTracks } = await import('../main/beatportFixture')
  const { coverDataUrl } = await import('./fixtures')
  return {
    ...real,
    getRelease: async () =>
      real.mapRelease({ ...despechaRelease, image: { uri: coverDataUrl() } }, [
        despechaTracks[0],
        {
          ...despechaTracks[0],
          id: 1,
          name: 'Despechá',
          mix_name: 'Original Mix',
          bpm: 128,
          key: { name: 'A Minor' },
        },
      ]),
  }
})

import { readTags } from '../main/ffmpeg'
import { getProvider } from '../main/providers'
import type { Release } from '../shared/types'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'

describe('Bring in the BPM and key from Beatport', () => {
  let folder: string
  let surco: Scenario
  let beforeSaving: Awaited<ReturnType<typeof readTags>>

  beforeAll(async () => {
    folder = scenarioDir('beatport')
    makeTrack(join(folder, 'despecha clean.mp3'), { title: 'despecha', artist: 'rosalia' })
    makeTrack(join(folder, 'despecha.flac'), { title: 'despecha', artist: 'rosalia' })
    surco = await openSurco({ settings: { outputFormat: 'source' }, destination: 'overwrite' })
    await surco.drop(folder)
    const fromBeatport: Release = await getProvider('beatport').getRelease(6386332)
    surco.acceptMatch('despecha clean.mp3', fromBeatport, '1')
    surco.acceptMatch('despecha.flac', fromBeatport, '2')
    beforeSaving = await readTags(join(folder, 'despecha clean.mp3'))
    await surco.convertAll()
  }, 60_000)

  it('does not change the file until the tags are saved', () => {
    expect(beforeSaving).toMatchObject({ title: 'despecha', bpm: '', key: '' })
  })

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
  })

  it('brings the BPM, the key in Camelot, the label and the catalogue number', async () => {
    expect(await readTags(join(folder, 'despecha clean.mp3'))).toMatchObject({
      bpm: '130',
      key: '9B',
      publisher: 'Columbia',
      catalogNumber: 'G010004869119V',
    })
    expect(await readTags(join(folder, 'despecha.flac'))).toMatchObject({ bpm: '128', key: '8A' })
  })

  it('adds the mix to the title, except an Original Mix', async () => {
    expect((await readTags(join(folder, 'despecha clean.mp3'))).title).toBe('DESPECHÁ (Clean)')
    expect((await readTags(join(folder, 'despecha.flac'))).title).toBe('Despechá')
  })
})
