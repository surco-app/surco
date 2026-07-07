import { Heart } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { Settings } from '../../../../shared/types'
import { DONATE_URL } from '../../lib/donate'
import { formatTimeSaved, MANUAL_SECONDS_PER_CONVERSION, timeSavedSeconds } from '../../lib/stats'

interface Props {
  settings: Settings
}

export function StatsTab({ settings }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
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
