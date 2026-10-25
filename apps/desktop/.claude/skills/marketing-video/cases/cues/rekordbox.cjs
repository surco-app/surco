const fs = require('node:fs')
const path = require('node:path')

const [root, appDir, target] = process.argv.slice(2)
const Database = require(path.join(root, 'node_modules/better-sqlite3-multiple-ciphers'))
const KEY = fs
  .readFileSync(path.join(appDir, 'src/main/rekordboxDb.ts'), 'utf8')
  .match(/REKORDBOX_KEY\s*=\s*['"]([^'"]+)['"]/)[1]
const source = path.join(process.env.HOME, 'Library/Pioneer/rekordbox')
const TRACK = 'Here We Go (Bell%'
const PLAYLIST = '1096465097'

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
fs.copyFileSync(path.join(source, 'master.db'), path.join(target, 'master.db'))
const db = new Database(path.join(target, 'master.db'))
db.pragma(`cipher='sqlcipher'`)
db.pragma('legacy=4')
db.pragma(`key='${KEY}'`)

const row = db
  .prepare(`SELECT ID, AnalysisDataPath, ImagePath FROM djmdContent WHERE Title LIKE ? AND rb_local_deleted = 0`)
  .get(TRACK)
const copyShare = (rel, whole) => {
  const from = path.join(source, 'share', rel)
  const to = path.join(target, 'share', rel)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  if (!whole) return fs.copyFileSync(from, to)
  for (const f of fs.readdirSync(path.dirname(from)))
    fs.copyFileSync(path.join(path.dirname(from), f), path.join(path.dirname(to), f))
}
copyShare(row.AnalysisDataPath, true)
if (row.ImagePath) copyShare(row.ImagePath, false)
db.prepare('DELETE FROM djmdCue WHERE ContentID = ?').run(row.ID)

db.prepare(`UPDATE djmdPlaylist SET rb_local_deleted = 1 WHERE ID != ? AND (Name = 'Himnos' OR Name GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]*')`).run(PLAYLIST)
const seq = db.prepare(`SELECT max(Seq) m FROM djmdPlaylist WHERE ParentID = 'root'`).get().m
db.prepare(`UPDATE djmdPlaylist SET Name = 'Himnos', ParentID = 'root', Seq = ? WHERE ID = ?`).run(seq + 1, PLAYLIST)
db.close()
