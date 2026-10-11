// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/applemusic', async (original) => ({
  ...(await import('./fakeMusic')).appleMusicModule(await original()),
  scenarioFake: true,
}))
vi.mock('../main/appleMusicPlaylists', async () => (await import('./fakeMusic')).playlistsModule())
vi.mock('../main/appleMusicArtwork', async (original) =>
  (await import('./fakeMusic')).artworkModule(await original()),
)

import { readTags } from '../main/ffmpeg'
import { music } from './fakeMusic'
import { coverJpg, embeddedCover, listFiles, makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'

function sha1(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex')
}

describe('Build a set from an Apple Music playlist', () => {
  let library: string
  let output: string
  let surco: Scenario
  let imported: Awaited<ReturnType<Scenario['importPlaylist']>>
  let importedEmpty: Awaited<ReturnType<Scenario['importPlaylist']>>
  const bytes = new Map<string, string>()

  beforeAll(async () => {
    library = scenarioDir('music-library')
    output = scenarioDir('set')
    const wav = makeTrack(join(library, 'Show Me Love.wav'), {
      title: 'Show Me Love',
      artist: 'Robin S',
    })
    const flac = makeTrack(join(library, 'Tagged.flac'), { title: 'Tagged', artist: 'Someone' })
    for (const file of listFiles(library)) bytes.set(file, sha1(join(library, file)))
    music.reset()
    const fromMusic = music.addEntry({
      location: wav,
      title: 'Show Me Love',
      artist: 'Robin S',
      album: 'Show Me Love',
      year: 1993,
      artwork: coverJpg(join(scenarioDir('art'), 'robin.jpg')),
    })
    const streaming = music.addEntry({ location: null, title: 'Streamed', artist: 'Cloud' })
    const tagged = music.addEntry({ location: flac, title: 'Tagged', artist: 'Someone' })
    const friday = music.addPlaylist({
      name: 'Friday',
      entries: [fromMusic.persistentId, streaming.persistentId, tagged.persistentId],
    })
    const empty = music.addPlaylist({ name: 'Empty', entries: [] })

    surco = await openSurco({ settings: { outputDir: output }, destination: 'folder' })
    importedEmpty = await surco.importPlaylist(empty.persistentId, 'Empty')
    imported = await surco.importPlaylist(friday.persistentId, 'Friday')
    await surco.convertAll('confirm', 'aiff')
  }, 120_000)

  it('loads the files on disk and counts the streaming ones apart', () => {
    expect(imported).toEqual({ name: 'Friday', imported: 2, missing: 1 })
  })

  it('reports an empty playlist as empty, not as one track without a file', () => {
    expect(importedEmpty).toEqual({ name: 'Empty', imported: 0, missing: 0 })
  })

  it('puts a copy of every file in the chosen format in the folder', () => {
    expect(listFiles(output)).toHaveLength(2)
    expect(listFiles(output).every((f) => f.endsWith('.aiff'))).toBe(true)
  })

  it('takes from Music what the file lacks, like the year and the cover', async () => {
    const copy = listFiles(output).find((f) => f.includes('Show Me'))
    expect(copy).toBeDefined()
    const path = join(output, copy as string)
    expect(await readTags(path)).toMatchObject({
      title: 'Show Me Love',
      artist: 'Robin S',
      year: '1993',
    })
    expect(embeddedCover(path)).not.toBeNull()
  })

  it('leaves the Apple Music files exactly as they were and adds nothing to Music', () => {
    for (const [file, sha] of bytes) expect(sha1(join(library, file)), file).toBe(sha)
    expect(music.state.added).toEqual([])
  })

  it('runs without a single error the user would see, and skips nothing', () => {
    expect(surco.errors).toEqual([])
    expect(surco.summary()).toMatchObject({ converted: 2, skipped: 0, failed: 0 })
  })
})
