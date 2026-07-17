import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { Database, SqlJsStatic } from 'sql.js'

// Writes a Denon Engine DJ library database (Engine Library "Database2" m.db) from scratch:
// the loaded tracks plus a single playlist. The schema is the Engine Library 2.18.0 baseline
// emitted by libdjinterop (https://github.com/xsco/libdjinterop) — newer Engine DJ versions
// (incl. 4.x) migrate it forward on open, so we don't have to chase the latest on-disk format.
//
// This is a minimal "tracks + one playlist" import: metadata only. The performance BLOBs
// (grid/cues/waveforms) stay NULL with isAnalyzed = 0, so Engine analyses the audio itself
// on first load. No hm.db is needed.

// One track resolved for the database: the path is relative to the Engine Library directory
// (the parent of Database2), which is how Engine stores and resolves it.
export interface EngineTrack {
  relativePath: string
  filename: string
  fileType: string
  fileBytes: number | null
  title: string
  artist: string
  album: string
  genre: string
  comment: string
  bpm: number | null
  bpmAnalyzed: number | null
  year: number | null
  durationSec: number | null
  // Engine's 0–100 scale (20 per star), already converted from the "1"–"5" tag.
  rating: number
}

// The verbatim 2.18.0 DDL. The misspellings (currentPlayedIndiciator, isPerfomanceData…,
// Heirarchy) are in Engine's real schema — keep them exactly or migration/round-trips break.
const SCHEMA = `
CREATE TABLE Information ( id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT, schemaVersionMajor INTEGER, schemaVersionMinor INTEGER, schemaVersionPatch INTEGER, currentPlayedIndiciator INTEGER, lastRekordBoxLibraryImportReadCounter INTEGER);
CREATE TABLE Track ( id INTEGER PRIMARY KEY AUTOINCREMENT, playOrder INTEGER, length INTEGER, bpm INTEGER, year INTEGER, path TEXT, filename TEXT, bitrate INTEGER, bpmAnalyzed REAL, albumArtId INTEGER, fileBytes INTEGER, title TEXT, artist TEXT, album TEXT, genre TEXT, comment TEXT, label TEXT, composer TEXT, remixer TEXT, key INTEGER, rating INTEGER, albumArt TEXT, timeLastPlayed DATETIME, isPlayed BOOLEAN, fileType TEXT, isAnalyzed BOOLEAN, dateCreated DATETIME, dateAdded DATETIME, isAvailable BOOLEAN, isMetadataOfPackedTrackChanged BOOLEAN, isPerfomanceDataOfPackedTrackChanged BOOLEAN, playedIndicator INTEGER, isMetadataImported BOOLEAN, pdbImportKey INTEGER, streamingSource TEXT, uri TEXT, isBeatGridLocked BOOLEAN, originDatabaseUuid TEXT, originTrackId INTEGER, trackData BLOB, overviewWaveFormData BLOB, beatData BLOB, quickCues BLOB, loops BLOB, thirdPartySourceId INTEGER, streamingFlags INTEGER, explicitLyrics BOOLEAN, CONSTRAINT C_originDatabaseUuid_originTrackId UNIQUE (originDatabaseUuid, originTrackId), CONSTRAINT C_path UNIQUE (path), FOREIGN KEY (albumArtId) REFERENCES AlbumArt (id) ON DELETE RESTRICT );
CREATE TABLE ChangeLog ( id INTEGER PRIMARY KEY AUTOINCREMENT, trackId INTEGER, FOREIGN KEY (trackId) REFERENCES Track (id) ON DELETE SET NULL );
CREATE TABLE AlbumArt ( id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT, albumArt BLOB );
CREATE TABLE Pack ( id INTEGER PRIMARY KEY AUTOINCREMENT, packId TEXT, changeLogDatabaseUuid TEXT, changeLogId INTEGER );
CREATE TABLE PlaylistEntity ( id INTEGER PRIMARY KEY AUTOINCREMENT, listId INTEGER, trackId INTEGER, databaseUuid TEXT, nextEntityId INTEGER, membershipReference INTEGER, CONSTRAINT C_NAME_UNIQUE_FOR_LIST UNIQUE (listId, databaseUuid, trackId), FOREIGN KEY (listId) REFERENCES Playlist (id) ON DELETE CASCADE );
CREATE TABLE Playlist ( id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, parentListId INTEGER, isPersisted BOOLEAN, nextListId INTEGER, lastEditTime DATETIME, isExplicitlyExported BOOLEAN, CONSTRAINT C_NAME_UNIQUE_FOR_PARENT UNIQUE (title, parentListId), CONSTRAINT C_NEXT_LIST_ID_UNIQUE_FOR_PARENT UNIQUE (parentListId, nextListId) );
CREATE TABLE PreparelistEntity ( id INTEGER PRIMARY KEY AUTOINCREMENT, trackId INTEGER, trackNumber INTEGER, FOREIGN KEY (trackId) REFERENCES Track (id) ON DELETE CASCADE );
CREATE INDEX index_Track_filename ON Track (filename);
CREATE INDEX index_Track_albumArtId ON Track (albumArtId);
CREATE INDEX index_Track_uri ON Track (uri);
CREATE TRIGGER trigger_after_insert_Track_check_id AFTER INSERT ON Track WHEN NEW.id <= (SELECT seq FROM sqlite_sequence WHERE name = 'Track') BEGIN SELECT RAISE(ABORT, 'Recycling deleted track id''s are not allowed'); END;
CREATE TRIGGER trigger_after_update_Track_check_Id BEFORE UPDATE ON Track WHEN NEW.id <> OLD.id BEGIN SELECT RAISE(ABORT, 'Changing track id''s are not allowed'); END;
CREATE TRIGGER trigger_after_insert_Track_fix_origin AFTER INSERT ON Track WHEN IFNULL(NEW.originTrackId, 0) = 0 OR IFNULL(NEW.originDatabaseUuid, '') = '' BEGIN UPDATE Track SET originTrackId = NEW.id, originDatabaseUuid = (SELECT uuid FROM Information) WHERE track.id = NEW.id; END;
CREATE TRIGGER trigger_after_update_Track_fix_origin AFTER UPDATE ON Track WHEN IFNULL(NEW.originTrackId, 0) = 0 OR IFNULL(NEW.originDatabaseUuid, '') = '' BEGIN UPDATE Track SET originTrackId = NEW.id, originDatabaseUuid = (SELECT uuid FROM Information) WHERE track.id = NEW.id; END;
CREATE TRIGGER trigger_after_update_Track AFTER UPDATE ON Track FOR EACH ROW BEGIN INSERT INTO ChangeLog (trackId) VALUES(NEW.id); END;
CREATE INDEX index_AlbumArt_hash ON AlbumArt (hash);
CREATE TRIGGER trigger_before_insert_List BEFORE INSERT ON Playlist FOR EACH ROW BEGIN UPDATE Playlist SET nextListId = -(1 + nextListId) WHERE nextListId = NEW.nextListId AND parentListId = NEW.parentListId; END;
CREATE TRIGGER trigger_after_insert_List AFTER INSERT ON Playlist FOR EACH ROW BEGIN UPDATE Playlist SET nextListId = NEW.id WHERE nextListId = -(1 + NEW.nextListId) AND parentListId = NEW.parentListId; END;
CREATE TRIGGER trigger_after_delete_List AFTER DELETE ON Playlist FOR EACH ROW BEGIN UPDATE Playlist SET nextListId = OLD.nextListId WHERE nextListId = OLD.id; DELETE FROM Playlist WHERE parentListId = OLD.id; END;
CREATE TRIGGER trigger_after_update_isPersistParent AFTER UPDATE ON Playlist WHEN (old.isPersisted = 0 AND new.isPersisted = 1) OR (old.parentListId != new.parentListId AND new.isPersisted = 1) BEGIN UPDATE Playlist SET isPersisted = 1 WHERE id IN (SELECT parentListId FROM PlaylistAllParent WHERE id=new.id); END;
CREATE TRIGGER trigger_after_update_isPersistChild AFTER UPDATE ON Playlist WHEN old.isPersisted = 1 AND new.isPersisted = 0 BEGIN UPDATE Playlist SET isPersisted = 0 WHERE id IN (SELECT childListId FROM PlaylistAllChildren WHERE id=new.id); END;
CREATE TRIGGER trigger_after_insert_isPersist AFTER INSERT ON Playlist WHEN new.isPersisted = 1 BEGIN UPDATE Playlist SET isPersisted = 1 WHERE id IN (SELECT parentListId FROM PlaylistAllParent WHERE id=new.id); END;
CREATE VIEW PlaylistPath AS WITH RECURSIVE Heirarchy AS ( SELECT id AS child, parentListId AS parent, title AS name, 1 AS depth FROM Playlist UNION ALL SELECT child, parentListId AS parent, title AS name, h.depth + 1 AS depth FROM Playlist c JOIN Heirarchy h ON h.parent = c.id ORDER BY depth DESC ), OrderedList AS ( SELECT id , nextListId, 1 AS position FROM Playlist WHERE nextListId = 0 UNION ALL SELECT c.id , c.nextListId , l.position + 1 FROM Playlist c INNER JOIN OrderedList l ON c.nextListId = l.id ), NameConcat AS ( SELECT child AS id, GROUP_CONCAT(name ,';') || ';' AS path FROM (SELECT child, name FROM Heirarchy ORDER BY depth DESC ) GROUP BY child ) SELECT id, path, ROW_NUMBER() OVER (ORDER BY (SELECT COUNT(*) FROM (SELECT * FROM Heirarchy WHERE child = id) ) DESC, (SELECT position FROM OrderedList ol WHERE ol.id = c.id) ASC ) AS position FROM Playlist c LEFT JOIN NameConcat g USING (id);
CREATE VIEW PlaylistAllParent AS WITH FindAllParent AS ( SELECT id, parentListId FROM Playlist UNION ALL SELECT recursiveCTE.id, Plist.parentListId FROM Playlist Plist INNER JOIN FindAllParent recursiveCTE ON recursiveCTE.parentListId = Plist.id ) SELECT * FROM FindAllParent;
CREATE VIEW PlaylistAllChildren AS WITH FindAllChild AS ( SELECT id, id as childListId FROM Playlist UNION ALL SELECT recursiveCTE.id, Plist.id FROM Playlist Plist INNER JOIN FindAllChild recursiveCTE ON recursiveCTE.childListId = Plist.parentListId ) SELECT * FROM FindAllChild WHERE id <> childListId;
CREATE TRIGGER trigger_before_delete_PlaylistEntity BEFORE DELETE ON PlaylistEntity WHEN OLD.trackId > 0 BEGIN UPDATE PlaylistEntity SET nextEntityId = OLD.nextEntityId WHERE nextEntityId = OLD.id AND listId = OLD.listId; END;
CREATE INDEX index_PreparelistEntity_trackId ON PreparelistEntity (trackId);
CREATE VIEW PerformanceData AS SELECT id AS trackId, isAnalyzed, trackData, overviewWaveFormData, beatData, quickCues, loops, thirdPartySourceId FROM Track;
CREATE TRIGGER trigger_instead_insert_PerformanceData INSTEAD OF INSERT ON PerformanceData FOR EACH ROW BEGIN UPDATE Track SET isAnalyzed = NEW.isAnalyzed, trackData = NEW.trackData, overviewWaveFormData = NEW.overviewWaveFormData, beatData = NEW.beatData, quickCues = NEW.quickCues, loops = NEW.loops, thirdPartySourceId = NEW.thirdPartySourceId WHERE Track.id = NEW.trackId; END;
CREATE TRIGGER trigger_instead_update_isAnalyzed_PerformanceData INSTEAD OF UPDATE OF isAnalyzed ON PerformanceData FOR EACH ROW BEGIN UPDATE Track SET isAnalyzed = NEW.isAnalyzed WHERE Track.id = NEW.trackId; END;
CREATE TRIGGER trigger_instead_update_trackData_PerformanceData INSTEAD OF UPDATE OF trackData ON PerformanceData FOR EACH ROW BEGIN UPDATE Track SET trackData = NEW.trackData WHERE Track.id = NEW.trackId; END;
CREATE TRIGGER trigger_instead_update_overviewWaveFormData_PerformanceData INSTEAD OF UPDATE OF overviewWaveFormData ON PerformanceData FOR EACH ROW BEGIN UPDATE Track SET overviewWaveFormData = NEW.overviewWaveFormData WHERE Track.id = NEW.trackId; END;
CREATE TRIGGER trigger_instead_update_beatData_PerformanceData INSTEAD OF UPDATE OF beatData ON PerformanceData FOR EACH ROW BEGIN UPDATE Track SET beatData = NEW.beatData WHERE Track.id = NEW.trackId; END;
CREATE TRIGGER trigger_instead_update_quickCues_PerformanceData INSTEAD OF UPDATE OF quickCues ON PerformanceData FOR EACH ROW BEGIN UPDATE Track SET quickCues = NEW.quickCues WHERE Track.id = NEW.trackId; END;
CREATE TRIGGER trigger_instead_update_loops_PerformanceData INSTEAD OF UPDATE OF loops ON PerformanceData FOR EACH ROW BEGIN UPDATE Track SET loops = NEW.loops WHERE Track.id = NEW.trackId; END;
CREATE TRIGGER trigger_instead_update_thirdPartySourceId_PerformanceData INSTEAD OF UPDATE OF thirdPartySourceId ON PerformanceData FOR EACH ROW BEGIN UPDATE Track SET thirdPartySourceId = NEW.thirdPartySourceId WHERE Track.id = NEW.trackId; END;
CREATE TRIGGER trigger_instead_delete_PerformanceData INSTEAD OF DELETE ON PerformanceData FOR EACH ROW BEGIN UPDATE Track SET isAnalyzed = NULL, trackData = NULL, overviewWaveFormData = NULL, beatData = NULL, quickCues = NULL, loops = NULL, thirdPartySourceId = NULL WHERE Track.id = OLD.trackId; END;
`

