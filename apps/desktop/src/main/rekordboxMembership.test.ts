import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openRekordboxDb } from './rekordboxDb'
import { readMembership } from './rekordboxMembership'
import {
  ORGANISE_FIXTURE,
  TWIN_PATHS,
  writeRekordboxPlaylistFixture,
} from './rekordboxPlaylistsFixture'

describe('readMembership', () => {
  it('lists the playlists of each file the collection holds once', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbmember-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const db = openRekordboxDb(path, { readonly: true })
    if (!db) throw new Error('did not open')
    const read = readMembership(
      db,
      [
        '/Volumes/Public/Music/Play This Song.wav',
        '/Volumes/Public/Music/Gowan.wav',
        '/Users/dj/Music/Music/Ekkah.wav',
        '/nowhere/x.wav',
      ],
      TWIN_PATHS,
    )
    expect(read['/Volumes/Public/Music/Play This Song.wav'].sort()).toEqual(['2000', '3000'])
    expect(read['/Volumes/Public/Music/Gowan.wav']).toEqual([])
    expect('/Users/dj/Music/Music/Ekkah.wav' in read).toBe(false)
    expect('/nowhere/x.wav' in read).toBe(false)
    db.close()
  })

  it('reads the collection once however many files are asked, since a selection of thousands otherwise freezes the app', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbmember-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const db = openRekordboxDb(path, { readonly: true })
    if (!db) throw new Error('did not open')
    const prepare = db.prepare.bind(db)
    let contentReads = 0
    db.prepare = ((sql: string) => {
      if (/FROM djmdContent/.test(sql)) contentReads += 1
      return prepare(sql)
    }) as typeof db.prepare
    const read = readMembership(
      db,
      [
        '/Volumes/Public/Music/Play This Song.wav',
        '/Volumes/Public/Music/Gowan.wav',
        '/Volumes/Public/Music/PLAY THIS SONG.wav',
        '/nowhere/x.wav',
      ],
      TWIN_PATHS,
    )
    expect(contentReads).toBe(1)
    expect(read['/Volumes/Public/Music/Play This Song.wav'].sort()).toEqual(['2000', '3000'])
    expect(read['/Volumes/Public/Music/PLAY THIS SONG.wav'].sort()).toEqual(['2000', '3000'])
    db.close()
  })
})
