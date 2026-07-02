import { Heart } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { Settings } from '../../../../shared/types'
import { DONATE_URL } from '../../lib/donate'
import { formatTimeSaved, MANUAL_SECONDS_PER_CONVERSION, timeSavedSeconds } from '../../lib/stats'

// The current list's cleanup progress, tallied by App from the same view the filter
// chips read, so the two never disagree on a count.
export interface ListStats {
  total: number
  analyzed: number
  suspect: number
  converted: number
  duplicates: number
  formats: { format: string; count: number }[]
}

interface Props {
  settings: Settings
  listStats: ListStats
}

export function StatsTab({ settings, listStats }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
      {listStats.total > 0 && (
        <div
          data-testid="stats-list"
          className="mb-8 w-full max-w-xs rounded-lg border border-[var(--color-line)] px-4 py-3 text-left"
        >
          <p className="text-xs font-medium text-fg-muted">
            {tr('settings.stats.listTitle', { count: listStats.total })}
          </p>
          <dl className="mt-2 space-y-1 text-xs text-fg-dim">
            <div className="flex justify-between">
              <dt>{tr('settings.stats.listAnalyzed')}</dt>
              <dd data-testid="stats-list-analyzed" className="tabular-nums text-fg">
                {listStats.analyzed}/{listStats.total}
              </dd>
            </div>
            {listStats.suspect > 0 && (
              <div className="flex justify-between">
                <dt>{tr('settings.stats.listSuspect')}</dt>
                <dd data-testid="stats-list-suspect" className="tabular-nums text-warn">
                  {listStats.suspect}
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>{tr('settings.stats.listConverted')}</dt>
              <dd data-testid="stats-list-converted" className="tabular-nums text-fg">
                {listStats.converted}/{listStats.total}
              </dd>
            </div>
            {listStats.duplicates > 0 && (
              <div className="flex justify-between">
                <dt>{tr('settings.stats.listDuplicates')}</dt>
                <dd data-testid="stats-list-duplicates" className="tabular-nums text-fg">
                  {listStats.duplicates}
                </dd>
              </div>
            )}
            {listStats.formats.length > 0 && (
              <div className="flex justify-between">
                <dt>{tr('settings.stats.listFormats')}</dt>
                <dd data-testid="stats-list-formats" className="tabular-nums text-fg">
                  {listStats.formats.map((f) => `${f.format} ${f.count}`).join(' · ')}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {settings.conversionCount > 0 ? (
        <>
          <p data-testid="stats-count" className="text-6xl font-semibold tabular-nums text-fg">
            {settings.conversionCount}
          </p>
          <p className="mt-1 text-sm text-fg-muted">{tr('settings.stats.count')}</p>
          <p data-testid="stats-time-saved" className="mt-7 text-lg text-fg">
            {tr('settings.stats.timeSaved', {
              time: formatTimeSaved(timeSavedSeconds(settings.conversionCount)),
            })}
          </p>
          <p className="mt-1 text-xs text-fg-dim">
            {tr('settings.stats.perTrack', {
              minutes: MANUAL_SECONDS_PER_CONVERSION / 60,
            })}
          </p>
        </>
      ) : (
        <p data-testid="stats-empty" className="max-w-xs text-sm text-fg-muted">
          {tr('settings.stats.empty')}
        </p>
      )}
      <p className="mt-8 text-sm text-fg-muted">{tr('settings.stats.donate')}</p>
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