// The columns Engine fills for a metadata-only track, in a fixed order. id is AUTOINCREMENT
// (never set manually — a trigger aborts on recycled ids); originDatabaseUuid/originTrackId are
// left NULL so the fix-origin trigger stamps them with this DB's uuid and the new row id.
// Exported (with trackRow) for engineLibrary.ts, which inserts into a user's existing
// database and needs the same column/value pairing without the fresh-file assumptions.
export const TRACK_COLUMNS = [
  'playOrder',
  'length',
  'bpm',
  'year',
  'path',
  'filename',
  'bitrate',
  'bpmAnalyzed',
  'albumArtId',
  'fileBytes',
  'title',
  'artist',
  'album',
  'genre',
  'comment',
  'label',
  'composer',
  'remixer',
  'key',
  'rating',
  'albumArt',
  'timeLastPlayed',
  'isPlayed',
  'fileType',
  'isAnalyzed',
  'dateCreated',
  'dateAdded',
  'isAvailable',
  'isMetadataOfPackedTrackChanged',
  'isPerfomanceDataOfPackedTrackChanged',
  'playedIndicator',
  'isMetadataImported',
  'pdbImportKey',
  'streamingSource',
  'uri',
  'isBeatGridLocked',
  'originDatabaseUuid',
  'originTrackId',
  'trackData',
  'overviewWaveFormData',
  'beatData',
  'quickCues',
  'loops',
  'thirdPartySourceId',
  'streamingFlags',
  'explicitLyrics',
]

