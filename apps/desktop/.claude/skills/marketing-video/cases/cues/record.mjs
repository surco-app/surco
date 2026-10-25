import { join } from 'node:path'
import { caseDir, fresh, realSettings, session } from '../../kit.mjs'

const collection = join(caseDir('cues'), 'rekordbox-live')
fresh(join(caseDir('cues'), 'rekordbox'), collection)
const s = await session('cues', {
  ...realSettings(['cueFlows', 'activeCueFlow', 'cueJumpBars', 'cueQuantize', 'cueLettersByTime', 'editorSections']),
  searchProviders: [],
  autoAnalyze: false,
  syncRekordbox: true,
  rekordboxDbPath: join(collection, 'master.db'),
})
const { page, step, clickOn, glide, glideTo, key } = s
let ok = false
try {
  await s.startRec()
  await page.waitForTimeout(800)
  await step('rb', async () => {
    await clickOn(page.locator('[data-testid="source-rail-rekordbox"]'), 900)
    await page.waitForTimeout(1200)
    await clickOn(page.getByText('Himnos', { exact: true }).last(), 900)
    await page.locator('[data-testid="track-row"]').first().waitFor()
  })
  await step(
    'list',
    async () => {
      await glideTo(page.locator('[data-testid="track-row"]').nth(1), 900, 20, 25)
      await page.waitForTimeout(500)
      await clickOn(page.locator('[data-testid="track-row"]', { hasText: 'Here We Go' }).first(), 900)
      await page.waitForTimeout(1500)
      await page.locator('[data-testid="cues-auto-mark"]').scrollIntoViewIfNeeded()
    },
    0.3,
  )
  await step('max', async () => {
    await s.tagMaximize('[data-testid="cues-auto-mark"]', 'cmax')
    await clickOn(page.locator('[data-v="cmax"]'), 800)
    await page.waitForTimeout(900)
  })
  await step('auto', async () => {
    await clickOn(page.locator('[data-testid="cues-auto-mark"]'), 800)
    await page.waitForTimeout(1200)
    await glide(400, 190, 1200)
    await glide(820, 190, 1400)
  })
  await step('accept', () => clickOn(page.locator('[data-testid="cues-auto-accept"]'), 800), 0.2)
  await step(
    'nav',
    async () => {
      await page.waitForTimeout(300)
      await key('ArrowRight', '→')
      await page.waitForTimeout(1300)
      await key('ArrowRight', '→')
    },
    0.2,
  )
  await step('save', async () => {
    await clickOn(page.locator('[data-testid="cues-save"]'), 900)
    await page.waitForTimeout(1500)
  })
  ok = true
} finally {
  await s.finish(ok)
}
