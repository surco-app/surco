import { join } from 'node:path'
import { session } from '../../kit.mjs'

const s = await session('calidad', { searchProviders: [] })
const { page, step, clickOn, glide, glideTo, zoomAt, unzoom } = s
let ok = false
try {
  await s.startRec()
  await page.waitForTimeout(1000)
  await step('open', async () => {
    await page.waitForTimeout(2600)
    await s.openFiles([join(s.dir, 'in/Pack Hard House 2026')])
  })
  await step(
    'analyze',
    async () => {
      await page.waitForTimeout(1200)
      await glideTo(page.locator('[data-testid="track-row"]').nth(2), 900, 120, 0)
    },
    0.2,
  )
  await step('filter', async () => {
    zoomAt(260, 260, 2)
    await clickOn(page.locator('[data-testid="quality-filter-trigger"]'), 800)
    await page.waitForTimeout(700)
    const doubtful = page
      .getByRole('menuitemradio', { name: /Dudosas/ })
      .or(page.getByRole('menuitem', { name: /Dudosas/ }))
      .or(page.getByRole('option', { name: /Dudosas/ }))
    await clickOn(doubtful.first(), 700)
    await page.waitForTimeout(500)
  })
  await step(
    'why',
    async () => {
      unzoom()
      await clickOn(page.locator('[data-testid="track-row"]').first(), 700)
      await page.waitForTimeout(600)
      await s.tagMaximize('[data-testid="quality-badge"]', 'qmax')
      await clickOn(page.locator('[data-v="qmax"]'), 700)
      await page.waitForTimeout(1200)
      await glideTo(page.locator('[data-testid="quality-evidence"]').first(), 900)
    },
    0.3,
  )
  await step('done', () => glide(1300, 700, 800))
  ok = true
} finally {
  await s.finish(ok)
}
