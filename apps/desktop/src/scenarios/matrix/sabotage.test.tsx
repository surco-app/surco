// @vitest-environment jsdom
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { relative } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { File as TagFile } from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../electronFake')).electronFake())
vi.mock('../../main/applemusic', async (original) => ({
  ...(await import('../fakeMusic')).appleMusicModule(await original()),
  scenarioFake: true,
}))
vi.mock('../../main/appleMusicPlaylists', async () =>
  (await import('../fakeMusic')).playlistsModule(),
)
vi.mock('../../main/appleMusicArtwork', async (original) =>
  (await import('../fakeMusic')).artworkModule(await original()),
)
vi.mock('../../main/rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))
vi.mock('../../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))
vi.mock('../../main/traktorProcess', () => ({ isTraktorRunning: vi.fn(async () => false) }))

import { decodeQuickCues, inflateEngineBlob } from '../../main/engineBlobs'
import { engineDbPath } from '../../main/enginePlaylistsFixture'
import { openRekordboxDb } from '../../main/rekordboxDb'
import { music } from '../fakeMusic'
import { CELLS } from './cells'
import { engineSeededCues, type LibrarySet, type SeededTrack, traktorEntryOf } from './libraries'
import { pcmSha1 } from './oracle'
import { agreement } from './report'
import { runGroup } from './run'
import {
  BROKEN_KEY_SUFFIX,
  duplicateRowId,
  MOVED_CUE_MS,
  OTHER_TITLE,
  SABOTAGES,
  traktorKeyOf,
} from './sabotage'
import { SEEDED_CUES_MS, TRICKY } from './sources'

type Reread = (set: LibrarySet, t: SeededTrack, written: string) => boolean

function tagsOf<T>(path: string, read: (f: TagFile) => T): T {
  const f = TagFile.createFromPath(path)
  try {
    return read(f)
  } finally {
    f.dispose()
  }
}

function rekordboxRead<T>(set: LibrarySet, read: (db: Database.Database) => T): T {
  const db = openRekordboxDb(set.rekordboxDb as string, { readonly: true })
  if (!db) throw new Error('rekordbox unreadable')
  try {
    return read(db)
  } finally {
    db.close()
  }
}

const rekordboxRow = (set: LibrarySet, id: string) =>
  rekordboxRead(
    set,
    (db) =>
      db.prepare('SELECT * FROM djmdContent WHERE ID = ?').get(id) as
        | Record<string, unknown>
        | undefined,
  )

const rekordboxCues = (set: LibrarySet, t: SeededTrack) =>
  rekordboxRead(set, (db) =>
    (
      db
        .prepare('SELECT InMsec FROM djmdCue WHERE ContentID = ? AND rb_local_deleted = 0')
        .all(t.rekordboxId) as { InMsec: number }[]
    ).map((c) => c.InMsec),
  )

function engineRead<T>(set: LibrarySet, read: (db: Database.Database) => T): T {
  const db = new Database(engineDbPath(set.engineDir as string), { readonly: true })
  try {
    return read(db)
  } finally {
    db.close()
  }
}

const engineTrack = (set: LibrarySet, t: SeededTrack) =>
  engineRead(
    set,
    (db) =>
      db.prepare('SELECT path, fileBytes FROM Track WHERE id = ?').get(t.engineId) as
        | { path: string; fileBytes: number }
        | undefined,
  )

const nmlOf = (set: LibrarySet) => readFileSync(set.traktorNml as string, 'utf8')
const traktorEntries = (set: LibrarySet, t: SeededTrack) =>
  nmlOf(set).split(`AUDIO_ID="${t.traktorAudioId}"`).length - 1

const fileAttr = (entry: string) => entry.match(/<LOCATION\b[^>]*\sFILE="([^"]*)"/)?.[1]

const addedEntry = () => music.entry(music.state.added.at(-1)?.persistentId ?? '')

function aiffShort(path: string): boolean {
  const bytes = readFileSync(path)
  const comm = bytes.indexOf('COMM', 12, 'latin1')
  const ssnd = bytes.indexOf('SSND', 12, 'latin1')
  const declared = bytes.readUInt32BE(comm + 10) * bytes.readUInt16BE(comm + 8) * 2
  return comm !== -1 && ssnd !== -1 && bytes.length - (ssnd + 16) < declared
}

// What the library or the file holds once the batch settled, read again by the test: the
// sabotage must still be there, or the self-check was handed something other than the
// broken result (a sabotage that a later write undid proves nothing).
const REREAD: Record<string, Reread> = {
  fileMissing: (_s, _t, written) => !existsSync(written),
  fileWrongFormat: (_s, _t, written) => readFileSync(written).subarray(0, 4).toString() === 'RIFF',
  fileTruncated: (_s, _t, written) => aiffShort(written),
  filePcmDiffers: (_s, t, written) => !aiffShort(written) && pcmSha1(written) !== pcmSha1(t.path),
  fileTagDiffers: (_s, _t, written) => tagsOf(written, (f) => f.tag.title) === OTHER_TITLE,
  fileNoCover: (_s, _t, written) =>
    tagsOf(written, (f) => f.tag.pictures.length === 0 && f.tag.title === TRICKY.title),
  musicMissing: () => addedEntry() === undefined,
  musicWrongFile: (_s, t) => addedEntry()?.location === realpathSync(t.path),
  musicDuplicate: () =>
    music.state.entries.filter((e) => e.location === addedEntry()?.location).length === 2,
  musicTagDiffers: () => addedEntry()?.title === OTHER_TITLE,
  musicPlaylistLost: (_s, t) =>
    !music.playlist(t.playlists.music[0])?.entries.includes(addedEntry()?.persistentId ?? ''),
  rekordboxStillOld: (s, t) =>
    String(rekordboxRow(s, t.rekordboxId)?.FolderPath).normalize('NFC') === t.path.normalize('NFC'),
  rekordboxMissing: (s, t) => rekordboxRow(s, t.rekordboxId) === undefined,
  rekordboxAmbiguous: (s, t) =>
    rekordboxRow(s, duplicateRowId(t))?.FolderPath === rekordboxRow(s, t.rekordboxId)?.FolderPath,
  rekordboxSizeDiffers: (s, t, written) =>
    rekordboxRow(s, t.rekordboxId)?.FileSize === readFileSync(written).length + 1,
  rekordboxCuesLost: (s, t) => rekordboxCues(s, t).length === SEEDED_CUES_MS.length - 1,
  rekordboxAnalysisEmptied: (s, t) => rekordboxRow(s, t.rekordboxId)?.AnalysisDataPath === '',
  engineStillOld: (s, t) =>
    engineTrack(s, t)?.path === relative(s.engineDir as string, t.path).normalize('NFC'),
  engineMissing: (s, t) => engineTrack(s, t) === undefined,
  engineSizeDiffers: (s, t, written) =>
    engineTrack(s, t)?.fileBytes === readFileSync(written).length + 1,
  enginePerformanceChanged: (s, t) =>
    engineRead(s, (db) => {
      const { quickCues } = db
        .prepare('SELECT quickCues FROM PerformanceData WHERE trackId = ?')
        .get(t.engineId) as { quickCues: Buffer }
      const first = decodeQuickCues(inflateEngineBlob(quickCues))?.slots[0].cue?.sample ?? 0
      return first - engineSeededCues()[0].sample === (MOVED_CUE_MS / 1000) * 44100
    }),
  traktorStillOld: (s, t) =>
    fileAttr(traktorEntryOf(nmlOf(s), t.traktorAudioId)) ===
    fileAttr(s.traktorEntries[t.traktorAudioId]),
  traktorMissing: (s, t) => traktorEntries(s, t) === 0,
  traktorAmbiguous: (s, t) => traktorEntries(s, t) === 2,
  blindRekordboxCueMoved: (s, t) =>
    [...rekordboxCues(s, t)].sort((a, b) => a - b)[0] === SEEDED_CUES_MS[0] + MOVED_CUE_MS,
  blindRekordboxPlaylistLink: (s, t) =>
    rekordboxRead(
      s,
      (db) =>
        (
          db
            .prepare('SELECT count(*) AS n FROM djmdSongPlaylist WHERE ContentID = ?')
            .get(t.rekordboxId) as { n: number }
        ).n ===
        t.playlists.rekordbox.length - 1,
    ),
  blindTraktorPlaylistKey: (s, t) =>
    nmlOf(s).includes(
      `KEY="${traktorKeyOf(traktorEntryOf(nmlOf(s), t.traktorAudioId))}${BROKEN_KEY_SUFFIX}"`,
    ),
}

const sabotaged = CELLS.filter((c) => c.layer === 'S')

describe('the sabotage catalogue', () => {
  it('breaks one thing for every sabotage cell and nothing else', () => {
    expect(Object.keys(SABOTAGES).sort()).toEqual(sabotaged.map((c) => c.sabotage).sort())
    expect(Object.keys(REREAD).sort()).toEqual(Object.keys(SABOTAGES).sort())
  })
})

// Each cell converts a track right, breaks the result after Surco wrote it and before the
// self-check reads it, and asks both instruments to see it: the oracle always, the
// self-check with the detail it names for that failure. The three blind spots are the
// self-check's known gaps: it says ok over a broken result, and the test pins that.
describe.skipIf(process.platform !== 'darwin')('a result broken on purpose', () => {
  it.each(sabotaged.map((c) => [c.sabotage as string, c] as const))(
    '%s is seen by the oracle and lands where the self-check reads',
    async (id, cell) => {
      let landed = false
      const [outcome] = await runGroup({ key: cell.id, cells: [cell] }, (set, written) => {
        landed = REREAD[id](set, set.tracks[0], written[0])
      })
      expect(outcome.broken, id).not.toEqual([])
      expect(landed, `${id}: the library read after the batch is not the sabotaged one`).toBe(true)
      if (cell.expectBroken) expect(agreement(outcome)).toBe('falseOk')
      else expect(outcome.verdict?.checks.map((c) => c.detail.key)).toContain(cell.expectedKey)
    },
    120_000,
  )
})
