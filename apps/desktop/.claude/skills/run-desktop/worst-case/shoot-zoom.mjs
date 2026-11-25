import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const desk = resolve(import.meta.dirname, '../../../..')
const skill = join(desk, '.claude/skills/run-desktop')
const require = createRequire(join(skill, 'driver.mjs'))
const { _electron: electron } = require('playwright-core')
const { quietLaunch } = await import(join(skill, 'quiet-launch.mjs'))
const electronPath = createRequire(resolve(desk, '../../index.js'))('electron')
const here = process.env.WORST_DIR ?? '/tmp/surco-worst-case'
const [screen = 'editor', set = 'worst', lang = 'es', size = '1080x620', zooms = '1,1.25,1.5,2'] = process.argv.slice(2)
const [w, h] = size.split('x').map(Number)
const ud = join(here, 'profiles', `z-${screen}-${set}-${lang}-${size}-${Date.now()}`)
mkdirSync(ud, { recursive: true })
mkdirSync(join(here, 'zshots'), { recursive: true })
writeFileSync(join(ud, 'settings.json'), JSON.stringify({
  hasSeenOnboarding: true, lastSeenChangelogVersion: '99.0.0', donateNudgeDismissed: true,
  addToAppleMusic: false, outputDir: join(ud, 'Surco'), language: lang, theme: 'dark', autoMatch: false,
  ...(screen === 'tree' ? { traktorNmlPath: join(here, 'fx', set, 'collection.nml') } : {}),
}))
const quiet = quietLaunch(join(desk, 'out/main/index.js'), electronPath)
const app = await electron.launch({
  executablePath: quiet.executablePath,
  args: [quiet.entry, '--force-device-scale-factor=1', `--user-data-dir=${ud}`],
  env: { ...process.env, ...quiet.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await app.evaluate(({ BrowserWindow }, [w, h]) => {
  const win = BrowserWindow.getAllWindows()[0]
  win.webContents.setAudioMuted(true)
  win.setContentSize(w, h)
}, [w, h])
await page.waitForTimeout(2000)
if (screen === 'tree') {
  await page.getByTestId('source-rail-traktor').click()
  await page.waitForTimeout(4000)
} else {
  await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open-files', [p]), join(here, 'fx', set))
  await page.waitForSelector('[data-testid="track-row"]', { timeout: 60000 })
  await page.waitForTimeout(6000)
  if (screen === 'editor') {
    await page.locator('[data-testid="track-row"]').first().click()
    await page.waitForTimeout(2000)
  }
}
const capture = async (file) => {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(file, Buffer.from(b64, 'base64'))
}
const measure = () => page.evaluate(() => {
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const offscreen = (sel) => [...document.querySelectorAll(sel)].map((e) => { const b = e.getBoundingClientRect(); return { sel, w: Math.round(b.width), l: Math.round(b.left), r: Math.round(b.right), b: Math.round(b.bottom), hidden: b.width === 0 || b.right > vw + 1 || b.left < -1 || b.bottom > vh + 1 } })
  const cols = ['[data-testid="source-rail"]', '[data-testid="source-tree"]', '[data-testid="track-list"]', '[data-testid="results-strip"]', '[data-testid="editor-scroll"]'].flatMap(offscreen)
  const keys = ['[data-testid="quality-filter-trigger"]', '[data-testid="convert-button"], [data-testid^="convert-"]', '[data-testid="track-row"]', '[data-testid="field-title"]', '[data-testid="source-node-' + 'u0"]'].flatMap((s) => offscreen(s).slice(0, 1))
  const wide = [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.right > vw + 1 && getComputedStyle(e).position !== 'fixed' }).slice(0, 8).map((e) => `${e.getAttribute('data-testid') || e.tagName}:${Math.round(e.getBoundingClientRect().right)}`)
  return { vw, vh, docOverflowX: document.documentElement.scrollWidth > vw, docOverflowY: document.documentElement.scrollHeight > vh, cols, keys, wide }
})
const report = {}
if (process.env.STEPS) {
  const area = await app.evaluate(({ screen, BrowserWindow }) => screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()).workArea)
  report.area = area
  for (let k = 1; k <= Number(process.env.STEPS); k++) {
    await app.evaluate(({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.setZoomLevel(wc.getZoomLevel() + 0.5) })
    await page.waitForTimeout(1500)
    const state = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { level: w.webContents.getZoomLevel(), bounds: w.getBounds(), min: w.getMinimumSize() } })
    await capture(join(here, 'zshots', `steps-${screen}-${size}-k${k}.png`))
    report['k' + k] = { ...state, ...(await measure()) }
  }
  writeFileSync(join(here, 'zshots', `steps-${screen}-${size}.json`), JSON.stringify(report, null, 1))
  console.log('steps ok')
  await app.close()
  process.exit(0)
}

for (const z of zooms.split(',').map(Number)) {
  await app.evaluate(({ BrowserWindow }, z) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(z), z)
  await page.waitForTimeout(1500)
  if (screen === 'filters') {
    await page.getByTestId('quality-filter-trigger').click().catch(() => {})
    await page.waitForTimeout(600)
  }
  await page.mouse.move(1, 1)
  await capture(join(here, 'zshots', `${screen}-${set}-${lang}-${size}-z${z}.png`))
  report[z] = await measure()
  if (screen === 'filters') {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
}
writeFileSync(join(here, 'zshots', `${screen}-${set}-${lang}-${size}.json`), JSON.stringify(report, null, 1))
console.log(screen, set, lang, size, 'ok')
await app.close()
