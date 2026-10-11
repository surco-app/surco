// @vitest-environment jsdom
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { act, waitFor } from '@testing-library/react'
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
vi.mock('../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))

import { buildEngineDatabase, type EngineTrack, loadSqlJs } from '../main/engine'
import type { MusicReview } from '../renderer/src/hooks/useMusicReview'
import { osTrash } from './electronFake'
import { music } from './fakeMusic'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'

function engineTrack(file: string): EngineTrack {
  return {
    relativePath: `../Music/${file}`,
    filename: file,
    fileType: file.split('.').pop() ?? '',
    fileBytes: 1,
    title: 'One More Time',
    artist: 'Daft Punk',
    album: '',
    genre: '',
    comment: '',
    bpm: 123,
    bpmAnalyzed: 123,
    year: null,
    durationSec: 4,
    rating: 0,
  }
}

async function enginePlaylist(mdb: string): Promise<unknown[]> {
  const SQL = await loadSqlJs()
  const db = new SQL.Database(readFileSync(mdb))
  try {
    return (
      db.exec(
        "SELECT t.filename FROM PlaylistEntity e JOIN Track t ON t.id = e.trackId JOIN Playlist p ON p.id = e.listId WHERE p.title = 'Warm-up'",
      )[0]?.values ?? []
    ).flat()
  } finally {
    db.close()
  }
}

describe.skipIf(process.platform !== 'darwin')(
  'Remove the repeated tracks from Apple Music',
  () => {
    let files: string
    let mdb: string
    let surco: Scenario
    let review: () => MusicReview
    let keptByDefault: string
    let mp3Pid: string
    let aiffPid: string
    let warmUp: string

    beforeAll(async () => {
      const root = scenarioDir('music-duplicates')
      files = join(root, 'Music')
      const mp3 = makeTrack(join(files, 'One More Time.mp3'), {
        title: 'One More Time',
        artist: 'Daft Punk',
      })
      const aiff = makeTrack(join(files, 'One More Time.aiff'), {
        title: 'One More Time',
        artist: 'Daft Punk',
      })
      music.reset()
      mp3Pid = music.addEntry({
        location: mp3,
        title: 'One More Time',
        artist: 'Daft Punk',
        durationSec: 4,
      }).persistentId
      aiffPid = music.addEntry({
        location: aiff,
        title: 'One More Time',
        artist: 'Daft Punk',
        durationSec: 4,
      }).persistentId
      warmUp = music.addPlaylist({ name: 'Warm-up', entries: [mp3Pid] }).persistentId
      const library = join(root, 'Engine Library')
      mdb = join(library, 'Database2', 'm.db')
      mkdirSync(join(library, 'Database2'), { recursive: true })
      writeFileSync(mdb, await buildEngineDatabase([engineTrack('One More Time.mp3')], 'Warm-up'))

      surco = await openSurco({ settings: { engineLibraryDir: library, syncEngineDj: true } })
      review = await surco.openMusicReview('duplicates')
      await waitFor(() =>
        expect(Object.keys(review().duplicates[0]?.locations ?? {})).toHaveLength(2),
      )
      const card = review().duplicates[0]
      keptByDefault = review().choice(card.group.key) ?? ''
      act(() => review().toggleStaged(card.group.key))
      await act(async () => review().apply())
      await act(async () => review().undo())
    }, 120_000)

    it('keeps the copy in the better format by default', () => {
      expect(keptByDefault).toBe(aiffPid)
    })

    it('puts the kept copy in the playlists of the removed one, in Apple Music', () => {
      expect(music.playlist(warmUp)?.entries).toEqual([aiffPid])
      expect(music.entry(mp3Pid)).toBeUndefined()
    })

    it('moves the playlist entry in Engine DJ onto the kept copy', async () => {
      expect(await enginePlaylist(mdb)).toEqual(['One More Time.aiff'])
    })

    it('sends the removed file to the Trash, and Undo does not bring it back', () => {
      expect(osTrash.map((p) => basename(p))).toEqual(['One More Time.mp3'])
      expect(existsSync(join(files, 'One More Time.mp3'))).toBe(false)
    })

    it('runs without a single error the user would see', () => {
      expect(surco.errors).toEqual([])
    })
  },
)
