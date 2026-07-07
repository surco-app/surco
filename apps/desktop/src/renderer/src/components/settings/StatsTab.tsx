import { AudioLines, Disc3, FolderDown, Headphones, Heart, Store } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { LifetimeStats, Settings } from '../../../../shared/types'
import { DONATE_URL } from '../../lib/donate'
import {
  formatTimeSaved,
  MANUAL_SECONDS_PER_CONVERSION,
  nextMilestone,
  timeSavedSeconds,
} from '../../lib/stats'

interface Props {
  settings: Settings
}

// One cell per lifetime tally; the label comes from settings.stats.<key> so the
// grid, the i18n files and the persisted Settings shape share the same key names.
const CELLS: { key: keyof LifetimeStats; icon: typeof FolderDown }[] = [
  { key: 'imported', icon: FolderDown },
  { key: 'listened', icon: Headphones },
  { key: 'analyzed', icon: AudioLines },
  { key: 'discogsMatches', icon: Disc3 },
  { key: 'bandcampMatches', icon: Store },
]

export function StatsTab({ settings }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { conversionCount, stats } = settings
  const anyActivity = conversionCount > 0 || CELLS.some(({ key }) => stats[key] > 0)
  const milestone = nextMilestone(conversionCount)
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
      {conversionCount > 0 && (
        <>
          <p data-testid="stats-count" className="text-5xl font-semibold tabular-nums text-fg">
            {conversionCount}
          </p>
          <p className="mt-1 text-sm text-fg-muted">{tr('settings.stats.count')}</p>
          {milestone !== null && (
            <div data-testid="stats-milestone" className="mt-4 w-full max-w-xs">
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
        <div className="mt-5 grid w-full max-w-xl grid-cols-5 gap-1.5">
          {CELLS.map(({ key, icon: Icon }) => (
            <div
              key={key}
              data-testid={`stats-${key}`}
              className="rounded-lg border border-[var(--color-line)] px-1 py-2"
            >
              <Icon size={14} className="mx-auto text-fg-dim" aria-hidden="true" />
              <p className="mt-1 text-lg font-semibold tabular-nums text-fg">{stats[key]}</p>
              <p className="text-[10px] leading-tight text-fg-muted">
                {tr(`settings.stats.${key}`)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p data-testid="stats-empty" className="max-w-xs text-sm text-fg-muted">
          {tr('settings.stats.empty')}
        </p>
      )}
      {conversionCount > 0 && (
        <>
          <p data-testid="stats-time-saved" className="mt-5 text-lg text-fg">
            {tr('settings.stats.timeSaved', {
              time: formatTimeSaved(timeSavedSeconds(conversionCount)),
            })}
          </p>
          <p className="mt-1 text-xs text-fg-dim">
            {tr('settings.stats.perTrack', {
              minutes: MANUAL_SECONDS_PER_CONVERSION / 60,
            })}
          </p>
        </>
      )}
      <p className="mt-5 text-sm text-fg-muted">{tr('settings.stats.donate')}</p>
      <a
        data-testid="stats-donate"
        href={DONATE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="press mt-3 inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
      >
        <Heart size={14} />
        {tr('settings.stats.donateCta')}
      </a>
    </div>
  )
}
