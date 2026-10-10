// @vitest-environment jsdom
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { readMeta, readTags } from '../main/ffmpeg'
import { readTraktorCueStart, storedTree } from '../main/traktor4Fixture'
import type { TrackMetadata } from '../shared/types'
import { audioMd5, DROP_MS, listFiles, makeTrack, release } from './fixtures'
import { openSurco, type Scenario } from './harness'

const movinMelodies = release({
  tracklist: [
    { position: 'A1', title: 'Till I Come', artists: [{ name: 'ATB' }] },
    { position: 'A2', title: '9 PM', artists: [{ name: 'ATB' }] },
  ],
})

describe('Tag and add covers to a whole folder, without making copies', () => {
  let folder: string
  let surco: Scenario
  const before = new Map<string, { md5: string; tags: TrackMetadata }>()

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'surco-in-place-'))
    makeTrack(join(folder, 'till i come.mp3'), {
      title: 'till i come',
      artist: 'ATB',
      withCues: true,
    })
    makeTrack(join(folder, 'Vinyl', '9pm.flac'), { title: '9pm', artist: 'ATB', withCues: true })
    makeTrack(join(folder, 'Vinyl', 'Unsure.aiff'), {
      title: 'Unsure',
      artist: 'Someone',
      album: 'Left As It Was',
      withCues: true,
    })
    for (const file of listFiles(folder)) {
      const path = join(folder, file)
      before.set(file, { md5: audioMd5(path), tags: await readTags(path) })
    }

    surco = await openSurco({
      settings: { outputFormat: 'source', overwriteOriginal: true, backupPolicy: 'always' },
    })
    await surco.drop(folder)
    surco.acceptMatch('till i come.mp3', movinMelodies, 'A1')
    surco.acceptMatch('9pm.flac', movinMelodies, 'A2')
    await surco.convertAll()
  }, 60_000)

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
    expect(surco.tracks().map((t) => [basename(t.inputPath), t.status])).toEqual([
      ['till i come.mp3', 'done'],
      ['9pm.flac', 'done'],
      ['Unsure.aiff', 'done'],
    ])
  })

  it('leaves exactly the same files in the folder, with no copies and nothing half-written', () => {
    expect(listFiles(folder)).toEqual([...before.keys()])
  })

  it('does not change the sound, only the tags', () => {
    for (const [file, { md5 }] of before) expect(audioMd5(join(folder, file)), file).toBe(md5)
  })

  it('writes the matched data into the same files', async () => {
    const mp3 = await readTags(join(folder, 'till i come.mp3'))
    const flac = await readTags(join(folder, 'Vinyl', '9pm.flac'))
    expect(mp3).toMatchObject({
      title: 'Till I Come',
      album: 'Movin Melodies',
      publisher: 'Kontor',
    })
    expect(flac).toMatchObject({ title: '9 PM', album: 'Movin Melodies', publisher: 'Kontor' })
  })

  it('embeds the cover of the match', async () => {
    for (const file of ['till i come.mp3', join('Vinyl', '9pm.flac')]) {
      const { cover } = await readMeta(join(folder, file))
      expect(cover, file).not.toBeNull()
      expect(cover?.width, file).toBe(600)
    }
  })

  it('keeps the tags of a track the user left unconfirmed', async () => {
    const file = join('Vinyl', 'Unsure.aiff')
    expect(await readTags(join(folder, file))).toEqual(before.get(file)?.tags)
  })

  it('keeps the Traktor cue points where they were', () => {
    for (const file of before.keys()) {
      const tree = storedTree(join(folder, file))
      expect(tree, `${file} lost its cues`).not.toBeNull()
      expect(readTraktorCueStart(tree as Uint8Array, 1), file).toBeCloseTo(DROP_MS, 2)
    }
  })

  it('keeps a backup of every file it rewrote, as "Always" promises', async () => {
    const backedUp = (await surco.trash.list()).map((e) => e.originalPath).sort()
    expect(backedUp).toEqual([...before.keys()].map((f) => join(folder, f)).sort())
  })
})
