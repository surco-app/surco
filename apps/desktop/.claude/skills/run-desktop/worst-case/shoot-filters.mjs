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
const [set = 'worst', lang = 'es', theme = 'dark', size = '1080x620', density = 'normal'] = process.argv.slice(2)
const [w, h] = size.split('x').map(Number)
const name = `${set}-${lang}-${theme}-${size}-${density}`
const ud = join(here, 'profiles', `f-${name}-${Date.now()}`)
mkdirSync(ud, { recursive: true })
mkdirSync(join(here, 'fshots'), { recursive: true })
writeFileSync(join(ud, 'settings.json'), JSON.stringify({
  hasSeenOnboarding: true, lastSeenChangelogVersion: '99.0.0', donateNudgeDismissed: true,
  addToAppleMusic: false, outputDir: join(ud, 'Surco'), language: lang, theme, density, autoMatch: false,
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
await page.waitForTimeout(1500)
await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open-files', [p]), join(here, 'fx', set))
await page.waitForSelector('[data-testid="track-row"]', { timeout: 60000 })
await page.waitForTimeout(set === 'big' ? 15000 : 6000)
const shot = async (label) => {
  await page.mouse.move(1, 1)
  await page.screenshot({ path: join(here, 'fshots', `${name}-${label}.png`) })
}
const measure = () => page.evaluate(() => {
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const menu = document.querySelector('[data-testid="quality-filter-menu"], [data-testid="quality-filter-listbox"]')?.closest('.fixed') ?? document.querySelector('.animate-pop-flat.fixed')
  const mb = menu?.getBoundingClientRect()
  const cut = [...(menu?.querySelectorAll('span, button, p, label') ?? [])]
    .filter((e) => e.children.length === 0 && e.scrollWidth > e.clientWidth + 1)
    .map((e) => e.textContent.trim())
  const over = [...(menu?.querySelectorAll('*') ?? [])].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && mb && (b.right > mb.right + 0.5 || b.left < mb.left - 0.5) }).map((e) => e.getAttribute('data-testid') || e.tagName)
  const trigger = document.querySelector('[data-testid="quality-filter-trigger"]')
  const chips = [...document.querySelectorAll('[data-testid^="active-filter-"]:not([data-testid$="-remove"])')].map((c) => ({ text: c.textContent, cut: [...c.querySelectorAll('span')].some((s) => s.scrollWidth > s.clientWidth + 1), w: Math.round(c.getBoundingClientRect().width) }))
  const list = document.querySelector('[data-testid="active-filters"]')
  return {
    menu: mb ? { x: Math.round(mb.left), y: Math.round(mb.top), w: Math.round(mb.width), h: Math.round(mb.height), offRight: mb.right > vw, offBottom: mb.bottom > vh, scrollY: menu.scrollHeight > menu.clientHeight } : null,
    cut: [...new Set(cut)].slice(0, 20), over: [...new Set(over)].slice(0, 10),
    trigger: trigger ? { text: trigger.textContent, w: Math.round(trigger.getBoundingClientRect().width), cut: [...trigger.querySelectorAll('span')].some((s) => s.scrollWidth > s.clientWidth + 1) } : null,
    chips, chipsRowH: list ? Math.round(list.getBoundingClientRect().height) : 0,
    counter: [...document.querySelectorAll('[data-testid^="track-"][data-testid$="position"], [data-testid="track-selected-count"]')].map((e) => e.textContent),
    docOverflowX: document.documentElement.scrollWidth > vw,
  }
})
const report = {}
await page.getByTestId('quality-filter-trigger').click()
await page.waitForTimeout(500)
const sections = await page.$$eval('[data-testid^="quality-filter-section-"]', (els) => els.map((e) => e.getAttribute('data-testid')).filter((t) => /^quality-filter-section-[a-z]+$/.test(t)))
for (const s of sections) {
  await page.getByTestId(s).click()
  await page.waitForTimeout(300)
  const key = s.replace('quality-filter-section-', '')
  await shot(`menu-${key}`)
  report[`menu-${key}`] = await measure()
}
const pick = async (section, index) => {
  await page.getByTestId(`quality-filter-section-${section}`).click()
  await page.waitForTimeout(250)
  const opts = page.locator('[data-testid="quality-filter-listbox"] [role="option"], [data-testid="quality-filter-listbox"] button')
  if ((await opts.count()) > index) await opts.nth(index).click()
  await page.waitForTimeout(400)
  if (!(await page.getByTestId(`quality-filter-section-${section}`).isVisible().catch(() => false))) {
    await page.getByTestId('quality-filter-trigger').click()
    await page.waitForTimeout(300)
  }
}
await pick('status', 1)
await pick('tags', 1)
await pick('match', 1)
await pick('format', 0)
await page.keyboard.press('Escape')
await page.waitForTimeout(600)
await shot('active')
report.active = await measure()
writeFileSync(join(here, 'fshots', `${name}.json`), JSON.stringify(report, null, 1))
console.log(name, sections.length)
await app.close()
