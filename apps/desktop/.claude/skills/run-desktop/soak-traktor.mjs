import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { bigTraktor, repoRoot } from './big-fixtures.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const tree = resolve(arg('tree', repoRoot))
const tracks = Number(arg('tracks', '60'))
const budgetMb = Number(arg('budget', '600'))
const ENTRIES = 25000
const SETTLE_TRACKS = 10
const SETTLE_MB = 50
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright-core')
const electronPath = createRequire(join(repoRoot, 'index.js'))('electron')

const nml = bigTraktor({ entries: ENTRIES })
const ud = join(tmpdir(), `surco-soak-traktor-profile-${Date.now()}`)
mkdirSync(ud, { recursive: true })
writeFileSync(
  join(ud, 'settings.json'),
  JSON.stringify({
    hasSeenOnboarding: true,
    lastSeenChangelogVersion: '99.0.0',
    donateNudgeDismissed: true,
    addToAppleMusic: false,
    outputDir: join(ud, 'Surco'),
    rekordboxDbPath: join(ud, 'no-rekordbox', 'master.db'),
    traktorNmlPath: nml,
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
let closing = false
let detached = false
page.on('crash', () => {
  crashed = true
})
page.on('close', () => {
  if (!closing) detached = true
})
const proc = app.process()
proc.on('exit', (code, signal) => {
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
const scrollTo = (fraction) =>
  page.evaluate((f) => {
    let el = document.querySelector('[data-testid="track-row"]')
    while (el && !(el.scrollHeight > el.clientHeight + 10 && getComputedStyle(el).overflowY !== 'visible'))
      el = el.parentElement
    if (el) el.scrollTop = f * (el.scrollHeight - el.clientHeight)
  }, fraction)

await page.locator('[data-testid="source-rail-traktor"]').click({ timeout: 60000 })
await page.getByText('SOAK BIG', { exact: true }).first().click({ timeout: 120000 })
await page.locator('[data-testid="track-row"]').first().waitFor({ timeout: 180000 })
await page.waitForTimeout(20000)
const series = [await retainedMb()]
for (let i = 0; i < tracks && !crashed; i++) {
  const at = (i * 0.618034) % 1
  await quietly(scrollTo(at))
  await quietly(page.waitForTimeout(800))
  if (i % 10 === 9) {
    for (let k = 0; k < 60 && !crashed; k++) {
      await quietly(scrollTo(Math.min(1, at + (k * 25) / ENTRIES)))
      await quietly(page.waitForTimeout(400))
    }
    const now = new Date()
    utimesSync(nml, now, now)
  }
  const row = page.locator('[data-testid="track-row"]').filter({ visible: true }).nth(6)
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
  if (!crashed)
    series.push(
      await retainedMb().catch((e) => {
        console.log(`could not measure the heap: ${e.message.split('\n')[0]}`)
        return Number.NaN
      }),
    )
  console.log(`track ${i + 1}/${tracks}: ${series.at(-1)} MB retained`)
}
closing = true
await Promise.race([quietly(app.close()), new Promise((r) => setTimeout(r, 30000))])
proc.kill('SIGKILL')

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
const lost = series.filter((mb) => !Number.isFinite(mb)).length
if (lost) {
  console.log(
    detached
      ? `FAIL: the test lost its connection to the app (${lost} of ${series.length} heap readings missing) while the app kept running: run it again`
      : `FAIL: ${lost} of ${series.length} heap readings were lost, the run cannot vouch for the memory`,
  )
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
