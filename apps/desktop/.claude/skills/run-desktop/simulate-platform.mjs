import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

const platform = process.env.SURCO_SIMULATE_PLATFORM
const mainEntry = new URL('../../../out/main/index.js', import.meta.url)
const requireFromMain = createRequire(mainEntry)
for (const dep of [
  '@ffprobe-installer/ffprobe',
  'ffmpeg-static',
  'better-sqlite3-multiple-ciphers',
  'node-taglib-sharp',
  'electron-log/main',
  'electron-updater',
]) {
  requireFromMain(dep)
}

Object.defineProperty(process, 'platform', { value: platform })
app.setPath('userData', `${app.getPath('appData')}/Electron-${platform}`)
process.env.SURCO_SIMULATE_LOG = `${app.getPath('userData')}/simulated-calls.log`
process.env.PATH = `${fileURLToPath(new URL('simulate-bin', import.meta.url))}:${process.env.PATH}`
await import(mainEntry.href)
