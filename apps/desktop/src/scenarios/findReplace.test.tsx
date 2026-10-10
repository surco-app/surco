// @vitest-environment jsdom
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { readTags } from '../main/ffmpeg'
import i18n from '../renderer/src/i18n'
import { audioMd5, listFiles, makeTrack } from './fixtures'
import { openSurco, type Scenario } from './harness'

describe('Clean up the titles of hundreds of tracks at once', () => {
  let folder: string
  let surco: Scenario
  let promoPreview: string
  const tagsBeforeSaving = new Map<string, string>()
  const sound = new Map<string, string>()

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'surco-find-replace-'))
    makeTrack(join(folder, 'a.mp3'), { title: 'Sing It Back (Promo Only)', artist: 'Moloko (Promo Only)' })
    makeTrack(join(folder, 'b.flac'), { title: 'Finally [FREE DOWNLOAD]', artist: 'Kings Of Tomorrow' })
    makeTrack(join(folder, 'c.aiff'), { title: 'Lady', artist: 'Modjo' })
    for (const file of listFiles(folder)) sound.set(file, audioMd5(join(folder, file)))

    surco = await openSurco({ settings: { outputFormat: 'source' }, destination: 'overwrite' })
    await surco.drop(folder)
    promoPreview = surco.findAndReplace('(Promo Only)', '')
    surco.findAndReplace('\\s*\\[FREE DOWNLOAD\\]', '', { regex: true })
    for (const file of listFiles(folder))
      tagsBeforeSaving.set(file, (await readTags(join(folder, file))).title)
    await surco.convertAll()
  }, 60_000)

  it('says how many tracks change before replacing', () => {
    expect(promoPreview).toContain(i18n.t('findReplace.summary', { fields: 2, tracks: 1 }))
  })

  it('leaves the files alone until the tags are saved', () => {
    expect(Object.fromEntries(tagsBeforeSaving)).toEqual({
      'a.mp3': 'Sing It Back (Promo Only)',
      'b.flac': 'Finally [FREE DOWNLOAD]',
      'c.aiff': 'Lady',
    })
  })

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
  })

  it('writes the cleaned title and artist, with no space left where the text was', async () => {
    expect(await readTags(join(folder, 'a.mp3'))).toMatchObject({ title: 'Sing It Back', artist: 'Moloko' })
    expect(await readTags(join(folder, 'b.flac'))).toMatchObject({ title: 'Finally' })
    expect(await readTags(join(folder, 'c.aiff'))).toMatchObject({ title: 'Lady', artist: 'Modjo' })
  })

  it('only touches the tags, never the sound', () => {
    for (const [file, md5] of sound) expect(audioMd5(join(folder, file)), file).toBe(md5)
  })
})
