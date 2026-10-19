import { writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { REKORDBOX_KEY } from './rekordboxDb'
import { hexId } from './rekordboxMasterXml'

// A miniature master.db with the tables and columns the playlist reader and writer touch,
// encrypted like the real one. The column names come from a live rekordbox 7 collection;
// the shapes worth reproducing are the ones measured there: nested folders whose children
// repeat names, one blank separator file linked many times, a streaming row, soft-deleted
// rows, the −128 cloud-sync trial playlist, link IDs that are UUID-like strings, and the
// change counter every write moves on.
export interface FixtureContent {
  ID: string
  FolderPath: string
  FileType: number
  Title: string
  Length: number
  BPM?: number
  Rating?: number
  KeyID?: string
  // findTrackByPath reads it; 0 unless a test cares.
  FileSize?: number
  deleted?: boolean
  UUID?: string
}

export interface FixturePlaylist {
  ID: string
  Name: string
  Attribute: number
  ParentID: string
  Seq: number
  deleted?: boolean
}

export interface FixtureLink {
  // Defaults to link-<index>.
  ID?: string
  PlaylistID: string
  ContentID: string
  TrackNo: number
  // null writes a NULL flag, which rekordbox leaves on some rows instead of 0.
  deleted?: boolean | null
}

export interface PlaylistFixture {
  content: FixtureContent[]
  keys: { ID: string; ScaleName: string }[]
  playlists: FixturePlaylist[]
  links: FixtureLink[]
  // Where rekordbox's change counter (agentRegistry localUpdateCount) stands.
  usn?: number
  // Writes masterPlaylists6.xml beside the database, one NODE per live playlist, laid out as
  // rekordbox 7 writes it (CRLF, four-space nodes, ParentId "0" for the root). Playlist IDs
  // must be numeric for this.
  xml?: boolean
  // Leaves the database in WAL mode, as rekordbox keeps it.
  wal?: boolean
  device?: { ID: string; MasterDBID: string }
  artists?: { ID: string; Name: string }[]
  xmlTimestamps?: Record<string, number>
}

// Every fixture row is older than any edit a test makes.
export const FIXTURE_STAMP = '2026-01-01 00:00:00.000 +00:00'

const LOOKUP_COLUMNS = `UUID VARCHAR(255), rb_data_status INTEGER DEFAULT 0,
  rb_local_data_status INTEGER DEFAULT 0, rb_local_deleted TINYINT(1) DEFAULT 0,
  rb_local_synced TINYINT(1) DEFAULT 0, usn BIGINT, rb_local_usn BIGINT, created_at DATETIME,
  updated_at DATETIME`

export function writeRekordboxPlaylistFixture(path: string, data: PlaylistFixture): void {
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  if (data.wal) db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE djmdContent (ID VARCHAR(255) PRIMARY KEY, FolderPath VARCHAR(255),
      FileNameL VARCHAR(255), FileNameS VARCHAR(255), Title VARCHAR(255), ArtistID VARCHAR(255),
      AlbumID VARCHAR(255), GenreID VARCHAR(255), BPM INTEGER, Length INTEGER, TrackNo INTEGER,
      BitRate INTEGER, BitDepth INTEGER, Commnt TEXT, FileType INTEGER, Rating INTEGER,
      ReleaseYear INTEGER, RemixerID VARCHAR(255), LabelID VARCHAR(255), OrgArtistID VARCHAR(255),
      KeyID VARCHAR(255), StockDate VARCHAR(255), ColorID VARCHAR(255), DJPlayCount INTEGER,
      ImagePath VARCHAR(255), MasterDBID VARCHAR(255), MasterSongID VARCHAR(255),
      AnalysisDataPath VARCHAR(255), SearchStr VARCHAR(255), FileSize INTEGER, DiscNo INTEGER,
      ComposerID VARCHAR(255), Subtitle VARCHAR(255), SampleRate INTEGER, DisableQuantize INTEGER,
      Analysed INTEGER, ReleaseDate VARCHAR(255), DateCreated VARCHAR(255), ContentLink INTEGER,
      Tag VARCHAR(255), ModifiedByRBM VARCHAR(255), HotCueAutoLoad VARCHAR(255),
      DeliveryControl VARCHAR(255), DeliveryComment VARCHAR(255), CueUpdated VARCHAR(255),
      AnalysisUpdated VARCHAR(255), TrackInfoUpdated VARCHAR(255), Lyricist VARCHAR(255),
      ISRC VARCHAR(255), SamplerTrackInfo INTEGER, SamplerPlayOffset INTEGER, SamplerGain FLOAT,
      VideoAssociate VARCHAR(255), LyricStatus INTEGER, ServiceID INTEGER,
      OrgFolderPath VARCHAR(255), Reserved1 TEXT, ExtInfo TEXT, rb_file_id VARCHAR(255),
      DeviceID VARCHAR(255), UUID VARCHAR(255), rb_data_status INTEGER DEFAULT 0,
      rb_local_data_status INTEGER DEFAULT 0, rb_local_deleted INTEGER DEFAULT 0,
      rb_local_synced INTEGER DEFAULT 0, usn BIGINT, rb_local_usn BIGINT, created_at DATETIME,
      updated_at DATETIME);
    CREATE TABLE djmdArtist (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255),
      SearchStr VARCHAR(255), ${LOOKUP_COLUMNS});
    CREATE TABLE djmdAlbum (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255),
      AlbumArtistID VARCHAR(255), ImagePath VARCHAR(255), Compilation INTEGER,
      SearchStr VARCHAR(255), ${LOOKUP_COLUMNS});
    CREATE TABLE djmdGenre (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255), ${LOOKUP_COLUMNS});
    CREATE TABLE djmdLabel (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255), ${LOOKUP_COLUMNS});
    CREATE TABLE djmdDevice (ID VARCHAR(255) PRIMARY KEY, MasterDBID VARCHAR(255),
      Name VARCHAR(255), ${LOOKUP_COLUMNS});
    CREATE TABLE djmdKey (ID VARCHAR(255) PRIMARY KEY, ScaleName VARCHAR(255));
    CREATE TABLE djmdPlaylist (ID VARCHAR(255) PRIMARY KEY, Seq INTEGER, Name VARCHAR(255),
      ImagePath VARCHAR(255), Attribute INTEGER, ParentID VARCHAR(255), SmartList TEXT,
      UUID VARCHAR(255), rb_data_status INTEGER DEFAULT 0, rb_local_data_status INTEGER DEFAULT 0,
      rb_local_deleted TINYINT(1) DEFAULT 0, rb_local_synced TINYINT(1) DEFAULT 0, usn BIGINT,
      rb_local_usn BIGINT, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);
    CREATE TABLE djmdSongPlaylist (ID VARCHAR(255) PRIMARY KEY, PlaylistID VARCHAR(255),
      ContentID VARCHAR(255), TrackNo INTEGER, UUID VARCHAR(255),
      rb_data_status INTEGER DEFAULT 0, rb_local_data_status INTEGER DEFAULT 0,
      rb_local_deleted TINYINT(1) DEFAULT 0, rb_local_synced TINYINT(1) DEFAULT 0, usn BIGINT,
      rb_local_usn BIGINT, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);
    CREATE TABLE agentRegistry (registry_id VARCHAR(255) PRIMARY KEY, int_1 BIGINT,
      created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);
  `)
  db.prepare(
    `INSERT INTO agentRegistry (registry_id, int_1, created_at, updated_at)
     VALUES ('localUpdateCount', ?, ?, ?)`,
  ).run(data.usn ?? 1, FIXTURE_STAMP, FIXTURE_STAMP)
  const content = db.prepare(
    `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize, Title, Length, BPM,
       Rating, KeyID, UUID, rb_local_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const c of data.content) {
    content.run(
      c.ID,
      c.FolderPath,
      basename(c.FolderPath),
      c.FileType,
      c.FileSize ?? 0,
      c.Title,
      c.Length,
      c.BPM ?? 0,
      c.Rating ?? 0,
      c.KeyID ?? null,
      c.UUID ?? `uuid-c-${c.ID}`,
      c.deleted ? 1 : 0,
    )
  }
  const device = data.device ?? { ID: '7', MasterDBID: '3216549870' }
  db.prepare(
    `INSERT INTO djmdDevice (ID, MasterDBID, Name, created_at, updated_at) VALUES (?, ?, 'Mac', ?, ?)`,
  ).run(device.ID, device.MasterDBID, FIXTURE_STAMP, FIXTURE_STAMP)
  const artist = db.prepare(
    `INSERT INTO djmdArtist (ID, Name, rb_local_deleted, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`,
  )
  for (const a of data.artists ?? []) artist.run(a.ID, a.Name, FIXTURE_STAMP, FIXTURE_STAMP)
  const key = db.prepare('INSERT INTO djmdKey VALUES (?, ?)')
  for (const k of data.keys) key.run(k.ID, k.ScaleName)
  const playlist = db.prepare(
    `INSERT INTO djmdPlaylist (ID, Seq, Name, Attribute, ParentID, UUID, rb_local_deleted,
       rb_local_usn, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  )
  for (const p of data.playlists) {
    playlist.run(
      p.ID,
      p.Seq,
      p.Name,
      p.Attribute,
      p.ParentID,
      `uuid-${p.ID}`,
      p.deleted ? 1 : 0,
      FIXTURE_STAMP,
      FIXTURE_STAMP,
    )
  }
  const link = db.prepare(
    `INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo, UUID, rb_local_deleted,
       rb_local_usn, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  )
  data.links.forEach((l, i) => {
    const id = l.ID ?? `link-${i}`
    link.run(
      id,
      l.PlaylistID,
      l.ContentID,
      l.TrackNo,
      `uuid-${id}`,
      l.deleted === null ? null : l.deleted ? 1 : 0,
      FIXTURE_STAMP,
      FIXTURE_STAMP,
    )
  })
  db.close()
  if (data.xml) writeFileSync(join(dirname(path), 'masterPlaylists6.xml'), fixtureXml(data))
}

