import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as fx from './big-fixtures.mjs'
import { quietLaunch } from './quiet-launch.mjs'
import { sourcePositions } from './source-positions.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright-core')
const rootReq = createRequire(join(fx.repoRoot, 'index.js'))
const tree = resolve(arg('tree', fx.repoRoot))
const program = arg('program', 'engine')
const ud = join(tmpdir(), `surco-prof-${Date.now()}`)
mkdirSync(ud, { recursive: true })
const settings = { hasSeenOnboarding: true, lastSeenChangelogVersion: '99.0.0', donateNudgeDismissed: true, addToAppleMusic: false, autoAnalyze: false, cueLearnFromEdits: false, outputDir: join(ud, 'out'), rekordboxDbPath: join(ud, 'none', 'master.db') }
if (program === 'engine') settings.engineLibraryDir = fx.bigEngine()
if (program === 'virtualdj') settings.virtualdjLibraryDir = fx.bigVirtualdj()
if (program === 'rekordbox') settings.rekordboxDbPath = fx.bigRekordbox()
writeFileSync(join(ud, 'settings.json'), JSON.stringify(settings))
const quiet = quietLaunch(join(tree, 'apps/desktop/out/main/index.js'), rootReq('electron'))
const app = await electron.launch({ executablePath: quiet.executablePath, args: [quiet.entry, '--force-device-scale-factor=1', `--user-data-dir=${ud}`], env: { ...process.env, ...quiet.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } })
const page = await app.firstWindow()
await page.waitForTimeout(6000)
await page.locator(`[data-testid="source-rail-${program}"]`).click({ timeout: 60000 })
await page.waitForTimeout(6000)
await page.getByText('SOAK BIG', { exact: true }).first().click({ timeout: 60000 })
await page.waitForTimeout(8000)
await page.locator('[data-testid="track-row"]').nth(3).click({ timeout: 60000 })
await page.waitForTimeout(4000)
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
await cdp.send('Profiler.start')
const t = Date.now()
await page.keyboard.press('Meta+a')
const act = Date.now() - t
await page.waitForTimeout(3000)
const { profile } = await cdp.send('Profiler.stop')
const dom = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-testid="track-row"]').length, nodes: document.querySelectorAll('*').length }))
await app.close().catch(() => {})
const { label: labelOf } = sourcePositions(tree)
const label = (n) => labelOf(n.callFrame)
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
const dt = profile.timeDeltas
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + dt[i] / 1000))
const parent = new Map()
for (const n of profile.nodes) for (const ch of n.children ?? []) parent.set(ch, n.id)
const selfBy = new Map(), totalBy = new Map()
for (const [id, ms] of self) {
  const l = label(byId.get(id))
  selfBy.set(l, (selfBy.get(l) ?? 0) + ms)
  const seen = new Set()
  for (let p = id; p; p = parent.get(p)) {
    const pl = label(byId.get(p))
    if (pl.includes('node_modules') || seen.has(pl)) continue
    seen.add(pl)
    totalBy.set(pl, (totalBy.get(pl) ?? 0) + ms)
  }
}
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([l, ms]) => `${ms.toFixed(0).padStart(6)} ms  ${l}`).join('\n')
console.log(`${program}: Meta+A answered in ${act} ms; rows in DOM ${dom.rows}, nodes ${dom.nodes}`)
console.log('--- self time\n' + top(selfBy, 25))
console.log('--- total time (app code)\n' + top(totalBy, 40))
