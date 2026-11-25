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
const [set = 'editor', lang = 'es', theme = 'dark', size = '1080x620', fields = 'all', density = 'normal', zoom = '1', tag = ''] = process.argv.slice(2)
const ALL = ['title', 'artist', 'albumArtist', 'album', 'year', 'genre', 'style', 'grouping', 'trackNumber', 'trackTotal', 'discNumber', 'discTotal', 'comment', 'bpm', 'key', 'remixArtist', 'mixName', 'composer', 'originalArtist', 'lyricist', 'conductor', 'copyright', 'encodedBy', 'originalYear', 'isrc', 'compilation', 'publisher', 'catalogNumber', 'discogsReleaseId', 'discogsUrl', 'country', 'mediaType', 'mood', 'energy', 'quality']
const [w, h] = size.split('x').map(Number)
const name = `${set}-${lang}-${theme}-${size}-${fields}-${density}-z${zoom}${tag}`
const ud = join(here, 'profiles', `${name}-${Date.now()}`)
mkdirSync(ud, { recursive: true })
mkdirSync(join(here, 'eshots'), { recursive: true })
const settings = {
  hasSeenOnboarding: true, lastSeenChangelogVersion: '99.0.0', donateNudgeDismissed: true,
  addToAppleMusic: false, outputDir: join(ud, 'Surco'), language: lang, theme, density, autoMatch: false,
}
if (fields === 'all') settings.visibleFields = ALL
writeFileSync(join(ud, 'settings.json'), JSON.stringify(settings))
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
await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open-files', [p]), join(here, 'fx', set))
await page.waitForSelector('[data-testid="track-row"]', { timeout: 60000 })
await page.waitForTimeout(5000)
const rows = await page.locator('[data-testid="track-row"]').count()
const measure = () => page.evaluate(() => {
  const sc = document.querySelector('[data-testid="editor-scroll"]')
  if (!sc) return { noEditor: true }
  const box = sc.getBoundingClientRect()
  const over = [...sc.querySelectorAll('*')].filter((e) => {
    const b = e.getBoundingClientRect()
    return b.width > 0 && b.height > 0 && (b.right > box.right + 0.5 || b.left < box.left - 0.5)
  }).map((e) => `${e.getAttribute('data-testid') || e.tagName}:${Math.round(e.getBoundingClientRect().width)}`)
  const inputs = [...sc.querySelectorAll('input[type=text], input:not([type]), textarea')].map((i) => ({
    name: i.getAttribute('data-testid') || i.name, w: Math.round(i.clientWidth), clipped: i.scrollWidth > i.clientWidth + 1,
    value: i.value.slice(0, 40), lines: i.value.split('\n').length, dir: i.getAttribute('dir'),
    h: Math.round(i.getBoundingClientRect().height),
  }))
  const cover = sc.querySelector('[data-testid*="cover"] img, img')
  const cb = cover?.getBoundingClientRect()
  const summary = document.querySelector('[data-testid="form-summary"]')?.textContent
  return { editorW: Math.round(box.width), scrollWidthOver: sc.scrollWidth > sc.clientWidth, over: [...new Set(over)].slice(0, 30), inputs, cover: cover ? { w: Math.round(cb.width), h: Math.round(cb.height), natural: `${cover.naturalWidth}x${cover.naturalHeight}`, fit: getComputedStyle(cover).objectFit } : null, summary, docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth }
})
const report = []
const scrollShots = async (label) => {
  for (let k = 1; k <= Number(process.env.SCROLLS ?? 0); k++) {
    const moved = await page.evaluate((k) => { const sc = document.querySelector('[data-testid="editor-scroll"]'); if (!sc) return false; const before = sc.scrollTop; sc.scrollTop = k * (sc.clientHeight - 60); return sc.scrollTop !== before }, k)
    if (!moved) break
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(here, 'eshots', `${name}-${label}-s${k}.png`) })
  }
  await page.evaluate(() => { const sc = document.querySelector('[data-testid="editor-scroll"]'); if (sc) sc.scrollTop = 0 })
}
for (let i = 0; i < rows; i++) {
  await page.locator('[data-testid="track-row"]').nth(i).click()
  await page.waitForTimeout(2500)
  await page.mouse.move(1, 1)
  await page.screenshot({ path: join(here, 'eshots', `${name}-r${i + 1}.png`) })
  report.push({ row: i + 1, ...(await measure()) })
  await scrollShots(`r${i + 1}`)
}
if (rows > 1) {
  await page.locator('[data-testid="track-row"]').nth(0).click()
  await page.keyboard.press('Meta+a')
  await page.waitForTimeout(2500)
  await page.mouse.move(1, 1)
  await page.screenshot({ path: join(here, 'eshots', `${name}-multi.png`) })
  report.push({ row: 'multi', ...(await measure()) })
  await scrollShots('multi')
}
writeFileSync(join(here, 'eshots', `${name}.json`), JSON.stringify(report, null, 1))
console.log(name, 'rows', rows)
await app.close()
