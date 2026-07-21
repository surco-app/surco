import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { autoMatchAvailable } from '../shared/autoMatch'
import {
  DEFAULT_DISCOGS_MAX_RESULTS,
  DEFAULT_FIELDS,
  DEFAULT_REQUIRED_FIELDS,
} from '../shared/defaults'
import { DEFAULT_DECLICK, normalizeDeclick } from '../shared/declick'
import { DEFAULT_EDITOR_SECTIONS } from '../shared/editorSections'
import type { Settings } from '../shared/types'

export const defaults: Settings = {
  theme: 'system',
  // Follow the OS locale by default; the user can pin English or Spanish.
  language: 'system',
  discogsToken: '',
  // No format filter by default: search shows every Discogs release format.
  discogsFormats: [],
  discogsMaxResults: DEFAULT_DISCOGS_MAX_RESULTS,
  // Search Discogs only by default; Bandcamp is opt-in (Settings → Search).
  searchProviders: ['discogs'],
  // The classic rip stamps everyone's files carry; whole-word matching keeps "rip" from
  // biting into a real title word ("Tripping"), and the list is the user's to edit.
  searchIgnoreWords: ['vinyl', 'rip'],
  outputDir: join(app.getPath('music'), 'Surco'),
  outputFormat: 'aiff',
  addToAppleMusic: process.platform === 'darwin',
  // Keep a copy in the output folder by default; "Apple Music only" is opt-in.
  keepOutputCopy: true,
  // Off by default: exports produce a copy and never touch the source unless the user
  // opts into overwriting it.
  overwriteOriginal: false,
  convertBesideOriginal: false,
  addToEngineDj: false,
  // Engine DJ's default library location on both macOS and Windows.
  engineLibraryDir: join(app.getPath('music'), 'Engine Library'),
  engineDjPlaylist: 'Surco',
  filenameFormat: '{artist} - {title}',
  titleFormat: '',
  // Off by default: the metadata-derived name stays opt-in (the "Regenerate" button), so a
  // plain "load and convert" keeps the source file name until the user turns this on.
  autoApplyFilename: false,
  // No grouping presets by default — they're personal/language-specific, so the user adds
  // their own (the field shows a localized example as a placeholder).
  groupingPresets: [],
  genrePresets: [],
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: DEFAULT_FIELDS,
  requiredFields: DEFAULT_REQUIRED_FIELDS,
  coverMaxSize: 1200,
  coverSquare: false,
  coverUpscale: false,
  replaceLowResCover: false,
  // Off by default: the Finder-covers ID3 header is off-spec for FLAC, so it's opt-in.
  flacFinderCovers: false,
  mp3Quality: '320',
  // Max fidelity by default: preserve the source's own bit depth and sample rate.
  outputBitDepth: 'source',
  outputSampleRate: 'source',
  // ffmpeg's own FLAC default; higher only shrinks files slower, the audio is identical.
  flacCompression: '5',
  showSpectrum: true,
  showLoudness: true,
  activityPanel: null,
  resultsWidth: null,
  showWaveform: true,
  autoAnalyze: false,
  autoMatch: false,
  continuousPlayback: false,
  keyNotation: 'camelot',
  // Off by default: a conversion never changes loudness unless the user enables it.
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  // Off by default: a conversion never repairs clicks unless the user enables it.
  declick: DEFAULT_DECLICK,
  editorSections: DEFAULT_EDITOR_SECTIONS,
  shortcutOverrides: {},
  hasSeenOnboarding: false,
  conversionCount: 0,
  stats: { imported: 0, listened: 0, analyzed: 0, discogsMatches: 0, bandcampMatches: 0 },
  commandUsage: {},
  donateNudgeDismissed: false,
  donateNudgeLastShown: '',
  lastSeenChangelogVersion: '',
}

