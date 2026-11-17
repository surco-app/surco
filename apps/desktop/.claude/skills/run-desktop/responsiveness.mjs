import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  bigEngine,
  bigRekordbox,
  bigSerato,
  bigTraktor,
  bigVirtualdj,
  repoRoot,
} from './big-fixtures.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const tree = resolve(arg('tree', repoRoot))
const runs = Number(arg('runs', '3'))
const git = (...a) => execFileSync('git', a, { cwd: tree, encoding: 'utf8' }).trim()
const baselineTag = arg('baseline', git('describe', '--tags', '--abbrev=0'))
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright-core')
const requireRoot = createRequire(join(repoRoot, 'index.js'))
const electronPath = requireRoot('electron')
const electronVite = join(dirname(requireRoot.resolve('electron-vite/package.json')), 'bin/electron-vite.js')
const ACT_TIMEOUT = 60000
const RATIO = 1.5
const SLACK_MS = 500
const FLOOR_MS = 1000

function baselineTree() {
  const dir = join(repoRoot, '.claude/worktrees', `gate-baseline-${baselineTag}`)
  if (!existsSync(dir)) git('worktree', 'add', '--detach', dir, baselineTag)
  if (!existsSync(join(dir, 'apps/desktop/out/main/index.js')))
    execFileSync(process.execPath, [electronVite, 'build'], { cwd: join(dir, 'apps/desktop'), stdio: 'ignore' })
  return dir
}

const refocusTwice = async (app, page) => {
  for (let i = 0; i < 2; i++) {
    await app
      .evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        w.blur()
        setTimeout(() => w.focus(), 300)
      })
      .catch(() => {})
    if (i === 0) await page.waitForTimeout(6000).catch(() => {})
  }
}

const bigListPhases = (program) => [
  ['open tab', (page) => page.locator(`[data-testid="source-rail-${program}"]`).click({ timeout: ACT_TIMEOUT }), 8000],
  ['open big list', (page) => page.getByText('SOAK BIG', { exact: true }).first().click({ timeout: ACT_TIMEOUT }), 10000],
  ['select a track', (page) => page.locator('[data-testid="track-row"]').nth(3).click({ timeout: ACT_TIMEOUT }), 5000],
  ['select every track', (page) => page.keyboard.press('Meta+a'), 8000],
]

const SCENARIOS = {
  rekordbox: {
    settings: () => ({ rekordboxDbPath: bigRekordbox() }),
    phases: [
      ['open tab', (page) => page.locator('[data-testid="source-rail-rekordbox"]').click({ timeout: ACT_TIMEOUT }), 8000],
      ['open big list', (page) => page.getByText('SOAK BIG', { exact: true }).first().click({ timeout: ACT_TIMEOUT }), 12000],
      ['come back to the window twice', null, 6000],
      ['select a track', (page) => page.locator('[data-testid="track-row"]').nth(3).click({ timeout: ACT_TIMEOUT }), 6000],
    ],
  },
  traktor: {
    settings: (ud) => ({ traktorNmlPath: bigTraktor({ entries: 8268, sessions: 180 }), rekordboxDbPath: join(ud, 'none', 'master.db') }),
    phases: [
      ['open tab', (page) => page.locator('[data-testid="source-rail-traktor"]').click({ timeout: ACT_TIMEOUT }), 15000],
      ['come back to the window twice', null, 8000],
    ],
  },
  engine: {
    settings: (ud) => ({ engineLibraryDir: bigEngine(), rekordboxDbPath: join(ud, 'none', 'master.db') }),
    phases: bigListPhases('engine'),
  },
  virtualdj: {
    settings: (ud) => ({ virtualdjLibraryDir: bigVirtualdj(), rekordboxDbPath: join(ud, 'none', 'master.db') }),
    phases: bigListPhases('virtualdj'),
  },
  serato: {
    home: () => bigSerato(),
    settings: (ud) => ({ rekordboxDbPath: join(ud, 'none', 'master.db') }),
    phases: bigListPhases('serato'),
  },
}

async function measure(appTree, name) {
  const scenario = SCENARIOS[name]
  await new Promise((r) => setTimeout(r, 3000))
  const ud = join(tmpdir(), `surco-gate-profile-${Date.now()}`)
  mkdirSync(ud, { recursive: true })
  writeFileSync(
    join(ud, 'settings.json'),
    JSON.stringify({
      hasSeenOnboarding: true,
      lastSeenChangelogVersion: '99.0.0',
      donateNudgeDismissed: true,
      addToAppleMusic: false,
      autoAnalyze: false,
      cueLearnFromEdits: false,
      outputDir: join(ud, 'out'),
      ...scenario.settings(ud),
    }),
  )
  const app = await electron.launch({
    executablePath: electronPath,
    args: [join(appTree, 'apps/desktop/out/main/index.js'), '--force-device-scale-factor=1', `--user-data-dir=${ud}`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  if (scenario.home) await app.evaluate(({ app }, home) => app.setPath('home', home), scenario.home())
  const page = await app.firstWindow()
  await page.waitForTimeout(6000)
  const result = {}
  let phase = null
  let watching = true
  const watcher = (async () => {
    while (watching) {
      const t = Date.now()
      await app.evaluate(() => 1).catch(() => {})
      const lag = Date.now() - t
      if (phase) result[phase].lag = Math.max(result[phase].lag, lag)
      await new Promise((r) => setTimeout(r, 100))
    }
  })()
  for (const [label, act, wait] of scenario.phases) {
    phase = label
    result[label] = { act: 0, lag: 0 }
    const t = Date.now()
    if (act) await act(page).catch(() => {})
    else await refocusTwice(app, page)
    result[label].act = act ? Date.now() - t : 0
    await page.waitForTimeout(wait).catch(() => {})
  }
  watching = false
  await watcher
  await app.close().catch(() => {})
  return result
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

async function typical(appTree, name) {
  const all = []
  for (let i = 0; i < runs; i++) all.push(await measure(appTree, name))
  const out = {}
  for (const [label] of SCENARIOS[name].phases)
    out[label] = {
      act: median(all.map((r) => r[label].act)),
      lag: median(all.map((r) => r[label].lag)),
    }
  return out
}

const tooSlow = (now, before) => now > FLOOR_MS && now > Math.max(before * RATIO, before + SLACK_MS)

const base = baselineTree()
console.log(`responsiveness: ${tree} against ${baselineTag}, median of ${runs} runs each`)
const failures = []
const only = arg('only', '').split(',').filter(Boolean)
for (const name of Object.keys(SCENARIOS).filter((n) => only.length === 0 || only.includes(n))) {
  const before = await typical(base, name)
  const now = await typical(tree, name)
  for (const [label] of SCENARIOS[name].phases) {
    const b = before[label]
    const n = now[label]
    const bad = ['act', 'lag'].filter((k) => tooSlow(n[k], b[k]))
    console.log(
      `${bad.length ? 'FAIL' : ' ok '} ${name} ${label}: answers in ${n.act} ms (was ${b.act}), main blocked ${n.lag} ms (was ${b.lag})`,
    )
    if (bad.length) failures.push(`${name} ${label}`)
  }
}
if (failures.length) {
  console.log(`FAIL: slower than ${baselineTag} on ${failures.join(', ')}`)
  process.exit(1)
}
console.log(`OK: no step is slower than ${baselineTag}`)
