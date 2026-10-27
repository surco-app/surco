// Captures the /guia walkthrough shots: every section's screen, in every app language.
//
//   node guide-shots.mjs [sectionId ...] [--lang es,en]   # default: every section and language
//
// Writes apps/web/public/guide/<sectionId>-<lang>.webp at the walkthrough's export size.
// Every scene runs on the reference track (Tina Cousins, Pray), read from the NAS. Search
// results come from the live search, so the machine needs the network; no Discogs token is
// set, which is why the search panel shows its "works without setup" note.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_LANGUAGES } from './recipe-labels.mjs'

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
const ffmpeg = join(root, 'node_modules/ffmpeg-static/ffmpeg')

export const PRAY =
  '/Volumes/Public/Music/Media.localized/Music/Tina Cousins/Pray/Pray (W.I.P. In The Church Mix).wav'
const WIDTH = 1440
const HEIGHT = 867
const outDir = join(webDir, 'public/guide')

export async function launch(lang, extra = {}) {
  const ud = join(tmpdir(), `surco-guide-shots-${lang}-${Date.now()}`)
  mkdirSync(ud, { recursive: true })
  writeFileSync(
    join(ud, 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      language: lang,
      hasSeenOnboarding: true,
      lastSeenChangelogVersion: '99.0.0',
      donateNudgeDismissed: true,
      outputDir: join(ud, 'Surco'),
      addToAppleMusic: false,
      rekordboxDbPath: join(ud, 'no-rekordbox/master.db'),
      ...extra,
    }),
  )
  const app = await electron.launch({
    executablePath: electronPath,
    args: [mainEntry, '--force-device-scale-factor=1', `--user-data-dir=${ud}`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    BrowserWindow.getAllWindows()[0].setContentSize(w, h)
  }, [WIDTH, HEIGHT])
  await page.waitForTimeout(1200)
  return { app, page, ud }
}

export async function open(app, page, paths) {
  await app.evaluate(({ BrowserWindow }, p) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-files', p)
  }, paths)
  await page.waitForSelector('[data-testid="track-row"]', { timeout: 30000 })
}

export async function save(page, name) {
  await page.mouse.move(2, 2)
  await page.waitForTimeout(300)
  const png = join(outDir, `${name}.png`)
  await page.screenshot({ path: png })
  execFileSync('cwebp', ['-quiet', '-q', '80', png, '-o', join(outDir, `${name}.webp`)])
  rmSync(png)
}

// Three takes of the reference track at the lengths of the release's A, B1 and B2, so the
// album match pairs each file with a side.
function albumTakes() {
  const dir = join(tmpdir(), 'surco-guide-album-v2')
  mkdirSync(dir, { recursive: true })
  return [
    ['A', 426],
    ['B1', 360],
    ['B2', 263],
  ].map(([side, secs]) => {
    const out = join(dir, `Pray ${side}.wav`)
    if (!existsSync(out))
      execFileSync(ffmpeg, [
        '-y', '-i', PRAY, '-t', String(secs), '-map_metadata', '-1',
        '-metadata', 'title=Pray', '-metadata', 'artist=Tina Cousins',
        '-metadata', 'album=Pray', '-metadata', 'date=1998', out,
      ], { stdio: 'ignore' })
    return out
  })
}

const wait = (page, ms) => page.waitForTimeout(ms)

async function selectPray(app, page) {
  await open(app, page, [PRAY])
  await page.locator('[data-testid="track-row"]').first().click()
  await settle(page)
}

async function settle(page) {
  await page.locator('[data-testid="result-card"]').first().waitFor({ timeout: 60000 })
  await page
    .locator('[data-testid="best-match-skeleton"]')
    .waitFor({ state: 'detached', timeout: 60000 })
    .catch(() => {})
  await wait(page, 1500)
}

async function editorTop(page) {
  await page.evaluate(() => document.querySelector('[data-testid="editor-scroll"]')?.scrollTo(0, 0))
  await wait(page, 300)
}

async function scrollEditorTo(page, selector) {
  await page.evaluate((sel) => {
    const scroll = document.querySelector('[data-testid="editor-scroll"]')
    const el = document.querySelector(sel)
    scroll.scrollTo(0, el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 16)
  }, selector)
  await wait(page, 400)
}

async function openSection(page, testid) {
  const toggle = page.locator(`[data-testid="${testid}"] button[aria-expanded="false"]`).first()
  if (await toggle.count()) await toggle.click()
  await wait(page, 600)
}

