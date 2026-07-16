// Driver for the Surco Electron desktop app.
//
// Launches the *built* app (apps/desktop/out/) via Playwright's _electron and drives
// the renderer. Two modes:
//
//   node driver.mjs smoke         # full flow: launch → inject a tone WAV → open the
//                                 # player → screenshot → exit. Non-zero exit on failure.
//   node driver.mjs repl          # interactive: read commands from stdin (for tmux)
//
// REPL commands (one per line):
//   ss <name>            screenshot the window to /tmp/surco-<name>.png
//   click <selector>     click a DOM node (testid or css)
//   eval <js>            run JS in the renderer; prints the JSON result
//   open <wavPath>       feed a file to the app as if opened from Finder
//   tone [secs]          generate a tone WAV in /tmp and open it (default 5s)
//   play                 double-click the first track row → open the floating player
//   quit                 close the app and exit
//
// playwright-core is installed in this skill's own node_modules (see package.json) so
// the app manifest stays clean; it reuses Electron's bundled Chromium, no browser download.

import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright-core')

const here = dirname(fileURLToPath(import.meta.url))
// skill dir → apps/desktop
const appDir = resolve(here, '../../..')
const repoRoot = resolve(appDir, '../..')
const mainEntry = resolve(appDir, 'out/main/index.js')
const ffmpeg = resolve(repoRoot, 'node_modules/ffmpeg-static/ffmpeg')

// The pnpm-hoisted electron with its real binary lives at the repo root; the copy under
// apps/desktop has no binary (build scripts are skipped there). Resolve from the root.
const requireRoot = createRequire(resolve(repoRoot, 'index.js'))
const electronPath = requireRoot('electron')

if (!existsSync(mainEntry)) {
  console.error(`Build missing: ${mainEntry}\nRun "pnpm --filter surco build" first (see SKILL.md).`)
  process.exit(2)
}

// A short sine-tone WAV so the player has real audio to load. ffmpeg-static ships with
// the app's own deps, so no system ffmpeg is required.
function makeToneWav(secs = 5) {
  const out = `/tmp/surco-tone-${secs}s.wav`
  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`,
    '-metadata', 'title=Driver Tone', '-metadata', 'artist=Surco Driver',
    out,
  ], { stdio: 'ignore' })
  return out
}

async function launch() {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [mainEntry],
    // Headed on macOS shows a real window; that's fine and lets screenshots capture it.
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

// Feed a path to the app the same way macOS does on double-click: the main process
// listens for 'open-file' and forwards 'open-files' to the live window's webContents.
async function openFile(app, page, wavPath) {
  await app.evaluate(async ({ BrowserWindow }, p) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.send('open-files', [p])
  }, wavPath)
  // The list row carries the title from tags; wait for it to land.
  await page.waitForSelector('[data-testid="track-row"], [data-testid="player"]', { timeout: 15000 })
}

async function openPlayer(page) {
  // Double-clicking a track row plays it and mounts the floating player card
  // (TrackList wires onDoubleClick → onActivate → open player).
  const row = page.locator('[data-testid="track-row"]').first()
  await row.dblclick()
  await page.waitForSelector('[data-testid="player"]', { timeout: 15000 })
}

async function shot(page, name) {
  const path = `/tmp/surco-${name}.png`
  await page.screenshot({ path })
  return path
}

async function smoke() {
  const { app, page } = await launch()
  try {
    const wav = makeToneWav(5)
    await openFile(app, page, wav)
    await openPlayer(page)
    // Hover the card so the volume pill (and its slider) fade in, then capture.
    await page.locator('[data-testid="player"]').hover()
    await page.waitForTimeout(400)
    const path = await shot(page, 'player')
    const vol = await page.locator('[data-testid="player-volume"]').first().textContent()
    console.log(`OK player up, volume pill shows "${vol?.trim()}", screenshot: ${path}`)
  } finally {
    await app.close()
  }
}

async function repl() {
  let app, page
  const rl = createInterface({ input: process.stdin })
  console.log('repl ready')
  for await (const line of rl) {
    const [cmd, ...rest] = line.trim().split(/\s+/)
    const arg = rest.join(' ')
    try {
      if (cmd === 'launch') { ({ app, page } = await launch()); console.log('launched') }
      else if (cmd === 'tone') { const w = makeToneWav(Number(arg) || 5); await openFile(app, page, w); console.log('opened ' + w) }
      else if (cmd === 'open') { await openFile(app, page, arg); console.log('opened ' + arg) }
      else if (cmd === 'play') { await openPlayer(page); console.log('player open') }
      else if (cmd === 'ss') { console.log(await shot(page, arg || 'shot')) }
      else if (cmd === 'click') { await page.locator(arg).first().click(); console.log('clicked ' + arg) }
      else if (cmd === 'hover') { await page.locator(arg).first().hover(); console.log('hovered ' + arg) }
      else if (cmd === 'key') { await page.keyboard.press(arg); console.log('pressed ' + arg) }
      else if (cmd === 'eval') { console.log(JSON.stringify(await page.evaluate(arg))) }
      else if (cmd === 'sleep') { await page.waitForTimeout(Number(arg) || 500); console.log('slept ' + (Number(arg) || 500)) }
      else if (cmd === 'quit') { if (app) await app.close(); console.log('bye'); break }
      else console.log('?' + cmd)
    } catch (e) { console.log('ERR ' + (e?.message || e)) }
  }
}

const mode = process.argv[2] || 'smoke'
if (mode === 'smoke') smoke().catch((e) => { console.error(e); process.exit(1) })
else if (mode === 'repl') repl().catch((e) => { console.error(e); process.exit(1) })
else { console.error('usage: node driver.mjs [smoke|repl]'); process.exit(2) }
