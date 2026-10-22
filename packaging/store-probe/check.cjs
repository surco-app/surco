const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const [, , title, dir, localCache] = process.argv
const files = [
  'master.db',
  'master.db-wal',
  'master.db-shm',
  'master.db.surco-backup',
  'masterPlaylists6.xml',
  'masterPlaylists6.xml.surco-tmp',
  'brand-new.txt',
]

const out = [`### ${title}`, '', '| file | real folder (rekordbox sees) |', '|---|---|']
for (const f of files) {
  const p = path.join(dir, f)
  let cell = 'missing'
  if (fs.existsSync(p)) {
    const size = fs.statSync(p).size
    cell = f.endsWith('.xml') || f.endsWith('.txt') ? `"${fs.readFileSync(p, 'utf8')}"` : `${size} bytes`
  }
  out.push(`| ${f} | ${cell} |`)
}

try {
  const db = new DatabaseSync(path.join(dir, 'master.db'), { readOnly: true })
  const rows = db.prepare('SELECT v FROM t').all().map((r) => r.v)
  db.close()
  out.push('', `Rows read from outside: ${rows.join(', ')}`)
} catch (err) {
  out.push('', `Outside read failed: ${err.message}`)
}

const control = path.join(path.dirname(dir), '..', 'SurcoProbeControl', 'control.txt')
out.push('', `Control (new folder in AppData) at real path: ${fs.existsSync(control) ? 'present' : 'missing'}`)

const walk = (d) =>
  fs.existsSync(d)
    ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name)
        return e.isDirectory() ? walk(p) : [`${path.relative(localCache, p)} (${fs.statSync(p).size} bytes)`]
      })
    : []
const redirected = walk(localCache)
out.push('', `Package private LocalCache: ${redirected.length ? redirected.join('; ') : 'empty'}`, '')

const text = out.join('\n')
console.log(text)
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
