import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const APP_DIR = resolve(HERE, '../../..')
export const ROOT = dirname(
  execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE })
    .toString()
    .trim(),
)
export const WORK = process.env.SURCO_VIDEO_DIR || join(tmpdir(), 'surco-video')
export const MUSIC = process.env.SURCO_VIDEO_MUSIC || '/Volumes/Public/Music/Media.localized/Music'
export const FFMPEG = join(ROOT, 'node_modules/ffmpeg-static/ffmpeg')
export const ELECTRON = createRequire(join(ROOT, 'index.js'))('electron')
export const MAIN_ENTRY = [APP_DIR, join(ROOT, 'apps/desktop')]
  .map((d) => join(d, 'out/main/index.js'))
  .find((p) => existsSync(p))
export const REAL_SETTINGS = join(homedir(), 'Library/Application Support/surco/settings.json')

const BASE_SETTINGS = {
  theme: 'dark',
  language: 'es',
  hasSeenOnboarding: true,
  lastSeenChangelogVersion: '99.0.0',
  donateNudgeDismissed: true,
  betaUpdates: false,
  searchProviders: ['discogs'],
  discogsFormats: ['Vinyl'],
  discogsMaxResults: 5,
  autoMatch: false,
  autoAnalyze: true,
  outputFormat: 'aiff',
  addToAppleMusic: false,
  keepOutputCopy: false,
  convertBesideOriginal: false,
  syncRekordbox: false,
  syncTraktor: false,
  syncEngineDj: false,
  addToEngineDj: false,
  groupingPresets: ['Bases', 'Cantaditas', 'SFMM', 'Mashups', 'Acapella'],
  visibleFields: ['title', 'artist', 'albumArtist', 'album', 'year', 'genre', 'grouping'],
  requiredFields: [],
  filenameFormat: '{artist} - {title}',
  autoApplyFilename: true,
  showEditorHints: false,
  deezerProviderMigrated: true,
  musicbrainzProviderMigrated: true,
  backupPolicyMigrated: true,
  backupLimitsMigrated: true,
  trackImportFieldsMigrated: true,
  outputCopyMigrated: true,
  mixInBarsMigrated: true,
}

export const realSettings = (keys) => {
  const real = JSON.parse(readFileSync(REAL_SETTINGS, 'utf8'))
  return Object.fromEntries(keys.filter((k) => k in real).map((k) => [k, real[k]]))
}

export const caseDir = (name) => join(WORK, name)

