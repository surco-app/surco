// @vitest-environment jsdom
import { existsSync } from 'node:fs'
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
vi.mock('../main/rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { music } from './fakeMusic'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'
import { makeRekordbox, type RekordboxRow, rekordboxRow } from './rekordboxFixture'

describe('Your music lives in Apple Music and you organise it in rekordbox', () => {
  let surco: Scenario
  let recognised: boolean
  let row: RekordboxRow
  let media: string

  beforeAll(async () => {
    const root = scenarioDir('music-rekordbox')
    const mp3 = makeTrack(join(root, 'Music', 'Show Me Love.mp3'), {
      title: 'Show me love',
      artist: 'Robin S',
      signal: 'kick',
    })
    music.reset()
    media = join(root, 'Media')
    music.state.mediaFolder = media
    music.addEntry({ location: mp3, title: 'Show me love', artist: 'Robin S', durationSec: 8 })
    const db = makeRekordbox(join(root, 'rekordbox'), [
      {
        id: '900001',
        path: mp3,
        title: 'Show me love',
        artist: 'Robin S',
        genre: 'House',
        fileType: 1,
        bpm: 12000,
        keyId: 'k8A',
        playlists: ['pl-peak'],
        cuesMs: [32000],
      },
    ])
    surco = await openSurco({
      settings: { outputFormat: 'aiff', syncRekordbox: true, rekordboxDbPath: db },
      destination: 'appleMusic',
    })
    await surco.drop(mp3)
    surco.editMeta('Show Me Love.mp3', {
      title: 'Show Me Love',
      album: 'Show Me Love',
      publisher: 'Champion',
      year: '1993',
      comment: 'Peak time',
      genre: '',
    })
    recognised = (await surco.convertInEditor('Show Me Love.mp3')).replaces
    row = rekordboxRow(db, '900001')
  }, 120_000)

  it('recognises the track it already has in Apple Music', () => {
    expect(recognised).toBe(true)
  })

  it('updates Apple Music and rekordbox together, onto the new file', () => {
    expect(music.state.added).toHaveLength(1)
    expect(row.path).toBe(join(media, 'Show Me Love.aiff'))
    expect(existsSync(row.path)).toBe(true)
  })

  it('brings the corrected title, album, label, comment and year to rekordbox', () => {
    expect(row).toMatchObject({
      title: 'Show Me Love',
      artist: 'Robin S',
      album: 'Show Me Love',
      label: 'Champion',
      comment: 'Peak time',
      year: 1993,
    })
  })

  it('does not erase in rekordbox a field left empty in Surco', () => {
    expect(row.genre).toBe('House')
  })

  it('keeps the track in its playlists with its cues, BPM and key', () => {
    expect(row).toMatchObject({ playlists: ['pl-peak'], cuesMs: [32000], bpm: 12000, keyId: 'k8A' })
  })

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
  })
})
