// Captures the Settings tabs each /casos-de-uso recipe asks the reader to change, with
// the controls to touch numbered in the same order as the recipe's list.
//
//   node use-case-shots.mjs [caseId ...]   # default: every recipe, every app language
//
// Writes apps/web/public/use-cases/<caseId>-<n>-<lang>.webp, n being the tab's place in
// the recipe, and its size to apps/web/src/lib/useCaseShots.json. groupByTab below must
// match settingGroups in apps/web/src/lib/useCases.ts, whose numbers the page prints.
// Languages the website does not carry yet are captured too, so adding one to the site
// needs no new captures; recipe-labels.mjs names their settings.
// The values are set by clicking them in the modal and never saved, so the profile in
// /tmp stays as it was written.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_LANGUAGES, appLocale, recipeSettings } from './recipe-labels.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../../..')
const webDir = resolve(appDir, '../web')
const root = dirname(
  execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: here })
    .toString()
    .trim(),
)
const mainEntry = join(appDir, 'out/main/index.js')
const electronPath = createRequire(join(root, 'index.js'))('electron')
const { _electron: electron } = createRequire(
  join(root, 'apps/desktop/.claude/skills/run-desktop/package.json'),
)('playwright-core')

const outDir = join(webDir, 'public/use-cases')
const sizesFile = join(webDir, 'src/lib/useCaseShots.json')
const json = (p) => JSON.parse(readFileSync(p, 'utf8'))

const groupByTab = (settings) => {
  const groups = []
  for (const s of settings) {
    const g = groups.find((o) => o.tab === s.tab)
    if (g) g.settings.push(s)
    else groups.push({ tab: s.tab, settings: [s] })
  }
  let n = 0
  return groups.map((g) => ({ ...g, settings: g.settings.map((s) => ({ ...s, n: ++n })) }))
}

async function launch(lang) {
  const ud = join(tmpdir(), `surco-use-case-shots-${lang}`)
  rmSync(ud, { recursive: true, force: true })
  mkdirSync(ud, { recursive: true })
  writeFileSync(
    join(ud, 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      language: lang,
      hasSeenOnboarding: true,
      lastSeenChangelogVersion: '99.0.0',
      donateNudgeDismissed: true,
      outputDir: join(homedir(), 'Music/Surco'),
      discogsToken: 'token',
      traktorNmlPath: join(homedir(), 'Documents/Native Instruments/Traktor 4.0.1/collection.nml'),
    }),
  )
  const app = await electron.launch({
    executablePath: electronPath,
    args: [mainEntry, '--force-device-scale-factor=2', `--user-data-dir=${ud}`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setContentSize(1440, 1600)
  })
  await page.waitForTimeout(1500)
  return { app, page }
}

