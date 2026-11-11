import { statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import {
  beatDataBlob,
  overviewBlob,
  quickCuesBlob,
  trackDataBlob,
} from '../../main/enginePerformanceFixture'
import { writeEngineLibraryFixture } from '../../main/enginePlaylistsFixture'
import type { TestLibrary } from './testLibrary'

const RATE = 44100

export const engineLibrary: TestLibrary = {
  build: ({ root }, tracks, listName) => {
    const dir = join(root, 'Engine Library')
    const db = writeEngineLibraryFixture(dir, {
      tracks: tracks.map((t, i) => ({
        id: i + 1,
        path: relative(dir, t.path),
        title: t.title,
        artist: t.artist,
        length: t.durationSec,
      })),
      playlists: [{ id: 1, title: listName, parentListId: 0, nextListId: 0 }],
      entities: tracks.map((_, i) => ({
        id: i + 1,
        listId: 1,
        trackId: i + 1,
        nextEntityId: i + 1 < tracks.length ? i + 2 : 0,
      })),
      performance: tracks.map((t, i) => {
        const samples = RATE * t.durationSec
        return {
          trackId: i + 1,
          trackData: trackDataBlob(RATE, samples),
          beatData: beatDataBlob(RATE, samples, [
            [0, 0],
            [samples, (t.durationSec * 120) / 60],
          ]),
          quickCues: quickCuesBlob([]),
          overviewWaveFormData: overviewBlob([[10, 20, 30]]),
        }
      }),
    })
    try {
      for (const [i, t] of tracks.entries())
        db.prepare('UPDATE Track SET fileType = ?, fileBytes = ? WHERE id = ?').run(
          extname(t.path).slice(1).toLowerCase(),
          statSync(t.path).size,
          i + 1,
        )
    } finally {
      db.close()
    }
    return { syncEngineDj: true, addToEngineDj: true, engineLibraryDir: dir }
  },
  formatProblems: () => [],
}
