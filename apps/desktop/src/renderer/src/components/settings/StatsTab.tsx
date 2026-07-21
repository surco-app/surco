import { AudioLines, Disc3, FolderDown, Headphones, Heart, Share, Store } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../lib/toastContext'
import type { LifetimeStats, Settings } from '../../../../shared/types'
import { DONATE_URL } from '../../lib/donate'
import {
  formatTimeSaved,
  MANUAL_SECONDS_PER_CONVERSION,
  nextMilestone,
  timeSavedSeconds,
} from '../../lib/stats'
import { renderStatsImage, statsImageCells } from '../../lib/statsImage'

interface Props {
  settings: Settings
}

// The "what Surco did for me" tallies, one tile each; the label comes from
// settings.stats.<key> so the grid, the i18n files and the persisted Settings shape share
// the same key names. The two match counts live apart in the source split below, since
// together they read as one proportion, not two more equal boxes.
const ACTIVITY_CELLS: { key: keyof LifetimeStats; icon: typeof FolderDown }[] = [
  { key: 'imported', icon: FolderDown },
  { key: 'listened', icon: Headphones },
  { key: 'analyzed', icon: AudioLines },
]

// The whole activity tally set, still the one source of truth for "has anything happened"
// and for the share card's cells.
const CELLS: { key: keyof LifetimeStats; icon: typeof FolderDown }[] = [
  ...ACTIVITY_CELLS,
  { key: 'discogsMatches', icon: Disc3 },
  { key: 'bandcampMatches', icon: Store },
]

// Discogs vs Bandcamp as a share of all matches found — one bar, sized to each source's
// slice, with the raw counts beside their swatches. When no match has landed yet the bar
// stays flat and empty rather than dividing by zero.
function MatchSplit({
  discogs,
  bandcamp,
  heading,
  discogsLabel,
  bandcampLabel,
}: {
  discogs: number
  bandcamp: number
  heading: string
  discogsLabel: string
  bandcampLabel: string
}): React.JSX.Element {
  const total = discogs + bandcamp
  const discogsPct = total > 0 ? (discogs / total) * 100 : 0
  return (
    <div
      data-testid="stats-match-split"
      className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-2)] px-4 py-3 text-left"
    >
      <p className="text-xs font-medium text-fg-muted">{heading}</p>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[var(--color-field)]">
        <div
          data-testid="stats-match-discogs"
          className="h-full bg-[var(--color-accent)]"
          style={{ width: `${discogsPct}%` }}
        />
        <div className="h-full flex-1 bg-[var(--color-fg-dim)]/70" />
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <span className="inline-flex items-center gap-1.5 text-fg-muted">
          <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" aria-hidden="true" />
          {discogsLabel}
          <span data-testid="stats-discogsMatches" className="font-semibold tabular-nums text-fg">
            {discogs}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-fg-muted">
          <span
            className="h-2 w-2 rounded-full bg-[var(--color-fg-dim)]/70"
            aria-hidden="true"
          />
          {bandcampLabel}
          <span data-testid="stats-bandcampMatches" className="font-semibold tabular-nums text-fg">
            {bandcamp}
          </span>
        </span>
      </div>
    </div>
  )
}

