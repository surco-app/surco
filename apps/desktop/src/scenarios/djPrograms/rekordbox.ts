import { mkdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { openRekordboxDb } from '../../main/rekordboxDb'
import { writeRekordboxExportFixture } from '../../main/rekordboxExportFixture'
import { REKORDBOX_FILE_TYPE } from '../matrix/libraries'
import type { TestLibrary } from './testLibrary'

const LIST_ID = '70001'

export const rekordboxLibrary: TestLibrary = {
  build: ({ root }, tracks, listName) => {
    const dir = join(root, 'rekordbox')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'master.db')
    const ids = tracks.map((_, i) => String(60001 + i))
    writeRekordboxExportFixture(path, {
      dbId: '123456789',
      content: tracks.map((t, i) => ({
        ID: ids[i],
        FolderPath: t.path,
        FileType: REKORDBOX_FILE_TYPE[extname(t.path).toLowerCase()],
        Title: t.title,
        Length: t.durationSec,
        FileSize: statSync(t.path).size,
        ArtistID: 'artist-1',
      })),
      artists: [{ ID: 'artist-1', Name: tracks[0]?.artist ?? '' }],
      keys: [],
      playlists: [{ ID: LIST_ID, Name: listName, Attribute: 0, ParentID: 'root', Seq: 1 }],
      links: ids.map((id, i) => ({ PlaylistID: LIST_ID, ContentID: id, TrackNo: i + 1 })),
      xml: true,
    })
    return { syncRekordbox: true, addToRekordbox: true, rekordboxDbPath: path }
  },
  formatProblems: () => [],
  storedCuesMs: ({ rekordboxDbPath }, path) => {
    const db = openRekordboxDb(rekordboxDbPath ?? '', { readonly: true })
    if (!db) throw new Error('battery: rekordbox library unreadable')
    try {
      return (
        db
          .prepare(
            `SELECT c.InMsec FROM djmdCue c JOIN djmdContent t ON t.ID = c.ContentID
             WHERE t.FolderPath = ? AND coalesce(c.rb_local_deleted, 0) = 0 AND c.Kind > 0
             ORDER BY c.InMsec`,
          )
          .all(path) as { InMsec: number }[]
      ).map((row) => row.InMsec)
    } finally {
      db.close()
    }
  },
}