// Settings that never leave this machine, even when the user points the settings
// folder at a cloud-synced location: a local output path and Engine library path
// don't exist on another Mac, per-machine tallies would corrupt if two Macs wrote
// the same file, and onboarding/changelog/pixel state is meaningful only locally.
// (The Discogs token DOES sync now — it's identical across the user's Macs, and the
// user accepts it living in their own cloud in plain text.)
const LOCAL_KEYS = [
  'outputDir',
  'engineLibraryDir',
  'hasSeenOnboarding',
  'conversionCount',
  'stats',
  'commandUsage',
  // Each machine updates on its own schedule, so "which changelog did I already
  // see" only means something locally.
  'lastSeenChangelogVersion',
  // A pixel position only means something on the screen it was saved on.
  'activityPanel',
  'resultsWidth',
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

// Where settings live when no custom folder is chosen, shown in the Settings field so
// "default" isn't an opaque label — the user can see the actual location.
export function defaultConfigDir(): string {
  return app.getPath('userData')
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

// stats and normalize are the two fixed-shape nested objects (every other object
// field — shortcutOverrides, commandUsage — is an open Record the user populates
// themselves, where a "missing" key is a legitimate empty state, not staleness).
// A plain `{ ...defaults, ...local }` merges at the top level only: a settings.json
// written by an older Surco that predates a new stats/normalize field has an object
// present under that key, just missing the one field, so the shallow merge takes
// the whole (incomplete) local object instead of filling the gap from defaults.
// recordStat's `cur.stats[key] + n` then corrupts that field to NaN — which
// JSON.stringifies to null, permanently bricking the counter on the next read.
function mergeSettings(base: Settings, patch: Partial<Settings>): Settings {
  return {
    ...base,
    ...patch,
    stats: { ...base.stats, ...patch.stats },
    normalize: { ...base.normalize, ...patch.normalize },
    // Not a spread-merge like the two above: a 0.49-0.50 file stores declick as a
    // bare mode string, which normalizeDeclick upgrades (and repairs) instead.
    declick: normalizeDeclick(patch.declick ?? base.declick),
  }
}

export function getSettings(): Settings {
  const local = readJson(localFile()) as Partial<Settings>
  const sf = syncedFile()
  if (!sf) return mergeSettings(defaults, local)
  // With a custom folder active, the local file only contributes its machine-bound
  // keys; everything else comes from the shared file so another Mac's edits win.
  const { local: localOnly } = split(mergeSettings(defaults, local))
  const synced = readJson(sf) as Partial<Settings>
  // Read-time migration: discogsToken used to be a LOCAL_KEY, so a user who set up
  // sync before that change has the token stranded in their local file only. If the
  // synced file has since been created without it, adopt the stranded local token
  // rather than losing it to the default '' — the next save/setConfigDir naturally
  // moves it into the synced file for good.
  const recoveredToken = !synced.discogsToken && local.discogsToken ? local.discogsToken : undefined
  return mergeSettings(mergeSettings(defaults, synced), {
    ...localOnly,
    ...(recoveredToken ? { discogsToken: recoveredToken } : {}),
  })
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

// Keys a settings:set patch from the renderer must never carry directly: these are
// internal tallies bumped only by recordStat/recordConversion, each with its own
// validation (recordStat rejects NaN/negative amounts; stats:record allowlists the
// key). A raw patch would bypass both — a compromised renderer, or a bug, could
// zero out or inflate a user's lifetime stats in one call. commandUsage is exempt:
// the command palette patches it directly and legitimately on every run.
const INTERNAL_ONLY_KEYS = ['stats', 'conversionCount'] as const satisfies readonly (keyof Settings)[]

export function sanitizeSettingsPatch(patch: Partial<Settings>): Partial<Settings> {
  const clean = { ...patch }
  for (const key of INTERNAL_ONLY_KEYS) delete clean[key]
  return clean
}

function persist(next: Settings): Settings {
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

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  // Auto-match can't be left on without the prerequisites met (a source, plus a Discogs
  // token whenever Discogs is one), whatever the UI sent — so clearing the token or the
  // last source also turns it off.
  if (!autoMatchAvailable(next)) next.autoMatch = false
  return persist(next)
}

// Backup restore: unlike saveSettings (which merges the patch over the current
// settings), this rebuilds from defaults so keys absent in the imported file fall
// back to their default instead of keeping the value being replaced. Persistence
// (and the local/synced split) is otherwise identical to saveSettings. The imported
// file is sanitized like a renderer patch: an imported backup must not resurrect or
// corrupt this machine's lifetime tallies, so stats/conversionCount always fall back
// to their defaults instead of taking whatever the backup file says.
export function replaceSettings(imported: Partial<Settings>): Settings {
  const next = mergeSettings(defaults, sanitizeSettingsPatch(imported))
  if (!autoMatchAvailable(next)) next.autoMatch = false
  return persist(next)
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

// The lifetime tallies next to conversionCount. `by` crosses the IPC boundary from
// the renderer, so it is validated here: anything but a positive finite number is
// dropped rather than persisted into the tally.
export function recordStat(key: keyof Settings['stats'], by = 1): void {
  const n = Math.floor(by)
  if (!Number.isFinite(n) || n <= 0) return
  const cur = getSettings()
  saveSettings({ stats: { ...cur.stats, [key]: cur.stats[key] + n } })
}
