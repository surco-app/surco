import { resolveJobFormat } from '../../../shared/format'
import type { DeclickMode, FormatSetting, NormalizeConfig, Settings } from '../../../shared/types'
import i18n from '../i18n'
import type { TrackItem } from '../types'
import { canAddToAppleMusic } from './appleMusic'
import type { Destination } from './destination'
import { DONATE_URL } from './donate'
import { openFeedback } from './feedback'
import { suspectTracks } from './triage'

// The palette's section for a command, Raycast-style: a fixed set of buckets so 47
// commands read as six short lists instead of one wall. 'tracks' is reserved for the
// go-to-track jumps filterTrackCommands builds.
type CommandGroup =
  | 'tags'
  | 'convert'
  | 'library'
  | 'playback'
  | 'navigate'
  | 'app'
  | 'tracks'

// The order the palette shows the sections in: everyday tag work first, app chrome last.
export const COMMAND_GROUP_ORDER: CommandGroup[] = [
  'tags',
  'convert',
  'library',
  'playback',
  'navigate',
  'app',
  'tracks',
]

export interface Command {
  id: string
  title: string
  hint?: string
  enabled: boolean
  // Which palette section the command lists under. Required on purpose: a new
  // command without a group would silently render ungrouped.
  group: CommandGroup
  run: () => void
}

