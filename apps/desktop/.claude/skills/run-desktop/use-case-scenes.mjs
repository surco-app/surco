// Captures the /casos-de-uso recipes whose screen is not a Settings tab, one image per
// recipe and app language, at the walkthrough's export size.
//
//   node use-case-scenes.mjs [caseId ...] [--lang es,en]   # default: every scene and language
//
// Writes apps/web/public/use-cases/<caseId>-<lang>.webp. The recipes that borrow a guide
// shot (paste-tracklist, repair-library) need nothing here. organize-playlists reads the
// reference machine's rekordbox through a copy of its database, as guide-shots.mjs does,
// and never writes to it.

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, rekordboxClone } from './guide-shots.mjs'
import { APP_LANGUAGES } from './recipe-labels.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../../../../web/public/use-cases')

const SCENES = {
  'organize-playlists': {
    launchWith: () => ({ rekordboxDbPath: rekordboxClone() }),
    run: async (page) => {
      await page.click('[data-testid="source-rail-rekordbox"]')
      await page.waitForTimeout(3000)
      const first = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid^="source-node-"]')]
          .map((e) => e.dataset.testid)
          .find((id) => /^source-node-\d+$/.test(id)),
      )
      await page.click(`[data-testid="${first}"]`, { button: 'right' })
      await page.waitForTimeout(600)
    },
  },
  'custom-fields': {
    launchWith: () => ({}),
    run: async (page) => {
      await page.click('[data-testid="open-settings"]')
      await page.click('[data-testid="settings-tab-editor"]')
      await page.click('[data-testid="settings-subtab-fields"]')
      await page.waitForTimeout(500)
      await page.evaluate(() => {
        const panel = document.querySelector('[role="tabpanel"]')
        panel.scrollTop = panel.scrollHeight
      })
      await page.waitForTimeout(400)
    },
  },
}

async function main() {
  const args = process.argv.slice(2)
  const langFlag = args.indexOf('--lang')
  const langs = langFlag >= 0 ? args[langFlag + 1].split(',') : APP_LANGUAGES
  const only = args.filter((a, i) => !a.startsWith('--') && (langFlag < 0 || i !== langFlag + 1))
  mkdirSync(outDir, { recursive: true })
  for (const lang of langs) {
    for (const [id, scene] of Object.entries(SCENES)) {
      if (only.length && !only.includes(id)) continue
      const { app, page } = await launch(lang, scene.launchWith())
      await scene.run(page)
      const png = join(outDir, `${id}-${lang}.png`)
      await page.screenshot({ path: png })
      execFileSync('cwebp', ['-quiet', '-q', '80', png, '-o', join(outDir, `${id}-${lang}.webp`)])
      rmSync(png)
      console.log(`${id} ${lang}`)
      app.process().kill('SIGKILL')
    }
  }
}

await main()
process.exit(0)
