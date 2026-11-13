import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const tree = resolve(arg('tree', resolve(here, '../../../../..')))
const tracks = Number(arg('tracks', '40'))
const budgetMb = Number(arg('budget', '600'))
const SETTLE_TRACKS = 10
const SETTLE_MB = 50
const repoRoot = resolve(here, '../../../../..')
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright-core')
const requireRoot = createRequire(join(repoRoot, 'index.js'))
const electronPath = requireRoot('electron')
const Database = requireRoot('better-sqlite3-multiple-ciphers')

const KEY = readFileSync(join(repoRoot, 'apps/desktop/src/main/rekordboxDb.ts'), 'utf8').match(
  /REKORDBOX_KEY = '([0-9a-f]+)'/,
)[1]
const LOCAL_ID = '999000111'
const BIG_ID = '999000222'
const LOCAL_TRACKS = 80
const COPIES = 165

function openDb(path) {
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${KEY}'`)
  return db
}

function addPlaylist(db, xmlPath, id, name, contentIds) {
  const stamp = db.prepare('SELECT created_at FROM djmdPlaylist WHERE created_at IS NOT NULL LIMIT 1').get().created_at
  const seq = db.prepare("SELECT coalesce(max(Seq),0)+1 s FROM djmdPlaylist WHERE ParentID='root'").get().s
  db.prepare(
    `INSERT INTO djmdPlaylist (ID, Seq, Name, Attribute, ParentID, UUID, rb_local_deleted, rb_local_usn, created_at, updated_at)
     VALUES (?, ?, ?, 0, 'root', ?, 0, 1, ?, ?)`,
  ).run(id, seq, name, `uuid-${id}`, stamp, stamp)
  const link = db.prepare(
    `INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo, UUID, rb_local_deleted, rb_local_usn, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
  )
  contentIds.forEach((cid, i) => link.run(`${id}-${i}`, id, cid, i + 1, `uuid-${id}-${i}`, stamp, stamp))
  const node = `    <NODE Id="${BigInt(id).toString(16).toUpperCase()}" ParentId="0" Attribute="0" Timestamp="${Date.now()}" Lib_Type="0" CheckType="0"/>`
  writeFileSync(xmlPath, readFileSync(xmlPath, 'utf8').replace('  <PLAYLISTS>', `  <PLAYLISTS>\r\n${node}`))
}

function buildFixture(dir) {
  const real = join(homedir(), 'Library/Pioneer/rekordbox')
  const dbPath = join(dir, 'master.db')
  if (existsSync(join(dir, 'ready'))) return dbPath
  mkdirSync(join(dir, 'audio'), { recursive: true })
  mkdirSync(join(dir, 'rows'), { recursive: true })
  execFileSync('cp', ['-c', join(real, 'master.db'), join(real, 'masterPlaylists6.xml'), dir])
  execFileSync('cp', ['-c', '-R', join(real, 'share'), dir])
  const db = openDb(dbPath)
  const picked = db
    .prepare(
      `SELECT c.ID, c.FolderPath FROM djmdContent c
       WHERE coalesce(c.rb_local_deleted,0)=0 AND coalesce(c.AnalysisDataPath,'') != ''
         AND EXISTS (SELECT 1 FROM djmdCue q WHERE q.ContentID=c.ID AND coalesce(q.rb_local_deleted,0)=0)`,
    )
    .all()
    .filter((r) => existsSync(r.FolderPath))
    .slice(0, LOCAL_TRACKS)
  if (picked.length < LOCAL_TRACKS) throw new Error(`only ${picked.length} analysed tracks with cues are reachable`)
  const repoint = db.prepare('UPDATE djmdContent SET FolderPath = ? WHERE ID = ?')
  picked.forEach(({ ID, FolderPath }, i) => {
    const to = join(dir, 'audio', `${String(i).padStart(3, '0')} ${basename(FolderPath)}`)
    copyFileSync(FolderPath, to)
    repoint.run(to, ID)
  })
  const local = picked.map((r) => r.ID)
  addPlaylist(db, join(dir, 'masterPlaylists6.xml'), LOCAL_ID, 'SOAK LOCAL', local)
  const cCols = db.prepare('PRAGMA table_info(djmdContent)').all().map((c) => c.name)
  const qCols = db.prepare('PRAGMA table_info(djmdCue)').all().map((c) => c.name)
  const getC = db.prepare('SELECT * FROM djmdContent WHERE ID = ?')
  const getQ = db.prepare('SELECT * FROM djmdCue WHERE ContentID = ? AND coalesce(rb_local_deleted,0)=0')
  const insC = db.prepare(`INSERT INTO djmdContent (${cCols.join(',')}) VALUES (${cCols.map(() => '?').join(',')})`)
  const insQ = db.prepare(`INSERT INTO djmdCue (${qCols.join(',')}) VALUES (${qCols.map(() => '?').join(',')})`)
  const rows = [...local]
  db.transaction(() => {
    for (let k = 1; k <= COPIES; k++)
      for (const id of local) {
        const row = getC.get(id)
        const nid = String(800000000 + rows.length)
        const file = join(dir, 'rows', `${nid}${extname(row.FolderPath)}`)
        execFileSync('cp', ['-c', row.FolderPath, file])
        const value = { ID: nid, UUID: `uuid-${nid}`, Title: `${row.Title} #${k}`, FolderPath: file }
        insC.run(...cCols.map((c) => (c in value ? value[c] : row[c])))
        for (const q of getQ.all(id))
          insQ.run(...qCols.map((c) => (c === 'ID' ? `${nid}-${q.ID}` : c === 'ContentID' ? nid : c === 'UUID' ? `uuid-${nid}-${q.ID}` : q[c])))
        rows.push(nid)
      }
  })()
  addPlaylist(db, join(dir, 'masterPlaylists6.xml'), BIG_ID, 'SOAK BIG', rows)
  db.close()
  writeFileSync(join(dir, 'ready'), String(rows.length))
  return dbPath
}

