import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_FIELDS, DEFAULT_REQUIRED_FIELDS } from '../shared/defaults'
import { bumpUsage } from '../shared/license'
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
  deviceId: '',
}

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): Settings {
  let parsed: Partial<Settings> = {}
  try {
    if (existsSync(file())) parsed = JSON.parse(readFileSync(file(), 'utf-8'))
  } catch {
    // corrupt file → fall back to defaults
  }
  const merged = { ...defaults, ...parsed }
  // Mint a stable device id the first time it's needed and persist it, so every
  // license activation from this install presents the same device identity.
  if (!merged.deviceId) {
    merged.deviceId = randomUUID()
    try {
      writeFileSync(file(), JSON.stringify(merged, null, 2), 'utf-8')
    } catch {
      // best-effort: a non-persisted id still works for this run
    }
  }
  return merged
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  // Auto-match requires the user's own Discogs token (its own rate-limit bucket), so it can
  // never be on without one — whatever the UI sent, and clearing the token also turns it off.
  if (!next.discogsToken.trim()) next.autoMatch = false
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

// Bumped once from the main process whenever a track finishes converting, the
// single completion point that covers both one-off and "Convert all" runs. Kept
// here so the tally is the one source of truth the Stats tab reads back.
export function recordConversion(): void {
  const cur = getSettings()
  saveSettings({
    conversionCount: cur.conversionCount + 1,
    // The free tier is metered per month; fold this conversion into the monthly
    // tally too, rolling over when the month changes.
    usage: bumpUsage(cur.usage, Date.now()),
  })
}
