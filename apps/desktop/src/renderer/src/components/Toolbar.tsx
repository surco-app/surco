import {
  Activity,
  ChartColumn,
  Loader2,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  SquareCheckBig,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react'
import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { BatchSummary } from '../lib/batch'
import { Tooltip } from './Tooltip'

interface Props {
  isMac: boolean
  trackCount: number
  // Metadata-read progress of an in-flight import (null when idle), shown as a "212/319"
  // counter beside "Add files" so a big drop isn't an opaque wait.
  importing: { done: number; total: number } | null
  batchSummary: BatchSummary | null
  batching: boolean
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
  selectedEligibleCount: number
  onAdd: () => void
  onSelectAll: () => void
  onFillAll: () => void
  onFindReplace: () => void
  onAnalyzeAll: () => void
  onCancelAnalyze: () => void
  onAutoMatch: () => void
  onCancelAutoMatch: () => void
  onConvertSelected: () => void
  onCancelConvert: () => void
  onExport: () => void
  onClearAll: () => void
  onPalette: () => void
  onStats: () => void
  onSettings: () => void
}

// The window's title-bar toolbar: add files, the per-list actions (select/fill/find,
// the analyze-quality and auto-match sweeps, convert-selected, export, clear), and the
// always-present palette/stats/settings. App owns the state and hands every action down.
// Memoized for the same contract as the Editor: App hands it stable handlers, so a
// keystroke in a metadata field no longer re-renders the whole toolbar.
export const Toolbar = memo(function Toolbar({
  isMac,
  trackCount,
  importing,
  batchSummary,
  batching,
  batchProgress,
  analysis,
  allAnalyzed,
  matching,
  hasToken,
  autoMatchable,
  selectedEligibleCount,
  onAdd,
  onSelectAll,
  onFillAll,
  onFindReplace,
  onAnalyzeAll,
  onCancelAnalyze,
  onAutoMatch,
  onCancelAutoMatch,
  onConvertSelected,
  onCancelConvert,
  onExport,
  onClearAll,
  onPalette,
  onStats,
  onSettings,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] pr-3 pl-20"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div />
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
            {importing.done}/{importing.total}
            <Tooltip
              label={tr('header.importingCount', { done: importing.done, total: importing.total })}
            />
          </span>
        )}
        <button
          type="button"
          data-testid="add-files"
          onClick={onAdd}
          className="press flex h-8 items-center rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3.5 text-sm font-medium hover:bg-[var(--color-line-strong)]"
        >
          {tr('header.add')}
        </button>
        {trackCount > 0 && (
          <>
            <div aria-hidden="true" className="mx-1 h-5 w-px self-center bg-[var(--color-line)]" />
            <button
              type="button"
              data-testid="select-all"
              onClick={onSelectAll}
              aria-label={tr('header.selectAll')}
              className="press group relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
            >
              <SquareCheckBig className="h-4 w-4" aria-hidden="true" />
              <Tooltip label={tr('header.selectAll')} align="end" />
            </button>
            <button
              type="button"
              data-testid="fill-all"
              onClick={onFillAll}
              aria-label={tr('header.fillFromName')}
              className="press group relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
            >
              <Tag className="h-4 w-4" aria-hidden="true" />
              <Tooltip label={tr('header.fillFromName')} align="end" />
            </button>
            <button
              type="button"
              data-testid="open-find-replace"
              onClick={onFindReplace}
              aria-label={tr('commands.findReplace')}
              className="press group relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              <Tooltip label={tr('commands.findReplace')} align="end" />
            </button>
            {/* Auto-match and analyze are the two crate-wide "intelligence" sweeps, so they
                share a group, set apart from the per-tag edit tools before them. */}
            <div aria-hidden="true" className="mx-1 h-5 w-px self-center bg-[var(--color-line)]" />
            <button
              type="button"
              data-testid="auto-match"
              onClick={matching ? onCancelAutoMatch : onAutoMatch}
              disabled={!matching && (!hasToken || autoMatchable === 0)}
              aria-label={tr('header.autoMatch')}
              className={`press group relative flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2 hover:bg-[var(--color-panel-2)] disabled:opacity-40 ${
                matching
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'w-8 border-[var(--color-line)] text-fg-muted hover:text-fg'
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
                align="end"
              />
            </button>
            <button
              type="button"
              data-testid="analyze-quality"
              onClick={analysis ? onCancelAnalyze : onAnalyzeAll}
              disabled={!analysis && allAnalyzed}
              aria-label={tr('header.analyzeQuality')}
              className={`press group relative flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2 hover:bg-[var(--color-panel-2)] disabled:opacity-40 ${
                analysis
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'w-8 border-[var(--color-line)] text-fg-muted hover:text-fg'
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
                align="end"
              />
            </button>
            <div aria-hidden="true" className="mx-1 h-5 w-px self-center bg-[var(--color-line)]" />
            {/* One button, two states: while the batch runs it morphs into the cancel
                action (like the analyze and auto-match buttons above) instead of a
                second button popping in next to it and shifting the toolbar. */}
            <button
              type="button"
              data-testid="convert-selected"
              onClick={batching ? onCancelConvert : onConvertSelected}
              disabled={!batching && selectedEligibleCount === 0}
              className={`press group relative flex h-8 items-center rounded-lg px-3.5 text-sm font-medium ${
                batching
                  ? 'border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] hover:bg-[var(--color-line-strong)]'
                  : 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40'
              }`}
            >
              {batching
                ? `${tr('common.cancel')} (${batchProgress.done}/${batchProgress.total})`
                : `${tr('header.convert')} (${selectedEligibleCount})`}
              {/* Names what this converts — the selected tracks, batch-style — so it reads
                  apart from the editor's own convert button for the open track below. */}
              {!batching && <Tooltip label={tr('header.convertSelectedHint')} align="end" />}
            </button>
            <button
              type="button"
              data-testid="export-open"
              onClick={onExport}
              aria-label={tr('header.export')}
              className="press group relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              <Tooltip label={tr('header.export')} align="end" />
            </button>
            <div aria-hidden="true" className="mx-1 h-5 w-px self-center bg-[var(--color-line)]" />
            <button
              type="button"
              data-testid="clear-all"
              onClick={onClearAll}
              aria-label={tr('header.clearAll')}
              className="press group relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-danger"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <Tooltip label={tr('header.clearAll')} align="end" />
            </button>
          </>
        )}
        <div aria-hidden="true" className="mx-1 h-5 w-px self-center bg-[var(--color-line)]" />
        <button
          type="button"
          data-testid="open-palette"
          onClick={onPalette}
          className="press flex h-8 items-center gap-1 rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-medium text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
          aria-label={tr('header.palette')}
        >
          <kbd className="font-sans">{isMac ? '⌘' : 'Ctrl'}</kbd>
          <kbd className="font-sans">K</kbd>
        </button>
        <button
          type="button"
          data-testid="open-stats"
          onClick={onStats}
          className="press flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
          aria-label={tr('header.stats')}
        >
          <ChartColumn className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="open-settings"
          onClick={onSettings}
          className="press flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
          aria-label={tr('header.settings')}
        >
          <SettingsIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  )
})
