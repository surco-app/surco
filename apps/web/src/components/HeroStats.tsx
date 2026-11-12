import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { Language } from '../i18n'
import { PAGES } from '../lib/nav'
import { installsInLast, type Stats } from '../lib/stats'
import { fetchStats, useFormat } from './Stats'

const SPARK_W = 56
const SPARK_H = 18
const SPARK_DAYS = 60

function Sparkline({ stats }: { stats: Stats }) {
  const days = stats.days.slice(-SPARK_DAYS)
  const min = days[0].mac
  const span = Math.max(days[days.length - 1].mac - min, 1)
  const x = (i: number) => (i / Math.max(days.length - 1, 1)) * (SPARK_W - 2) + 1
  const y = (mac: number) => SPARK_H - 2 - ((mac - min) / span) * (SPARK_H - 4)
  const last = days.length - 1

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      width={SPARK_W}
      height={SPARK_H}
      aria-hidden="true"
      className="flex-none overflow-visible text-blue"
    >
      <polyline
        points={days.map((d, i) => `${x(i)},${y(d.mac)}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={x(last)} cy={y(days[last].mac)} r="2" fill="currentColor" />
    </svg>
  )
}

export function HeroStatsView({ stats }: { stats: Stats }) {
  const { t, i18n } = useTranslation()
  const format = useFormat()
  const latest = stats.days[stats.days.length - 1]
  const week = installsInLast(stats.days, 7)

  return (
    <p className="inline-flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 rounded-full border border-line bg-surface/40 px-3.5 py-1.5 text-[0.8125rem] text-muted">
      <Sparkline stats={stats} />
      <span>
        <Trans
          i18nKey="home.heroStatsTotal"
          values={{ total: format.number(latest.mac + latest.windows + latest.linux) }}
          components={{
            n: <b data-testid="hero-stats-total" className="font-semibold text-fg tabular-nums" />,
          }}
        />
        {week > 0 && (
          <>
            {' · '}
            <Trans
              i18nKey="home.heroStatsWeek"
              values={{ count: `+${format.number(week)}` }}
              components={{
                n: <span data-testid="hero-stats-week" className="text-green tabular-nums" />,
              }}
            />
          </>
        )}
      </span>
      <a
        href={PAGES.stats[i18n.language as Language]}
        data-testid="hero-stats-link"
        className="inline-block py-1.5 -my-1.5 font-medium text-blue transition-colors hover:text-cyan"
      >
        {t('nav.estadisticas')} →
      </a>
    </p>
  )
}

export default function HeroStats() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchStats()
      .then((data) => {
        if (!cancelled && data.days.length > 0) setStats(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      data-testid="hero-stats"
      className="mt-5 flex min-h-14 items-center justify-center min-[27.5rem]:min-h-8"
    >
      {stats && <HeroStatsView stats={stats} />}
    </div>
  )
}
