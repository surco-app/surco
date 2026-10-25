import { join } from 'node:path'
import { caseDir, fresh, realSettings, session } from '../../kit.mjs'

fresh(join(caseDir('carpeta'), 'pristine'), join(caseDir('carpeta'), 'in'))
const s = await session('carpeta', {
  ...realSettings(['discogsToken']),
  outputFormat: 'source',
  overwriteOriginal: true,
  autoMatch: true,
})
const { page, step, clickOn, glide, zoomAt, unzoom } = s
let ok = false
try {
  await s.startRec()
  await page.waitForTimeout(800)
  await step('open', async () => {
    await page.waitForTimeout(2800)
    await s.openFiles([join(s.dir, 'in/Di Carlo')])
  })
  await step(
    'auto',
    async () => {
      await page.waitForTimeout(1500)
      zoomAt(300, 420, 1.6)
      await glide(330, 330, 1000)
    },
    0.2,
  )
  await step(
    'auto2',
    async () => {
      await page.waitForFunction(() => !document.querySelector('[data-testid="auto-match-progress"]'), null, {
        timeout: 120000,
        polling: 500,
      })
      unzoom()
      await glide(1150, 260, 1000)
    },
    0.2,
  )
  await step('pending', async () => {
    await clickOn(page.locator('[data-testid="track-row"]', { hasText: 'No Whisk' }).first(), 900)
    await page.locator('[data-testid="discogs-result"]').first().waitFor({ timeout: 60000 })
    await page.waitForTimeout(1200)
    const mix = page.locator('[data-testid="discogs-track"]', { hasText: 'No Whisk' }).first()
    if (!(await mix.isVisible()))
      await clickOn(page.locator('[data-testid="discogs-result"]', { hasText: 'Get Up' }).first(), 800)
    await mix.waitFor({ timeout: 30000 })
    await page.waitForTimeout(600)
    await clickOn(mix, 800)
    await page.waitForTimeout(1500)
  })
  await step('convert', async () => {
    await clickOn(page.locator('[data-testid="convert-all"]'), 900)
    await page.waitForTimeout(800)
    await clickOn(page.getByRole('button', { name: 'Sobrescribir y convertir' }), 700)
  })
  await step(
    'done',
    async () => {
      await page.waitForFunction(
        () => [...document.querySelectorAll('[data-testid="track-row"]')].every((r) => /Hecho/.test(r.innerText)),
        null,
        { timeout: 120000 },
      )
      await page.waitForTimeout(800)
      zoomAt(330, 520, 1.35)
      await glide(560, 600, 900)
    },
    0.3,
  )
  ok = true
} finally {
  await s.finish(ok)
}
