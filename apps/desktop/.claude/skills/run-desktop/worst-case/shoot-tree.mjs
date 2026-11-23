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
const [set = 'nml-worst', lang = 'es', theme = 'dark', size = '1080x620', density = 'normal', tag = ''] = process.argv.slice(2)
const [w, h] = size.split('x').map(Number)
const name = `${set}-${lang}-${theme}-${size}-${density}${tag}`
const ud = join(here, 'profiles', `${name}-${Date.now()}`)
mkdirSync(ud, { recursive: true })
mkdirSync(join(here, 'tshots'), { recursive: true })
writeFileSync(join(ud, 'settings.json'), JSON.stringify({
  hasSeenOnboarding: true, lastSeenChangelogVersion: '99.0.0', donateNudgeDismissed: true,
  addToAppleMusic: false, outputDir: join(ud, 'Surco'), language: lang, theme, density, autoMatch: false,
  traktorNmlPath: join(here, 'fx', set, 'collection.nml'),
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
await page.waitForTimeout(2500)
await page.getByTestId('source-rail-traktor').click()
await page.waitForTimeout(4000)
const shot = async (label) => {
  await page.mouse.move(1, 1)
  await page.screenshot({ path: join(here, 'tshots', `${name}-${label}.png`) })
}
const measure = () => page.evaluate(() => {
  const tree = document.querySelector('[data-testid="source-tree"]')
  if (!tree) return { noTree: true, text: document.body.innerText.slice(0, 300) }
  const box = tree.getBoundingClientRect()
  const rows = [...tree.querySelectorAll('[data-testid^="source-node-"]')].filter((b) => b.tagName === 'BUTTON' && /^source-node-[^-]/.test(b.getAttribute('data-testid')) && !/-(count|expand|recent|all|smart|matching)/.test(b.getAttribute('data-testid')))
  return {
    treeW: Math.round(box.width),
    scrollX: tree.scrollWidth > tree.clientWidth,
    rows: rows.slice(0, 60).map((b) => {
      const nameEl = b.querySelector('span.truncate')
      const count = b.querySelector('[data-testid^="source-node-count-"]')
      const rb = b.getBoundingClientRect()
      return {
        name: nameEl?.textContent, nameW: Math.round(nameEl?.getBoundingClientRect().width ?? 0),
        cut: nameEl ? nameEl.scrollWidth > nameEl.clientWidth : null,
        count: count?.textContent, countW: Math.round(count?.getBoundingClientRect().width ?? 0),
        pad: getComputedStyle(b).paddingLeft, h: Math.round(rb.height), title: b.getAttribute('title'),
        over: rb.right > box.right + 0.5, dir: nameEl?.getAttribute('dir'),
      }
    }),
  }
})
await shot('closed')
for (let pass = 0; pass < 20; pass++) {
  const closed = page.locator('[data-testid="source-tree"] button[aria-expanded="false"]')
  const n = await closed.count()
  if (n === 0) break
  await closed.first().click()
  await page.waitForTimeout(150)
}
await page.waitForTimeout(800)
await shot('open')
const report = { open: await measure() }
await page.evaluate(() => { const t = document.querySelector('[data-testid="source-tree"]'); const s = t?.querySelector('.overflow-y-auto') ?? t; if (s) s.scrollTop = 400 })
await page.waitForTimeout(400)
await shot('open-s1')
writeFileSync(join(here, 'tshots', `${name}.json`), JSON.stringify(report, null, 1))
console.log(name, report.open.rows?.length ?? JSON.stringify(report.open))
await app.close()
