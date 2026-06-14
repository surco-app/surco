import type { NormalizeConfig, OutputFormat, Settings } from '../../../shared/types'
import i18n from '../i18n'
import type { TrackItem } from '../types'
import { canAddToAppleMusic } from './appleMusic'
import { openFeedback } from './feedback'

export interface Command {
  id: string
  title: string
  hint?: string
  enabled: boolean
  run: () => void
}

export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase()
  if (!q) return commands
  return commands.filter((c) => c.title.toLowerCase().includes(q))
}

// The user guide is published per-language at separate paths, so pick the one
// that matches the running locale rather than dropping everyone on Spanish.
export function guideUrl(language: string): string {
  return language === 'es' ? 'https://getsurco.app/guia' : 'https://getsurco.app/en/guide'
}

export function runCommand(commands: Command[], id: string): void {
  const c = commands.find((c) => c.id === id)
  if (c?.enabled) c.run()
}

// Everything the command registry reads or triggers, supplied by App per render so
// each command's enabled/run pair sees the current state. The registry itself is
// declarative data; keeping it here leaves App with only the wiring.
export interface CommandDeps {
  tr: (key: string) => string
  // The palette hint for a command's effective key binding (defaults + overrides).
  hintFor: (id: string) => string
  tracks: TrackItem[]
  // The triage view (spectrum-merged) the sweeps run over, and its filtered/sorted
  // counterpart the prev/next navigation steps through.
  tracksView: TrackItem[]
  visibleTracks: TrackItem[]
  selected: TrackItem | null
  selectedTracksCount: number
  settings: Settings | null
  analysis: { done: number; total: number } | null
  matching: { done: number; total: number } | null
  autoMatchable: number
  canProcessSelected: boolean
  canProcessAll: boolean
  // The editor's split-button picks, read at run time so ⌘⏎ honors them.
  editorFormatRef: { readonly current: OutputFormat | null }
  editorNormalizeRef: { readonly current: NormalizeConfig | null }
  searchInputRef: { readonly current: HTMLInputElement | null }
  pickFiles: () => void
  selectAll: () => void
  askFillAll: () => void
  moveSelection: (delta: number) => void
  togglePlay: () => void
  processOne: (id: string, format?: OutputFormat, normalize?: NormalizeConfig) => unknown
  askConvertAll: (targets: TrackItem[], format?: OutputFormat, normalize?: NormalizeConfig) => void
  cancelAnalysis: () => void
  analyzeAllQuality: () => void
  cancelAutoMatch: () => void
  enqueueAutoMatch: (candidates: TrackItem[], visibleOnly: boolean) => void
  addTrackToAppleMusic: (id: string) => unknown
  removeTrack: (id: string) => void
  askClearAll: () => void
  openSettings: (tab?: 'general' | 'stats' | 'naming' | 'shortcuts') => void
  openFindReplace: () => void
  openExport: () => void
  openRename: () => void
  openHelp: () => void
  toggleLanguage: () => void
}

