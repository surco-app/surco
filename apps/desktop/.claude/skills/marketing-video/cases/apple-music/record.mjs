import { join } from 'node:path'
import { session } from '../../kit.mjs'

const s = await session('apple-music', { addToAppleMusic: true, searchProviders: ['discogs'] })
const { page, step, clickOn, glide } = s
const track = join(s.dir, 'in/tina cousins - pray (church mix).wav')
const mix = () =>
  page
    .locator('[data-testid="result-card"]')
    .first()
    .locator('[data-testid="discogs-track"]', { hasText: 'Church M' })
    .first()
let ok = false
try {
  await s.startRec()
  await page.waitForTimeout(1200)
  await step('open', async () => {
    await page.waitForTimeout(1800)
    await s.openFiles([track])
  })
  await step(
    'search',
    async () => {
      await clickOn(page.locator('[data-testid="track-row"]').first())
      await page.locator('[data-testid="discogs-result"]').first().waitFor({ timeout: 60000 })
    },
    0.2,
  )
  await step('release', async () => {
    const release = page.locator('[data-testid="discogs-result"]').first()
    if ((await release.getAttribute('aria-expanded')) !== 'true') await clickOn(release)
    await mix().waitFor({ timeout: 30000 })
    const b = await mix().boundingBox()
    await glide(b.x + 140, b.y - 60, 900)
    await page.waitForTimeout(600)
    await glide(b.x + 170, b.y + 18, 600)
  })
  await step(
    'apply',
    async () => {
      await clickOn(mix(), 400)
      await page.waitForTimeout(1200)
      await glide(1250, 300, 900)
    },
    0.6,
  )
  await step('grouping', async () => {
    await page.waitForTimeout(600)
    await clickOn(page.locator('[data-testid="chip-Cantaditas"]'), 800)
  })
  await step('convert', async () => {
    await clickOn(page.locator('[data-testid="process-btn"]'), 800)
    await page.getByText('Añadido a Apple Music').first().waitFor({ timeout: 180000 })
    await page.waitForTimeout(500)
    const added = await page.getByText('Añadido a Apple Music').first().boundingBox()
    await glide(added.x + added.width / 2, added.y + added.height / 2 + 4, 900)
  })
  await step('done', () => page.waitForTimeout(300), 0.3)
  ok = true
} finally {
  await s.finish(ok)
}
