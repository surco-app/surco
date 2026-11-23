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
const [size = '1080x620', density = 'normal'] = process.argv.slice(2)
const [w, h] = size.split('x').map(Number)
const ud = join(here, 'profiles', `marks-${size}-${density}-${Date.now()}`)
mkdirSync(ud, { recursive: true })
mkdirSync(join(here, 'mshots'), { recursive: true })
writeFileSync(join(ud, 'settings.json'), JSON.stringify({
  hasSeenOnboarding: true, lastSeenChangelogVersion: '99.0.0', donateNudgeDismissed: true,
  addToAppleMusic: false, outputDir: join(ud, 'Surco'), language: 'es', theme: 'dark', density,
  autoMatch: true, autoCleanSpacing: true, showListWaves: false,
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
await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open-files', [p]), join(here, 'fx', 'marks'))
await page.waitForSelector('[data-testid="track-row"]', { timeout: 60000 })
await page.waitForTimeout(15000)
await page.locator('[data-testid="track-row"]').first().click()
await page.waitForTimeout(1500)
const album = page.getByTestId('field-album')
if (await album.count()) {
  await album.fill('Innovator (Remastered)')
  await album.press('Tab')
}
await page.waitForTimeout(1500)
await page.mouse.move(1, 1)
const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
writeFileSync(join(here, 'mshots', `marks-${size}-${density}.png`), Buffer.from(b64, 'base64'))
const report = await page.evaluate(() => [...document.querySelectorAll('[data-testid="track-row"]')].map((r) => {
  const rb = r.getBoundingClientRect()
  const line = r.querySelector('[data-testid="track-detail-line"]')
  const lb = line.getBoundingClientRect()
  const marks = [...line.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).filter((t) => t !== 'track-artist')
  const artist = r.querySelector('[data-testid="track-artist"]')
  const over = [...line.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > rb.right - 0.5 }).map((e) => e.getAttribute('data-testid') || e.tagName)
  return { title: r.querySelector('[data-testid="track-title"]')?.textContent, artist: artist?.textContent, artistW: Math.round(artist?.getBoundingClientRect().width ?? 0), lineW: Math.round(lb.width), rowRight: Math.round(rb.right), lineRight: Math.round(lb.right), marks, over }
}))
writeFileSync(join(here, 'mshots', `marks-${size}-${density}.json`), JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1))
for (const n of [6, 9]) {
  await page.evaluate((n) => {
    const row = document.querySelector('[data-testid="track-row"]')
    const box = row.querySelector('[data-testid="track-marks"]')
    box.querySelectorAll('[data-sim]').forEach((e) => e.remove())
    const mark = box.querySelector('[data-testid="track-duplicate"]')
    const have = box.querySelectorAll('[data-mark-label]').length
    for (let k = have; k < n; k++) { const c = mark.cloneNode(true); c.setAttribute('data-sim', ''); c.setAttribute('data-mark-label', `Mark ${k + 1}`); box.appendChild(c) }
    box.style.width = `${box.getBoundingClientRect().width - 1}px`
    requestAnimationFrame(() => { box.style.width = '' })
  }, n)
  await page.evaluate(() => { document.querySelector('[data-testid="track-marks"]').style.maxWidth = '20px' })
  await page.waitForTimeout(400)
  await page.evaluate(() => { document.querySelector('[data-testid="track-marks"]').style.maxWidth = '' })
  await page.waitForTimeout(600)
  const sim = await page.evaluate((n) => {
    const row = document.querySelector('[data-testid="track-row"]')
    const rb = row.getBoundingClientRect()
    const box = row.querySelector('[data-testid="track-marks"]')
    const marks = [...box.querySelectorAll('[data-mark-label]')]
    const visible = marks.filter((m) => m.offsetTop < box.clientHeight).length
    const fmt = row.querySelector('[data-testid="track-format-slot"]').getBoundingClientRect()
    return { n, visible, more: row.querySelector('[data-testid="track-marks-more"]')?.textContent ?? null, artistW: Math.round(row.querySelector('[data-testid="track-artist"]').getBoundingClientRect().width), formatVisible: fmt.right <= rb.right }
  }, n)
  await page.mouse.move(1, 1)
  const b = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(here, 'mshots', `fix-sim-${n}-${size}-${density}.png`), Buffer.from(b, 'base64'))
  console.log('SIM', JSON.stringify(sim))
}
await app.close()
