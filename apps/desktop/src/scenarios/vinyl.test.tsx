// @vitest-environment jsdom
import { basename, join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { readMeta, readTags } from '../main/ffmpeg'
import { ipcHandlers } from './electronFake'
import { listFiles, loudness, makeTrack, release, scenarioDir, vinylSource } from './fixtures'
import { openSurco, type Scenario } from './harness'

const plasticDreams = release({
  title: 'Plastic Dreams',
  artists: [{ name: 'Jaydee' }],
  formats: [{ name: 'Vinyl', descriptions: ['12"'] }],
  tracklist: [
    { position: 'A1', title: 'Plastic Dreams (Long Version)', duration: '1:10' },
    { position: 'A2', title: 'Plastic Dreams (Radio)', duration: '0:10' },
    { position: 'B1', title: 'Plastic Dreams (Dub)', duration: '0:40' },
  ],
})

type Clicks = { count: number } | null

async function clicksIn(path: string): Promise<number> {
  const handler = ipcHandlers.get('audio:clicks') as (
    e: unknown,
    p: string,
    prio: string,
  ) => Promise<Clicks>
  return (await handler({}, path, 'low'))?.count ?? 0
}

describe('Digitise your vinyl', () => {
  let rips: string
  let output: string
  let surco: Scenario
  const clicksBefore = new Map<string, number>()

  beforeAll(async () => {
    const root = scenarioDir('vinyl')
    rips = join(root, 'Rips')
    output = join(root, 'Surco')
    makeTrack(join(rips, 'Track 01.wav'), { title: '', artist: '', lavfi: vinylSource(70) })
    makeTrack(join(rips, 'Track 02.wav'), { title: '', artist: '', lavfi: vinylSource(10) })
    makeTrack(join(rips, 'Track 03.wav'), { title: '', artist: '', lavfi: vinylSource(40) })
    surco = await openSurco({
      settings: {
        declick: { mode: 'standard', rumble: false },
        outputDir: output,
        normalize: { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      },
      destination: 'folder',
    })
    await surco.drop(rips)
    for (const file of listFiles(rips)) clicksBefore.set(file, await clicksIn(join(rips, file)))
    surco.applyAlbum(plasticDreams)
    await surco.trimDetectedSilence()
    await surco.convertAll()
  }, 180_000)

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
  })

  it('gives each recording its own song and position from one search of the record', async () => {
    const tagged = await Promise.all(
      listFiles(output).map(async (f) => {
        const { title, trackNumber, album } = await readTags(join(output, f))
        return { title, trackNumber, album }
      }),
    )
    expect(tagged).toEqual(
      expect.arrayContaining([
        { title: 'Plastic Dreams (Long Version)', trackNumber: 'A1', album: 'Plastic Dreams' },
        { title: 'Plastic Dreams (Radio)', trackNumber: 'A2', album: 'Plastic Dreams' },
        { title: 'Plastic Dreams (Dub)', trackNumber: 'B1', album: 'Plastic Dreams' },
      ]),
    )
  })

  it('cuts the silence before and after each side', async () => {
    for (const f of listFiles(output)) {
      const source = surco.tracks().find((t) => basename(t.outputPath ?? '') === f)
      const { duration } = await readMeta(join(output, f))
      expect(duration ?? 0, f).toBeLessThan((source?.duration ?? 0) - 2)
    }
  })

  it('repairs the clicks', async () => {
    expect(Math.max(...clicksBefore.values())).toBeGreaterThan(5)
    for (const f of listFiles(output)) expect(await clicksIn(join(output, f)), f).toBeLessThan(3)
  })

  it('brings the loudest peak to −1 dBFS', () => {
    for (const f of listFiles(output))
      expect(loudness(join(output, f)).truePeak, f).toBeLessThanOrEqual(-0.9)
  })
})
