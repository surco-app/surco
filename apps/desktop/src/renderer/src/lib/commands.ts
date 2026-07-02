import type { NormalizeConfig, OutputFormat, Settings } from '../../../shared/types'
import i18n from '../i18n'
import type { TrackItem } from '../types'
import { canAddToAppleMusic } from './appleMusic'
import { DONATE_URL } from './donate'
import { openFeedback } from './feedback'

export interface Command {
  id: string
  title: string
  hint?: string
  enabled: boolean
  run: () => void
}

// Filters commands by a case-insensitive substring of the title. With a non-empty query,
// matches are ordered by how often the user has run each (frecency), so a habitual choice
// like "Clear the list" leads over an earlier-declared "Clear metadata". Ties keep the
// declarative order (stable sort), and an empty query is left untouched so the browsable
// menu the user has memorized never reshuffles.
export function filterCommands(
  commands: Command[],
  query: string,
  usage: Record<string, number> = {},
): Command[] {
  const q = query.trim().toLowerCase()
  if (!q) return commands
  const matches = commands.filter((c) => c.title.toLowerCase().includes(q))
  return matches
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (usage[b.c.id] ?? 0) - (usage[a.c.id] ?? 0) || a.i - b.i)
    .map((e) => e.c)
}

// The label a track shows in the palette: "artist — title" when both are known, else
// whichever single field exists, falling back to the frozen list label for a raw import.
export function trackLabel(t: TrackItem): string {
  const { artist, title } = t.meta
  if (artist && title) return `${artist} — ${title}`
  return title || artist || t.listLabel || t.fileName
}

// How many track jumps the palette offers for one query, so a broad term ("mix") can't
// bury the commands or turn the palette into the whole library.
const TRACK_RESULT_LIMIT = 8

// Turns the visible tracks into "jump to this track" palette entries for a non-empty
// query, matching on artist, title and the frozen list label. Empty query → no tracks,
// so ⌘K stays a pure command launcher until the user types something to search for.
export function filterTrackCommands(
  tracks: TrackItem[],
  query: string,
  goToTrack: (id: string) => void,
): Command[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: Command[] = []
  for (const t of tracks) {
    const haystack = `${t.meta.artist ?? ''} ${t.meta.title ?? ''} ${t.listLabel}`.toLowerCase()
    if (!haystack.includes(q)) continue
    out.push({
      id: `goto:${t.id}`,
      title: trackLabel(t),
      enabled: true,
      run: () => goToTrack(t.id),
    })
    if (out.length >= TRACK_RESULT_LIMIT) break
  }
  return out
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
  // The host OS, supplied so the registry stays free of IPC: the Apple Music gate is
  // macOS-only and reads it through this instead of reaching for window.api.
  platform: string
  tracks: TrackItem[]
  // The filtered/sorted rows the prev/next navigation steps through and the sweeps now run over.
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
  // The sidebar's track-filter field — the `/` shortcut focuses this.
  trackSearchRef: { readonly current: HTMLInputElement | null }
  pickFiles: () => void
  selectAll: () => void
  askFillAll: () => void
  moveSelection: (delta: number) => void
  jumpSelection: (to: 'first' | 'last') => void
  pageSelection: (dir: -1 | 1) => void
  // Move keyboard focus between the three columns (list / Discogs matches / editor).
  focusList: () => void
  focusMatches: () => void
  focusEditor: () => void
  togglePlay: () => void
  processOne: (id: string, format?: OutputFormat, normalize?: NormalizeConfig) => unknown
  askConvertAll: (targets: TrackItem[], format?: OutputFormat, normalize?: NormalizeConfig) => void
  cancelAnalysis: () => void
  analyzeAllQuality: () => void
  cancelAutoMatch: () => void
  enqueueAutoMatch: (candidates: TrackItem[], visibleOnly: boolean) => void
  addTrackToAppleMusic: (id: string) => unknown
  removeTrack: (id: string) => void
  // Opens the converted file in the OS file manager. Injected so the registry doesn't
  // call window.api.reveal directly.
  reveal: (path: string) => void
  askClearAll: () => void
  openSettings: (tab?: 'general' | 'stats' | 'naming' | 'shortcuts') => void
  openFindReplace: () => void
  openExport: () => void
  openRename: () => void
  openActivity: () => void
  openHelp: () => void
  toggleLanguage: () => void
  // Rotates the UI theme through system → light → dark; global chrome, so it's always live.
  toggleTheme: () => void
  // Empties every metadata field on the current selection (the Editor's clear button).
  clearMeta: () => void
  // Fills tags on the current selection by parsing each file name (the Editor's derive button).
  deriveTags: () => void
  // Fires the celebration confetti — the same burst the donate nudge shows, on demand.
  fireConfetti: () => void
}

