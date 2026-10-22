const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const dir = process.argv[2]
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })

const db = new DatabaseSync(path.join(dir, 'master.db'))
db.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (v TEXT); INSERT INTO t (v) VALUES ('seed');")
db.close()

fs.writeFileSync(path.join(dir, 'masterPlaylists6.xml'), 'ORIGINAL')
console.log(fs.readdirSync(dir))