// Filters commands by a case-insensitive substring of the title. With a non-empty query,
// matches are ordered by how often the user has run each (frecency), so a habitual choice
// like "Clear the list" leads over an earlier-declared "Clear metadata". Ties keep the
// declarative order (stable sort), and an empty query is left untouched so the browsable
// menu the user has memorized never reshuffles.
// Lowercases and strips diacritics, so "titulo" finds "título" (and an accented
// query still finds an unaccented title) — nobody types accents into a launcher.
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function filterCommands(
  commands: Command[],
  query: string,
  usage: Record<string, number> = {},
): Command[] {
  const q = fold(query.trim())
  if (!q) return commands
  const matches = commands.filter((c) => fold(c.title).includes(q))
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

// How far one ←/→ press nudges the playhead — the customary 5-second scrub step.
const SEEK_STEP_SECONDS = 5

// Turns the visible tracks into "jump to this track" palette entries for a non-empty
// query, matching on artist, title and the frozen list label. Empty query → no tracks,
// so ⌘K stays a pure command launcher until the user types something to search for.
export function filterTrackCommands(
  tracks: TrackItem[],
  query: string,
  goToTrack: (id: string) => void,
): Command[] {
  const q = fold(query.trim())
  if (!q) return []
  const out: Command[] = []
  for (const t of tracks) {
    const haystack = fold(`${t.meta.artist ?? ''} ${t.meta.title ?? ''} ${t.listLabel}`)
    if (!haystack.includes(q)) continue
    out.push({
      id: `goto:${t.id}`,
      title: trackLabel(t),
      enabled: true,
      group: 'tracks',
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
  // Whether a convert-all/add-all batch is running, and its cancel — 'process-all'
  // flips into that cancel mid-run, like the sweep commands do.
  batching: boolean
  cancelBatch: () => void
  // The editor's split-button picks, read at run time so ⌘⏎ honors them.
  editorFormatRef: { readonly current: FormatSetting | null }
  editorDestinationRef: { readonly current: Destination | null }
  editorNormalizeRef: { readonly current: NormalizeConfig | null }
  editorDeclickRef: { readonly current: DeclickMode | null }
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
  // Whether the player card is open — gates the ←/→ seek so the arrows only act on a
  // running player, never while it's closed.
  playerVisible: boolean
  // Nudge the playhead by ±seconds (the ←/→ shortcuts).
  seek: (delta: number) => void
  processOne: (
    id: string,
    format?: FormatSetting,
    normalize?: NormalizeConfig,
    forceReencode?: boolean,
    destination?: Destination,
    declick?: DeclickMode,
    // Fires when the conversion actually starts (after an overwrite confirm, if any), so
    // convert-and-advance only steps the selection once the run commits.
    onStarted?: () => void,
  ) => unknown
  askConvertAll: (
    targets: TrackItem[],
    format?: FormatSetting,
    normalize?: NormalizeConfig,
    destination?: Destination,
    declick?: DeclickMode,
  ) => void
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
  // The shared bulk-action scope: a deliberate multi-selection (>1) when there is one,
  // else the visible rows. Convert-all and Auto-match sweep THIS set, matching Find &
  // Replace and the toolbar buttons, so a selection is never silently ignored.
  bulkTracks: TrackItem[]
  // Sends every flagged (suspect) visible rip to the OS Trash after a confirm — the one-click
  // "clean the fakes" that turns the quality sweep into an action, not just a filter.
  askTrashSuspects: () => void
  // Sends the selected tracks' files to the OS Trash after a confirm — the palette/toolbar
  // counterpart of the context menu's "Move to Trash".
  askTrashSelected: () => void
  openSettings: (tab?: 'general' | 'stats' | 'naming' | 'shortcuts') => void
  openFindReplace: () => void
  openExport: () => void
  openRename: () => void
  openActivity: () => void
  openHelp: () => void
  openOnboarding: () => void
  toggleLanguage: () => void
  // Rotates the UI theme through system → light → dark; global chrome, so it's always live.
  toggleTheme: () => void
  // Empties every metadata field on the current selection (the Editor's clear button).
  clearMeta: () => void
  // Fills tags on the current selection by parsing each file name (the Editor's derive button).
  deriveTags: () => void
  // Stamps 1..N (list order) onto the bulk scope's track numbers.
  numberTracks: () => void
  // Opens the preview for dropping the leading track number from the bulk scope's titles.
  openStripNumbering: () => void
  // Rewrites the selection's titles from the settings' title format (one-shot).
  applyTitleFormat: () => void
  // Rebuilds the selection's file names from the Settings → Naming pattern.
  regenerateNames: () => void
  // Detects and stages the silence trim over the whole selection.
  trimDetected: () => void
  // Whether a title format is configured at all — the command is pointless without one.
  titleFormatSet: boolean
  // Restores the tags the last batch operation (fill-all, find & replace, clear, paste,
  // derive) overwrote. Read lazily so the palette entry reflects the stack at open time.
  undoMeta: () => void
  canUndoMeta: () => boolean
  // Applies the selected track's pending 'review' suggestion — the match the sweep flagged
  // but didn't write — without opening the editor. A no-op when there's nothing to accept.
  acceptReview: () => void
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
    batching,
    cancelBatch,
    editorFormatRef,
    editorDestinationRef,
    editorNormalizeRef,
    editorDeclickRef,
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
    playerVisible,
    seek,
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
    bulkTracks,
    askTrashSuspects,
    askTrashSelected,
    openSettings,
    openFindReplace,
    openExport,
    openRename,
    openActivity,
    openHelp,
    openOnboarding,
    toggleLanguage,
    toggleTheme,
    clearMeta,
    deriveTags,
    numberTracks,
    openStripNumbering,
    applyTitleFormat,
    regenerateNames,
    trimDetected,
    titleFormatSet,
    undoMeta,
    canUndoMeta,
    acceptReview,
    fireConfetti,
  } = deps
  return [
    {
      id: 'add',
      group: 'library',
      title: tr('commands.add'),
      hint: hintFor('add'),
      enabled: true,
      run: pickFiles,
    },
    {
      id: 'find-replace',
      group: 'tags',
      title: tr('commands.findReplace'),
      hint: hintFor('find-replace'),
      enabled: tracks.length > 0,
      run: openFindReplace,
    },
    {
      id: 'select-all',
      group: 'library',
      title: tr('commands.selectAll'),
      hint: hintFor('select-all'),
      enabled: tracks.length > 0,
      run: selectAll,
    },
    {
      id: 'fill-all',
      group: 'tags',
      title: tr('commands.fillAll'),
      hint: hintFor('fill-all'),
      enabled: tracks.length > 0,
      run: askFillAll,
    },
    {
      // Fills tags from the file name for the current selection — the Editor's Tag button.
      id: 'derive-tags',
      group: 'tags',
      title: tr('commands.deriveTags'),
      hint: hintFor('derive-tags'),
      enabled: !!selected,
      run: deriveTags,
    },
    {
      // Writes the bulk scope's list order into the track numbers (1..N) — for albums
      // with no Discogs release to take positions from. Needs at least two tracks in
      // scope: numbering a single row has no order to express.
      id: 'number-tracks',
      group: 'tags',
      title: tr('commands.numberTracks'),
      hint: hintFor('number-tracks'),
      enabled: bulkTracks.length > 1,
      run: numberTracks,
    },
    {
      // Drops the leading track number from the bulk scope's titles ("1. Shake It",
      // "A1 - Deep Cut"). Opens a preview rather than applying blind: it rewrites a
      // whole scope, and the numbering it strips is not always obvious at a glance.
      id: 'strip-numbering',
      group: 'tags',
      title: tr('commands.stripNumbering'),
      hint: hintFor('strip-numbering'),
      enabled: bulkTracks.length > 0,
      run: openStripNumbering,
    },
    {
      // Rewrites the selection's titles from the settings' title format — the bulk twin
      // of the title field's ⋯ menu row. Needs a configured format and a selection.
      id: 'apply-title-format',
      group: 'tags',
      title: tr('commands.applyTitleFormat'),
      hint: hintFor('apply-title-format'),
      enabled: !!selected && titleFormatSet,
      run: applyTitleFormat,
    },
    {
      // Empties every metadata field on the current selection — the Editor's Eraser button.
      id: 'clear-meta',
      group: 'tags',
      title: tr('commands.clearMeta'),
      hint: hintFor('clear-meta'),
      enabled: !!selected,
      run: clearMeta,
    },
    {
      // Rolls back the last batch tag operation — the escape hatch for a mistaken
      // fill-all, find & replace, clear, paste or derive.
      id: 'undo-meta',
      group: 'tags',
      title: tr('commands.undoMeta'),
      hint: hintFor('undo-meta'),
      enabled: canUndoMeta(),
      run: undoMeta,
    },
    {
      id: 'prev',
      group: 'navigate',
      title: tr('commands.prev'),
      hint: hintFor('prev'),
      enabled: visibleTracks.length > 1,
      run: () => moveSelection(-1),
    },
    {
      id: 'next',
      group: 'navigate',
      title: tr('commands.next'),
      hint: hintFor('next'),
      enabled: visibleTracks.length > 1,
      run: () => moveSelection(1),
    },
    {
      // Home/End/PageUp/PageDown are fixed aliases (not in the rebind UI), so their hints
      // are the literal key glyphs rather than a binding looked up from the keymap.
      id: 'list-top',
      group: 'navigate',
      title: tr('commands.listTop'),
      hint: '↖',
      enabled: visibleTracks.length > 1,
      run: () => jumpSelection('first'),
    },
    {
      id: 'list-bottom',
      group: 'navigate',
      title: tr('commands.listBottom'),
      hint: '↘',
      enabled: visibleTracks.length > 1,
      run: () => jumpSelection('last'),
    },
    {
      id: 'list-page-up',
      group: 'navigate',
      title: tr('commands.listPageUp'),
      hint: '⇞',
      enabled: visibleTracks.length > 1,
      run: () => pageSelection(-1),
    },
    {
      id: 'list-page-down',
      group: 'navigate',
      title: tr('commands.listPageDown'),
      hint: '⇟',
      enabled: visibleTracks.length > 1,
      run: () => pageSelection(1),
    },
    {
      id: 'play',
      group: 'playback',
      title: tr('commands.play'),
      hint: hintFor('play'),
      enabled: !!selected,
      run: togglePlay,
    },
    {
      id: 'seek-back',
      group: 'playback',
      title: tr('commands.seekBack'),
      hint: hintFor('seek-back'),
      enabled: playerVisible,
      run: () => seek(-SEEK_STEP_SECONDS),
    },
    {
      id: 'seek-forward',
      group: 'playback',
      title: tr('commands.seekForward'),
      hint: hintFor('seek-forward'),
      enabled: playerVisible,
      run: () => seek(SEEK_STEP_SECONDS),
    },
    {
      id: 'search',
      group: 'library',
      title: tr('commands.search'),
      hint: hintFor('search'),
      enabled: tracks.length > 0,
      run: () => trackSearchRef.current?.focus(),
    },
    {
      // Jump focus to the track list (the selected row).
      id: 'focus-list',
      group: 'navigate',
      title: tr('commands.focusList'),
      hint: hintFor('focus-list'),
      enabled: visibleTracks.length > 0,
      run: focusList,
    },
    {
      // Jump focus to the Discogs matches column (first result, else the search box).
      id: 'focus-matches',
      group: 'navigate',
      title: tr('commands.focusMatches'),
      hint: hintFor('focus-matches'),
      enabled: !!selected,
      run: focusMatches,
    },
    {
      // Jump focus to the editor column (the first metadata field).
      id: 'focus-editor',
      group: 'navigate',
      title: tr('commands.focusEditor'),
      hint: hintFor('focus-editor'),
      enabled: !!selected,
      run: focusEditor,
    },
    {
      id: 'process-current',
      group: 'convert',
      title: tr('commands.processCurrent'),
      hint: hintFor('process-current'),
      enabled: canProcessSelected,
      run: () => {
        if (!selected) return
        // Convert-and-advance: the conversion runs in the background, so move straight to
        // the next track — ⌘⏎ ⌘⏎ … works through the crate without a manual step between.
        // The advance rides onStarted so an in-place overwrite confirms first: a cancelled
        // dialog leaves the selection put, and a confirmed one advances as it fires.
        processOne(
          selected.id,
          editorFormatRef.current ?? undefined,
          editorNormalizeRef.current ?? undefined,
          undefined,
          editorDestinationRef.current ?? undefined,
          editorDeclickRef.current ?? undefined,
          () => moveSelection(1),
        )
      },
    },
    {
      // Toggles the batch: starts a convert-all, or cancels the one running — same
      // flip as the sweep commands, so a misfired run can be stopped from the palette
      // that started it (queued tracks bail; in-flight conversions finish).
      id: 'process-all',
      group: 'convert',
      title: tr('commands.processAll'),
      hint: hintFor('process-all'),
      enabled: batching ? true : canProcessAll,
      // Convert the bulk scope: the multi-selection when one exists, else the visible
      // rows — with a format filter on, never the hidden FLAC/WAV rows.
      run: () => {
        if (batching) cancelBatch()
        else
          askConvertAll(
            bulkTracks,
            editorFormatRef.current ?? undefined,
            editorNormalizeRef.current ?? undefined,
            editorDestinationRef.current ?? undefined,
            editorDeclickRef.current ?? undefined,
          )
      },
    },
    {
      // Toggles the quality sweep: starts it, or cancels a running one — the same button
      // the toolbar shows. The sweep works on the visible rows, so it's disabled once every
      // visible track is analyzed; changing the filter to reveal unanalysed rows re-enables it.
      id: 'analyze-quality',
      group: 'library',
      title: tr('commands.analyzeQuality'),
      hint: hintFor('analyze-quality'),
      enabled: analysis ? true : !visibleTracks.every((t) => Boolean(t.spectrum)),
      run: () => {
        if (analysis) cancelAnalysis()
        else analyzeAllQuality()
      },
    },
    {
      // The payoff of the quality sweep: move every flagged rip to the Trash in one confirmed
      // step, instead of right-clicking each row. Scoped to the visible set, so a filter narrows
      // what it deletes; disabled when nothing visible is flagged, so it never fires on an empty set.
      id: 'trash-suspects',
      group: 'library',
      title: tr('commands.trashSuspects'),
      hint: hintFor('trash-suspects'),
      enabled: suspectTracks(visibleTracks).length > 0,
      run: askTrashSuspects,
    },
    {
      // Sends the selection's files to the OS Trash after a confirm — the same flow as the
      // context menu's "Move to Trash", surfaced where the keyboard can reach it.
      id: 'trash-selected',
      group: 'library',
      title: tr('commands.trashSelected'),
      hint: hintFor('trash-selected'),
      enabled: selectedTracksCount > 0 || !!selected,
      run: askTrashSelected,
    },
    {
      // Toggles the Discogs auto-match sweep. Needs a user token and at least one unmatched
      // visible track, mirroring the toolbar button's disabled rule. Matches the visible rows
      // so an active filter narrows the sweep to what's shown.
      id: 'auto-match',
      group: 'tags',
      title: tr('commands.autoMatch'),
      hint: hintFor('auto-match'),
      enabled: matching ? true : !!settings?.discogsToken && autoMatchable > 0,
      run: () => {
        if (matching) cancelAutoMatch()
        else enqueueAutoMatch(bulkTracks, false)
      },
    },
    {
      // Applies the review-tier suggestion the sweep flagged on the selected track, straight
      // from the list — the keyboard-first alternative to opening the editor and clicking it.
      // Enabled only while the selection actually carries a pending suggestion.
      id: 'accept-review',
      group: 'tags',
      title: tr('commands.acceptReview'),
      hint: hintFor('accept-review'),
      enabled: !!selected?.reviewMatch,
      run: acceptReview,
    },
    {
      id: 'export',
      group: 'convert',
      title: tr('commands.export'),
      hint: hintFor('export'),
      enabled: tracks.length > 0,
      run: openExport,
    },
    {
      id: 'reveal',
      group: 'library',
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
      group: 'convert',
      title: tr('commands.rename'),
      hint: hintFor('rename'),
      enabled: !!selected && selectedTracksCount <= 1 && !settings?.overwriteOriginal,
      run: openRename,
    },
    {
      // Rebuilds file names from the Settings pattern over the whole selection — the
      // bulk twin of the File name section's Regenerate button, which multi-select
      // hides. Overwrite mode pins names to the originals, so it is disabled there.
      id: 'regenerate-names',
      group: 'convert',
      title: tr('commands.regenerateNames'),
      hint: hintFor('regenerate-names'),
      enabled: !!selected && !settings?.overwriteOriginal,
      run: regenerateNames,
    },
    {
      // The bulk twin of the trim section's scissors markers: detects and stages
      // each selected track's silence trim in one press. Detection only suggests —
      // what converts is exactly what this stages, visible and resettable per track.
      id: 'trim-detected',
      group: 'convert',
      title: tr('commands.trimDetected'),
      hint: hintFor('trim-detected'),
      enabled: !!selected,
      run: trimDetected,
    },
    {
      id: 'add-apple-music',
      group: 'convert',
      title: tr('commands.addAppleMusic'),
      hint: hintFor('add-apple-music'),
      enabled:
        !!selected &&
        canAddToAppleMusic(
          selected,
          platform,
          resolveJobFormat(settings?.outputFormat ?? 'aiff', selected.inputPath, 'aiff'),
        ),
      run: () => selected && addTrackToAppleMusic(selected.id),
    },
    {
      id: 'remove',
      group: 'library',
      title: tr('commands.remove'),
      hint: hintFor('remove'),
      enabled: !!selected,
      run: () => selected && removeTrack(selected.id),
    },
    {
      id: 'remove-all',
      group: 'library',
      title: tr('commands.clearAll'),
      enabled: tracks.length > 0,
      run: askClearAll,
    },
    {
      id: 'settings',
      group: 'app',
      title: tr('commands.settings'),
      hint: hintFor('settings'),
      enabled: true,
      run: () => openSettings(),
    },
    {
      id: 'shortcuts',
      group: 'app',
      title: tr('commands.shortcuts'),
      hint: hintFor('shortcuts'),
      enabled: true,
      run: () => openSettings('shortcuts'),
    },
    {
      id: 'stats',
      group: 'app',
      title: tr('commands.stats'),
      hint: hintFor('stats'),
      enabled: true,
      run: () => openSettings('stats'),
    },
    {
      id: 'activity',
      group: 'app',
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
      group: 'app',
      title: tr('commands.toggleLanguage'),
      hint: hintFor('toggle-language'),
      enabled: true,
      run: toggleLanguage,
    },
    {
      // Rotates system → light → dark. Persisted, unlike the language toggle: the theme is
      // a real preference, and this is the palette twin of the Settings segmented control.
      id: 'toggle-theme',
      group: 'app',
      title: tr('commands.toggleTheme'),
      hint: hintFor('toggle-theme'),
      enabled: true,
      run: toggleTheme,
    },
    {
      id: 'help',
      group: 'app',
      title: tr('commands.help'),
      enabled: true,
      run: openHelp,
    },
    {
      id: 'onboarding',
      group: 'app',
      title: tr('commands.onboarding'),
      enabled: true,
      run: openOnboarding,
    },
    {
      id: 'feedback',
      group: 'app',
      title: tr('commands.feedback'),
      enabled: true,
      run: () => openFeedback(),
    },
    {
      id: 'guide',
      group: 'app',
      title: tr('commands.guide'),
      enabled: true,
      run: () => window.open(guideUrl(i18n.language)),
    },
    {
      id: 'donate',
      group: 'app',
      title: tr('commands.donate'),
      enabled: true,
      run: () => window.open(DONATE_URL),
    },
    {
      id: 'website',
      group: 'app',
      title: tr('commands.website'),
      enabled: true,
      run: () => window.open('https://getsurco.app/'),
    },
    {
      // A little joy on demand: the same corner-to-centre burst the donate nudge fires.
      id: 'confetti',
      group: 'app',
      title: tr('commands.confetti'),
      enabled: true,
      run: fireConfetti,
    },
  ]
}
