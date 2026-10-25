import { join } from 'node:path'
import { caseDir, fresh, session } from '../../kit.mjs'

const folder = join(caseDir('titulos'), 'in/descargas')
fresh(join(caseDir('titulos'), 'pristine'), folder)
const s = await session('titulos', { searchProviders: [], outputFormat: 'source', overwriteOriginal: true })
const { page, step, clickOn, glide, glideTo, typeSlow, key, zoomAt, unzoom } = s
let ok = false
try {
  await s.startRec()
  await page.waitForTimeout(800)
  await step('open', async () => {
    await page.waitForTimeout(1500)
    await s.openFiles([folder])
    await page.waitForTimeout(800)
    await glideTo(page.locator('[data-testid="track-row"]').nth(1), 1000, 60, -14)
  })
  await step(
    'find',
    async () => {
      await key('Meta+f', '⌘ F')
      await page.waitForTimeout(500)
      zoomAt(720, 400, 1.7)
      await page.waitForTimeout(400)
      await typeSlow(' [www.hardpromos.net]', 55)
    },
    0.3,
  )
  await step('preview', () => glideTo(page.locator('[data-testid="find-replace-preview"]'), 900, 0, 20), 0.2)
  await step(
    'underscore',
    async () => {
      await clickOn(page.locator('[data-testid="find-replace-apply"]'), 800)
      await page.waitForTimeout(900)
      await clickOn(page.locator('[data-testid="find-replace-find"]'), 600)
      await typeSlow('_', 80)
      await clickOn(page.locator('[data-testid="find-replace-replace"]'), 600)
      await typeSlow(' ', 80)
      await page.waitForTimeout(900)
      await clickOn(page.locator('[data-testid="find-replace-apply"]'), 700)
      await page.waitForTimeout(500)
    },
    0.3,
  )
  await step('save', async () => {
    await clickOn(page.locator('[data-testid="find-replace-cancel"]'), 600)
    unzoom()
    await page.waitForTimeout(500)
    await clickOn(page.locator('[data-testid="convert-all"]'), 900)
    await page.waitForTimeout(700)
    await clickOn(page.getByRole('button', { name: 'Sobrescribir y convertir' }), 700)
  })
  await step(
    'done',
    async () => {
      await page.waitForFunction(
        () => [...document.querySelectorAll('[data-testid="track-row"]')].every((r) => !r.innerText.includes('_')),
        null,
        { timeout: 60000 },
      )
      zoomAt(320, 420, 1.75)
      await glide(560, 560, 900)
    },
    0.5,
  )
  ok = true
} finally {
  await s.finish(ok)
}
