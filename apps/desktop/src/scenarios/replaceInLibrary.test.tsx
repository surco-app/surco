// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
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
vi.mock('../main/rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { osTrash } from './electronFake'
import { music } from './fakeMusic'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'
import { makeRekordbox, type RekordboxRow, rekordboxRow } from './rekordboxFixture'

describe.skipIf(process.platform !== 'darwin')(
  'Swap a track in your library for a better copy',
  () => {
    let library: string
    let media: string
    let surco: Scenario
    let replaces: boolean
    let oldPid: string
    let warmUp: string
    let row: RekordboxRow
    let osTrashAfterCleanUp: string[]

    beforeAll(async () => {
      const root = scenarioDir('replace')
      library = join(root, 'Music')
      media = join(root, 'Media')
      const old = makeTrack(join(library, 'Show Me Love.mp3'), {
        title: 'Show Me Love',
        artist: 'Robin S',
        signal: 'kick',
      })
      makeTrack(join(root, 'Downloads', 'Robin S - Show Me Love.flac'), {
        title: 'Show Me Love',
        artist: 'Robin S',
        signal: 'kick',
      })
      music.reset()
      music.state.mediaFolder = media
      oldPid = music.addEntry({
        location: old,
        title: 'Show Me Love',
        artist: 'Robin S',
        durationSec: 8,
      }).persistentId
      warmUp = music.addPlaylist({ name: 'Warm-up', entries: [oldPid] }).persistentId
      const db = makeRekordbox(join(root, 'rekordbox'), [
        {
          id: '900001',
          path: old,
          title: 'Show Me Love',
          artist: 'Robin S',
          fileType: 1,
          bpm: 12000,
          keyId: 'k8A',
          playlists: ['pl-peak', 'pl-classics'],
          cuesMs: [32000, 64000],
        },
      ])

      surco = await openSurco({
        settings: { outputFormat: 'aiff', syncRekordbox: true, rekordboxDbPath: db },
        destination: 'appleMusic',
      })
      await surco.drop(join(root, 'Downloads'))
      replaces = (await surco.convertInEditor('Robin S - Show Me Love.flac')).replaces
      row = rekordboxRow(db, '900001')
      await surco.cleanUp('Robin S - Show Me Love.flac')
      osTrashAfterCleanUp = osTrash.map((p) => basename(p))
    }, 120_000)

    it('offers to swap, since it found the song in Apple Music', () => {
      expect(replaces).toBe(true)
    })

    it('puts the new AIFF in Apple Music in place of the old copy', () => {
      expect(music.state.added.map((a) => basename(a.path))).toEqual([
        'Robin S - Show Me Love.aiff',
      ])
      expect(music.entry(oldPid)).toBeUndefined()
    })

    it('keeps the track in its rekordbox playlists, with its cues, BPM and key, now on the new file', () => {
      expect(row).toMatchObject({
        bpm: 12000,
        keyId: 'k8A',
        playlists: ['pl-peak', 'pl-classics'],
        cuesMs: [32000, 64000],
      })
      expect(row.path.startsWith(media)).toBe(true)
      expect(existsSync(row.path)).toBe(true)
    })

    it('keeps the track in its plain Music playlist, now as the new AIFF', () => {
      expect(music.playlist(warmUp)?.entries).toEqual([music.state.added[0].persistentId])
    })

    it('offers to send the old file to the Trash when it is done', () => {
      expect(osTrashAfterCleanUp).toContain('Show Me Love.mp3')
    })

    it('runs without a single error the user would see', () => {
      expect(surco.errors).toEqual([])
    })
  },
)
