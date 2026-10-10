// @vitest-environment jsdom
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { readTags } from '../main/ffmpeg'
import { getSettings } from '../main/settings'
import { audioMd5, listFiles, makeTrack } from './fixtures'
import { openSurco, type Scenario } from './harness'

const fromSmb = (name: string): string => name.normalize('NFD')

describe('Your music on a NAS', () => {
  describe('tag and convert as always, with accent-free file names', () => {
    let share: string
    let surco: Scenario

    beforeAll(async () => {
      share = mkdtempSync(join(tmpdir(), 'surco-nas-'))
      makeTrack(join(share, fromSmb('Röyksopp - Eple.flac')), {
        title: 'Eple',
        artist: 'Röyksopp',
      })
      makeTrack(join(share, 'Techno', fromSmb('Mylène Farmer - Désenchantée.wav')), {
        title: 'Désenchantée',
        artist: 'Mylène Farmer',
      })
      surco = await openSurco({ settings: { asciiFileNames: true }, destination: 'beside' })
      await surco.drop(share)
      await surco.convertAll()
    }, 60_000)

    it('runs without a single error the user would see', () => {
      expect(surco.errors).toEqual([])
    })

    it('writes "Royksopp" in the file name instead of "Röyksopp"', () => {
      expect(listFiles(share).map((f) => f.normalize('NFC'))).toEqual([
        'Royksopp - Eple.aiff',
        'Röyksopp - Eple.flac',
        'Techno/Mylene Farmer - Desenchantee.aiff',
        'Techno/Mylène Farmer - Désenchantée.wav',
      ])
    })

    it('keeps the accents in the tags', async () => {
      expect(await readTags(join(share, 'Royksopp - Eple.aiff'))).toMatchObject({
        artist: 'Röyksopp',
      })
      expect(
        await readTags(join(share, 'Techno', 'Mylene Farmer - Desenchantee.aiff')),
      ).toMatchObject({ artist: 'Mylène Farmer', title: 'Désenchantée' })
    })
  })

  describe('backups: "Only if the audio changes", as it ships', () => {
    let share: string
    let surco: Scenario
    let trimmedBefore: string

    beforeAll(async () => {
      share = mkdtempSync(join(tmpdir(), 'surco-nas-backups-'))
      makeTrack(join(share, 'Retag.flac'), { title: 'Retag', artist: 'Someone' })
      makeTrack(join(share, 'Trim.flac'), { title: 'Trim', artist: 'Someone' })
      trimmedBefore = audioMd5(join(share, 'Trim.flac'))
      surco = await openSurco({ settings: { outputFormat: 'source' }, destination: 'overwrite' })
      await surco.drop(share)
      surco.editMeta('Retag.flac', { album: 'Fixed On The NAS' })
      surco.patchTrack('Trim.flac', { trim: { startSec: 1 } })
      await surco.convertAll()
    }, 60_000)

    it('ships with "Only if the audio changes"', () => {
      expect(getSettings().backupPolicy).toBe('audioChanges')
    })

    it('runs without a single error the user would see', () => {
      expect(surco.errors).toEqual([])
    })

    it('keeps no copy of a file whose tags alone changed', async () => {
      expect(await readTags(join(share, 'Retag.flac'))).toMatchObject({
        album: 'Fixed On The NAS',
      })
      const backedUp = (await surco.trash.list()).map((e) => e.originalPath)
      expect(backedUp).not.toContain(join(share, 'Retag.flac'))
    })

    it('keeps a copy of the file whose audio a trim re-encoded', async () => {
      expect(audioMd5(join(share, 'Trim.flac'))).not.toBe(trimmedBefore)
      const backedUp = (await surco.trash.list()).map((e) => e.originalPath)
      expect(backedUp).toEqual([join(share, 'Trim.flac')])
    })
  })
})
