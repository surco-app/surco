// Records the home hero loop in every app language: a folder of tracks, one picked, its
// Discogs match applied and the track converted. No cursor and no voice, unlike the
// narrated cases: the clip plays muted under the headline.
//
//   node hero.mjs [--lang es,en]   # default: every app language
//
// Writes apps/web/public/hero-app-<lang>.{webm,mp4,webp}. The tracks are read from
// SURCO_HERO_DIR (default: the NAS folder below) and the conversion lands in a throwaway
// profile, so nothing in the library changes. Search runs without a Discogs token.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { APP_DIR, ELECTRON, FFMPEG, MAIN_ENTRY, ROOT } from './kit.mjs'

const SOURCE = process.env.SURCO_HERO_DIR || '/Volumes/Public/Musica/FLAC/bases buenas'
const FIRST = 'Bom Da De'
const PICK = 'Fire Wire (Club Mix)'
const WIDTH = 1440
const HEIGHT = 894
const FPS = 25
const OUT = resolve(APP_DIR, '../web/public')
const LANGUAGES = ['es', 'en', 'de', 'fr', 'pt-BR', 'ja']

const { _electron: electron } = createRequire(
  join(ROOT, 'apps/desktop/.claude/skills/run-desktop/package.json'),
)('playwright-core')

async function record(lang) {
  const work = join(tmpdir(), `surco-hero-${lang}-${Date.now()}`)
  const ud = join(work, 'ud')
  const framesDir = join(work, 'frames')
  mkdirSync(ud, { recursive: true })
  mkdirSync(framesDir)
  writeFileSync(
    join(ud, 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      language: lang,
      hasSeenOnboarding: true,
      lastSeenChangelogVersion: '99.0.0',
      donateNudgeDismissed: true,
      betaUpdates: false,
      searchProviders: ['discogs'],
      autoMatch: false,
      outputFormat: 'aiff',
      outputDir: join(work, 'Surco'),
      addToAppleMusic: false,
      syncRekordbox: false,
      syncTraktor: false,
      syncEngineDj: false,
      addToEngineDj: false,
      rekordboxDbPath: join(work, 'no-rekordbox/master.db'),
      deezerProviderMigrated: true,
      musicbrainzProviderMigrated: true,
      backupPolicyMigrated: true,
      backupLimitsMigrated: true,
      trackImportFieldsMigrated: true,
      outputCopyMigrated: true,
      mixInBarsMigrated: true,
    }),
  )
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [MAIN_ENTRY, '--force-device-scale-factor=2', `--user-data-dir=${ud}`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.setZoomFactor(1)
      win.setContentSize(w, h)
      win.center()
    },
    [WIDTH, HEIGHT],
  )
  await page.waitForTimeout(1200)
  const files = readdirSync(SOURCE)
    .filter((f) => f.endsWith('.flac'))
    .sort()
    .map((f) => join(SOURCE, f))
  await app.evaluate(
    ({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open-files', p),
    files,
  )
  await page.waitForSelector('[data-testid="track-row"]', { timeout: 60000 })
  // The header counts the tags still being read; the take starts once that is done.
  await page
    .locator('[data-testid="top-progress"]')
    .waitFor({ state: 'hidden', timeout: 120000 })
    .catch(() => {})
  await page.waitForTimeout(1500)
  const row =(title) => page.locator('[data-testid="track-row"]', { hasText: title }).first()
  const matched = async () => {
    await page.locator('[data-testid="discogs-track"]').first().waitFor({ timeout: 60000 })
    await page.waitForTimeout(1500)
  }
  await row(FIRST).click()
  await matched()
  await page.mouse.move(2, 2)

  const frames = []
  let n = 0
  const cdp = await page.context().newCDPSession(page)
  cdp.on('Page.screencastFrame', (f) => {
    const file = join(framesDir, `${String(n++).padStart(5, '0')}.jpg`)
    writeFileSync(file, Buffer.from(f.data, 'base64'))
    frames.push({ file, t: f.metadata.timestamp })
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: WIDTH * 2,
    maxHeight: HEIGHT * 2,
  })
  await page.waitForTimeout(900)
  await row(PICK).click()
  await matched()
  await page
    .locator('[data-testid="discogs-track"]', { hasText: 'Club Mix' })
    .first()
    .click()
  await page.waitForTimeout(1800)
  const resolved = frames.at(-1).t
  await page.click('[data-testid="process-btn"]')
  await page.locator('[data-testid="export-success"]').waitFor({ timeout: 120000 })
  await page.waitForTimeout(1600)
  await cdp.send('Page.stopScreencast')
  await page.screenshot({ path: join(work, 'still.png') })
  app.process().kill('SIGKILL')

  // A screencast only emits when something repaints, so the frames are resampled onto a
  // fixed 25 fps grid (the last frame shown at each tick) before encoding. The loop opens
  // on the resolved track, so the still under it shows the result, not an empty editor.
  const seq = join(work, 'seq')
  mkdirSync(seq)
  const t0 = frames[0].t
  const total = frames.at(-1).t - t0
  let k = 0
  const ticks = []
  for (let i = 0; i * (1 / FPS) <= total; i++) {
    const t = t0 + i / FPS
    while (k + 1 < frames.length && frames[k + 1].t <= t) k++
    ticks.push(frames[k].file)
  }
  const start = Math.round((resolved - t0) * FPS)
  const loop = [...ticks.slice(start), ...ticks.slice(0, start)]
  loop.forEach((file, i) => symlinkSync(file, join(seq, `${String(i).padStart(5, '0')}.jpg`)))
  const scale = `scale=1360:-2:flags=lanczos`
  const input = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(seq, '%05d.jpg')]
  execFileSync(FFMPEG, [
    ...input, '-vf', scale, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1',
    '-an', join(OUT, `hero-app-${lang}.webm`),
  ])
  execFileSync(FFMPEG, [
    ...input, '-vf', `${scale},format=yuv420p`, '-c:v', 'libx264', '-crf', '30', '-preset', 'slow',
    '-movflags', '+faststart', '-an', join(OUT, `hero-app-${lang}.mp4`),
  ])
  execFileSync('cwebp', [
    '-quiet', '-q', '82', '-resize', '2000', '0', loop[0], '-o', join(OUT, `hero-app-${lang}.webp`),
  ])
  rmSync(work, { recursive: true, force: true })
  console.log(`hero ${lang}: ${total.toFixed(1)} s`)
}

const flag = process.argv.indexOf('--lang')
const langs = flag >= 0 ? process.argv[flag + 1].split(',') : LANGUAGES
for (const lang of langs) await record(lang)
process.exit(0)
