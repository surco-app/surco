import { execFileSync } from 'node:child_process'
import {
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { basename, relative } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile } from 'node-taglib-sharp'
import {
  decodeQuickCues,
  decodeTrackData,
  deflateEngineBlob,
  encodeQuickCues,
  inflateEngineBlob,
  quickCueSlotBytes,
} from '../../main/engineBlobs'
import { engineDbPath } from '../../main/enginePlaylistsFixture'
import { openRekordboxDb } from '../../main/rekordboxDb'
import { music } from '../fakeMusic'
import type { Sabotage } from '../harness'
import type { SabotageId } from './cells'
import { type LibrarySet, REKORDBOX_FILE_TYPE, type SeededTrack, traktorEntryOf } from './libraries'

const FF = ffmpegStatic as unknown as string

type RekordboxDb = NonNullable<ReturnType<typeof openRekordboxDb>>
type EngineDb = InstanceType<typeof Database>

export const MOVED_CUE_MS = 500
export const OTHER_TITLE = 'Otro título'
export const BROKEN_KEY_SUFFIX = '.roto'
export const duplicateRowId = (t: SeededTrack): string => `${t.rekordboxId}7`

function touched(path: string): void {
  const later = new Date(statSync(path).mtimeMs + 2000)
  utimesSync(path, later, later)
}

function flipSample(path: string): void {
  const bytes = readFileSync(path)
  const at = bytes.indexOf('SSND', 12, 'latin1')
  if (at === -1) throw new Error(`scenario: no SSND chunk in ${path}`)
  const start = at + 16
  const end = at + 8 + bytes.readUInt32BE(at + 4)
  bytes[start + Math.floor((end - start) / 4) * 2] ^= 0x40
  writeFileSync(path, bytes)
  touched(path)
}

function rewrapAsWav(path: string): void {
  const wav = `${path}.otro.wav`
  execFileSync(FF, ['-v', 'error', '-y', '-i', path, '-c:a', 'pcm_s16le', '-f', 'wav', wav])
  renameSync(wav, path)
}

function retag(path: string, edit: (f: TagFile) => void): void {
  const f = TagFile.createFromPath(path)
  try {
    edit(f)
    f.save()
  } finally {
    f.dispose()
  }
  touched(path)
}

const onFile = (edit: (path: string) => void): Sabotage => ({ afterConvert: edit })

const unwritten = (program: string) =>
  new Error(`scenario: ${program} still names the source, Surco wrote nothing there to break`)

const rekordbox = (set: LibrarySet, t: SeededTrack, edit: (db: RekordboxDb) => void): Sabotage => ({
  beforeLibraryCheck: () => {
    const db = set.rekordboxDb ? openRekordboxDb(set.rekordboxDb) : null
    if (!db) throw new Error('scenario: no rekordbox collection to break')
    try {
      const row = db
        .prepare('SELECT FolderPath FROM djmdContent WHERE ID = ?')
        .get(t.rekordboxId) as { FolderPath: string } | undefined
      if (row?.FolderPath.normalize('NFC') === t.path.normalize('NFC')) throw unwritten('rekordbox')
      edit(db)
    } finally {
      db.close()
    }
  },
})

const firstCueId = (db: RekordboxDb, t: SeededTrack): string =>
  (
    db
      .prepare(
        'SELECT ID FROM djmdCue WHERE ContentID = ? AND coalesce(rb_local_deleted, 0) = 0 ORDER BY ID',
      )
      .get(t.rekordboxId) as { ID: string }
  ).ID