export function buildCommands(deps: CommandDeps): Command[] {
  const {
    tr,
    hintFor,
    tracks,
    tracksView,
    visibleTracks,
    selected,
    selectedTracksCount,
    settings,
    analysis,
    matching,
    autoMatchable,
    canProcessSelected,
    canProcessAll,
    editorFormatRef,
    editorNormalizeRef,
    searchInputRef,
    pickFiles,
    selectAll,
    askFillAll,
    moveSelection,
    togglePlay,
    processOne,
    askConvertAll,
    cancelAnalysis,
    analyzeAllQuality,
    cancelAutoMatch,
    enqueueAutoMatch,
    addTrackToAppleMusic,
    removeTrack,
    askClearAll,
    openSettings,
    openFindReplace,
    openExport,
    openRename,
    openHelp,
    toggleLanguage,
  } = deps
  return [
    {
      id: 'add',
      title: tr('commands.add'),
      hint: hintFor('add'),
      enabled: true,
      run: pickFiles,
    },
    {
      id: 'find-replace',
      title: tr('commands.findReplace'),
      hint: hintFor('find-replace'),
      enabled: tracks.length > 0,
      run: openFindReplace,
    },
    {
      id: 'select-all',
      title: tr('commands.selectAll'),
      hint: hintFor('select-all'),
      enabled: tracks.length > 0,
      run: selectAll,
    },
    {
      id: 'fill-all',
      title: tr('commands.fillAll'),
      hint: hintFor('fill-all'),
      enabled: tracks.length > 0,
      run: askFillAll,
    },
    {
      id: 'prev',
      title: tr('commands.prev'),
      hint: hintFor('prev'),
      enabled: visibleTracks.length > 1,
      run: () => moveSelection(-1),
    },
    {
      id: 'next',
      title: tr('commands.next'),
      hint: hintFor('next'),
      enabled: visibleTracks.length > 1,
      run: () => moveSelection(1),
    },
    {
      id: 'play',
      title: tr('commands.play'),
      hint: hintFor('play'),
      enabled: !!selected,
      run: togglePlay,
    },
    {
      id: 'search',
      title: tr('commands.search'),
      hint: hintFor('search'),
      enabled: !!selected,
      run: () => searchInputRef.current?.focus(),
    },
    {
      id: 'process-current',
      title: tr('commands.processCurrent'),
      hint: hintFor('process-current'),
      enabled: canProcessSelected,
      run: () =>
        selected &&
        processOne(
          selected.id,
          editorFormatRef.current ?? undefined,
          editorNormalizeRef.current ?? undefined,
        ),
    },
    {
      id: 'process-all',
      title: tr('commands.processAll'),
      hint: hintFor('process-all'),
      enabled: canProcessAll,
      run: () =>
        askConvertAll(
          tracks,
          editorFormatRef.current ?? undefined,
          editorNormalizeRef.current ?? undefined,
        ),
    },
    {
      // Toggles the quality sweep: starts it, or cancels a running one — the same button
      // the toolbar shows. Disabled once every loaded track is already analyzed.
      id: 'analyze-quality',
      title: tr('commands.analyzeQuality'),
      hint: hintFor('analyze-quality'),
      enabled: analysis ? true : !tracksView.every((t) => Boolean(t.spectrum)),
      run: () => {
        if (analysis) cancelAnalysis()
        else analyzeAllQuality()
      },
    },
    {
      // Toggles the Discogs auto-match sweep. Needs a user token and at least one
      // unmatched track, mirroring the toolbar button's disabled rule.
      id: 'auto-match',
      title: tr('commands.autoMatch'),
      hint: hintFor('auto-match'),
      enabled: matching ? true : !!settings?.discogsToken && autoMatchable > 0,
      run: () => {
        if (matching) cancelAutoMatch()
        else enqueueAutoMatch(tracksView, false)
      },
    },
    {
      id: 'export',
      title: tr('commands.export'),
      hint: hintFor('export'),
      enabled: tracks.length > 0,
      run: openExport,
    },
    {
      id: 'reveal',
      title: tr('commands.reveal'),
      hint: hintFor('reveal'),
      enabled: !!selected?.outputPath,
      run: () => selected?.outputPath && window.api.reveal(selected.outputPath),
    },
    {
      // Builds the output name from a pattern. Only one track has a File name section
      // (multi-select hides it), so the command follows the same single-track rule.
      // Overwrite mode pins the name to the original, so renaming is disabled there too.
      id: 'rename',
      title: tr('commands.rename'),
      hint: hintFor('rename'),
      enabled: !!selected && selectedTracksCount <= 1 && !settings?.overwriteOriginal,
      run: openRename,
    },
    {
      id: 'add-apple-music',
      title: tr('commands.addAppleMusic'),
      hint: hintFor('add-apple-music'),
      enabled:
        !!selected &&
        canAddToAppleMusic(selected, window.api.platform, settings?.outputFormat ?? 'aiff'),
      run: () => selected && addTrackToAppleMusic(selected.id),
    },
    {
      id: 'remove',
      title: tr('commands.remove'),
      hint: hintFor('remove'),
      enabled: !!selected,
      run: () => selected && removeTrack(selected.id),
    },
    {
      id: 'remove-all',
      title: tr('commands.removeAll'),
      enabled: tracks.length > 0,
      run: askClearAll,
    },
    {
      id: 'settings',
      title: tr('commands.settings'),
      hint: hintFor('settings'),
      enabled: true,
      run: () => openSettings(),
    },
    {
      id: 'shortcuts',
      title: tr('commands.shortcuts'),
      hint: hintFor('shortcuts'),
      enabled: true,
      run: () => openSettings('shortcuts'),
    },
    {
      id: 'stats',
      title: tr('commands.stats'),
      hint: hintFor('stats'),
      enabled: true,
      run: () => openSettings('stats'),
    },
    {
      // Flips the UI between the two shipped locales. Not persisted on purpose: the app
      // re-detects the language from the OS on every launch, so this is a per-session
      // override for trying the other translation.
      id: 'toggle-language',
      title: tr('commands.toggleLanguage'),
      hint: hintFor('toggle-language'),
      enabled: true,
      run: toggleLanguage,
    },
    {
      id: 'help',
      title: tr('commands.help'),
      enabled: true,
      run: openHelp,
    },
    {
      id: 'feedback',
      title: tr('commands.feedback'),
      enabled: true,
      run: () => openFeedback(),
    },
    {
      id: 'guide',
      title: tr('commands.guide'),
      enabled: true,
      run: () => window.open(guideUrl(i18n.language)),
    },
    {
      id: 'website',
      title: tr('commands.website'),
      enabled: true,
      run: () => window.open('https://getsurco.app/'),
    },
  ]
}
