import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '../../../../..')
const requireRoot = createRequire(join(repoRoot, 'index.js'))
const Database = requireRoot('better-sqlite3-multiple-ciphers')
const KEY = readFileSync(join(repoRoot, 'apps/desktop/src/main/rekordboxDb.ts'), 'utf8').match(
  /REKORDBOX_KEY = '([0-9a-f]+)'/,
)[1]
const SOAK_BIG = '999000222'

export const rekordboxSoakFixture = join(tmpdir(), 'surco-soak')

function openDb(path, readonly = false) {
  const db = new Database(path, { readonly })
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${KEY}'`)
  return db
}

function requireSoakFixture() {
  if (!existsSync(join(rekordboxSoakFixture, 'ready')))
    throw new Error('the rekordbox soak fixture is missing: run soak.mjs once to build it')
}

function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

function addSmartLists(db, count) {
  const stamp = db
    .prepare('SELECT created_at FROM djmdPlaylist WHERE created_at IS NOT NULL LIMIT 1')
    .get().created_at
  const condition = (property, operator, left) =>
    `<CONDITION PropertyName="${property}" Operator="${operator}" ValueUnit="" ValueLeft="${esc(left)}" ValueRight=""/>`
  const artists = db
    .prepare('SELECT Name FROM djmdArtist WHERE Name IS NOT NULL LIMIT 200')
    .all()
    .map((r) => r.Name.slice(0, 4))
  const genres = db
    .prepare('SELECT Name FROM djmdGenre WHERE Name IS NOT NULL LIMIT 50')
    .all()
    .map((r) => r.Name)
  const insert = db.prepare(
    `INSERT INTO djmdPlaylist (ID, Seq, Name, Attribute, ParentID, SmartList, UUID, rb_local_deleted, rb_local_usn, created_at, updated_at)
     VALUES (?, ?, ?, 4, 'root', ?, ?, 0, 1, ?, ?)`,
  )
  for (let i = 0; i < count; i++) {
    const conditions = [
      condition('artist', 8, artists[i % Math.max(1, artists.length)] ?? 'a'),
      condition('genre', 1, genres[i % Math.max(1, genres.length)] ?? 'House'),
      condition('bpm', 4, String(11000 + (i % 30) * 100)),
      condition('rating', 4, String(1 + (i % 4))),
    ].slice(0, 2 + (i % 3))
    const xml = `<NODE Id="${900000 + i}" LogicalOperator="${i % 2 ? 1 : 2}" AutomaticUpdate="0">${conditions.join('')}</NODE>`
    insert.run(String(990000000 + i), 5000 + i, `Smart ${i}`, xml, `uuid-smart-${i}`, stamp, stamp)
  }
}

export function bigRekordbox({ smartLists = 150 } = {}) {
  requireSoakFixture()
  const dir = join(tmpdir(), `surco-gate-rekordbox-${smartLists}`)
  const db = join(dir, 'master.db')
  if (existsSync(join(dir, 'ready'))) return db
  mkdirSync(dir, { recursive: true })
  execFileSync('cp', [
    '-c',
    join(rekordboxSoakFixture, 'master.db'),
    join(rekordboxSoakFixture, 'masterPlaylists6.xml'),
    dir,
  ])
  execFileSync('cp', ['-c', '-R', join(rekordboxSoakFixture, 'share'), dir])
  const open = openDb(db)
  addSmartLists(open, smartLists)
  open.close()
  writeFileSync(join(dir, 'ready'), String(smartLists))
  return db
}

const KEYS = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'C', 'G', 'D', 'A']
const GENRES = ['House', 'Tech House', 'Deep House', 'Techno', 'Disco', 'Funk', 'Breaks', 'Minimal']

const locationOf = (path) => {
  const parts = path.split('/').filter(Boolean)
  const file = parts.pop()
  return { dir: `/:${parts.map((p) => `${p}/:`).join('')}`, file }
}