export function buildCommands(deps: CommandDeps): Command[] {
  const {
    tr,
    hintFor,
    platform,
    tracks,
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
    trackSearchRef,
    pickFiles,
    selectAll,
    askFillAll,
    moveSelection,
    jumpSelection,
    pageSelection,
    focusList,
    focusMatches,
    focusEditor,
    togglePlay,
    processOne,
    askConvertAll,
    cancelAnalysis,
    analyzeAllQuality,
    cancelAutoMatch,
    enqueueAutoMatch,
    addTrackToAppleMusic,
    removeTrack,
    reveal,
    askClearAll,
    openSettings,
    openFindReplace,
    openExport,
    openRename,
    openActivity,
    openHelp,
    toggleLanguage,
    toggleTheme,
    clearMeta,
    deriveTags,
    fireConfetti,
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
      // Fills tags from the file name for the current selection — the Editor's Tag button.
      id: 'derive-tags',
      title: tr('commands.deriveTags'),
      hint: hintFor('derive-tags'),
      enabled: !!selected,
      run: deriveTags,
    },
    {
      // Empties every metadata field on the current selection — the Editor's Eraser button.
      id: 'clear-meta',
      title: tr('commands.clearMeta'),
      hint: hintFor('clear-meta'),
      enabled: !!selected,
      run: clearMeta,
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
      // Home/End/PageUp/PageDown are fixed aliases (not in the rebind UI), so their hints
      // are the literal key glyphs rather than a binding looked up from the keymap.
      id: 'list-top',
      title: tr('commands.listTop'),
      hint: '↖',
      enabled: visibleTracks.length > 1,
      run: () => jumpSelection('first'),
    },
    {
      id: 'list-bottom',
      title: tr('commands.listBottom'),
      hint: '↘',
      enabled: visibleTracks.length > 1,
      run: () => jumpSelection('last'),
    },
    {
      id: 'list-page-up',
      title: tr('commands.listPageUp'),
      hint: '⇞',
      enabled: visibleTracks.length > 1,
      run: () => pageSelection(-1),
    },
    {
      id: 'list-page-down',
      title: tr('commands.listPageDown'),
      hint: '⇟',
      enabled: visibleTracks.length > 1,
      run: () => pageSelection(1),
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
      enabled: tracks.length > 0,
      run: () => trackSearchRef.current?.focus(),
    },
    {
      // Jump focus to the track list (the selected row).
      id: 'focus-list',
      title: tr('commands.focusList'),
      hint: hintFor('focus-list'),
      enabled: visibleTracks.length > 0,
      run: focusList,
    },
    {
      // Jump focus to the Discogs matches column (first result, else the search box).
      id: 'focus-matches',
      title: tr('commands.focusMatches'),
      hint: hintFor('focus-matches'),
      enabled: !!selected,
      run: focusMatches,
    },
    {
      // Jump focus to the editor column (the first metadata field).
      id: 'focus-editor',
      title: tr('commands.focusEditor'),
      hint: hintFor('focus-editor'),
      enabled: !!selected,
      run: focusEditor,
    },
    {
      id: 'process-current',
      title: tr('commands.processCurrent'),
      hint: hintFor('process-current'),
      enabled: canProcessSelected,
      run: () => {
        if (!selected) return
        processOne(
          selected.id,
          editorFormatRef.current ?? undefined,
          editorNormalizeRef.current ?? undefined,
        )
        // Convert-and-advance: the conversion runs in the background, so move straight to
        // the next track — ⌘⏎ ⌘⏎ … works through the crate without a manual step between.
        moveSelection(1)
      },
    },
    {
      id: 'process-all',
      title: tr('commands.processAll'),
      hint: hintFor('process-all'),
      enabled: canProcessAll,
      // Convert the VISIBLE rows, not the whole crate: with a format filter on (e.g. MP3),
      // "convert all" must touch only what's shown, never the hidden FLAC/WAV rows.
      run: () =>
        askConvertAll(
          visibleTracks,
          editorFormatRef.current ?? undefined,
          editorNormalizeRef.current ?? undefined,
        ),
    },
    {
      // Toggles the quality sweep: starts it, or cancels a running one — the same button
      // the toolbar shows. The sweep works on the visible rows, so it's disabled once every
      // visible track is analyzed; changing the filter to reveal unanalysed rows re-enables it.
      id: 'analyze-quality',
      title: tr('commands.analyzeQuality'),
      hint: hintFor('analyze-quality'),
      enabled: analysis ? true : !visibleTracks.every((t) => Boolean(t.spectrum)),
      run: () => {
        if (analysis) cancelAnalysis()
        else analyzeAllQuality()
      },
    },
    {
      // Toggles the Discogs auto-match sweep. Needs a user token and at least one unmatched
      // visible track, mirroring the toolbar button's disabled rule. Matches the visible rows
      // so an active filter narrows the sweep to what's shown.
      id: 'auto-match',
      title: tr('commands.autoMatch'),
      hint: hintFor('auto-match'),
      enabled: matching ? true : !!settings?.discogsToken && autoMatchable > 0,
      run: () => {
        if (matching) cancelAutoMatch()
        else enqueueAutoMatch(visibleTracks, false)
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
      run: () => selected?.outputPath && reveal(selected.outputPath),
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
        !!selected && canAddToAppleMusic(selected, platform, settings?.outputFormat ?? 'aiff'),
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
      title: tr('commands.clearAll'),
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
      id: 'activity',
      title: tr('commands.activity'),
      hint: hintFor('activity'),
      enabled: true,
      run: openActivity,
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
      // Rotates system → light → dark. Persisted, unlike the language toggle: the theme is
      // a real preference, and this is the palette twin of the Settings segmented control.
      id: 'toggle-theme',
      title: tr('commands.toggleTheme'),
      hint: hintFor('toggle-theme'),
      enabled: true,
      run: toggleTheme,
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
      id: 'donate',
      title: tr('commands.donate'),
      enabled: true,
      run: () => window.open(DONATE_URL),
    },
    {
      id: 'website',
      title: tr('commands.website'),
      enabled: true,
      run: () => window.open('https://getsurco.app/'),
    },
    {
      // A little joy on demand: the same corner-to-centre burst the donate nudge fires.
      id: 'confetti',
      title: tr('commands.confetti'),
      enabled: true,
      run: fireConfetti,
    },
  ]
}
