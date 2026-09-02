import {
  Activity,
  ArrowRightLeft,
  ChartColumn,
  FilePlus,
  Loader2,
  Radio,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react'
import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { BatchSummary } from '../lib/batch'
import { Tooltip } from './Tooltip'

interface Props {
  isMac: boolean
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
  canConvertAll: boolean
  onConvertAll: () => void
  // Metadata-read progress of an in-flight import (null when idle), shown as a "212/319"
  // counter beside "Add files" so a big drop isn't an opaque wait.
  importing: { done: number; total: number } | null
  batchSummary: BatchSummary | null
  batching: boolean
  // Progress of the running batch (convert-all / add-all), shown as a cancellable pill
  // while `batching` — the conversion's counterpart of the sweep buttons below.
  batchProgress: { done: number; total: number }
  // Progress of the analyze-quality sweep (null when idle) and whether every track is
  // already analyzed (which, when idle, disables the button).
  analysis: { done: number; total: number } | null
  allAnalyzed: boolean
  // Progress of the auto-match sweep (null when idle), whether a Discogs token is set,
  // and how many tracks are still matchable (zero disables the button).
  matching: { done: number; total: number } | null
  hasToken: boolean
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
}

// The window's title-bar toolbar: add files, the per-list actions (select/fill/find,
// the analyze-quality and auto-match sweeps, convert-selected, clear), and the
// always-present palette/stats/settings. App owns the state and hands every action down.
// Memoized for the same contract as the Editor: App hands it stable handlers, so a
// keystroke in a metadata field no longer re-renders the whole toolbar.
export const Toolbar = memo(function Toolbar({
  isMac,
  hintFor,
  trackCount,
  convertibleCount,
  canConvertAll,
  onConvertAll,
  importing,
  batchSummary,
  batching,
  batchProgress,
  analysis,
  allAnalyzed,
  matching,
  hasToken,
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
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] pr-3 pl-20"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {trackCount > 1 ? (
        // Converting the list is the app's whole point, and it used to have no button at
        // all — only a shortcut and a palette entry, while the toolbar carried the two
        // sweeps that merely PREPARE that work. It leads the header for the same reason it
        // reads left to right: what you do, what prepares it, the command, the app.
        // Labelled rather than a bare glyph: it rewrites many files at once, and an icon
        // alone would be a button that doesn't say what it touches.
        <div
          className="ml-3 inline-flex items-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            data-testid="convert-all"
            onClick={batching ? onCancelBatch : onConvertAll}
            disabled={!batching && !canConvertAll}
            aria-label={
              batching
                ? tr('header.cancelConvert')
                : tr('header.convertAll', { count: convertibleCount })
            }
            className={`press group relative flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-[var(--color-panel-2)] disabled:opacity-40 ${
              batching
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-[var(--color-line-strong)] text-fg'
            }`}
          >
            {batching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {/* The digits alone are silent to a screen reader, and the button's own
                    name is the cancel action — so the count needs its own status region. */}
                <span
                  role="status"
                  aria-label={tr('header.convertingCount', {
                    done: batchProgress.done,
                    total: batchProgress.total,
                  })}
                  className="tabular-nums"
                >
                  {tr('header.convertingCount', {
                    done: batchProgress.done,
                    total: batchProgress.total,
                  })}
                </span>
              </>
            ) : (
              <>
                <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
                {tr('header.convertAll', { count: convertibleCount })}
              </>
            )}
            <Tooltip
              label={
                batching
                  ? tr('header.cancelConvert')
                  : tr('header.convertAll', { count: convertibleCount })
              }
              hint={batching ? undefined : hintFor('process-all')}
            />
          </button>
        </div>
      ) : (
        <div />
      )}
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
              batchSummary.failed > 0 && tr('header.batchFailed', { count: batchSummary.failed }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
        {importing && (
          // A live pill matching the auto-match/analyze sweeps (accent ring, spinning
          // glyph, done/total), so a big drop reads as active work rather than a static
          // line — and clicking it cancels, like the batch pill beside it. This was the
          // one sweep with no way out: a folder dropped by mistake had to be waited out.
          <button
            type="button"
            data-testid="import-progress"
            onClick={onCancelImport}
            aria-label={tr('header.cancelImport')}
            className="press group relative flex h-8 items-center gap-1.5 rounded-lg border border-[var(--color-accent)] px-2.5 text-xs font-medium tabular-nums text-[var(--color-accent)] hover:bg-[var(--color-panel-2)]"
          >
            {/* FilePlus, not the shared Loader2: mid-conversion, a dropped folder painted
                two identical spinning capsules. The other sweeps identify themselves by
                glyph already; this is the import's, echoing the Add files button it
                follows from. */}
            <FilePlus className="h-4 w-4" aria-hidden="true" />
            {/* A status region like the batch pill's: the visible counter alone is silent
                to a screen reader, and the button's own name is the cancel action. */}
            <span
              role="status"
              aria-label={tr('header.importingCount', {
                done: importing.done,
                total: importing.total,
              })}
            >
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
              disabled={!matching && !needsToken && (!hasToken || autoMatchable === 0)}
              aria-label={needsToken ? tr('header.autoMatchNoToken') : tr('header.autoMatch')}
              className={`press group relative flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 hover:bg-[var(--color-panel-2)] disabled:opacity-40 ${
                matching
                  ? 'min-w-[3.25rem] border border-[var(--color-accent)] text-[var(--color-accent)]'
                  : needsToken
                    ? 'border border-[var(--color-warn)] px-2.5 text-xs font-medium text-[var(--color-warn)]'
                    : 'w-8 text-fg-muted hover:text-fg'
              }`}
            >
              <Sparkles
                className={`h-4 w-4 ${matching ? 'animate-pulse' : ''}`}
                aria-hidden="true"
              />
              {matching && (
                <span
                  data-testid="auto-match-progress"
                  role="status"
                  aria-label={tr('header.autoMatchingCount', {
                    done: matching.done,
                    total: matching.total,
                  })}
                  className="text-xs tabular-nums"
                >
                  {matching.done}/{matching.total}
                </span>
              )}
              {/* Auto-match on, token missing: name the gap inline so it reads without a
                  hover — the tooltip alone was the invisible dead end this fixes. */}
              {!matching && needsToken && <span>{tr('header.addToken')}</span>}
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
              aria-label={tr('header.analyzeQuality')}
              className={`press group relative flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 hover:bg-[var(--color-panel-2)] disabled:opacity-40 ${
                analysis
                  ? 'min-w-[3.25rem] border border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'w-8 text-fg-muted hover:text-fg'
              }`}
            >
              <Activity
                className={`h-4 w-4 ${analysis ? 'animate-pulse' : ''}`}
                aria-hidden="true"
              />
              {analysis && (
                <span
                  data-testid="analyze-progress"
                  role="status"
                  aria-label={tr('header.analyzingCount', {
                    done: analysis.done,
                    total: analysis.total,
                  })}
                  className="text-xs tabular-nums"
                >
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
        <div aria-hidden="true" className="mx-1 h-5 w-px self-center bg-[var(--color-line)]" />
        <button
          type="button"
          data-testid="open-palette"
          onClick={onPalette}
          className="press flex h-8 items-center gap-1 rounded-lg px-2.5 text-[11px] font-medium text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
          aria-label={tr('header.palette')}
        >
          <kbd className="font-sans">{isMac ? '⌘' : 'Ctrl'}</kbd>
          <kbd className="font-sans">K</kbd>
        </button>
        {/* Split the command launcher from the app-level views (stats, activity, settings)
            so the header reads as three groups — track actions · command · app — instead
            of one undifferentiated run of icons. */}
        <div aria-hidden="true" className="mx-1 h-5 w-px self-center bg-[var(--color-line)]" />
        <button
          type="button"
          data-testid="open-stats"
          onClick={onStats}
          className="press group relative flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
          aria-label={tr('header.stats')}
        >
          <ChartColumn className="h-4 w-4" aria-hidden="true" />
          <Tooltip label={tr('header.stats')} hint={hintFor('stats')} align="end" />
        </button>
        <button
          type="button"
          data-testid="open-activity"
          onClick={onActivity}
          className="press group relative flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
          aria-label={tr('header.activity')}
        >
          <Radio className="h-4 w-4" aria-hidden="true" />
          {activityRunning && (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-good" />
          )}
          <Tooltip label={tr('header.activity')} align="end" />
        </button>
        <button
          type="button"
          data-testid="open-settings"
          // Call with no args so React's click event can't reach the opener as its tab.
          onClick={() => onSettings()}
          className="press group relative flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
          aria-label={tr('header.settings')}
        >
          <SettingsIcon className="h-4 w-4" aria-hidden="true" />
          <Tooltip label={tr('header.settings')} hint={hintFor('settings')} align="end" />
        </button>
      </div>
    </header>
  )
})
