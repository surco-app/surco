// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { readTags } from '../main/ffmpeg'
import { readTraktorCueStart, storedTree } from '../main/traktor4Fixture'
import { audioMd5, coverJpg, DROP_MS, embeddedCover, listFiles, makeTrack } from './fixtures'
import { openSurco, type Scenario } from './harness'

function sha1(data: Buffer | null): string {
  return data ? createHash('sha1').update(data).digest('hex') : 'no cover'
}

describe('Move your collection to AIFF without losing the cue points', () => {
  let folder: string
  let surco: Scenario
  const original = new Map<string, { bytes: string; md5: string }>()

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'surco-to-aiff-'))
    const cover = coverJpg(join(mkdtempSync(join(tmpdir(), 'surco-cover-')), 'front.jpg'))
    makeTrack(join(folder, 'Stardust.flac'), {
      title: 'Music Sounds Better With You',
      artist: 'Stardust',
      album: 'Music Sounds Better With You',
      grouping: 'Classics',
      publisher: 'Roulé',
      bpm: 124,
      coverJpg: cover,
      withCues: true,
    })
    makeTrack(join(folder, 'Vinyl rip.wav'), {
      title: 'Plastic Dreams',
      artist: 'Jaydee',
      album: 'Plastic Dreams',
      publisher: 'R&S',
      withCues: true,
    })
    makeTrack(join(folder, 'Promo.mp3'), { title: 'Promo', artist: 'Someone', withCues: true })
    makeTrack(join(folder, 'Already.aiff'), { title: 'Already', artist: 'Done', withCues: true })
    for (const file of listFiles(folder)) {
      const path = join(folder, file)
      original.set(file, { bytes: sha1(readFileSync(path)), md5: audioMd5(path) })
    }

    surco = await openSurco({
      settings: { outputFormat: 'aiff', keepMp3Sources: true },
      destination: 'beside',
    })
    await surco.drop(folder)
    await surco.convertAll()
  }, 60_000)

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
    expect(surco.sentToAppleMusic).toEqual([])
  })

  it('writes each AIFF next to its original, and the "(2)" the recipe warns about for one that already was AIFF', () => {
    expect(listFiles(folder)).toEqual(
      [
        'Already (2).aiff',
        'Already.aiff',
        'Promo.mp3',
        'Stardust.aiff',
        'Stardust.flac',
        'Vinyl rip.aiff',
        'Vinyl rip.wav',
      ].sort(),
    )
  })

  it('does not touch a single byte of the originals', () => {
    for (const [file, { bytes }] of original)
      expect(sha1(readFileSync(join(folder, file))), file).toBe(bytes)
  })

  it('keeps the MP3 as it is', () => {
    const mp3 = surco.tracks().find((t) => basename(t.inputPath) === 'Promo.mp3')
    expect(mp3?.outputPath).toBeUndefined()
  })

  it('loses nothing of the sound going from FLAC or WAV to AIFF', () => {
    expect(audioMd5(join(folder, 'Stardust.aiff'))).toBe(original.get('Stardust.flac')?.md5)
    expect(audioMd5(join(folder, 'Vinyl rip.aiff'))).toBe(original.get('Vinyl rip.wav')?.md5)
  })

  it('carries the Traktor cue points into the AIFF from FLAC and WAV', () => {
    for (const file of ['Stardust.aiff', 'Vinyl rip.aiff']) {
      const tree = storedTree(join(folder, file))
      expect(tree, `${file} lost its cues`).not.toBeNull()
      expect(readTraktorCueStart(tree as Uint8Array, 1), file).toBeCloseTo(DROP_MS, 2)
    }
  })

  it('keeps the cover, which AIFF holds and WAV could not show', () => {
    expect(sha1(embeddedCover(join(folder, 'Stardust.aiff')))).toBe(
      sha1(embeddedCover(join(folder, 'Stardust.flac'))),
    )
  })

  it('carries the tags a DJ relies on into the AIFF', async () => {
    expect(await readTags(join(folder, 'Stardust.aiff'))).toMatchObject({
      title: 'Music Sounds Better With You',
      artist: 'Stardust',
      grouping: 'Classics',
      publisher: 'Roulé',
      bpm: '124',
    })
    expect(await readTags(join(folder, 'Vinyl rip.aiff'))).toMatchObject({
      title: 'Plastic Dreams',
      artist: 'Jaydee',
      album: 'Plastic Dreams',
      publisher: 'R&S',
    })
  })
})
