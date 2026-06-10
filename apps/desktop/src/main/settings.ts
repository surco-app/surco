import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_FIELDS, DEFAULT_REQUIRED_FIELDS } from '../shared/defaults'
import type { Settings } from '../shared/types'

const defaults: Settings = {
  theme: 'system',
  discogsToken: '',
  outputDir: join(app.getPath('music'), 'Surco'),
  outputFormat: 'aiff',
  addToAppleMusic: process.platform === 'darwin',
  // Keep a copy in the output folder by default; "Apple Music only" is opt-in.
  keepOutputCopy: true,
  // Off by default: exports produce a copy and never touch the source unless the user
  // opts into overwriting it.
  overwriteOriginal: false,
  filenameFormat: '{artist} - {title}',
  groupingPresets: ['Bases', 'Cantaditas'],
  genrePresets: [],
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: DEFAULT_FIELDS,
  requiredFields: DEFAULT_REQUIRED_FIELDS,
  coverMaxSize: 1200,
  coverSquare: false,
  showSpectrum: true,
  showLoudness: true,
  autoMatch: false,
  keyNotation: 'camelot',
  // Off by default: a conversion never changes loudness unless the user enables it.
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  shortcutOverrides: {},
  hasSeenOnboarding: false,
  conversionCount: 0,
  donateNudgeDismissed: false,
  donateNudgeLastShown: '',
}

// Settings that never leave this machine, even when the user points the settings
// folder at a cloud-synced location: the Discogs token is a secret that must not
// land in iCloud/Dropbox in plain text, autoMatch is gated on that token, and the
// rest are machine-bound (a local path, onboarding state, this Mac's stats).
const LOCAL_KEYS = [
  'discogsToken',
  'autoMatch',
  'outputDir',
  'hasSeenOnboarding',
  'conversionCount',
] as const satisfies readonly (keyof Settings)[]

function localFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

// Tiny pointer that always lives in userData and holds the user-chosen settings
// folder, solving the bootstrap problem of a configurable config location.
function pointerFile(): string {
  return join(app.getPath('userData'), 'config-dir.json')
}

export function getConfigDir(): string | null {
  const parsed = readJson(pointerFile())
  return typeof parsed.dir === 'string' && parsed.dir !== '' ? parsed.dir : null
}

function syncedFile(): string | null {
  const dir = getConfigDir()
  return dir ? join(dir, 'settings.json') : null
}

function readJson(path: string): Record<string, unknown> {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    // corrupt or unreadable (e.g. an iCloud file not yet downloaded) → treat as empty
  }
  return {}
}

function split(settings: Settings): { synced: Partial<Settings>; local: Partial<Settings> } {
  const synced: Record<string, unknown> = { ...settings }
  const local: Record<string, unknown> = {}
  for (const key of LOCAL_KEYS) {
    local[key] = synced[key]
    delete synced[key]
  }
  return { synced, local }
}

export function getSettings(): Settings {
  const local = readJson(localFile()) as Partial<Settings>
  const sf = syncedFile()
  if (!sf) return { ...defaults, ...local }
  // With a custom folder active, the local file only contributes its machine-bound
  // keys; everything else comes from the shared file so another Mac's edits win.
  const { local: localOnly } = split({ ...defaults, ...local })
  return { ...defaults, ...(readJson(sf) as Partial<Settings>), ...localOnly }
}

// Write-then-rename: a crash or full disk mid-write must never truncate the live
// file, because getSettings' corrupt-file fallback would silently reset every
// preference. The rename replaces it whole or not at all — same pattern as the
// conversion pipeline's temp-write.
function writeAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8')
  renameSync(tmp, path)
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  // Auto-match requires the user's own Discogs token (its own rate-limit bucket), so it can
  // never be on without one — whatever the UI sent, and clearing the token also turns it off.
  if (!next.discogsToken.trim()) next.autoMatch = false
  const sf = syncedFile()
  if (!sf) {
    writeAtomic(localFile(), next)
    return next
  }
  const { synced, local } = split(next)
  writeAtomic(sf, synced)
  writeAtomic(localFile(), local)
  return next
}

// Moves the settings folder. A new folder that already holds a settings.json is
// adopted as-is (that's a second Mac joining an existing sync folder); an empty one
// is seeded with this machine's current prefs. Resetting to null folds the synced
// prefs back into the local file first so nothing is lost.
export function setConfigDir(dir: string | null): Settings {
  const current = getSettings()
  if (dir === null) {
    rmSync(pointerFile(), { force: true })
    writeAtomic(localFile(), current)
    return getSettings()
  }
  writeAtomic(pointerFile(), { dir })
  const sf = join(dir, 'settings.json')
  if (!existsSync(sf)) writeAtomic(sf, split(current).synced)
  return getSettings()
}

// Bumped once from the main process whenever a track finishes converting, the
// single completion point that covers both one-off and "Convert all" runs. Kept
// here so the tally is the one source of truth the Stats tab reads back.
export function recordConversion(): void {
  const cur = getSettings()
  saveSettings({ conversionCount: cur.conversionCount + 1 })
}
