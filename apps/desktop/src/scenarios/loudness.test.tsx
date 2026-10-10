// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { readTraktorCueStart, storedTree } from '../main/traktor4Fixture'
import type { NormalizeConfig } from '../shared/types'
import i18n from '../renderer/src/i18n'
import { DROP_MS, listFiles, loudness, makeTrack } from './fixtures'
import { openSurco, type Scenario } from './harness'

const STREAMING: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

function sha1(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex')
}

function expectStreaming(path: string): void {
  const { integrated, truePeak } = loudness(path)
  expect(Math.abs(integrated + 14), path).toBeLessThanOrEqual(0.5)
  expect(truePeak, path).toBeLessThanOrEqual(-1 + 0.1)
}

describe('Even out the volume of a whole folder', () => {
  describe('next to the originals', () => {
    let folder: string
    let surco: Scenario

    beforeAll(async () => {
      folder = mkdtempSync(join(tmpdir(), 'surco-loudness-'))
      makeTrack(join(folder, 'Loud.flac'), { title: 'Loud', artist: 'A', signal: 'kick', withCues: true })
      makeTrack(join(folder, 'Quiet.wav'), { title: 'Quiet', artist: 'B', withCues: true })
      surco = await openSurco({ settings: { normalize: STREAMING }, destination: 'beside' })
      await surco.drop(folder)
      await surco.convertAll()
    }, 60_000)

    it('runs without a single error the user would see', () => {
      expect(surco.errors).toEqual([])
    })

    it('brings every track to Streaming −14 under the −1 dBTP ceiling', () => {
      expectStreaming(join(folder, 'Loud.aiff'))
      expectStreaming(join(folder, 'Quiet.aiff'))
    })

    it('keeps the Traktor cue points', () => {
      for (const file of ['Loud.aiff', 'Quiet.aiff']) {
        const tree = storedTree(join(folder, file))
        expect(tree, `${file} lost its cues`).not.toBeNull()
        expect(readTraktorCueStart(tree as Uint8Array, 1), file).toBeCloseTo(DROP_MS, 2)
      }
    })
  })

  describe('in place, with an MP3 in the folder', () => {
    let folder: string
    let surco: Scenario
    let afterFirst: { integrated: number; truePeak: number }

    beforeAll(async () => {
      folder = mkdtempSync(join(tmpdir(), 'surco-loudness-in-place-'))
      makeTrack(join(folder, 'Master.flac'), { title: 'Master', artist: 'A', signal: 'kick' })
      makeTrack(join(folder, 'Promo.mp3'), { title: 'Promo', artist: 'B' })
      surco = await openSurco({
        settings: { normalize: STREAMING, outputFormat: 'source' },
        destination: 'overwrite',
      })
      await surco.drop(folder)
      await surco.convertAll()
      afterFirst = loudness(join(folder, 'Master.flac'))
      await surco.convertAll()
    }, 60_000)

    it('runs without a single error the user would see', () => {
      expect(surco.errors).toEqual([])
    })

    it('asks before re-encoding the MP3, since that loses quality', () => {
      expect(surco.prompts[0]?.title).toBe(i18n.t('confirm.convertLossyReencodeTitle'))
    })

    it('does not raise a track again when it is saved a second time', () => {
      expectStreaming(join(folder, 'Master.flac'))
      expect(loudness(join(folder, 'Master.flac')).integrated).toBeCloseTo(afterFirst.integrated, 0)
    })

    it('keeps the files where they were', () => {
      expect(listFiles(folder)).toEqual(['Master.flac', 'Promo.mp3'])
    })
  })

  describe('when the user says no to re-encoding the MP3', () => {
    it('leaves the MP3 exactly as it was', async () => {
      const folder = mkdtempSync(join(tmpdir(), 'surco-loudness-declined-'))
      makeTrack(join(folder, 'Promo.mp3'), { title: 'Promo', artist: 'B' })
      const before = sha1(join(folder, 'Promo.mp3'))
      const surco = await openSurco({
        settings: { normalize: STREAMING, outputFormat: 'source' },
        destination: 'overwrite',
      })
      await surco.drop(folder)
      await surco.convertAll('cancel')
      expect(surco.prompts).toHaveLength(1)
      expect(sha1(join(folder, 'Promo.mp3'))).toBe(before)
    }, 60_000)
  })
})
