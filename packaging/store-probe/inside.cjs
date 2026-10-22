const fs = require('node:fs')
const path = require('node:path')

const [, , installDir, dir, sync] = process.argv
const log = (m) => fs.appendFileSync(path.join(sync, 'inside.log'), `${m}\n`)
const mark = (name) => fs.writeFileSync(path.join(sync, name), '')
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const waitFor = (name) => {
  while (!fs.existsSync(path.join(sync, name))) sleep(200)
}

const db = path.join(dir, 'master.db')
const xml = path.join(dir, 'masterPlaylists6.xml')

try {
  log(`APPDATA=${process.env.APPDATA}`)
  log(`before: ${fs.readdirSync(dir).join(', ')}`)

  fs.copyFileSync(db, `${db}.surco-backup`)
  log('copied master.db.surco-backup')

  fs.writeFileSync(`${xml}.surco-tmp`, 'UPDATED')
  fs.renameSync(`${xml}.surco-tmp`, xml)
  log(`renamed tmp over xml; inside reads: ${fs.readFileSync(xml, 'utf8')}`)

  fs.writeFileSync(path.join(dir, 'brand-new.txt'), 'NEW')
  log('wrote brand-new.txt')

  const Database = require(
    path.join(installDir, 'app', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3-multiple-ciphers'),
  )
  const conn = new Database(db)
  conn.pragma('wal_autocheckpoint = 0')
  log(`journal_mode=${conn.pragma('journal_mode', { simple: true })}`)
  conn.prepare("INSERT INTO t (v) VALUES ('inside')").run()
  log(`inside count after insert: ${conn.prepare('SELECT count(*) AS c FROM t').get().c}`)
  log(`inside sees: ${fs.readdirSync(dir).join(', ')}`)
  mark('inserted')

  waitFor('proceed')
  conn.close()
  log(`after close inside sees: ${fs.readdirSync(dir).join(', ')}`)
} catch (err) {
  log(`ERROR ${err.stack}`)
} finally {
  mark('done')
}
