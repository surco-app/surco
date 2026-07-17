import {
  Activity,
  ChartColumn,
  Columns3,
  Disc3,
  Loader2,
  Radio,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { BatchSummary } from '../lib/batch'
import { FOCUS_PRESETS, type FocusPresetId } from '../lib/focusPreset'
import { Tooltip } from './Tooltip'

// The glyph for each focus preset, in the same order FOCUS_PRESETS lists them: a record
// for "find the release", three even columns for balanced, the audio sliders for "edit".
const PRESET_ICONS: Record<FocusPresetId, typeof Disc3> = {
  match: Disc3,
  balanced: Columns3,
  edit: SlidersHorizontal,
}

interface Props {
  isMac: boolean
  // Formats a command's bound chord (e.g. "⌘⇧D") for the button tooltips, so a sweep's
  // shortcut is discoverable on hover. Passed in (rather than computed here) to keep the
  // binding table in App the single source of truth.
  hintFor: (id: string) => string
  trackCount: number
  // The focus preset whose column widths currently match (null when a drag has moved them
  // between presets, so no segment is lit), and the handler that reparks both columns.
  focusPreset: FocusPresetId | null
  onFocusPreset: (id: FocusPresetId) => void
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
  autoMatchable: number
  onAnalyzeAll: () => void
  onCancelAnalyze: () => void
  onAutoMatch: () => void
  onCancelAutoMatch: () => void
  // Stops the running batch between tracks: queued conversions bail as skipped, the
  // ones already in ffmpeg finish.
  onCancelBatch: () => void
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
  focusPreset,
  onFocusPreset,
  importing,
  batchSummary,
  batching,
  batchProgress,
  analysis,
  allAnalyzed,
  matching,
  hasToken,
  autoMatchable,
  onAnalyzeAll,
  onCancelAnalyze,
  onAutoMatch,
  onCancelAutoMatch,
  onCancelBatch,
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
      {trackCount > 0 ? (
        // Focus presets: repark the results column for the task at hand (find a match /
        // balanced / edit) in one click. The divider still fine-tunes; dragging off a
        // preset clears its highlight (focusPreset goes null). Hidden with no tracks, since
        // there's no results or editor column to focus yet. Each button carries its own
        // aria-label/aria-pressed, matching SegmentedControl's plain-div grouping.
        <div
          data-testid="focus-presets"
          className="inline-flex items-center gap-0.5 rounded-lg bg-[var(--color-field)] p-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {FOCUS_PRESETS.map(({ id }) => {
            const Icon = PRESET_ICONS[id]
            const active = focusPreset === id
            return (
              <button
                key={id}
                type="button"
                data-testid={`focus-preset-${id}`}
                aria-pressed={active}
                onClick={() => onFocusPreset(id)}
                aria-label={tr(`header.focus.${id}`)}
                className={`press group relative flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  active ? 'bg-[var(--color-panel-2)] text-fg' : 'text-fg-muted hover:text-fg'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <Tooltip label={tr(`header.focus.${id}`)} />
              </button>
            )
          })}
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
              tr('header.batchConverted', { count: batchSummary.converted }),
              batchSummary.skipped > 0 &&
                tr('header.batchSkipped', { count: batchSummary.skipped }),
              batchSummary.failed > 0 && tr('header.batchFailed', { count: batchSummary.failed }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
        {batching && (
          // The running batch's pill: same accent ring and inline phase text as the
          // import pill (a generic loader can't identify its sweep by icon alone), but
          // clickable — like the sweep buttons, the control that shows the run is the
          // one that cancels it, so a misfired Convert all can be stopped right here.
          <button
            type="button"
            data-testid="batch-progress"
            onClick={onCancelBatch}
            aria-label={tr('header.cancelConvert')}
            className="press group relative flex h-8 items-center gap-1.5 rounded-lg border border-[var(--color-accent)] px-2.5 text-xs font-medium tabular-nums text-[var(--color-accent)] hover:bg-[var(--color-panel-2)]"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {tr('header.convertingCount', {
              done: batchProgress.done,
              total: batchProgress.total,
            })}
            <Tooltip label={tr('header.cancelConvert')} align="end" />
          </button>
        )}
        {importing && (
          // A live pill matching the auto-match/analyze sweeps (accent ring, spinning
          // glyph, done/total), so a big drop reads as active work rather than a static line.
          <span
            data-testid="import-progress"
            role="status"
            aria-label={tr('header.importingCount', {
              done: importing.done,
              total: importing.total,
            })}
            className="group relative flex h-8 items-center gap-1.5 rounded-lg border border-[var(--color-accent)] px-2.5 text-xs font-medium tabular-nums text-[var(--color-accent)]"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {/* The spinner alone doesn't say which sweep this is (the sparkles/activity
                buttons identify themselves by icon, but a generic loader can't), so the import
                pill names its phase inline rather than hiding it in a hover tooltip. */}
            {tr('header.importingCount', { done: importing.done, total: importing.total })}
          </span>
        )}
        {trackCount > 0 && (
          <>
            {/* Auto-match and analyze are the two crate-wide "intelligence" sweeps. Add files
                and the per-list edit tools (select/fill/find/clear) now live in the list's own
                header, so the toolbar keeps only crate-wide sweeps and global actions. */}
            <button
              type="button"
              data-testid="auto-match"
              onClick={matching ? onCancelAutoMatch : onAutoMatch}
              disabled={!matching && (!hasToken || autoMatchable === 0)}
              aria-label={tr('header.autoMatch')}
              className={`press group relative flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 hover:bg-[var(--color-panel-2)] disabled:opacity-40 ${
                matching
                  ? 'min-w-[3.25rem] border border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'w-8 text-fg-muted hover:text-fg'
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
              <Tooltip
                label={
                  matching
                    ? tr('header.autoMatchingCount', { done: matching.done, total: matching.total })
                    : !hasToken
                      ? tr('header.autoMatchNoToken')
                      : tr('header.autoMatch')
                }
                hint={matching ? undefined : hintFor('auto-match')}
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