const fixture = join(tmpdir(), 'surco-soak')
const dbPath = buildFixture(fixture)
const ud = join(tmpdir(), `surco-soak-profile-${Date.now()}`)
mkdirSync(ud, { recursive: true })
writeFileSync(
  join(ud, 'settings.json'),
  JSON.stringify({
    hasSeenOnboarding: true,
    lastSeenChangelogVersion: '99.0.0',
    donateNudgeDismissed: true,
    addToAppleMusic: false,
    outputDir: join(ud, 'Surco'),
    rekordboxDbPath: dbPath,
  }),
)

const app = await electron.launch({
  executablePath: electronPath,
  args: [join(tree, 'apps/desktop/out/main/index.js'), '--force-device-scale-factor=1', `--user-data-dir=${ud}`],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
})
const page = await app.firstWindow()
await app.evaluate(({ BrowserWindow, app: a, dialog }) => {
  const mute = (w) => w.webContents.setAudioMuted(true)
  BrowserWindow.getAllWindows().forEach(mute)
  a.on('browser-window-created', (_e, w) => mute(w))
  dialog.showMessageBox = async () => ({ response: 0 })
})
let crashed = false
let gone = null
page.on('crash', () => {
  crashed = true
})
let closing = false
app.process().on('exit', (code, signal) => {
  if (closing) return
  gone = { code, signal }
  crashed = true
})
const cdp = await page.context().newCDPSession(page)
await cdp.send('Performance.enable')
await cdp.send('HeapProfiler.enable')
const retainedMb = async () => {
  await cdp.send('HeapProfiler.collectGarbage')
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Math.round(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1e6)
}
const quietly = (p) => p.catch(() => {})

await page.locator('[data-testid="source-rail-rekordbox"]').click({ timeout: 60000 })
await page.getByText('SOAK BIG', { exact: true }).first().click({ timeout: 60000 })
await page.locator('[data-testid="track-row"]').first().waitFor({ timeout: 180000 })
await page.waitForTimeout(20000)
const series = [await retainedMb()]
for (let i = 0; i < tracks && !crashed; i++) {
  const row = page.locator('[data-testid="track-row"]').nth(i)
  await quietly(row.click({ timeout: 10000 }))
  await quietly(page.waitForTimeout(6000))
  await quietly(page.locator('[data-testid="result-card"]').first().click({ timeout: 4000 }))
  await quietly(page.waitForTimeout(1500))
  await quietly(
    page.evaluate(() => {
      let el = document.querySelector('[data-testid="field-genre"]')?.parentElement
      while (el && !el.querySelector('[data-testid="field-suggestions"]')) el = el.parentElement
      el?.querySelector('[data-testid="field-suggestions"] button[data-testid^="chip-"]')?.click()
    }),
  )
  await quietly(page.locator('[data-testid="process-btn"]').click({ timeout: 4000 }))
  await quietly(page.waitForTimeout(3000))
  if (i % 3 === 2) await quietly(row.dblclick({ timeout: 4000 }))
  if (!crashed) series.push(await quietly(retainedMb()))
  console.log(`track ${i + 1}/${tracks}: ${series.at(-1)} MB retained`)
}
closing = true
await quietly(app.close())

const peak = Math.max(...series.filter(Number.isFinite))
console.log(`retained heap after GC (MB): ${series.join(' ')}`)
if (gone) {
  console.log(
    gone.code === 0 && gone.signal === null
      ? 'FAIL: the app quit cleanly mid-run, which is what a SIGTERM from outside looks like (another session killing Electron?): run it again'
      : `FAIL: the app exited (code ${gone.code}, signal ${gone.signal})`,
  )
  process.exit(1)
}
if (crashed) {
  console.log('FAIL: the renderer crashed')
  process.exit(1)
}
if (peak > budgetMb) {
  console.log(`FAIL: ${peak} MB retained, over the ${budgetMb} MB budget`)
  process.exit(1)
}
const tail = series.filter(Number.isFinite).slice(-SETTLE_TRACKS - 1)
const rise = tail.at(-1) - tail[0]
if (rise > SETTLE_MB) {
  console.log(`FAIL: still ${rise} MB up over the last ${SETTLE_TRACKS} tracks, the heap is not settling`)
  process.exit(1)
}
console.log(`OK: peak ${peak} MB retained, within the ${budgetMb} MB budget, and ${rise} MB over the last ${SETTLE_TRACKS} tracks`)
