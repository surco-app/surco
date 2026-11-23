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
const [set = 'worst', lang = 'es', theme = 'dark', size = '1000x621', zoom = '1', waves = '1', density = 'normal'] = process.argv.slice(2)
const [w, h] = size.split('x').map(Number)
const ud = join(here, 'profiles', `${set}-${lang}-${theme}-${size}-${zoom}-${waves}-${density}-${Date.now()}`)
mkdirSync(ud, { recursive: true })
writeFileSync(join(ud, 'settings.json'), JSON.stringify({
  hasSeenOnboarding: true, lastSeenChangelogVersion: '99.0.0', donateNudgeDismissed: true,
  addToAppleMusic: false, outputDir: join(ud, 'Surco'), language: lang, theme, density,
  showListWaves: waves === '1', autoMatch: false,
}))
const quiet = quietLaunch(join(desk, 'out/main/index.js'), electronPath)
const app = await electron.launch({
  executablePath: quiet.executablePath,
  args: [quiet.entry, '--force-device-scale-factor=1', `--user-data-dir=${ud}`],
  env: { ...process.env, ...quiet.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await app.evaluate(({ BrowserWindow }, [w, h, z]) => {
  const win = BrowserWindow.getAllWindows()[0]
  win.webContents.setAudioMuted(true)
  win.setContentSize(w, h)
  win.webContents.setZoomFactor(z)
}, [w, h, Number(zoom)])
await page.waitForTimeout(1500)
if (set !== 'empty') {
  const dir = join(here, 'fx', set)
  await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open-files', [p]), dir)
  await page.waitForSelector('[data-testid="track-row"]', { timeout: 60000 })
  await page.waitForTimeout(set === 'big' ? 15000 : 8000)
}
const name = `${set}-${lang}-${theme}-${size}-z${zoom}-w${waves}-${density}`
await page.mouse.move(1, 1)
await page.screenshot({ path: join(here, 'shots', `${name}.png`) })
const report = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-testid="track-row"]')]
  const out = rows.slice(0, 20).map((r) => {
    const rb = r.getBoundingClientRect()
    const over = [...r.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > rb.right + 0.5 || b.left < rb.left - 0.5) }).map((e) => e.getAttribute('data-testid') || e.tagName)
    const title = r.querySelector('[data-testid="track-title"]')
    const artist = r.querySelector('[data-testid="track-artist"]')
    const key = r.querySelector('[data-testid="track-key"]')
    const tb = title?.getBoundingClientRect()
    return { h: Math.round(rb.height), title: title?.textContent, titleW: Math.round(tb?.width ?? 0), artist: artist?.textContent, artistW: Math.round(artist?.getBoundingClientRect().width ?? 0), key: key?.textContent, keyClipped: key ? key.scrollWidth > key.clientWidth : null, dur: r.querySelector('[data-testid="track-duration"]')?.textContent, fmt: r.querySelector('[data-testid="track-format"]')?.textContent, over }
  })
  return { count: rows.length, docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth, rows: out }
})
writeFileSync(join(here, 'shots', `${name}.json`), JSON.stringify(report, null, 1))
console.log(name, 'rows', report.count)
await app.close()
