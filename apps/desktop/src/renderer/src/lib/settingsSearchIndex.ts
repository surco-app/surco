import type { DjProgram } from '../../../shared/djProgram'
import { offeredHere } from './platform'
import { SETTINGS_TABS, type SettingsTab } from './settingsTabs'

export interface SettingsSearchEntry {
  id: string
  tab: SettingsTab
  label: string
  anchor?: string
}

const SETTINGS_IDS: [SettingsTab, string[]][] = [
  [
    'general',
    ['theme', 'density', 'language', 'sourcesTitle', 'updates', 'autoUpdates', 'betaUpdates'],
  ],
  [
    'search',
    [
      'searchProviders',
      'searchResultsSection',
      'discogsFormats',
      'maxResults',
      'searchMatchingSection',
      'searchByAlbumFirst',
      'autoCleanSpacing',
      'autoCleanCase',
    ],
  ],
  [
    'editor',
    [
      'grouping',
      'genre',
      'showSpectrum',
      'autoAnalyze',
      'showLoudness',
      'showEditorHints',
      'keyNotation',
    ],
  ],
  ['layout', ['sections.title']],
  ['artwork', ['coverMaxSize', 'coverUpscale', 'coverSquare', 'replaceLowRes', 'flacFinderCovers']],
  [
    'cues',
    [
      'cueFlows.flows',
      'cueFlows.manual.jump',
      'cueFlows.manual.quantize',
      'cueFlows.manual.gridTolerance',
      'cueFlows.lettersByTime',
    ],
  ],
  [
    'conversion',
    ['outputFormat', 'keepMp3Sources', 'mp3Quality', 'bitDepth', 'sampleRate', 'flacCompression'],
  ],
  [
    'naming',
    [
      'titleFormat',
      'filenameFormat',
      'autoApplyFilename',
      'asciiFileNames',
      'trimWhitespace',
      'zeroPadTrack',
      'fullReleaseDate',
    ],
  ],
  ['destination', ['destination', 'originals', 'originalBackup']],
  [
    'programs',
    [
      'traktorSync',
      'traktorNmlPath',
      'traktorCueOffset',
      'rekordboxSync',
      'rekordboxDbPath',
      'completeCues',
      'engineSync',
      'seratoSync',
      'virtualdjLibrary',
      'virtualdjLibraryDir',
    ],
  ],
  ['advanced', ['configDir', 'backup', 'backups', 'cache', 'log']],
]

const ANCHORS: Record<string, string> = { completeCues: 'rekordboxSync' }

export const PROGRAM_OF_ANCHOR: Record<string, DjProgram> = {
  traktorSync: 'traktor',
  traktorNmlPath: 'traktor',
  traktorCueOffset: 'traktor',
  rekordboxSync: 'rekordbox',
  rekordboxDbPath: 'rekordbox',
  completeCues: 'rekordbox',
  engineSync: 'engine',
  seratoSync: 'serato',
  virtualdjLibrary: 'virtualdj',
  virtualdjLibraryDir: 'virtualdj',
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  ...SETTINGS_TABS.map((tab) => ({ id: `tabs.${tab}`, tab, label: `settings.tabs.${tab}` })),
  ...SETTINGS_IDS.flatMap(([tab, ids]) =>
    ids.map((id) => ({ id, tab, label: `settings.${id}`, anchor: ANCHORS[id] })),
  ),
  { id: 'declick.title', tab: 'processing', label: 'declick.title' },
  { id: 'normalize.title', tab: 'processing', label: 'normalize.title' },
]

export function settingsSearchIndexHere(): SettingsSearchEntry[] {
  return SETTINGS_SEARCH_INDEX.filter((entry) => {
    const program = PROGRAM_OF_ANCHOR[entry.anchor ?? entry.id]
    return !program || offeredHere(program)
  })
}
