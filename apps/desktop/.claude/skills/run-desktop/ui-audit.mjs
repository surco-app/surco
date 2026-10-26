// Walks the built app through every settings tab and every editor section, in each UI
// language and at the smallest and a large window, and measures the layout faults a DJ
// notices at a glance: an option row split over two lines, a checkbox off its label's
// first line, text cut with no ellipsis, a button label that wraps, a control spilling
// out of its panel, a sideways scrollbar, two controls on top of each other.
//
//   node ui-audit.mjs [audioFile]     # writes /tmp/surco-ui-audit.json + one screenshot
//                                     # per surface with findings; exit 1 if any
//
// Uses the app's own isolated profile (see SKILL.md); the language it changes is put back.

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright-core')
const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../../..')
const repoRoot = resolve(appDir, '../..')
const electronPath = createRequire(resolve(repoRoot, 'index.js'))('electron')

const LANGUAGES = ['es', 'en', 'de', 'fr', 'pt-BR']
const SIZES = [
  [1080, 620],
  [1440, 900],
]
const TABS = [
  'general',
  'search',
  'editor',
  'layout',
  'fields',
  'artwork',
  'cues',
  'conversion',
  'processing',
  'naming',
  'destination',
  'shortcuts',
  'stats',
]

// Runs in the page. Returns one finding per fault, named by the nearest data-testid.
const MEASURE = (scopeSelector) => {
  const scope = scopeSelector ? document.querySelector(scopeSelector) : document.body
  if (!scope) return []
  const found = []
  const visible = (el) =>
    el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false &&
    el.getBoundingClientRect().width > 0 &&
    !el.closest('[aria-hidden="true"]')
  const where = (el) => {
    const t = el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.tagName.toLowerCase()
    return `${t} «${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50)}»`
  }
  const add = (kind, el, detail = '') => found.push({ kind, where: where(el), detail })
  // The part of an element the DJ can see: its box cut by every scrolling or clipping
  // ancestor, so a control scrolled under a header is not taken for one beside it.
  const shown = (el) => {
    let r = el.getBoundingClientRect()
    let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      r = a.getBoundingClientRect()
      box = {
        left: Math.max(box.left, r.left),
        top: Math.max(box.top, r.top),
        right: Math.min(box.right, r.right),
        bottom: Math.min(box.bottom, r.bottom),
      }
    }
    return box.right - box.left > 0 && box.bottom - box.top > 0 ? box : null
  }
  // The most lines any one piece of text inside el is set on, counted from where its
  // glyphs land: an icon beside a label, or a badge above it, is not a wrapped label.
  const lines = (el) => {
    let most = 0
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      const rects = [...range.getClientRects()].filter((r) => r.width > 0)
      const lh = Number.parseFloat(getComputedStyle(n.parentElement).lineHeight) || 16
      const tops = []
      for (const r of rects) if (!tops.some((t) => Math.abs(t - r.top) < lh / 2)) tops.push(r.top)
      most = Math.max(most, tops.length)
    }
    return most
  }

  for (const group of scope.querySelectorAll('[role="group"]')) {
    const buttons = [...group.querySelectorAll(':scope > button[aria-pressed]')].filter(visible)
    if (buttons.length < 2) continue
    const tops = buttons.map((b) => Math.round(b.getBoundingClientRect().top))
    const rows = new Set(tops)
    // A deliberate grid (SegmentedControl in a narrow panel) is fine as long as its rows
    // are even; a row that wrapped on its own leaves its last options alone below.
    const counts = [...rows].map((t) => tops.filter((x) => x === t).length)
    if (group.dataset.layout === 'grid' ? Math.max(...counts) - Math.min(...counts) > 1 : rows.size > 1)
      add('options-wrap', group, `${rows.size} rows`)
  }

  for (const box of scope.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
    if (!visible(box)) continue
    const label = box.closest('label')
    const text = label && [...label.querySelectorAll('span')].find((s) => s.textContent?.trim())
    if (!text) continue
    const lh = Number.parseFloat(getComputedStyle(text).lineHeight)
    const t = text.getBoundingClientRect()
    if (!lh || t.height < lh * 1.5) continue
    const b = box.getBoundingClientRect()
    const off = b.top + b.height / 2 - (t.top + lh / 2)
    if (Math.abs(off) > 2) add('checkbox-off-first-line', label, `${off.toFixed(1)}px`)
  }

  for (const el of scope.querySelectorAll('*')) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (
      hasText &&
      el.clientWidth > 1 &&
      ['hidden', 'clip'].includes(cs.overflowX) &&
      cs.textOverflow !== 'ellipsis' &&
      el.scrollWidth > el.clientWidth + 1
    )
      add('text-cut', el, `${el.scrollWidth}>${el.clientWidth}`)
    if (
      ['auto', 'scroll'].includes(cs.overflowX) &&
      el.scrollWidth > el.clientWidth + 1 &&
      el.clientWidth > 0
    )
      add('sideways-scroll', el, `${el.scrollWidth}>${el.clientWidth}`)
  }

  const controls = [
    ...scope.querySelectorAll('button, [role="tab"], [role="menuitem"], input, select, textarea'),
  ].filter(visible)
  for (const c of controls) {
    if (c.matches('button, [role="tab"], [role="menuitem"]')) {
      const text = (c.textContent ?? '').trim()
      if (text && text.length < 60 && shown(c) && lines(c) > 1) add('button-label-wraps', c)
    }
    let clip = c.parentElement
    while (clip && getComputedStyle(clip).overflowX === 'visible') clip = clip.parentElement
    if (clip && clip !== document.body && clip !== document.documentElement) {
      const r = c.getBoundingClientRect()
      const k = clip.getBoundingClientRect()
      const scrolls = ['auto', 'scroll'].includes(getComputedStyle(clip).overflowX)
      if (!scrolls && c.clientWidth > 1 && (r.right > k.right + 1 || r.left < k.left - 1))
        add('control-spills', c, `${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(k.left)}..${Math.round(k.right)}`)
    }
  }
  for (let i = 0; i < controls.length; i++)
    for (let j = i + 1; j < controls.length; j++) {
      const [a, b] = [controls[i], controls[j]]
      if (a.contains(b) || b.contains(a)) continue
      const p = shown(a)
      const q = shown(b)
      if (!p || !q) continue
      // One laid inside the other on purpose: a clear button in a search field, a drag
      // handle over its row.
      const inside = (x, y) =>
        x.left >= y.left - 1 && x.right <= y.right + 1 && x.top >= y.top - 1 && x.bottom <= y.bottom + 1
      if (inside(p, q) || inside(q, p)) continue
      const w = Math.min(p.right, q.right) - Math.max(p.left, q.left)
      const h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top)
      if (w > 3 && h > 3) add('controls-overlap', a, `with ${where(b)}`)
    }
  return found
}

