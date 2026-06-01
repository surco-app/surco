import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { Settings } from '../shared/types'

const defaults: Settings = {
  discogsToken: '',
  outputDir: join(app.getPath('music'), 'Vinilo'),
  addToAppleMusic: true,
  filenameFormat: '{artist} - {title}',
  groupingPresets: ['Bases', 'Cantaditas'],
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [
    'title',
    'artist',
    'albumArtist',
    'album',
    'year',
    'genre',
    'grouping',
    'trackNumber',
    'comment'
  ]
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
