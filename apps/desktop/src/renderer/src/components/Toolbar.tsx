import {
  Activity,
  ArrowRightLeft,
  ChartColumn,
  FilePlus,
  Loader2,
  type LucideIcon,
  Radio,
  Search,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react'
import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { BatchSummary } from '../lib/batch'
import { Tooltip } from './Tooltip'

interface Props {
  // Formats a command's bound chord (e.g. "⌘⇧D") for the button tooltips, so a sweep's
  // shortcut is discoverable on hover. Passed in (rather than computed here) to keep the
  // binding table in App the single source of truth.
  hintFor: (id: string) => string
  trackCount: number
  // How many tracks the button would convert, and whether it can run at all (false once
  // nothing is eligible, which greys it rather than hiding it, so it stays where the user
  // last saw it). The count is named in the label on purpose: the editor footer carries a
  // "Convert to AIFF" for the open track, and without a count the two read as one action.
  convertibleCount: number
  // The tracks the batch covers (the selection, or the visible list), so a count below it
  // reads "1 of 3" and can't be taken for the open track when that one isn't ready.
  batchSize: number
  canConvertAll: boolean
  onConvertAll: () => void
  // Metadata-read progress of an in-flight import (null when idle), shown as a "212/319"
  // counter beside "Add files" so a big drop isn't an opaque wait.
  importing: { done: number; total: number } | null
  batchSummary: BatchSummary | null
  // Filters the list down to the rows whose conversion failed, so the summary's failure
  // count is a way into them instead of a number the user has to act on by eye.
  onShowFailed: () => void
  batching: boolean
  // Progress of the running batch (convert-all / add-all), shown as a cancellable pill
  // while `batching` — the conversion's counterpart of the sweep buttons below.
  batchProgress: { done: number; total: number }
  // Progress of the analyze-quality sweep (null when idle) and whether every track is
  // already analyzed (which, when idle, disables the button).
  analysis: { done: number; total: number } | null
  allAnalyzed: boolean
  // Progress of the auto-match sweep (null when idle), whether its sources can run (see
  // autoMatchAvailable), and how many tracks are still matchable (zero disables the button).
  matching: { done: number; total: number } | null
  canAutoMatch: boolean
  // Auto-match is on in Settings but the provider it needs can't run (no Discogs token) —
  // so the sweep would silently do nothing. The button then reads as a live "add a token"
  // fix instead of a disabled control, and onFixToken opens Settings where it's set.
  needsToken: boolean
  autoMatchable: number
  onAnalyzeAll: () => void
  onCancelAnalyze: () => void
  onAutoMatch: () => void
  onCancelAutoMatch: () => void
  onFixToken: () => void
  // Stops the running batch between tracks: queued conversions bail as skipped, the
  // ones already in ffmpeg finish.
  onCancelBatch: () => void
  onCancelImport: () => void
  onPalette: () => void
  onStats: () => void
  onActivity: () => void
  // True while any background work (search, cover download, conversion) is in flight,
  // for the dot on the activity button — the same signal the panel's rows show.
  activityRunning: boolean
  onSettings: () => void
  // Takes the main action's place while another view owns the screen (the Music review),
  // so Convert never acts on a list that is out of sight.
  primary?: React.ReactNode
}

// The window's title-bar toolbar: the convert-the-list action, the auto-match and
// analyze-quality sweeps, the progress of whatever runs, and the always-present
// palette/stats/activity/originals/settings. App owns the state and hands every action down.
// Memoized for the same contract as the Editor: App hands it stable handlers, so a
// keystroke in a metadata field no longer re-renders the whole toolbar.
export const Toolbar = memo(function Toolbar({
  hintFor,
  trackCount,
  convertibleCount,
  batchSize,
  canConvertAll,
  onConvertAll,
  importing,
  batchSummary,
  onShowFailed,
  batching,
  batchProgress,
  analysis,
  allAnalyzed,
  matching,
  canAutoMatch,
  needsToken,
  autoMatchable,
  onAnalyzeAll,
  onCancelAnalyze,
  onAutoMatch,
  onCancelAutoMatch,
  onFixToken,
  onCancelBatch,
  onCancelImport,
  onPalette,
  onStats,
  onActivity,
  activityRunning,
  onSettings,
  primary,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const convertLabel =
    convertibleCount === 0
      ? tr('header.convertNone')
      : convertibleCount < batchSize
        ? tr('header.convertSome', { ready: convertibleCount, total: batchSize })
        : tr('header.convertAll', { count: convertibleCount })
  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] pr-3 pl-20"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* The sweeps' counters, spoken. Outside the buttons because a button flattens what
          it holds into its own name (the cancel action), and always mounted, empty while
          idle, because a live region born together with its text is often never read. */}
      <div className="sr-only">
        <span role="status">
          {batching
            ? tr('header.convertingCount', { done: batchProgress.done, total: batchProgress.total })
            : ''}
        </span>
        <span role="status">
          {importing
            ? tr('header.importingCount', { done: importing.done, total: importing.total })
            : ''}
        </span>
        <span role="status">
          {matching
            ? tr('header.autoMatchingCount', { done: matching.done, total: matching.total })
            : ''}
        </span>
        <span role="status">
          {analysis
            ? tr('header.analyzingCount', { done: analysis.done, total: analysis.total })
            : ''}
        </span>
      </div>
      <div />
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {batchSummary && !batching && (
          <span data-testid="batch-summary" role="status" className="text-sm text-fg-muted">
            {[
              // Leads the row so a cancelled run cannot be mistaken for one that finished
              // on its own and skipped tracks for some other reason.
              batchSummary.cancelled === true && tr('header.batchCancelled'),
              tr('header.batchConverted', { count: batchSummary.converted }),
              batchSummary.skipped > 0 &&
                tr('header.batchSkipped', { count: batchSummary.skipped }),
            ]
              .filter(Boolean)
              .join(' · ')}
            {/* The failure count is the one segment worth acting on, so it's a button
                rather than text: it filters the list down to the rows that failed. The
                count used to point nowhere, leaving the user to find them by eye. */}
            {batchSummary.failed > 0 && (
              <>
                {' · '}
                <button
                  type="button"
                  data-testid="batch-failed-count"
                  onClick={onShowFailed}
                  className="text-danger underline-offset-2 hover:underline"
                >
                  {tr('header.batchFailed', { count: batchSummary.failed })}
                </button>
              </>
            )}
          </span>
        )}
        {importing && (
          // A live pill matching the auto-match/analyze sweeps (accent text, spinning
          // glyph, done/total), so a big drop reads as active work rather than a static
          // line — and clicking it cancels, like the batch pill beside it. This was the
          // one sweep with no way out: a folder dropped by mistake had to be waited out.
          <button
            type="button"
            data-testid="import-progress"
            onClick={onCancelImport}
            aria-label={tr('header.cancelImport')}
            className="press group relative flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium tabular-nums text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
          >
            {/* FilePlus, not the shared Loader2: mid-conversion, a dropped folder painted
                two identical spinning capsules. The other sweeps identify themselves by
                glyph already; this is the import's, echoing the Add files button it
                follows from. */}
            <FilePlus className="h-4 w-4" aria-hidden="true" />
            <span>
              {tr('header.importingCount', { done: importing.done, total: importing.total })}
            </span>
            <Tooltip label={tr('header.cancelImport')} align="end" />
          </button>
        )}
        {trackCount > 0 && (
          <>
            {/* Auto-match and analyze are the two crate-wide "intelligence" sweeps. Add files
                and the per-list edit tools (select/fill/find/clear) now live in the list's own
                header, so the toolbar keeps only crate-wide sweeps and global actions. */}
            <button
              type="button"
              data-testid="auto-match"
              onClick={matching ? onCancelAutoMatch : needsToken ? onFixToken : onAutoMatch}
              // When auto-match is on but the token is missing, the button isn't a dead
              // disabled control — it's the fix, so it stays enabled and routes to Settings.
              disabled={!matching && !needsToken && (!canAutoMatch || autoMatchable === 0)}
              // Mid-run a press cancels, so the name has to say that and not offer the start.
              aria-label={
                matching
                  ? tr('header.cancelAutoMatch')
                  : needsToken
                    ? tr('header.autoMatchNoToken')
                    : tr('header.autoMatch')
              }
              className={`press group relative flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium hover:bg-[var(--color-hover)] disabled:opacity-40 ${
                matching
                  ? 'min-w-[3.25rem] text-[var(--color-accent)]'
                  : 'text-fg-muted hover:text-fg'
              }`}
            >
              <Sparkles
                className={`h-4 w-4 ${matching ? 'animate-pulse' : ''}`}
                aria-hidden="true"
              />
              {matching && (
                <span data-testid="auto-match-progress" className="text-xs tabular-nums">
                  {matching.done}/{matching.total}
                </span>
              )}
              {/* Auto-match on, token missing: name the gap inline so it reads without a
                  hover — the tooltip alone was the invisible dead end this fixes. */}
              {!matching && needsToken && (
                <>
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warn" />
                  <span>{tr('header.addToken')}</span>
                </>
              )}
              {!matching && !needsToken && <span>{tr('header.autoMatchLabel')}</span>}
              <Tooltip
                label={
                  matching
                    ? tr('header.autoMatchingCount', { done: matching.done, total: matching.total })
                    : needsToken
                      ? tr('header.autoMatchNoToken')
                      : tr('header.autoMatch')
                }
                hint={matching || needsToken ? undefined : hintFor('auto-match')}
                align="end"
              />
            </button>
            <button
              type="button"
              data-testid="analyze-quality"
              onClick={analysis ? onCancelAnalyze : onAnalyzeAll}
              disabled={!analysis && allAnalyzed}
              aria-label={analysis ? tr('header.cancelAnalyze') : tr('header.analyzeQuality')}
              className={`press group relative flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 hover:bg-[var(--color-hover)] disabled:opacity-40 ${
                analysis
                  ? 'min-w-[3.25rem] text-[var(--color-accent)]'
                  : 'w-8 text-fg-muted hover:text-fg'
              }`}
            >
              <Activity
                className={`h-4 w-4 ${analysis ? 'animate-pulse' : ''}`}
                aria-hidden="true"
              />
              {analysis && (
                <span data-testid="analyze-progress" className="text-xs tabular-nums">
                  {analysis.done}/{analysis.total}
                </span>
              )}
              <Tooltip
                label={
                  analysis
                    ? tr('header.analyzingCount', { done: analysis.done, total: analysis.total })
                    : tr('header.analyzeQuality')
                }
                hint={analysis ? undefined : hintFor('analyze-quality')}
                align="end"
              />
            </button>
          </>
        )}
        <div aria-hidden="true" className="w-2" />
        <button
          type="button"
          data-testid="open-palette"
          onClick={onPalette}
          className="press group relative flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg"
          aria-label={tr('header.palette')}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          <Tooltip label={tr('header.palette')} hint={hintFor('palette')} align="end" />
        </button>
        {/* Split the command launcher from the app-level views (stats, activity, settings)
            so the header reads as three groups (track actions, command, app) instead of one
            undifferentiated run of icons. Space does the grouping, as in a macOS toolbar;
            the one hairline left is the one before the main action. */}
        <div aria-hidden="true" className="w-2" />
        <button
          type="button"
          data-testid="open-stats"
          onClick={onStats}
          className="press group relative flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg"
          aria-label={tr('header.stats')}
        >
          <ChartColumn className="h-4 w-4" aria-hidden="true" />
          <Tooltip label={tr('header.stats')} hint={hintFor('stats')} align="end" />
        </button>
        <button
          type="button"
          data-testid="open-activity"
          onClick={onActivity}
          className="press group relative flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg"
          aria-label={tr('header.activity')}
        >
          <Radio className="h-4 w-4" aria-hidden="true" />
          {activityRunning && (
            <span
              data-testid="activity-running"
              className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-good"
            />
          )}
          <Tooltip label={tr('header.activity')} align="end" />
        </button>
        <button
          type="button"
          data-testid="open-settings"
          // Call with no args so React's click event can't reach the opener as its tab.
          onClick={() => onSettings()}
          className="press group relative flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg"
          aria-label={tr('header.settings')}
        >
          <SettingsIcon className="h-4 w-4" aria-hidden="true" />
          <Tooltip label={tr('header.settings')} hint={hintFor('settings')} align="end" />
        </button>
        {/* Converting the list is the app's whole point, so it closes the header whenever
            there is a list, one track included, so the button never comes and goes: at the
            trailing edge, where a macOS toolbar keeps its main action, on the same side as
            the editor footer's action for the open track. Labelled rather than a bare
            glyph: it rewrites files, and an icon alone would not say what it touches. */}
        {primary ? (
          <>
            <div aria-hidden="true" className="mx-1 h-5 w-px self-center bg-[var(--color-line)]" />
            {primary}
          </>
        ) : (
          trackCount > 0 && (
            <>
              <div
                aria-hidden="true"
                className="mx-1 h-5 w-px self-center bg-[var(--color-line)]"
              />
              <PrimaryAction
                testid="convert-all"
                Icon={ArrowRightLeft}
                label={convertLabel}
                running={batching}
                runningLabel={tr('header.convertingCount', {
                  done: batchProgress.done,
                  total: batchProgress.total,
                })}
                cancelLabel={tr('header.cancelConvert')}
                ready={canConvertAll}
                hint={hintFor('process-all')}
                onRun={onConvertAll}
                onCancel={onCancelBatch}
              />
            </>
          )
        )}
      </div>
    </header>
  )
})