function fixtureXml(data: PlaylistFixture): string {
  const nodes = data.playlists
    .filter((p) => !p.deleted)
    .map(
      (p) =>
        `    <NODE Id="${hexId(p.ID)}" ParentId="${hexId(p.ParentID)}" Attribute="${p.Attribute}" Timestamp="${data.xmlTimestamps?.[p.ID] ?? 1767225600000}" Lib_Type="0" CheckType="0"/>`,
    )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '',
    '<MASTER_PLAYLIST Version="3.0.0" AutomaticSync="0">',
    '  <PRODUCT Name="rekordbox" Version="7.2.19" Company="Pioneer DJ"/>',
    '  <PLAYLISTS>',
    ...nodes,
    '  </PLAYLISTS>',
    '</MASTER_PLAYLIST>',
    '',
  ].join('\r\n')
}

// The collection the organising tests edit, numeric IDs so its XML can be written. Factory
// holds a track, a separator, a second track, one of the symlinked twins, a second
// separator, a third track and the second track again (rekordbox allows a file twice in a
// playlist). Ekkah is the measured twin case: the same file recorded under ~/Music/Music
// (a symlink) and under the volume it points at.
export const ORGANISE_FIXTURE: PlaylistFixture = {
  content: [
    {
      ID: '101',
      FolderPath: '/Volumes/Public/Music/Night Train.aiff',
      FileType: 12,
      Title: 'Night Train',
      Length: 256,
    },
    {
      ID: '102',
      FolderPath: '/Volumes/Public/Music/Play This Song.wav',
      FileType: 11,
      Title: 'Play This Song',
      Length: 338,
    },
    {
      ID: '103',
      FolderPath: '/Volumes/Public/Music/Gowan.wav',
      FileType: 11,
      Title: 'Gowan',
      Length: 300,
    },
    {
      ID: '104',
      FolderPath: '/Volumes/Public/Music/Vacation.wav',
      FileType: 11,
      Title: 'Vacation',
      Length: 280,
    },
    {
      ID: '109',
      FolderPath: '/Users/dj/Music/PioneerDJ/Blank Audio/_.mp3',
      FileType: 1,
      Title: ' ',
      Length: 1,
    },
    {
      ID: '110',
      FolderPath: '/Users/dj/Music/PioneerDJ/Other/blank.mp3',
      FileType: 1,
      Title: '',
      Length: 2,
    },
    {
      ID: '201',
      FolderPath: '/Users/dj/Music/Music/Ekkah.wav',
      FileType: 11,
      Title: 'Ekkah',
      Length: 310,
    },
    {
      ID: '202',
      FolderPath: '/Volumes/Public/Music/Ekkah.wav',
      FileType: 11,
      Title: 'Ekkah',
      Length: 310,
    },
  ],
  keys: [],
  playlists: [
    { ID: '1000', Name: 'COMBOS', Attribute: 1, ParentID: 'root', Seq: 1 },
    { ID: '2000', Name: 'Factory', Attribute: 0, ParentID: '1000', Seq: 1 },
    { ID: '3000', Name: 'House', Attribute: 0, ParentID: 'root', Seq: 2 },
    {
      ID: '4000',
      Name: 'Trial playlist - Cloud Library Sync',
      Attribute: -128,
      ParentID: 'root',
      Seq: 3,
    },
  ],
  links: [
    { ID: 'f1', PlaylistID: '2000', ContentID: '101', TrackNo: 1 },
    { ID: 'f2', PlaylistID: '2000', ContentID: '109', TrackNo: 2 },
    { ID: 'f3', PlaylistID: '2000', ContentID: '102', TrackNo: 3 },
    { ID: 'f4', PlaylistID: '2000', ContentID: '201', TrackNo: 4 },
    { ID: 'f5', PlaylistID: '2000', ContentID: '109', TrackNo: 5 },
    { ID: 'f6', PlaylistID: '2000', ContentID: '104', TrackNo: 6 },
    { ID: 'f7', PlaylistID: '2000', ContentID: '102', TrackNo: 7 },
    { ID: 'h1', PlaylistID: '3000', ContentID: '102', TrackNo: 1 },
    { ID: 'h2', PlaylistID: '3000', ContentID: '110', TrackNo: 2 },
  ],
  usn: 500,
}

// The user's ~/Music/Music is a symlink to the volume, so one file has two spellings. The
// path rule findTrackByPath applies, described without touching the disk.
export const TWIN_PATHS = {
  realPath: (p: string): string => p.replace('/Users/dj/Music/Music', '/Volumes/Public/Music'),
  homeMusicDir: '/Users/dj/Music/Music',
}