async function capture(page, lang, c, group, index) {
  const tabId = Object.entries(appLocale(lang).settings.tabs).find(([, v]) => v === group.tab)[0]
  await page.click('[data-testid="open-settings"]')
  await page.click(`[data-testid="settings-tab-${tabId}"]`)
  await page.waitForTimeout(400)
  const missing = await page.evaluate(async (settings) => {
    const dialog = document.querySelector('[role="dialog"]')
    const panel = dialog.querySelector('[role="tabpanel"]') ?? dialog
    for (let e = panel; e && e !== dialog; e = e.parentElement) {
      e.style.overflow = 'visible'
      e.style.height = 'auto'
      e.style.maxHeight = 'none'
    }
    dialog.style.height = 'auto'
    dialog.style.maxHeight = 'none'
    const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
    const findText = (scope, text) =>
      [...scope.querySelectorAll('p,label,span,div,button,h4')].find(
        (el) => el.tagName !== 'H3' && (own(el) === text || el.textContent.trim() === text) && el.children.length <= 1,
      )
    const missing = []
    const boxes = []
    for (const s of settings) {
      let scope = panel
      if (s.section) {
        const h = [...panel.querySelectorAll('h3,p')].find((h) => h.textContent.trim() === s.section)
        scope = h?.closest('section') ?? panel
      }
      const label = findText(scope, s.setting)
      if (!label) {
        missing.push(s.setting)
        continue
      }
      const row = label.closest('label') ?? label
      if (row === label && label.nextElementSibling) {
        const field = label.parentElement
        let v = s.value && findText(field, s.value)
        for (const b of s.value && !v ? field.querySelectorAll('button') : []) {
          b.click()
          await new Promise((r) => setTimeout(r, 150))
          v = findText(field, s.value)
          if (v) break
        }
        if (v) {
          ;(v.closest('button,label') ?? v).click()
          await new Promise((r) => setTimeout(r, 150))
          v = findText(field, s.value)
        }
        const els = [label]
        for (let e = label.nextElementSibling; e; e = e.nextElementSibling) {
          els.push(e)
          if (v ? e.contains(v) : e.querySelector('button,input,select')) break
        }
        boxes.push({ n: s.n, els })
        continue
      }
      const input = row.querySelector('input[type="checkbox"]')
      if (input && !input.checked && !s.value) {
        input.click()
        await new Promise((r) => setTimeout(r, 150))
        dialog.querySelector('[data-testid="settings-complete-cues-yes"]')?.click()
      }
      boxes.push({ n: s.n, els: [row] })
    }
    window.__boxes = boxes
    return missing
  }, group.settings)
  if (missing.length) console.error(`  ${c.id} ${lang}: not found ${JSON.stringify(missing)}`)
  await page.waitForTimeout(300)
  await page.evaluate((home) => {
    const dialog = document.querySelector('[role="dialog"]')
    dialog.querySelector('[data-testid="settings-close"]').style.visibility = 'hidden'
    const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) walker.currentNode.textContent = walker.currentNode.textContent.replaceAll(home, '/Users/dj')
    for (const input of dialog.querySelectorAll('input')) input.value = input.value.replaceAll(home, '/Users/dj')
    const marked = window.__boxes.flatMap((b) => b.els)
    const sections = [...document.querySelectorAll('[role="dialog"] [data-testid="settings-section"]')]
    let stub = null
    for (const sec of sections) {
      if (marked.some((el) => sec.contains(el))) {
        stub = null
        continue
      }
      const name = sec.querySelector('h3, p')?.textContent.trim() ?? '…'
      if (stub) stub.dataset.names += ` · ${name}`
      else {
        stub = document.createElement('div')
        stub.className = 'mt-6 border-t border-[var(--color-line)] pt-4 text-xs text-fg-faint'
        stub.dataset.names = name
        sec.before(stub)
      }
      stub.textContent = `⋯  ${stub.dataset.names}`
      sec.style.display = 'none'
    }
    for (const b of window.__boxes) {
      const rs = b.els.map((e) => e.getBoundingClientRect())
      const x = Math.min(...rs.map((r) => r.left)) - 6
      const y = Math.min(...rs.map((r) => r.top)) - 6
      const w = Math.max(...rs.map((r) => r.right)) - x + 6
      const h = Math.max(...rs.map((r) => r.bottom)) - y + 6
      const m = document.createElement('div')
      m.className = '__mark'
      Object.assign(m.style, {
        position: 'fixed', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`,
        border: '2px solid #e0af68', borderRadius: '8px', zIndex: 2147483647, pointerEvents: 'none',
      })
      const n = document.createElement('span')
      n.textContent = String(b.n)
      Object.assign(n.style, {
        position: 'absolute', top: '-11px', left: '-11px', width: '22px', height: '22px',
        borderRadius: '999px', background: '#e0af68', color: '#1a1b26',
        font: '700 12px/22px ui-monospace, monospace', textAlign: 'center',
      })
      m.appendChild(n)
      document.body.appendChild(m)
    }
  }, homedir())
  const name = `${c.id}-${index + 1}-${lang}`
  const file = join(outDir, name)
  const box = await page.locator('[role="dialog"]').boundingBox()
  sizes[`${name}.webp`] = [Math.round(box.width), Math.round(box.height)]
  await page.locator('[role="dialog"]').screenshot({ path: `${file}.png` })
  execFileSync('cwebp', ['-quiet', '-q', '80', `${file}.png`, '-o', `${file}.webp`])
  rmSync(`${file}.png`)
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.querySelectorAll('.__mark').forEach((m) => m.remove()))
  await page.waitForTimeout(300)
}

const only = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const sizes = json(sizesFile)
for (const lang of APP_LANGUAGES) {
  const { app, page } = await launch(lang)
  for (const c of recipeSettings(lang)) {
    if (only.length && !only.includes(c.id)) continue
    const groups = groupByTab(c.settings)
    for (const [i, g] of groups.entries()) await capture(page, lang, c, g, i)
    console.log(`${c.id} ${lang}: ${groups.length}`)
  }
  await app.close()
}
const lines = Object.entries(sizes)
  .sort()
  .map(([k, [w, h]]) => `  "${k}": [${w}, ${h}]`)
writeFileSync(sizesFile, `{\n${lines.join(',\n')}\n}\n`)