// The toolbar's trailing main action: labelled, tinted while it can run, and while it runs
// the same button shows the count and cancels.
export function PrimaryAction({
  testid,
  Icon,
  label,
  running,
  runningLabel,
  cancelLabel,
  ready,
  hint,
  onRun,
  onCancel,
}: {
  testid: string
  Icon: LucideIcon
  label: string
  running: boolean
  runningLabel: React.ReactNode
  cancelLabel: string
  ready: boolean
  hint?: string
  onRun: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={running ? onCancel : onRun}
      disabled={!running && !ready}
      aria-label={running ? cancelLabel : label}
      className={`press group relative flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium disabled:opacity-40 ${
        running
          ? 'text-[var(--color-accent)] hover:bg-[var(--color-hover)]'
          : ready
            ? 'bg-[var(--color-accent-soft)] text-fg hover:bg-[var(--color-row-selected)] hover:text-[var(--color-on-row-selected)]'
            : 'text-fg-muted'
      }`}
    >
      {running ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {/* Spoken by the status regions at the top of the header, not here: the
            button's own name is the cancel action. */}
          <span className="tabular-nums">{runningLabel}</span>
        </>
      ) : (
        <>
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
        </>
      )}
      <Tooltip label={running ? cancelLabel : label} hint={running ? undefined : hint} />
    </button>
  )
}
