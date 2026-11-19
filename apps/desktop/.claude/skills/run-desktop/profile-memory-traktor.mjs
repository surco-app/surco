import { createWriteStream, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { bigTraktor, repoRoot } from './big-fixtures.mjs'
import { quietLaunch } from './quiet-launch.mjs'
import { sourcePositions } from './source-positions.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const tree = resolve(arg('tree', repoRoot))
const tracks = Number(arg('tracks', '60'))
const snapshot = arg('snapshot', null)
const snapshotAt = Number(arg('snapshot-at', '14'))
const ENTRIES = 25000
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright-core')
const electronPath = createRequire(join(repoRoot, 'index.js'))('electron')

const nml = bigTraktor({ entries: ENTRIES })
const ud = join(tmpdir(), `surco-profile-memory-traktor-${Date.now()}`)
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

const quiet = quietLaunch(join(tree, 'apps/desktop/out/main/index.js'), electronPath)
const app = await electron.launch({
  executablePath: quiet.executablePath,
  args: [quiet.entry, '--force-device-scale-factor=1', `--user-data-dir=${ud}`],
  env: { ...process.env, ...quiet.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
})
const page = await app.firstWindow()
await app.evaluate(({ BrowserWindow, app: a, dialog }) => {
  const mute = (w) => w.webContents.setAudioMuted(true)
  BrowserWindow.getAllWindows().forEach(mute)
  a.on('browser-window-created', (_e, w) => mute(w))
  dialog.showMessageBox = async () => ({ response: 0 })
})
let crashed = false
let closing = false
page.on('crash', () => {
  crashed = true
})
const proc = app.process()
proc.on('exit', () => {
  if (!closing) crashed = true
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
const snap = async (file) => {
  const out = createWriteStream(file)
  const on = ({ chunk }) => out.write(chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', on)
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', on)
  await new Promise((r) => out.end(r))
  console.log(`heap snapshot: ${file}`)
}
const series = [await retainedMb()]
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384 })
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
  if (snapshot && i + 1 === snapshotAt && !crashed) await snap(`${snapshot}-mid.heapsnapshot`)
}
await cdp.send('HeapProfiler.collectGarbage')
const { profile: heapProfile } = await cdp.send('HeapProfiler.getSamplingProfile')
if (snapshot && !crashed) await snap(`${snapshot}-end.heapsnapshot`)
closing = true
await Promise.race([quietly(app.close()), new Promise((r) => setTimeout(r, 30000))])
proc.kill('SIGKILL')

const { label } = sourcePositions(tree)
const selfBy = new Map(), totalBy = new Map()
let all = 0
const walk = (n, path) => {
  const l = label(n.callFrame)
  const next = path.includes(l) ? path : [...path, l]
  if (n.selfSize) {
    all += n.selfSize
    selfBy.set(l, (selfBy.get(l) ?? 0) + n.selfSize)
    for (const p of next) if (!p.includes('node_modules')) totalBy.set(p, (totalBy.get(p) ?? 0) + n.selfSize)
  }
  for (const ch of n.children ?? []) walk(ch, next)
}
walk(heapProfile.head, [])
const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([l, b]) => `${(b / 1e6).toFixed(1).padStart(7)} MB  ${l}`).join('\n')
console.log(`retained heap after GC (MB): ${series.join(' ')}`)
console.log(`live since the first reading, by allocation site: ${(all / 1e6).toFixed(0)} MB sampled`)
console.log('--- self\n' + top(selfBy, 25))
console.log('--- through app code\n' + top(totalBy, 45))
process.exit(0)