let sqlJs: SqlJsStatic | undefined
export async function loadSqlJs(): Promise<SqlJsStatic> {
  if (sqlJs) return sqlJs
  // sql.js ships the wasm next to its dist entry; read it and hand the bytes to the loader so
  // it never has to resolve a path itself (which fails once packaged inside an asar archive).
  const require = createRequire(import.meta.url)
  const buf = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'))
  // Hand a tight ArrayBuffer (not the Buffer's shared pool) to the loader.
  const wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  // Imported lazily (not at module load) so the sql.js emscripten glue stays off the
  // startup path — only an Engine DJ export, which most sessions never run, pays for it.
  const initSqlJs = (await import('sql.js')).default
  sqlJs = await initSqlJs({ wasmBinary })
  return sqlJs
}

export function lastId(db: Database): number {
  return db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
}

// Initializes an empty Database into a fresh Engine library (schema + Information +
// the no-art sentinel) and returns its uuid. Shared with engineLibrary.ts, which
// bootstraps a library at the configured location when none exists yet.
export function initEngineLibrary(db: Database): string {
  db.run(SCHEMA)
  const uuid = randomUUID()
  // currentPlayedIndiciator's meaning is unknown even to libdjinterop, which writes a random
  // int64; any value works. lastRekordBoxLibraryImportReadCounter is 0 for a fresh library.
  db.run(
    'INSERT INTO Information (uuid, schemaVersionMajor, schemaVersionMinor, schemaVersionPatch, currentPlayedIndiciator, lastRekordBoxLibraryImportReadCounter) VALUES (?, 2, 18, 0, ?, 0)',
    [uuid, Math.floor(Math.random() * 2 ** 31)],
  )
  // The "no album art" sentinel row Track.albumArtId points at (its FK is ON DELETE RESTRICT).
  db.run('INSERT INTO AlbumArt (id, hash, albumArt) VALUES (1, ?, NULL)', [''])
  return uuid
}