async function main() {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [resolve(appDir, 'out/main/index.js'), '--force-device-scale-factor=1'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const report = []
  const shots = '/tmp/surco-ui-audit'
  mkdirSync(shots, { recursive: true })
  const record = async (surface, lang, size, scope) => {
    await page.waitForTimeout(450)
    const findings = await page.evaluate(MEASURE, scope)
    if (findings.length === 0) return
    const name = `${surface}-${lang}-${size.join('x')}`.replace(/[^\w.-]/g, '_')
    await page.screenshot({ path: `${shots}/${name}.png` })
    for (const f of findings) report.push({ surface, lang, size: size.join('x'), ...f })
  }
  try {
    await page.waitForSelector('[data-testid="open-settings"]', { timeout: 20000 })
    const audio = process.argv[2]
    if (audio) {
      const copy = '/tmp/surco-ui-audit/track.flac'
      copyFileSync(audio, copy)
      await app.evaluate(({ BrowserWindow }, p) => {
        BrowserWindow.getAllWindows()[0].webContents.send('open-files', [p])
      }, copy)
      await page.waitForSelector('[data-testid="track-row"]', { timeout: 20000 })
    }
    const before = await page.evaluate(() => window.api.getSettings().then((s) => s.language))
    for (const size of SIZES) {
      await app.evaluate(({ BrowserWindow }, [w, h]) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.webContents.setZoomFactor(1)
        win.setContentSize(w, h)
      }, size)
      for (const lang of LANGUAGES) {
        await page.click('[data-testid="open-settings"]')
        await page.waitForSelector('[data-testid="settings-tab-general"]')
        await page.click('[data-testid="settings-tab-general"]')
        await page.click(`[data-testid="settings-language-${lang}"]`)
        for (const tab of TABS) {
          const tabButton = page.locator(`[data-testid="settings-tab-${tab}"]`)
          if ((await tabButton.count()) === 0) continue
          await tabButton.click()
          await record(`settings-${tab}`, lang, size, '[role="dialog"]')
        }
        await page.click('[data-testid="settings-close"]')
        await page.waitForTimeout(300)
        if (audio) {
          await page.locator('[data-testid="track-row"]').first().click()
          await page.waitForTimeout(800)
          for (const header of await page.locator('[data-section-header][aria-expanded="false"]').all())
            await header.click().catch(() => {})
          await record('editor', lang, size, null)
        }
      }
    }
    await page.click('[data-testid="open-settings"]')
    await page.click('[data-testid="settings-tab-general"]')
    await page.click(`[data-testid="settings-language-${before}"]`).catch(() => {})
    await page.click('[data-testid="settings-close"]')
  } finally {
    await app.close()
  }
  writeFileSync('/tmp/surco-ui-audit.json', JSON.stringify(report, null, 2))
  const byFault = new Map()
  for (const f of report) {
    const key = `${f.kind} ${f.where}`
    byFault.set(key, [...(byFault.get(key) ?? []), `${f.surface}/${f.lang}/${f.size}`])
  }
  for (const [key, where] of byFault) console.log(`${key}\n    ${where.slice(0, 6).join(', ')}${where.length > 6 ? ` +${where.length - 6}` : ''}`)
  console.log(`${byFault.size} distinct faults, ${report.length} findings`)
  process.exit(report.length > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