export const durations = (name) => {
  const p = join(caseDir(name), 'durations.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
}

export async function session(name, settings = {}) {
  const dir = caseDir(name)
  const ud = join(dir, 'ud')
  rmSync(ud, { recursive: true, force: true })
  mkdirSync(ud, { recursive: true })
  mkdirSync(join(dir, 'out'), { recursive: true })
  if (existsSync(join(dir, 'cache-seed')))
    cpSync(join(dir, 'cache-seed'), join(ud, 'analysis-cache'), { recursive: true })
  writeFileSync(
    join(ud, 'settings.json'),
    JSON.stringify({ ...BASE_SETTINGS, outputDir: join(dir, 'out'), ...settings }),
  )
  const said = durations(name)
  const { _electron: electron } = createRequire(
    join(ROOT, 'apps/desktop/.claude/skills/run-desktop/package.json'),
  )('playwright-core')
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [MAIN_ENTRY, '--force-device-scale-factor=2', `--user-data-dir=${ud}`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.webContents.setZoomFactor(1)
    w.setContentSize(1440, 810)
    w.center()
  })
  await page.waitForTimeout(1200)
  await page.evaluate(() => {
    const c = document.createElement('div')
    c.id = '__cur'
    c.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 14.8 L11.6 21.6 L14.4 20.4 L11.3 13.7 L17.5 13.4 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>'
    Object.assign(c.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: 2147483647,
      pointerEvents: 'none',
      transform: 'translate(1100px,600px)',
      transitionProperty: 'transform',
      transitionTimingFunction: 'cubic-bezier(.45,0,.2,1)',
      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.5))',
    })
    document.body.appendChild(c)
    window.__ripple = (x, y) => {
      const r = document.createElement('div')
      Object.assign(r.style, {
        position: 'fixed',
        left: `${x - 18}px`,
        top: `${y - 18}px`,
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        border: '2px solid rgba(255,255,255,.85)',
        zIndex: 2147483646,
        pointerEvents: 'none',
        transition: 'transform 450ms ease-out, opacity 450ms ease-out',
        transform: 'scale(.3)',
        opacity: '1',
      })
      document.body.appendChild(r)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          r.style.transform = 'scale(1.4)'
          r.style.opacity = '0'
        }),
      )
      setTimeout(() => r.remove(), 600)
    }
    window.__key = (label) => {
      let k = document.getElementById('__keycap')
      if (!k) {
        k = document.createElement('div')
        k.id = '__keycap'
        document.body.appendChild(k)
      }
      k.textContent = label
      Object.assign(k.style, {
        position: 'fixed',
        left: '50%',
        bottom: '90px',
        transform: 'translateX(-50%)',
        padding: '10px 22px',
        borderRadius: '12px',
        background: 'rgba(20,22,32,.92)',
        color: '#fff',
        font: '600 28px -apple-system, system-ui',
        border: '1px solid rgba(255,255,255,.25)',
        zIndex: 2147483647,
        pointerEvents: 'none',
        opacity: '1',
        transition: 'opacity 400ms',
      })
      clearTimeout(window.__kt)
      window.__kt = setTimeout(() => {
        k.style.opacity = '0'
      }, 1300)
    }
  })

  let cur = { x: 1100, y: 600 }
  const glide = async (x, y, ms = 700) => {
    await page.evaluate(
      ([x, y, ms]) => {
        const c = document.getElementById('__cur')
        c.style.transitionDuration = `${ms}ms`
        c.style.transform = `translate(${x - 4}px,${y - 2}px)`
      },
      [x, y, ms],
    )
    await page.mouse.move(x, y, { steps: 12 })
    await page.waitForTimeout(ms)
    cur = { x, y }
  }
  const glideTo = async (loc, ms, dx = 0, dy = 0) => {
    await loc.scrollIntoViewIfNeeded()
    const b = await loc.boundingBox()
    await glide(b.x + Math.min(b.width / 2, 160) + dx, b.y + b.height / 2 + dy, ms)
  }
  const clickOn = async (loc, ms) => {
    await glideTo(loc, ms)
    await page.waitForTimeout(150)
    await page.evaluate(([x, y]) => window.__ripple(x, y), [cur.x, cur.y])
    await page.mouse.click(cur.x, cur.y)
  }
  const typeSlow = (text, delay = 70) => page.keyboard.type(text, { delay })
  const key = async (combo, label) => {
    await page.evaluate((l) => window.__key(l), label || combo)
    await page.keyboard.press(combo)
  }
  const tagMaximize = (anchor, tag) =>
    page.evaluate(
      ([anchor, tag]) => {
        let e = document.querySelector(anchor)
        while (e && !e.querySelector('[data-testid="section-maximize"]')) e = e.parentElement
        e.querySelector('[data-testid="section-maximize"]').dataset.v = tag
      },
      [anchor, tag],
    )

  const frames = []
  const marks = []
  const zooms = []
  let t0
  let cdp
  let n = 0
  const framesDir = join(dir, 'frames')
  const now = () => Date.now() / 1000 - t0
  const startRec = async () => {
    rmSync(framesDir, { recursive: true, force: true })
    mkdirSync(framesDir)
    cdp = await page.context().newCDPSession(page)
    cdp.on('Page.screencastFrame', (f) => {
      const file = `${String(n++).padStart(5, '0')}.jpg`
      writeFileSync(join(framesDir, file), Buffer.from(f.data, 'base64'))
      frames.push({ name: file, t: f.metadata.timestamp })
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    })
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: 2880,
      maxHeight: 1620,
      everyNthFrame: 1,
    })
    await page.waitForTimeout(500)
    t0 = Date.now() / 1000
  }
  const step = async (id, fn, lead = 0.4) => {
    const start = Date.now() / 1000
    marks.push({ id, t: start - t0 + lead })
    await fn()
    const left = start + lead + (said[id] ?? 0) + 0.7 - Date.now() / 1000
    if (left > 0) await page.waitForTimeout(left * 1000)
  }
  const zoomAt = (cx, cy, scale) => zooms.push({ t: now(), cx, cy, scale })
  const unzoom = () => zoomAt(720, 405, 1)
  const openFiles = async (paths) => {
    await app.evaluate(
      ({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open-files', p),
      paths,
    )
    await page.waitForSelector('[data-testid="track-row"]', { timeout: 60000 })
  }
  const finish = async (ok) => {
    if (ok && cdp) {
      await page.waitForTimeout(800)
      marks.push({ id: 'end', t: now() })
      await cdp.send('Page.stopScreencast')
      writeFileSync(join(dir, 'timeline.json'), JSON.stringify({ t0, frames, marks, zooms }))
      console.log(marks.map((m) => `${m.id}@${m.t.toFixed(1)}`).join(' '))
    }
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 6000))])
    try {
      app.process().kill('SIGKILL')
    } catch {}
    rmSync(ud, { recursive: true, force: true })
  }
  const shot = (file) => page.screenshot({ path: join(dir, `${file}.png`) })
  return {
    app,
    page,
    dir,
    glide,
    glideTo,
    clickOn,
    typeSlow,
    key,
    tagMaximize,
    startRec,
    step,
    zoomAt,
    unzoom,
    openFiles,
    finish,
    shot,
  }
}

export const fresh = (from, to) => {
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
}
