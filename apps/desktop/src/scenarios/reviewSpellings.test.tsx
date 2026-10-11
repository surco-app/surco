// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { act } from '@testing-library/react'
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
import { diffSnapshots, snapshotTags } from '../main/tagSnapshot'
import type { MusicReview } from '../renderer/src/hooks/useMusicReview'
import { music } from './fakeMusic'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'

function engineTrack(file: string, artist: string): EngineTrack {
  return {
    relativePath: `../Music/${file}`,
    filename: file,
    fileType: file.split('.').pop() ?? '',
    fileBytes: 1,
    title: file,
    artist,
    album: '',
    genre: '',
    comment: '',
    bpm: 124,
    bpmAnalyzed: 124,
    year: null,
    durationSec: 4,
    rating: 0,
  }
}

async function engineArtist(mdb: string, file: string): Promise<unknown> {
  const SQL = await loadSqlJs()
  const db = new SQL.Database(readFileSync(mdb))
  try {
    return db.exec('SELECT artist FROM Track WHERE filename = ?', [file])[0]?.values[0]?.[0]
  } finally {
    db.close()
  }
}

describe.skipIf(process.platform !== 'darwin')(
  'Unify how your Apple Music library is spelled',
  () => {
    let root: string
    let mdb: string
    let surco: Scenario
    let review: () => MusicReview
    let stagedOnOpen: string[]
    let odd: { persistentId: string }
    let before: string[]
    let afterApply: string[]
    let engineAfterApply: unknown
    let backups: string[]
    let fieldsSetOnApply: unknown[]

    beforeAll(async () => {
      root = scenarioDir('music-review')
      const files = join(root, 'Music')
      makeTrack(join(files, 'a.mp3'), { title: 'Around The World', artist: 'Daft Punk' })
      makeTrack(join(files, 'b.flac'), { title: 'Da Funk', artist: 'Daft Punk' })
      const c = makeTrack(join(files, 'c.aiff'), {
        title: 'Revolution 909',
        artist: 'Daft punk',
        bpm: 124,
        withCues: true,
      })
      before = snapshotTags(c)
      music.reset()
      music.addEntry({
        location: join(files, 'a.mp3'),
        title: 'Around The World',
        artist: 'Daft Punk',
      })
      music.addEntry({ location: join(files, 'b.flac'), title: 'Da Funk', artist: 'Daft Punk' })
      odd = music.addEntry({
        location: c,
        title: 'Revolution 909',
        artist: 'Daft punk',
        bpm: 124,
        rating: 80,
        ratingKind: 'user',
      })
      const library = join(root, 'Engine Library')
      mdb = join(library, 'Database2', 'm.db')
      mkdirSync(join(library, 'Database2'), { recursive: true })
      writeFileSync(
        mdb,
        await buildEngineDatabase(
          [
            engineTrack('a.mp3', 'Daft Punk'),
            engineTrack('b.flac', 'Daft Punk'),
            engineTrack('c.aiff', 'Daft punk'),
          ],
          'Surco',
        ),
      )

      surco = await openSurco({ settings: { engineLibraryDir: library, syncEngineDj: true } })
      review = await surco.openMusicReview()
      stagedOnOpen = [...review().staged]
      const group = review().spelling.find((g) => g.kind === 'case')
      if (!group) throw new Error('scenario: no case group in the review')
      act(() => review().choose(group.key, 'Daft Punk'))
      act(() => review().toggleStaged(group.key))
      await act(async () => review().apply())
      afterApply = snapshotTags(c)
      engineAfterApply = await engineArtist(mdb, 'c.aiff')
      backups = (await surco.trash.list()).map((e) => basename(e.originalPath))
      fieldsSetOnApply = [...music.state.fieldsSet]
      await act(async () => review().undo())
    }, 120_000)

    it('puts nothing in the run on its own', () => {
      expect(stagedOnOpen).toEqual([])
    })

    it('writes the chosen spelling into the file and touches nothing else in it', () => {
      expect(diffSnapshots(before, afterApply)).toEqual({
        added: ['id3 TPE1=Daft Punk'],
        removed: ['id3 TPE1=Daft punk'],
      })
    })

    it('writes it into Apple Music too', () => {
      expect(fieldsSetOnApply).toEqual([
        expect.objectContaining({
          persistentId: odd.persistentId,
          field: 'artist',
          from: 'Daft punk',
          to: 'Daft Punk',
        }),
      ])
    })

    it('writes it into Engine DJ, which the user syncs', () => {
      expect(engineAfterApply).toBe('Daft Punk')
    })

    it('backs up the file before touching it', () => {
      expect(backups).toEqual(['c.aiff'])
    })

    it('puts everything back as it was on Undo', async () => {
      expect(snapshotTags(join(root, 'Music', 'c.aiff'))).toEqual(before)
      expect(music.entry(odd.persistentId)?.artist).toBe('Daft punk')
      expect(await engineArtist(mdb, 'c.aiff')).toBe('Daft punk')
    })

    it('runs without a single error the user would see', () => {
      expect(surco.errors).toEqual([])
    })
  },
)