export function StatsTab({ settings }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { reportError } = useToast()
  const { conversionCount, stats } = settings
  const anyActivity = conversionCount > 0 || CELLS.some(({ key }) => stats[key] > 0)
  const milestone = nextMilestone(conversionCount)
  // Composes the story-sized share card (an Instagram-ready PNG of these same numbers)
  // and hands it to the save dialog. Guarded against double-clicks while composing.
  const [sharing, setSharing] = useState(false)
  const shareImage = async (): Promise<void> => {
    if (sharing) return
    setSharing(true)
    try {
      const png = renderStatsImage({
        title: tr('settings.stats.shareTitle'),
        conversionCount,
        countLabel: tr('settings.stats.count'),
        milestoneLabel:
          milestone !== null
            ? tr('settings.stats.milestone', { milestone, remaining: milestone - conversionCount })
            : null,
        milestoneFraction: milestone !== null ? conversionCount / milestone : null,
        cells: statsImageCells(stats).map(({ key, value }) => ({
          value,
          label: tr(`settings.stats.${key}`),
        })),
        timeSaved:
          conversionCount > 0
            ? tr('settings.stats.timeSaved', {
                time: formatTimeSaved(timeSavedSeconds(conversionCount)),
              })
            : null,
        perTrack:
          conversionCount > 0
            ? tr('settings.stats.perTrack', { minutes: MANUAL_SECONDS_PER_CONVERSION / 60 })
            : null,
        footer: tr('settings.stats.shareFooter'),
      })
      await window.api.exportStatsImage(png)
    } catch (err) {
      // Composition only draws numbers already on screen, but the save still crosses IPC to
      // write a file — permissions, a full disk, a bad path. The user pressed Share and saw
      // the spinner finish; silence here reads as "it worked" with no image to show for it.
      console.error('stats image failed', err)
      reportError(tr('errors.statsImage'))
    } finally {
      setSharing(false)
    }
  }
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
      {conversionCount > 0 && (
        <>
          <p data-testid="stats-count" className="text-4xl font-semibold tabular-nums text-fg">
            {conversionCount}
          </p>
          <p className="mt-0.5 text-sm text-fg-muted">{tr('settings.stats.count')}</p>
          {milestone !== null && (
            <div data-testid="stats-milestone" className="mt-3 w-full max-w-xs">
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-field)]">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)]"
                  style={{ width: `${Math.min(100, (conversionCount / milestone) * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-fg-dim">
                {tr('settings.stats.milestone', {
                  milestone,
                  remaining: milestone - conversionCount,
                })}
              </p>
            </div>
          )}
        </>
      )}
      {anyActivity ? (
        <div className="mt-4 flex w-full max-w-xl flex-col gap-3">
          {/* The three "what Surco did" tallies read as equals; the number leads, the
              label sits under it. */}
          <div className="grid grid-cols-3 gap-2">
            {ACTIVITY_CELLS.map(({ key, icon: Icon }) => (
              <div
                key={key}
                data-testid={`stats-${key}`}
                className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-3"
              >
                <Icon size={15} className="mx-auto text-fg-dim" aria-hidden="true" />
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-fg">{stats[key]}</p>
                <p className="mt-0.5 text-xs leading-tight text-fg-muted">
                  {tr(`settings.stats.${key}`)}
                </p>
              </div>
            ))}
          </div>
          <MatchSplit
            discogs={stats.discogsMatches}
            bandcamp={stats.bandcampMatches}
            heading={tr('settings.stats.matchSources')}
            discogsLabel={tr('settings.stats.discogsMatches')}
            bandcampLabel={tr('settings.stats.bandcampMatches')}
          />
        </div>
      ) : (
        <p data-testid="stats-empty" className="max-w-xs text-sm text-fg-muted">
          {tr('settings.stats.empty')}
        </p>
      )}
      {conversionCount > 0 && (
        <p data-testid="stats-time-saved" className="mt-3 text-sm text-fg">
          {tr('settings.stats.timeSaved', {
            time: formatTimeSaved(timeSavedSeconds(conversionCount)),
          })}
          <span className="text-fg-dim">
            {' '}
            (
            {tr('settings.stats.perTrack', {
              minutes: MANUAL_SECONDS_PER_CONVERSION / 60,
            })}
            )
          </span>
        </p>
      )}

      <p
        data-testid="stats-roi-donate"
        className="mt-4 w-full max-w-md border-t border-[var(--color-line)] pt-4 text-xs text-fg-muted"
      >
        {tr('settings.stats.roiDonate')}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <a
          data-testid="stats-donate"
          href={DONATE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="press inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
        >
          <Heart size={14} />
          {tr('settings.stats.donateCta')}
        </a>
        {anyActivity && (
          <button
            type="button"
            data-testid="stats-share"
            onClick={() => void shareImage()}
            disabled={sharing}
            className="press inline-flex items-center gap-2 rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-panel-2)] disabled:opacity-60"
          >
            <Share size={14} aria-hidden="true" />
            {tr('settings.stats.share')}
          </button>
        )}
      </div>
    </div>
  )
}
