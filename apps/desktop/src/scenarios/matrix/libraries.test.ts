import { copyFileSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { File as TagFile, TagTypes, type XiphComment } from 'node-taglib-sharp'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../electronFake')).electronFake())

import { encodeBase91 } from '../../main/base91'
import { quickCuesBlob } from '../../main/enginePerformanceFixture'
import { engineDbPath } from '../../main/enginePlaylistsFixture'
import { setLibraryBackupRoot } from '../../main/libraryBackups'
import { takeCopy } from '../../main/libraryHistory'
import { openRekordboxDb } from '../../main/rekordboxDb'
import { buildTraktorTree, traktorCue } from '../../main/traktor4Fixture'
import { music } from '../fakeMusic'
import { scenarioDir } from '../fixtures'
import { CELLS, type Cell, type Programs } from './cells'
import { buildLibraries, type LibrarySet, type SeededTrack } from './libraries'
import { type Broken, type Expected, libraryInvariants } from './oracle'
import { makeSource, SEEDED_CUES_MS, type SourceTrack } from './sources'

const BASE = CELLS.find((c) => c.id === 'C-flac-aiff') as Cell
const cellWith = (programs: Programs): Cell => ({ ...BASE, programs })
const untouched = (t: SeededTrack, more: Partial<Expected> = {}): Expected => ({
  finalPath: t.path,
  lagMs: 0,
  samplesKept: true,
  destGone: false,
  ...more,
})

let sources: SourceTrack[]
let set: LibrarySet
let track: SeededTrack
let saved: Map<string, Buffer>

function keep(paths: string[]): Map<string, Buffer> {
  return new Map(paths.map((p) => [p, readFileSync(p)]))
}

function libraryFiles(s: LibrarySet): string[] {
  return [
    s.rekordboxDb as string,
    engineDbPath(s.engineDir as string),
    s.traktorNml as string,
    ...s.tracks.map((t) => t.path),
    s.bystander.path,
  ]
}

function rekordbox(sql: string, ...args: unknown[]): void {
  const db = openRekordboxDb(set.rekordboxDb as string)
  if (!db) throw new Error('rekordbox copy did not open')
  try {
    db.prepare(sql).run(...args)
  } finally {
    db.close()
  }
}

function engine(sql: string, ...args: unknown[]): void {
  const db = new Database(engineDbPath(set.engineDir as string))
  try {
    db.prepare(sql).run(...args)
  } finally {
    db.close()
  }
}

function traktor(edit: (nml: string) => string): void {
  const nml = readFileSync(set.traktorNml as string, 'utf8')
  const next = edit(nml)
  if (next === nml) throw new Error('the Traktor edit changed nothing')
  writeFileSync(set.traktorNml as string, next)
}

const judge = (cell: Cell, expected: Expected = untouched(track)): Broken[] =>
  libraryInvariants(cell, set, track, expected)

const beyondCollateral = (broken: Broken[]) => broken.filter((b) => b.invariant !== 'collateral')

const seen = (broken: Broken[], invariant: Broken['invariant'], detail: string) =>
  expect(broken).toContainEqual({ invariant, detail: expect.stringContaining(detail) })

beforeAll(() => {
  setLibraryBackupRoot(scenarioDir('matrix-library-backups'))
  const crate = scenarioDir('matrix-library-sources')
  sources = [makeSource(crate, 'flac'), makeSource(crate, 'wav16')]
  set = buildLibraries(scenarioDir('matrix-libraries'), 'all', sources)
  track = set.tracks[0]
  saved = keep(libraryFiles(set))
}, 60_000)

afterEach(() => {
  for (const [path, bytes] of saved) writeFileSync(path, bytes)
})

describe('Synthetic libraries the matrix judges on its own', () => {
  it('builds a set whose oracle passes untouched against the sources', () => {
    for (const t of set.tracks) expect(libraryInvariants(BASE, set, t, untouched(t))).toEqual([])
    expect(set.settings).toMatchObject({
      syncRekordbox: true,
      syncEngineDj: true,
      syncTraktor: true,
      traktorCueOffsetMs: 0,
    })
  })

  describe('rekordbox', () => {
    const only = cellWith('rekordbox')

    it('sees a row left on the old file', () => {
      const elsewhere = join(dirname(track.path), 'nuevo.flac')
      copyFileSync(track.path, elsewhere)
      seen(judge(only, untouched(track, { finalPath: elsewhere })), 'points', 'FolderPath')
    })

    it('sees a stale file name', () => {
      rekordbox(`UPDATE djmdContent SET FileNameL = 'viejo.flac' WHERE ID = ?`, track.rekordboxId)
      seen(judge(only), 'points', 'FileNameL')
    })

    it('sees a FileType that still names the old format', () => {
      rekordbox(`UPDATE djmdContent SET FileType = 12 WHERE ID = ?`, track.rekordboxId)
      seen(judge(only), 'points', 'FileType 12')
    })

    it('sees a FileSize that is not the file on disk', () => {
      rekordbox(`UPDATE djmdContent SET FileSize = 1 WHERE ID = ?`, track.rekordboxId)
      seen(judge(only), 'points', 'FileSize 1')
    })

    it('sees the moved row deleted', () => {
      rekordbox(`UPDATE djmdContent SET rb_local_deleted = 1 WHERE ID = ?`, track.rekordboxId)
      seen(judge(only), 'points', 'ya no está')
    })

    it('sees a live row on the old path once the original is gone', () => {
      const moved = join(dirname(track.path), 'movido.flac')
      copyFileSync(track.path, moved)
      rekordbox(
        `UPDATE djmdContent SET FolderPath = ?, FileNameL = ? WHERE ID = ?`,
        moved,
        basename(moved),
        track.rekordboxId,
      )
      rekordbox(
        `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, rb_local_deleted) VALUES ('5', ?, 'x', 5, 0)`,
        track.path,
      )
      seen(
        judge(only, untouched(track, { finalPath: moved, destGone: true })),
        'points',
        'ruta vieja',
      )
    })

    it('sees one cue moved 500 ms with the count unchanged', () => {
      rekordbox(
        `UPDATE djmdCue SET InMsec = InMsec + 500 WHERE ContentID = ? AND InMsec = ?`,
        track.rekordboxId,
        SEEDED_CUES_MS[1],
      )
      seen(judge(only), 'cues', 'rekordbox: cues')
    })

    it('sees cues shifted twice when the audio moved once', () => {
      const lag = -25
      rekordbox(
        `UPDATE djmdCue SET InMsec = InMsec + ? WHERE ContentID = ?`,
        2 * lag,
        track.rekordboxId,
      )
      seen(
        judge(only, untouched(track, { lagMs: lag, samplesKept: false })),
        'cues',
        'rekordbox: cues',
      )
    })

    it('sees a playlist link deleted', () => {
      rekordbox(
        `DELETE FROM djmdSongPlaylist WHERE ContentID = ? AND PlaylistID = '80002'`,
        track.rekordboxId,
      )
      seen(judge(only), 'playlists', 'rekordbox: playlists 80001')
    })

    it('sees the analysis emptied when the samples were kept', () => {
      rekordbox(
        `UPDATE djmdContent SET AnalysisDataPath = '', Analysed = 0 WHERE ID = ?`,
        track.rekordboxId,
      )
      seen(judge(only), 'cues', 'análisis borrado')
      expect(beyondCollateral(judge(only, untouched(track, { samplesKept: false })))).toEqual([])
    })

    it('sees a second row on the new path even when it is in a playlist', () => {
      rekordbox(
        `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, rb_local_deleted) VALUES ('6', ?, ?, 5, 0)`,
        track.path.normalize('NFC'),
        basename(track.path),
      )
      rekordbox(`INSERT INTO djmdSongPlaylist VALUES ('x6', '80001', '6')`)
      seen(judge(only), 'unique', 'rekordbox: 2 filas vivas')
    })

    it('sees a new row the batch left without playlists', () => {
      rekordbox(
        `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, rb_local_deleted) VALUES ('7', '/x/otra.aiff', 'otra.aiff', 12, 0)`,
      )
      seen(judge(only), 'unique', 'fila nueva 7')
    })
  })

  describe('Engine', () => {
    const only = cellWith('engine')
    const notKept = () => untouched(track, { samplesKept: false })

    it('sees a path left on the old file', () => {
      engine(`UPDATE Track SET path = '../viejo.flac' WHERE id = ?`, track.engineId)
      seen(judge(only), 'points', "Engine: path '../viejo.flac'")
    })

    it('sees the track deleted', () => {
      engine(`DELETE FROM Track WHERE id = ?`, track.engineId)
      seen(judge(only), 'points', `Engine: la pista ${track.engineId} ya no está`)
    })

    it('sees a stale fileType', () => {
      engine(`UPDATE Track SET fileType = 'aiff' WHERE id = ?`, track.engineId)
      seen(judge(only), 'points', "fileType 'aiff'")
    })

    it('sees fileBytes that are not the file on disk', () => {
      engine(`UPDATE Track SET fileBytes = 1 WHERE id = ?`, track.engineId)
      seen(judge(only), 'points', 'fileBytes 1')
    })

    it('sees quickCues changed when the samples were kept', () => {
      engine(
        `UPDATE PerformanceData SET quickCues = ? WHERE trackId = ?`,
        quickCuesBlob([{ label: 'Marker', sample: 441000, argb: 0xff00ff00 }]),
        track.engineId,
      )
      seen(judge(only), 'cues', 'quickCues cambiado')
    })

    it('sees a cue moved 500 ms when the samples changed', () => {
      engine(
        `UPDATE PerformanceData SET quickCues = ? WHERE trackId = ?`,
        quickCuesBlob(
          SEEDED_CUES_MS.map((ms, i) => ({
            label: `c${i}`,
            sample: ((ms + (i === 1 ? 500 : 0)) / 1000) * 44100,
            argb: 0,
          })),
        ),
        track.engineId,
      )
      seen(judge(only, notKept()), 'cues', 'Engine: cues')
    })

    it('sees an empty grid when the samples changed', () => {
      engine(`UPDATE PerformanceData SET beatData = NULL WHERE trackId = ?`, track.engineId)
      seen(judge(only, notKept()), 'cues', 'rejilla vacía')
    })

    it('sees a playlist entity deleted', () => {
      engine(`DELETE FROM PlaylistEntity WHERE trackId = ? AND listId = 2`, track.engineId)
      seen(judge(only), 'playlists', 'Engine: playlists 1')
    })

    it('sees the track moved to another position in its playlist', () => {
      const [a, b] = set.tracks
      engine(`UPDATE PlaylistEntity SET trackId = -1 WHERE listId = 1 AND trackId = ?`, a.engineId)
      engine(
        `UPDATE PlaylistEntity SET trackId = ? WHERE listId = 1 AND trackId = ?`,
        a.engineId,
        b.engineId,
      )
      engine(`UPDATE PlaylistEntity SET trackId = ? WHERE listId = 1 AND trackId = -1`, b.engineId)
      seen(judge(only), 'playlists', 'posición 2 en la playlist 1')
    })

    it('sees a second track on the same file under another spelling', () => {
      const engineDir = set.engineDir as string
      engine(
        `INSERT INTO Track (id, path, filename) VALUES (50, ?, 'x')`,
        relative(engineDir, track.path).normalize('NFD'),
      )
      seen(judge(only), 'unique', 'Engine: 2 pistas')
    })
  })

  describe('Traktor', () => {
    const only = cellWith('traktor')
    const file = () => basename(track.path).normalize('NFC')

    it('sees FILE left on the old name', () => {
      traktor((nml) => nml.replace(`FILE="${file()}"`, 'FILE="viejo.flac"'))
      seen(judge(only), 'points', 'Traktor: LOCATION')
    })

    it('sees the entry deleted, with no other entry of the same title and artist', () => {
      for (const t of set.tracks)
        traktor((nml) => {
          const start = nml.indexOf(
            `<ENTRY MODIFIED_DATE="2026/10/30" AUDIO_ID="${t.traktorAudioId}"`,
          )
          return nml.slice(0, start) + nml.slice(nml.indexOf('</ENTRY>', start) + 8)
        })
      seen(judge(only), 'points', 'Traktor: la entrada ya no está')
    })

    it('finds the entry by title and artist once AUDIO_ID is gone', () => {
      traktor((nml) => nml.replace(` AUDIO_ID="${track.traktorAudioId}"`, ''))
      expect(beyondCollateral(judge(only))).toEqual([])
    })

    it('sees a CUE_V2 moved 500 ms', () => {
      traktor((nml) => nml.replace('START="15000.000000"', 'START="15500.000000"'))
      seen(judge(only), 'cues', 'Traktor: CUE_V2')
    })

    it('sees the cues in the file moved 500 ms', () => {
      const f = TagFile.createFromPath(track.path)
      try {
        const tree = buildTraktorTree(
          SEEDED_CUES_MS.map((ms, i) => traktorCue(`c${i}`, 0, ms + 500, i)),
        )
        ;(f.getTag(TagTypes.Xiph, false) as XiphComment).setFieldAsStrings(
          'TRAKTOR4',
          encodeBase91(tree),
        )
        f.save()
      } finally {
        f.dispose()
      }
      seen(judge(only), 'cues', 'Traktor: TRAKTOR4')
    })

    it('sees a playlist that no longer names the track', () => {
      traktor((nml) => {
        const at = nml.indexOf('<PLAYLIST ')
        const key = nml.indexOf(`${file()}"></PRIMARYKEY>`, at)
        const start = nml.lastIndexOf('<ENTRY>', key)
        return nml.slice(0, start) + nml.slice(nml.indexOf('</ENTRY>', key) + 8)
      })
      seen(judge(only), 'playlists', 'ya no nombra la pista')
    })

    it('sees a PRIMARYKEY left dangling next to the right one', () => {
      traktor((nml) =>
        nml.replace(
          '<PLAYLIST ENTRIES="3" TYPE="LIST" UUID="pl-sabado">',
          '<PLAYLIST ENTRIES="3" TYPE="LIST" UUID="pl-sabado">\n<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="Macintosh HD/:nada/:viejo.flac"></PRIMARYKEY>\n</ENTRY>',
        ),
      )
      seen(judge(only), 'playlists', 'sin entrada')
    })

    it('sees a second entry on the same location', () => {
      traktor((nml) => {
        const start = nml.indexOf(
          `<ENTRY MODIFIED_DATE="2026/10/30" AUDIO_ID="${track.traktorAudioId}"`,
        )
        const entry = nml.slice(start, nml.indexOf('</ENTRY>', start) + 8)
        return nml.replace(entry, `${entry}\n${entry.replace(track.traktorAudioId, 'OTRO')}`)
      })
      seen(judge(only), 'unique', 'Traktor: 2 entradas')
    })
  })

  describe('Disk', () => {
    it('sees a temporary file left beside the result', () => {
      const tmp = join(dirname(track.path), '.x.tmp-1234abcd.aiff')
      writeFileSync(tmp, 'x')
      try {
        seen(judge(cellWith('rekordbox')), 'unique', 'queda el temporal')
      } finally {
        rmSync(tmp)
      }
    })

    it('sees the original gone when the destination keeps it', () => {
      rmSync(track.path)
      seen(judge(cellWith('rekordbox')), 'unique', 'el original ya no está')
      expect(judge(cellWith('rekordbox'), untouched(track, { destGone: true }))).not.toContainEqual(
        expect.objectContaining({ detail: 'disco: el original ya no está' }),
      )
    })
  })

  describe('Collateral', () => {
    it('sees a cue of a track outside the batch moved', () => {
      rekordbox(
        `UPDATE djmdCue SET InMsec = InMsec + 500 WHERE ContentID = ? AND InMsec = ?`,
        set.bystander.rekordboxId,
        SEEDED_CUES_MS[0],
      )
      seen(judge(BASE), 'collateral', 'otra pista, rekordbox: cues')
    })

    it('sees a library the cell does not sync changed by a byte', () => {
      engine(`UPDATE Track SET rating = 3 WHERE id = ?`, set.bystander.engineId)
      seen(
        judge(cellWith('rekordbox')),
        'collateral',
        'Engine: la biblioteca no sincronizada cambió',
      )
    })

    it('sees a synced library written without a copy taken first, and accepts it with one', async () => {
      rekordbox(`UPDATE djmdContent SET Title = 'x' WHERE ID = ?`, set.bystander.rekordboxId)
      seen(judge(cellWith('rekordbox')), 'collateral', 'sin copia de seguridad previa')
      const db = set.rekordboxDb as string
      const written = readFileSync(db)
      writeFileSync(db, saved.get(db) as Buffer)
      await takeCopy(db, [], 'run')
      writeFileSync(db, written)
      expect(judge(cellWith('rekordbox'))).toEqual([])
    })
  })

  describe('Spellings of one file', () => {
    it('treats an NFD FolderPath as the same file', () => {
      const nfd = buildLibraries(scenarioDir('matrix-libraries-nfd'), 'rekordbox', sources, {
        nfdRow: true,
      })
      const t = nfd.tracks[0]
      const db = openRekordboxDb(nfd.rekordboxDb as string, { readonly: true })
      const stored = db
        ?.prepare(`SELECT FolderPath FROM djmdContent WHERE ID = ?`)
        .get(t.rekordboxId) as {
        FolderPath: string
      }
      db?.close()
      expect(stored.FolderPath).toBe(t.path.normalize('NFD'))
      expect(stored.FolderPath).not.toBe(t.path.normalize('NFC'))
      expect(
        libraryInvariants(
          cellWith('rekordbox'),
          nfd,
          t,
          untouched(t, { finalPath: t.path.normalize('NFC') }),
        ),
      ).toEqual([])
    })

    it('resolves twin rows through the ~/Music/Music link as one file', () => {
      const twins = buildLibraries(scenarioDir('matrix-libraries-twins'), 'rekordbox', sources, {
        twinRows: true,
      })
      const t = twins.tracks[0]
      seen(
        libraryInvariants(cellWith('rekordbox'), twins, t, untouched(t)),
        'unique',
        'rekordbox: 2 filas vivas',
      )
    })
  })

  describe('Music', () => {
    let withMusic: LibrarySet
    let state: string

    beforeAll(() => {
      music.reset()
      withMusic = buildLibraries(scenarioDir('matrix-libraries-music'), 'music', sources)
      state = JSON.stringify(music.state)
    }, 60_000)

    afterEach(() => {
      Object.assign(music.state, JSON.parse(state))
    })

    const judgeMusic = () =>
      libraryInvariants(
        cellWith('music'),
        withMusic,
        withMusic.tracks[0],
        untouched(withMusic.tracks[0]),
      )
    const own = () => music.entry(withMusic.tracks[0].musicPid as string)

    it('passes untouched, with one normal playlist and one smart kept apart', () => {
      expect(judgeMusic()).toEqual([])
      expect(music.state.playlists.filter((p) => p.smart)).toHaveLength(1)
    })

    it('sees the entry pointed at another file', () => {
      const entry = own()
      if (entry) entry.location = withMusic.bystander.path
      seen(judgeMusic(), 'points', 'ninguna entrada')
      seen(judgeMusic(), 'points', 'la entrada vieja sigue viva')
    })

    it('sees the entry taken out of a normal playlist', () => {
      const list = music.playlist(withMusic.tracks[0].playlists.music[1])
      if (list) list.entries = list.entries.filter((pid) => pid !== own()?.persistentId)
      seen(judgeMusic(), 'playlists', 'Music: la playlist Sábado')
    })

    it('sees a second entry for the same file', () => {
      music.addEntry({ location: withMusic.tracks[0].path.normalize('NFC'), title: 'x' })
      seen(judgeMusic(), 'unique', 'Music: 2 entradas')
    })

    it('sees a new entry left without a file', () => {
      const ghost = music.addEntry({ location: '/nada/fantasma.aiff', title: 'x' })
      seen(judgeMusic(), 'unique', `entrada nueva ${ghost.persistentId}`)
    })
  })

  it('keeps the seeded sizes real, as rekordbox and Engine store them', () => {
    const db = openRekordboxDb(set.rekordboxDb as string, { readonly: true })
    const row = db
      ?.prepare(`SELECT FileSize FROM djmdContent WHERE ID = ?`)
      .get(track.rekordboxId) as {
      FileSize: number
    }
    db?.close()
    expect(row.FileSize).toBe(statSync(track.path).size)
  })
})