// The values matching TRACK_COLUMNS one-to-one for a metadata-only import: not analyzed
// (Engine builds beatgrid/waveform on first load), available, with both date columns
// stamped at `epoch` seconds.
export function trackRow(t: EngineTrack, epoch: number): (string | number | null | Uint8Array)[] {
  return [
    null,
    t.durationSec,
    t.bpm,
    t.year,
    t.relativePath,
    t.filename,
    null,
    t.bpmAnalyzed,
    1,
    t.fileBytes,
    t.title,
    t.artist,
    t.album,
    t.genre,
    t.comment,
    null,
    null,
    null,
    null,
    t.rating,
    null,
    null,
    0,
    t.fileType,
    0,
    epoch,
    epoch,
    1,
    0,
    0,
    0,
    1,
    null,
    null,
    null,
    // isBeatGridLocked stays 0 and beatData NULL: Surco writes no grid, so
    // Engine's own first-load analysis grids the track.
    0,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    0,
    0,
  ]
}

export async function buildEngineDatabase(
  tracks: EngineTrack[],
  playlistName: string,
): Promise<Uint8Array> {
  const SQL = await loadSqlJs()
  const db = new SQL.Database()
  try {
    const uuid = initEngineLibrary(db)

    // Playlist dates are formatted strings (unlike Track dates, which are epoch seconds).
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const lastEdit = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    db.run(
      'INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported) VALUES (?, 0, 1, 0, ?, 1)',
      [playlistName, lastEdit],
    )
    const playlistId = lastId(db)

    const epoch = Math.floor(now.getTime() / 1000)
    const insertTrack = db.prepare(
      `INSERT INTO Track (${TRACK_COLUMNS.join(', ')}) VALUES (${TRACK_COLUMNS.map(() => '?').join(', ')})`,
    )
    const trackIds: number[] = []
    for (const t of tracks) {
      insertTrack.run(trackRow(t, epoch))
      trackIds.push(lastId(db))
    }
    insertTrack.free()

    // PlaylistEntity is an intrusive forward-linked list: each entity points at the next via
    // nextEntityId (0 = tail). Insert one per track in order, then chain entity k → entity k+1
    // by entity id so Engine reads them back in playlist order.
    const insertEntity = db.prepare(
      'INSERT INTO PlaylistEntity (listId, trackId, databaseUuid, nextEntityId, membershipReference) VALUES (?, ?, ?, 0, 0)',
    )
    const entityIds: number[] = []
    for (const trackId of trackIds) {
      insertEntity.run([playlistId, trackId, uuid])
      entityIds.push(lastId(db))
    }
    insertEntity.free()
    for (let i = 0; i < entityIds.length - 1; i++) {
      db.run('UPDATE PlaylistEntity SET nextEntityId = ? WHERE id = ?', [
        entityIds[i + 1],
        entityIds[i],
      ])
    }

    return db.export()
  } finally {
    db.close()
  }
}