export function bigTraktor({ entries = 25000, sessions = 60, history = 180 } = {}) {
  requireSoakFixture()
  const dir = join(tmpdir(), `surco-gate-traktor-${entries}-${sessions}-${history}`)
  const nml = join(dir, 'collection.nml')
  if (existsSync(join(dir, 'ready'))) return nml
  mkdirSync(join(dir, 'rows'), { recursive: true })
  const rand = seeded(7)
  const db = openDb(join(rekordboxSoakFixture, 'master.db'), true)
  const rows = db
    .prepare(
      `SELECT c.ID, c.Title, a.Name Artist, c.BPM, c.Length, c.FolderPath FROM djmdSongPlaylist s
       JOIN djmdContent c ON c.ID = s.ContentID LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
       WHERE s.PlaylistID = ? ORDER BY s.TrackNo`,
    )
    .all(SOAK_BIG)
  const cues = db.prepare(
    'SELECT InMsec, Kind FROM djmdCue WHERE ContentID = ? AND coalesce(rb_local_deleted,0)=0 ORDER BY InMsec',
  )
  const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const blob = (n) => Array.from({ length: n }, () => b64[Math.floor(rand() * 64)]).join('')
  const body = []
  const keys = []
  for (let i = 0; i < entries; i++) {
    const r = rows[i % rows.length]
    let path = realpathSync(r.FolderPath)
    if (i >= rows.length) {
      const to = join(dir, 'rows', `${i}${path.slice(path.lastIndexOf('.'))}`)
      if (!existsSync(to)) execFileSync('cp', ['-c', path, to])
      path = realpathSync(to)
    }
    const { dir: folder, file } = locationOf(path)
    const bpm = (r.BPM / 100).toFixed(6)
    const marks = cues.all(r.ID)
    const first = marks.length ? marks[0].InMsec : 0
    const key = Math.floor(rand() * KEYS.length)
    const cueXml = [
      `<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="${first.toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="-1"><GRID BPM="${bpm}"></GRID>\n</CUE_V2>`,
      ...marks
        .filter((m) => m.Kind > 0 && m.Kind <= 8)
        .map(
          (m) =>
            `<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="${m.InMsec.toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="${m.Kind - 1}"></CUE_V2>`,
        ),
    ].join('\n')
    body.push(
      `<ENTRY MODIFIED_DATE="2026/11/14" MODIFIED_TIME="1" LOCK="1" AUDIO_ID="${blob(540)}==" TITLE="${esc(r.Title)}${i >= rows.length ? ` (${i})` : ''}" ARTIST="${esc(r.Artist)}"><LOCATION DIR="${esc(folder)}" FILE="${esc(file)}" VOLUME="Macintosh HD" VOLUMEID="Macintosh HD"></LOCATION>\n<ALBUM TRACK="${1 + (i % 12)}" TITLE="Album ${i % 2000}"></ALBUM>\n<MODIFICATION_INFO AUTHOR_TYPE="user"></MODIFICATION_INFO>\n<INFO BITRATE="320000" GENRE="${GENRES[i % GENRES.length]}" LABEL="Label ${i % 500}" COMMENT="Purchased at store ${i % 7}" COVERARTID="${String(i % 999).padStart(3, '0')}/${blob(28).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}" KEY="${KEYS[key]}" PLAYCOUNT="${Math.floor(rand() * 40)}" PLAYTIME="${r.Length}" PLAYTIME_FLOAT="${r.Length}.000000" RANKING="${[0, 51, 102, 153, 204, 255][Math.floor(rand() * 6)]}" IMPORT_DATE="2019/3/${1 + (i % 28)}" LAST_PLAYED="2026/10/${1 + (i % 28)}" FLAGS="28" FILESIZE="${8000 + (i % 9000)}"></INFO>\n<TEMPO BPM="${bpm}" BPM_QUALITY="100.000000"></TEMPO>\n<LOUDNESS PEAK_DB="-0.3" PERCEIVED_DB="${(rand() * 4 - 2).toFixed(6)}" ANALYZED_DB="${(rand() * 4 - 2).toFixed(6)}"></LOUDNESS>\n<MUSICAL_KEY VALUE="${key}"></MUSICAL_KEY>\n${cueXml}\n</ENTRY>`,
    )
    keys.push(`Macintosh HD${folder}${file}`)
  }
  db.close()
  let n = 0
  const uuid = () => `5a0c${String(++n).padStart(28, '0')}`
  const pick = (count) => Array.from({ length: count }, () => keys[Math.floor(rand() * keys.length)])
  const list = (name, picks) =>
    `<NODE TYPE="PLAYLIST" NAME="${esc(name)}"><PLAYLIST ENTRIES="${picks.length}" TYPE="LIST" UUID="${uuid()}">${picks
      .map((k) => `<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${esc(k)}"></PRIMARYKEY>\n</ENTRY>`)
      .join('\n')}\n</PLAYLIST>\n</NODE>`
  const folderNode = (name, nodes) =>
    `<NODE TYPE="FOLDER" NAME="${esc(name)}"><SUBNODES COUNT="${nodes.length}">\n${nodes.join('\n')}\n</SUBNODES>\n</NODE>`
  const crates = Array.from({ length: 12 }, (_, f) =>
    folderNode(
      `Crates ${f + 1}`,
      Array.from({ length: 25 }, (_, p) => list(`Crate ${f + 1}.${p + 1}`, pick(20 + Math.floor(rand() * 380)))),
    ),
  )
  const sessionFolder = folderNode(
    'Sesiones',
    Array.from({ length: sessions }, (_, s) => list(`Sesion ${s + 1}`, pick(25 + Math.floor(rand() * 40)))),
  )
  const historyFolder = folderNode(
    'History',
    Array.from({ length: history }, (_, h) => list(`History 2025-${String(h).padStart(3, '0')}`, pick(25 + Math.floor(rand() * 40)))),
  )
  const root = [list('SOAK BIG', keys), ...crates, sessionFolder, historyFolder]
  writeFileSync(
    nml,
    `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<NML VERSION="20"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor Pro 4"></HEAD>\n<COLLECTION ENTRIES="${body.length}">${body.join('\n')}\n</COLLECTION>\n<SETS ENTRIES="0"></SETS>\n<PLAYLISTS>${folderNode('$ROOT', root)}\n</PLAYLISTS>\n<INDEXING></INDEXING>\n</NML>\n`,
  )
  writeFileSync(join(dir, 'ready'), String(entries))
  return nml
}
