// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { readTags } from '../main/ffmpeg'
import { diffSnapshots, snapshotTags } from '../main/tagSnapshot'
import { readTraktorCueStart, storedTree } from '../main/traktor4Fixture'
import { ALLOWED_UPDATE_CHANGES, unexplainedChanges } from '../main/updateContract'
import i18n from '../renderer/src/i18n'
import { coverOf } from '../renderer/src/lib/release'
import {
  audioMd5,
  coverJpg,
  DROP_MS,
  embeddedCover,
  listFiles,
  makeTrack,
  release,
  scenarioDir,
} from './fixtures'
import { openSurco, type Scenario } from './harness'

function sha1(data: Buffer | null): string {
  return data ? createHash('sha1').update(data).digest('hex') : 'no cover'
}

const movinMelodies = release({
  tracklist: [
    { position: 'A1', title: 'Till I Come', artists: [{ name: 'ATB' }] },
    { position: 'A2', title: '9 PM', artists: [{ name: 'ATB' }] },
  ],
})

describe('Tag and add covers to a whole folder, without making copies', () => {
  let folder: string
  let surco: Scenario
  const before = new Map<string, { md5: string; tags: string[] }>()

  beforeAll(async () => {
    folder = scenarioDir('in-place')
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
      grouping: 'Warm-up',
      publisher: 'White Label',
      bpm: 124,
      comment: 'Energy 6',
      coverJpg: coverJpg(join(scenarioDir('cover'), 'own.jpg')),
      withCues: true,
    })
    makeTrack(join(folder, 'Vinyl', 'Untouched.wav'), {
      title: 'Untouched',
      artist: 'Somebody Else',
      album: 'Never Matched',
      grouping: 'Peak',
      publisher: 'Dub Label',
      bpm: 128,
      withCues: true,
    })
    for (const file of listFiles(folder)) {
      const path = join(folder, file)
      before.set(file, { md5: audioMd5(path), tags: snapshotTags(path) })
    }

    surco = await openSurco({
      settings: { outputFormat: 'source', backupPolicy: 'always' },
      destination: 'overwrite',
    })
    await surco.drop(folder)
    surco.acceptMatch('till i come.mp3', movinMelodies, 'A1')
    surco.acceptMatch('9pm.flac', movinMelodies, 'A2')
    await surco.convertAll()
  }, 60_000)

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
    expect(surco.sentToAppleMusic).toEqual([])
    expect(surco.tracks().map((t) => [basename(t.inputPath), t.status])).toEqual([
      ['till i come.mp3', 'done'],
      ['9pm.flac', 'done'],
      ['Unsure.aiff', 'done'],
      ['Untouched.wav', 'done'],
    ])
  })

  it('asks once before touching the files', () => {
    expect(surco.prompts.map((p) => p.title)).toEqual([i18n.t('confirm.convertInPlaceTitle')])
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

  it('embeds the cover of the match as it came, without re-encoding it', () => {
    const fromRelease = sha1(Buffer.from(coverOf(movinMelodies)?.split(',')[1] ?? '', 'base64'))
    for (const file of ['till i come.mp3', join('Vinyl', '9pm.flac')]) {
      expect(sha1(embeddedCover(join(folder, file))), file).toBe(fromRelease)
    }
  })

  it('keeps the tags of the tracks the user left unconfirmed', () => {
    for (const [name, ext] of [
      ['Unsure.aiff', 'aiff'],
      ['Untouched.wav', 'wav'],
    ] as const) {
      const file = join('Vinyl', name)
      const { added, removed } = diffSnapshots(
        before.get(file)?.tags ?? [],
        snapshotTags(join(folder, file)),
      )
      expect(unexplainedChanges(added, ALLOWED_UPDATE_CHANGES[ext].added), file).toEqual([])
      expect(unexplainedChanges(removed, ALLOWED_UPDATE_CHANGES[ext].removed), file).toEqual([])
    }
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
