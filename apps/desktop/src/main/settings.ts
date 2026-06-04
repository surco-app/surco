import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
  filenameFormat: '{artist} - {title}',
  groupingPresets: ['Bases', 'Cantaditas'],
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: DEFAULT_FIELDS,
  requiredFields: DEFAULT_REQUIRED_FIELDS,
  coverMaxSize: 1200,
  coverSquare: false,
  showSpectrum: true,
  hasSeenOnboarding: false,
  conversionCount: 0,
}

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): Settings {
  try {
    if (existsSync(file())) {
      return { ...defaults, ...JSON.parse(readFileSync(file(), 'utf-8')) }
    }
  } catch {
    // corrupt file → fall back to defaults
  }
  return { ...defaults }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

// Bumped once from the main process whenever a track finishes converting, the
// single completion point that covers both one-off and "Convert all" runs. Kept
// here so the tally is the one source of truth the Stats tab reads back.
export function recordConversion(): void {
  saveSettings({ conversionCount: getSettings().conversionCount + 1 })
}