async function settingsTab(page, tab) {
  await page.click('[data-testid="open-settings"]')
  await page.click(`[data-testid="settings-tab-${tab}"]`)
  await wait(page, 700)
}

async function close(_app, page) {
  await page.keyboard.press('Escape')
  await wait(page, 500)
}

// Each scene leaves the window as the shot shows it; the runner saves, then calls `after`.
export const SCENES = {
  instalar: { fresh: { hasSeenOnboarding: false }, run: async (_app, page) => wait(page, 1500) },
  importar: { run: async (_app, page) => editorTop(page) },
  lista: { run: async (_app, page) => editorTop(page) },
  editor: { run: async (_app, page) => editorTop(page) },
  'otros-tags': {
    run: async (_app, page) => {
      await openSection(page, 'foreign-tags-toggle')
      await page.locator('[data-testid="foreign-tags-toggle"]').click().catch(() => {})
      await scrollEditorTo(page, '[data-testid="foreign-tags-toggle"]')
    },
    after: async (_app, page) => page.locator('[data-testid="foreign-tags-toggle"]').click().catch(() => {}),
  },
  calidad: {
    run: async (_app, page) => {
      await page.locator('[data-testid="spectrogram"]').waitFor({ timeout: 60000 })
      await scrollEditorTo(page, '[data-testid="quality-status"]')
    },
  },
  recorte: {
    run: async (_app, page) => {
      await openSection(page, 'editor-trim')
      await wait(page, 6000)
      await scrollEditorTo(page, '[data-testid="editor-trim"]')
    },
  },
  declick: {
    run: async (_app, page) => {
      await openSection(page, 'editor-declick')
      await page.click('[data-testid="declick-mode-standard"]')
      await page.click('[data-testid="declick-noise-medium"]')
      await page.locator('[data-testid="declick-marks"]').waitFor({ timeout: 90000 })
      await wait(page, 4000)
      await scrollEditorTo(page, '[data-testid="editor-declick"]')
    },
    // The repair stays on the track otherwise, and the export scene would convert with it.
    after: async (_app, page) => {
      await page.click('[data-testid="declick-mode-off"]')
      await page.click('[data-testid="declick-noise-off"]')
      await wait(page, 300)
    },
  },
  discogs: { run: async (_app, page) => editorTop(page) },
  automatch: {
    run: async (_app, page) => {
      await editorTop(page)
      await page.click('[data-testid="open-activity"]')
      await wait(page, 800)
    },
    after: async (_app, page) => {
      await page.click('[data-testid="activity-close"]')
      await wait(page, 500)
    },
  },
  nombres: {
    run: async (_app, page) => {
      if (!(await page.locator('[data-testid="customize-output-name"]').count()))
        await page.click('[data-testid="output-name-summary"]')
      await page.click('[data-testid="customize-output-name"]')
      await wait(page, 800)
    },
    after: close,
  },
  convertir: {
    run: async (_app, page) => {
      await editorTop(page)
      await page.click('[data-testid="process-format-toggle"]')
      await wait(page, 600)
    },
    after: close,
  },
  'igual-origen': { run: async (_app, page) => settingsTab(page, 'conversion'), after: close },
  traktor: {
    run: async (_app, page) => {
      await settingsTab(page, 'destination')
      await page.evaluate(() => {
        const h = [...document.querySelectorAll('[role="dialog"] h3, [role="dialog"] p')].find((e) =>
          /Traktor/.test(e.textContent) && e.closest('[data-testid="settings-section"]'),
        )
        h?.closest('[data-testid="settings-section"]')?.scrollIntoView({ block: 'center' })
      })
      await wait(page, 500)
    },
    after: close,
  },
  atajos: {
    run: async (_app, page) => {
      await page.click('[data-testid="open-palette"]')
      await wait(page, 800)
    },
    after: close,
  },
  ajustes: {
    run: async (_app, page) => {
      await settingsTab(page, 'general')
      await page.evaluate(() => {
        const home = '/Users/dj/Library/Application Support/Surco'
        const dialog = document.querySelector('[role="dialog"]')
        const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT)
        while (walker.nextNode())
          if (walker.currentNode.textContent.includes('surco-guide-shots'))
            walker.currentNode.textContent = home
        for (const input of dialog.querySelectorAll('input'))
          if (input.value.includes('surco-guide-shots')) input.value = home
      })
    },
    after: close,
  },
  // Last: it converts for real (into the profile's own output folder), which changes the
  // footer every later scene would show.
  exportar: {
    run: async (_app, page) => {
      await editorTop(page)
      await page.click('[data-testid="process-btn"]')
      await page.locator('[data-testid="export-success"]').waitFor({ timeout: 180000 })
      await wait(page, 1000)
    },
  },
}