function duplicateRow(db: RekordboxDb, t: SeededTrack): void {
  const row = db.prepare('SELECT * FROM djmdContent WHERE ID = ?').get(t.rekordboxId) as Record<
    string,
    unknown
  >
  const columns = Object.keys(row)
  db.prepare(
    `INSERT INTO djmdContent (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...columns.map((c) => (c === 'ID' ? duplicateRowId(t) : row[c])))
}

const engine = (set: LibrarySet, t: SeededTrack, edit: (db: EngineDb) => void): Sabotage => ({
  beforeLibraryCheck: () => {
    if (!set.engineDir) throw new Error('scenario: no Engine library to break')
    const db = new Database(engineDbPath(set.engineDir), { fileMustExist: true })
    try {
      const row = db.prepare('SELECT path FROM Track WHERE id = ?').get(t.engineId) as
        | { path: string }
        | undefined
      if (row?.path.normalize('NFC') === enginePathOf(set, t)) throw unwritten('Engine')
      edit(db)
    } finally {
      db.close()
    }
  },
})

const enginePathOf = (set: LibrarySet, t: SeededTrack): string =>
  relative(set.engineDir as string, t.path).normalize('NFC')

function moveFirstQuickCue(db: EngineDb, t: SeededTrack): void {
  const perf = db
    .prepare('SELECT trackData, quickCues FROM PerformanceData WHERE trackId = ?')
    .get(t.engineId) as { trackData: Buffer; quickCues: Buffer }
  const rate = decodeTrackData(inflateEngineBlob(perf.trackData))?.sampleRate ?? 0
  const cues = decodeQuickCues(inflateEngineBlob(perf.quickCues))
  if (!cues || rate <= 0) throw new Error('scenario: no Engine hot cues to move')
  const slots = cues.slots.map((slot, i) =>
    i === 0 && slot.cue
      ? quickCueSlotBytes({ ...slot.cue, sample: slot.cue.sample + (MOVED_CUE_MS / 1000) * rate })
      : slot.bytes,
  )
  db.prepare('UPDATE PerformanceData SET quickCues = ? WHERE trackId = ?').run(
    deflateEngineBlob(encodeQuickCues(slots, cues.tail)),
    t.engineId,
  )
}

const traktor = (set: LibrarySet, t: SeededTrack, edit: (nml: string) => string): Sabotage => ({
  beforeLibraryCheck: () => {
    if (!set.traktorNml) throw new Error('scenario: no Traktor collection to break')
    const nml = readFileSync(set.traktorNml, 'utf8')
    if (fileAttr(entryBlock(nml, t)) === fileAttr(set.traktorEntries[t.traktorAudioId] ?? ''))
      throw unwritten('Traktor')
    writeFileSync(set.traktorNml, edit(nml))
  },
})

function entryBlock(nml: string, t: SeededTrack): string {
  const entry = traktorEntryOf(nml, t.traktorAudioId)
  if (!entry) throw new Error(`scenario: no Traktor entry ${t.traktorAudioId} to break`)
  return `${entry}</ENTRY>`
}

const fileAttr = (entry: string): string =>
  entry.match(/<LOCATION\b[^>]*\sFILE="([^"]*)"/)?.[1] ?? ''

export function traktorKeyOf(entry: string): string {
  const location = entry.match(/<LOCATION\b[^>]*>/)?.[0] ?? ''
  const raw = (name: string) => location.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? ''
  return `${raw('VOLUME')}${raw('DIR')}${raw('FILE')}`
}

function breakPlaylistKey(nml: string, t: SeededTrack): string {
  const key = `KEY="${traktorKeyOf(entryBlock(nml, t))}"`
  const at = nml.indexOf(key, nml.indexOf('<PLAYLISTS>'))
  if (at === -1) throw new Error('scenario: no Traktor playlist names the track')
  return `${nml.slice(0, at)}KEY="${key.slice(5, -1)}${BROKEN_KEY_SUFFIX}"${nml.slice(at + key.length)}`
}

function addedEntry() {
  const pid = music.state.added.at(-1)?.persistentId
  const entry = pid ? music.entry(pid) : undefined
  if (!entry) throw new Error('scenario: Surco added nothing to Music to break')
  return entry
}

const onMusic = (edit: () => void): Sabotage => ({ beforeMusicCheck: edit })

export const SABOTAGES: Record<SabotageId, (set: LibrarySet, track: SeededTrack) => Sabotage> = {
  fileMissing: () => onFile((path) => unlinkSync(path)),
  fileWrongFormat: () => onFile(rewrapAsWav),
  fileTruncated: () => onFile((path) => truncateSync(path, Math.floor(statSync(path).size / 2))),
  filePcmDiffers: () => onFile(flipSample),
  fileTagDiffers: () =>
    onFile((path) =>
      retag(path, (f) => {
        f.tag.title = OTHER_TITLE
      }),
    ),
  fileNoCover: () =>
    onFile((path) =>
      retag(path, (f) => {
        f.tag.pictures = []
      }),
    ),

  musicMissing: () =>
    onMusic(() => {
      const gone = addedEntry().persistentId
      music.state.entries = music.state.entries.filter((e) => e.persistentId !== gone)
      for (const p of music.state.playlists) p.entries = p.entries.filter((id) => id !== gone)
    }),
  musicWrongFile: (_set, t) =>
    onMusic(() => {
      addedEntry().location = realpathSync(t.path)
    }),
  musicDuplicate: () =>
    onMusic(() => {
      const { persistentId: _, artwork: __, ...twin } = addedEntry()
      music.addEntry(twin)
    }),
  musicTagDiffers: () =>
    onMusic(() => {
      addedEntry().title = OTHER_TITLE
    }),
  musicPlaylistLost: (_set, t) =>
    onMusic(() => {
      const list = music.playlist(t.playlists.music[0])
      if (!list) throw new Error('scenario: no Music playlist to take the track out of')
      const pid = addedEntry().persistentId
      list.entries = list.entries.filter((id) => id !== pid)
    }),

  rekordboxStillOld: (set, t) =>
    rekordbox(set, t, (db) =>
      db
        .prepare('UPDATE djmdContent SET FolderPath = ?, FileNameL = ?, FileType = ? WHERE ID = ?')
        .run(t.path, basename(t.path), REKORDBOX_FILE_TYPE['.flac'], t.rekordboxId),
    ),
  rekordboxMissing: (set, t) =>
    rekordbox(set, t, (db) =>
      db.prepare('DELETE FROM djmdContent WHERE ID = ?').run(t.rekordboxId),
    ),
  rekordboxAmbiguous: (set, t) => rekordbox(set, t, (db) => duplicateRow(db, t)),
  rekordboxSizeDiffers: (set, t) =>
    rekordbox(set, t, (db) =>
      db.prepare('UPDATE djmdContent SET FileSize = FileSize + 1 WHERE ID = ?').run(t.rekordboxId),
    ),
  rekordboxCuesLost: (set, t) =>
    rekordbox(set, t, (db) =>
      db.prepare('DELETE FROM djmdCue WHERE ID = ?').run(firstCueId(db, t)),
    ),
  rekordboxAnalysisEmptied: (set, t) =>
    rekordbox(set, t, (db) =>
      db.prepare(`UPDATE djmdContent SET AnalysisDataPath = '' WHERE ID = ?`).run(t.rekordboxId),
    ),

  engineStillOld: (set, t) =>
    engine(set, t, (db) =>
      db.prepare('UPDATE Track SET path = ? WHERE id = ?').run(enginePathOf(set, t), t.engineId),
    ),
  engineMissing: (set, t) =>
    engine(set, t, (db) => db.prepare('DELETE FROM Track WHERE id = ?').run(t.engineId)),
  engineSizeDiffers: (set, t) =>
    engine(set, t, (db) =>
      db.prepare('UPDATE Track SET fileBytes = fileBytes + 1 WHERE id = ?').run(t.engineId),
    ),
  enginePerformanceChanged: (set, t) => engine(set, t, (db) => moveFirstQuickCue(db, t)),

  traktorStillOld: (set, t) =>
    traktor(set, t, (nml) => {
      const entry = entryBlock(nml, t)
      const old = fileAttr(set.traktorEntries[t.traktorAudioId] ?? '')
      return nml.replace(entry, () =>
        entry.replace(/(<LOCATION\b[^>]*\sFILE=")[^"]*"/, (_m, head: string) => `${head}${old}"`),
      )
    }),
  traktorMissing: (set, t) => traktor(set, t, (nml) => nml.replace(entryBlock(nml, t), '')),
  traktorAmbiguous: (set, t) =>
    traktor(set, t, (nml) => {
      const entry = entryBlock(nml, t)
      return nml.replace(entry, () => `${entry}\n${entry}`)
    }),

  blindRekordboxCueMoved: (set, t) =>
    rekordbox(set, t, (db) =>
      db
        .prepare('UPDATE djmdCue SET InMsec = InMsec + ? WHERE ID = ?')
        .run(MOVED_CUE_MS, firstCueId(db, t)),
    ),
  blindRekordboxPlaylistLink: (set, t) =>
    rekordbox(set, t, (db) =>
      db
        .prepare(
          `DELETE FROM djmdSongPlaylist WHERE ID = (SELECT ID FROM djmdSongPlaylist
             WHERE ContentID = ? AND coalesce(rb_local_deleted, 0) = 0 ORDER BY ID LIMIT 1)`,
        )
        .run(t.rekordboxId),
    ),
  blindTraktorPlaylistKey: (set, t) => traktor(set, t, (nml) => breakPlaylistKey(nml, t)),
}