export const ALBUM_SCENES = {
  album: {
    run: async (_app, page) => {
      const expand = page.locator('[data-testid="best-match-slot"] button[aria-expanded="false"]').first()
      if (await expand.count()) await expand.click()
      await wait(page, 1500)
    },
  },
  lote: { run: async (_app, page) => editorTop(page) },
}

// The rekordbox scene edits cues, so it runs on an APFS clone of this Mac's collection
// (master.db and its share folder with the analysis files), never on the real one, and
// the window is killed rather than closed: nothing is ever saved, not even to the clone.
function rekordboxClone() {
  const real = join(homedir(), 'Library/Pioneer/rekordbox')
  const dir = join(tmpdir(), 'surco-guide-rekordbox')
  if (!existsSync(join(dir, 'master.db'))) {
    mkdirSync(dir, { recursive: true })
    execFileSync('cp', ['-c', join(real, 'master.db'), dir])
    execFileSync('cp', ['-c', '-R', join(real, 'share'), dir])
  }
  return join(dir, 'master.db')
}

async function openFromRekordbox(page) {
  await page.click('[data-testid="source-rail-rekordbox"]')
  await page.waitForTimeout(3000)
  const seen = new Set()
  for (;;) {
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="source-node-"]')]
        .filter((e) => !e.dataset.testid.includes('recent'))
        .map((e) => e.dataset.testid),
    )
    const next = names.find((n) => !seen.has(n))
    if (!next) throw new Error('No rekordbox playlist holds the reference track')
    seen.add(next)
    await page.click(`[data-testid="${next}"]`)
    await page.waitForTimeout(1200)
    const row = page.locator('[data-testid="track-row"]', { hasText: 'Pray (W.I.P' })
    if (await row.count()) return row.first().click()
  }
}

export const REKORDBOX_SCENE = {
  run: async (_app, page) => {
    await openFromRekordbox(page)
    await page.locator('[data-testid="cues-section"]').waitFor({ timeout: 60000 })
    await wait(page, 4000)
    await page.click('[data-testid="cues-section"] [data-testid="section-maximize"]')
    await wait(page, 1500)
    await page.click('[data-testid="cues-clear-all"]')
    await wait(page, 800)
    await page.click('[data-testid="cues-auto-mark"]')
    await wait(page, 3000)
    await page.focus('[data-testid="cues-editor"]')
    await page.keyboard.press('ArrowRight')
    await wait(page, 500)
    await page.keyboard.press('ArrowRight')
    await wait(page, 1500)
  },
}

async function shoot(app, page, lang, id, scene) {
  await scene.run(app, page)
  await save(page, `${id}-${lang}`)
  if (scene.after) await scene.after(app, page)
  console.log(`${id} ${lang}`)
}

async function main() {
  const args = process.argv.slice(2)
  const langFlag = args.indexOf('--lang')
  const langs = langFlag >= 0 ? args[langFlag + 1].split(',') : APP_LANGUAGES
  const only = args.filter((a, i) => !a.startsWith('--') && (langFlag < 0 || i !== langFlag + 1))
  const want = (id) => !only.length || only.includes(id)
  mkdirSync(outDir, { recursive: true })
  for (const lang of langs) {
    for (const [id, scene] of Object.entries(SCENES).filter(([id, s]) => s.fresh && want(id))) {
      const { app, page } = await launch(lang, scene.fresh)
      await shoot(app, page, lang, id, scene)
      await app.close()
    }
    const plain = Object.entries(SCENES).filter(([id, s]) => !s.fresh && want(id))
    if (plain.length) {
      const { app, page } = await launch(lang)
      await selectPray(app, page)
      for (const [id, scene] of plain) await shoot(app, page, lang, id, scene)
      await app.close()
    }
    if (want('rekordbox')) {
      const { app, page } = await launch(lang, { rekordboxDbPath: rekordboxClone() })
      await shoot(app, page, lang, 'rekordbox', REKORDBOX_SCENE)
      app.process().kill('SIGKILL')
    }
    const album = Object.entries(ALBUM_SCENES).filter(([id]) => want(id))
    if (album.length) {
      const { app, page } = await launch(lang)
      await open(app, page, albumTakes())
      await page.click('[data-testid="select-all"]')
      await settle(page)
      for (const [id, scene] of album) await shoot(app, page, lang, id, scene)
      await app.close()
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
  process.exit(0)
}
