import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type Day,
  installsInLast,
  lastTwelveMonths,
  type Stats,
  weeklyMacInstalls,
} from '../lib/stats'
import Footer from './Footer'
import Header from './Header'
import Kicker from './Kicker'
import Reveal from './Reveal'
import ScrollProgress from './ScrollProgress'

// Written once a day by .github/workflows/stats.yml on its own branch, so the page reads
// fresh figures without a redeploy.
const STATS_URL = 'https://raw.githubusercontent.com/surco-app/surco-releases/stats/stats.json'

const W = 720
const LEFT = 52
const RIGHT = 12
const TOP = 12
const BOTTOM = 36

function niceMax(value: number): number {
  const step = 10 ** Math.floor(Math.log10(Math.max(value, 1)))
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((n) => n * 4 >= value) ?? step * 10
  return nice * 4
}

const ticks = (max: number) => [0, 1, 2, 3, 4].map((i) => (max / 4) * i)

function useFormat() {
  const { i18n } = useTranslation()
  const lang = i18n.language
  const number = new Intl.NumberFormat(lang, {
    useGrouping: 'always',
  } as unknown as Intl.NumberFormatOptions)
  return {
    number: (n: number) => number.format(n),
    month: (date: string) =>
      new Date(date).toLocaleDateString(lang, { month: 'short', timeZone: 'UTC' }),
    day: (date: string) =>
      new Date(date).toLocaleDateString(lang, { day: 'numeric', month: 'long', timeZone: 'UTC' }),
  }
}

function monthStarts(from: string, to: string): string[] {
  const starts: string[] = []
  const d = new Date(from)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + 1)
  while (d.toISOString().slice(0, 10) <= to) {
    starts.push(d.toISOString().slice(0, 10))
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return starts
}

function CumulativeChart({ days }: { days: Day[] }) {
  const { t } = useTranslation()
  const format = useFormat()
  const H = 260
  const first = Date.parse(days[0].date)
  const span = Math.max(Date.parse(days[days.length - 1].date) - first, 1)
  const max = niceMax(days[days.length - 1].mac)
  const x = (date: string) => LEFT + ((Date.parse(date) - first) / span) * (W - LEFT - RIGHT)
  const y = (v: number) => TOP + (1 - v / max) * (H - TOP - BOTTOM)
  const points = (list: Day[]) => list.map((d) => `${x(d.date)},${y(d.mac)}`).join(' ')
  const split = days.findIndex((d) => !d.estimated)
  const estimated = split === -1 ? days : days.slice(0, split + 1)
  const measured = split === -1 ? [] : days.slice(split)
  const last = days[days.length - 1]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full overflow-visible"
      role="img"
      aria-label={t('stats.chartLabel')}
    >
      {ticks(max).map((v) => (
        <g key={v}>
          <line x1={LEFT} x2={W - RIGHT} y1={y(v)} y2={y(v)} className="stroke-line" />
          <text
            x={LEFT - 8}
            y={y(v) + 4}
            textAnchor="end"
            className="fill-faint font-mono text-[22px] sm:text-[11px]"
          >
            {format.number(v)}
          </text>
        </g>
      ))}
      {monthStarts(days[0].date, last.date).map((m) => (
        <text
          key={m}
          x={x(m)}
          y={H - 6}
          textAnchor="middle"
          className="fill-faint font-mono text-[22px] sm:text-[11px]"
        >
          {format.month(m)}
        </text>
      ))}
      <polygon
        points={`${x(days[0].date)},${y(0)} ${points(days)} ${x(last.date)},${y(0)}`}
        className="fill-blue opacity-15"
      />
      <polyline
        points={points(estimated)}
        fill="none"
        strokeWidth={2}
        strokeDasharray="5 4"
        strokeLinejoin="round"
        className="stroke-blue"
      />
      {measured.length > 1 && (
        <polyline
          points={points(measured)}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          className="stroke-blue"
        />
      )}
      <circle cx={x(last.date)} cy={y(last.mac)} r={4} className="fill-blue" />
    </svg>
  )
}

function WeeklyChart({ days }: { days: Day[] }) {
  const { t } = useTranslation()
  const format = useFormat()
  const H = 180
  const weeks = weeklyMacInstalls(days)
  const max = niceMax(Math.max(...weeks.map((w) => w.count)))
  const band = (W - LEFT - RIGHT) / weeks.length
  const y = (v: number) => TOP + (1 - v / max) * (H - TOP - BOTTOM)
  const firstOfMonth = weeks.filter(
    (w, i) => i === 0 || w.week.slice(0, 7) !== weeks[i - 1].week.slice(0, 7),
  )

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full overflow-visible"
      role="img"
      aria-label={t('stats.weeklyHeading')}
    >
      {ticks(max).map((v) => (
        <g key={v}>
          <line x1={LEFT} x2={W - RIGHT} y1={y(v)} y2={y(v)} className="stroke-line" />
          <text
            x={LEFT - 8}
            y={y(v) + 4}
            textAnchor="end"
            className="fill-faint font-mono text-[22px] sm:text-[11px]"
          >
            {format.number(v)}
          </text>
        </g>
      ))}
      {weeks.map((w, i) => (
        <rect
          key={w.week}
          x={LEFT + i * band + band * 0.15}
          y={y(w.count)}
          width={band * 0.7}
          height={y(0) - y(w.count)}
          rx={2}
          className="fill-blue"
        >
          <title>{format.number(w.count)}</title>
        </rect>
      ))}
      {firstOfMonth.map((w) => (
        <text
          key={w.week}
          x={LEFT + weeks.indexOf(w) * band + band / 2}
          y={H - 6}
          textAnchor="middle"
          className="fill-faint font-mono text-[22px] sm:text-[11px]"
        >
          {format.month(w.week)}
        </text>
      ))}
    </svg>
  )
}

function Figure({ value, label, testid }: { value: string; label: string; testid: string }) {
  return (
    <div className="grid gap-0.5 border-t border-line pt-3">
      <span data-testid={testid} className="text-2xl font-semibold tabular-nums">
        {value}
      </span>
      <span className="text-sm text-muted">{label}</span>
    </div>
  )
}

export function StatsView({ stats }: { stats: Stats }) {
  const { t } = useTranslation()
  const format = useFormat()
  const days = stats.days
  const latest = days[days.length - 1]
  const measuredSince = days.find((d) => !d.estimated)?.date ?? latest.date
  const maxUpdates = Math.max(...stats.macUpdates.map((u) => u.count), 1)

  return (
    <>
      <section className="py-10" data-testid="stats-totals">
        <Reveal eager>
          <p className="text-6xl font-semibold tracking-tight tabular-nums sm:text-7xl">
            <span data-testid="stats-total">
              {format.number(latest.mac + latest.windows + latest.linux)}
            </span>
          </p>
          <p className="mt-3 text-muted">{t('stats.total', { date: format.day(days[0].date) })}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Figure value={format.number(latest.mac)} label={t('stats.mac')} testid="stats-mac" />
            <Figure
              value={format.number(latest.windows)}
              label={t('stats.windows')}
              testid="stats-windows"
            />
            <Figure
              value={format.number(latest.linux)}
              label={t('stats.linux')}
              testid="stats-linux"
            />
          </div>
        </Reveal>
      </section>

      <section className="py-12" data-testid="stats-mac-installs">
        <Reveal>
          <Kicker>{t('stats.macHeading')}</Kicker>
          <p className="mt-4 leading-relaxed text-muted">{t('stats.macLede')}</p>
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-sm text-muted">
            <span>
              <b className="text-xl font-semibold text-fg tabular-nums">
                +{format.number(installsInLast(days, 7))}
              </b>{' '}
              {t('stats.lastWeek')}
            </span>
            <span>
              <b className="text-xl font-semibold text-fg tabular-nums">
                +{format.number(installsInLast(days, 30))}
              </b>{' '}
              {t('stats.lastMonth')}
            </span>
          </div>
          <div className="mt-8">
            <CumulativeChart days={lastTwelveMonths(days)} />
          </div>
          <p className="mt-3 text-xs text-faint">{t('stats.estimatedLegend')}</p>
        </Reveal>
      </section>

      <section className="py-12" data-testid="stats-weekly">
        <Reveal>
          <Kicker>{t('stats.weeklyHeading')}</Kicker>
          <div className="mt-8">
            <WeeklyChart days={days} />
          </div>
        </Reveal>
      </section>

      <section className="py-12" data-testid="stats-updates">
        <Reveal>
          <Kicker>{t('stats.updatesHeading')}</Kicker>
          <p className="mt-4 leading-relaxed text-muted">{t('stats.updatesLede')}</p>
          <ul className="mt-6 grid gap-2.5">
            {stats.macUpdates.map((u) => (
              <li
                key={u.version}
                className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm"
              >
                <span className="font-mono text-[0.8125rem]">{u.version}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-line">
                  <span
                    className="block h-full rounded-full bg-blue"
                    style={{ width: `${(u.count / maxUpdates) * 100}%` }}
                  />
                </span>
                <span className="text-right text-muted tabular-nums">{format.number(u.count)}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      <section className="py-12" data-testid="stats-how">
        <Reveal>
          <Kicker>{t('stats.howHeading')}</Kicker>
          <ul className="mt-5 space-y-3">
            {(t('stats.howItems', { returnObjects: true }) as string[]).map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-relaxed text-muted">
                <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-blue" />
                <span>{item}</span>
              </li>
            ))}
            <li className="flex gap-3 text-sm leading-relaxed text-muted">
              <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-blue" />
              <span data-testid="stats-measured-since">
                {t('stats.measuredSince', { date: format.day(measuredSince) })}
              </span>
            </li>
          </ul>
        </Reveal>
      </section>
    </>
  )
}

export default function StatsPage() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<Stats | null | 'error'>(null)

  useEffect(() => {
    let cancelled = false
    fetch(STATS_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
        return res.json() as Promise<Stats>
      })
      .then((data) => {
        if (!cancelled) setStats(data.days.length > 0 ? data : 'error')
      })
      .catch(() => {
        if (!cancelled) setStats('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-bg text-fg antialiased">
      <ScrollProgress />

      <Header page="stats" />

      <main id="main" className="relative mx-auto max-w-3xl px-6 sm:px-10">
        <section className="pt-12 sm:pt-16">
          <Reveal eager>
            <Kicker>{t('stats.kicker')}</Kicker>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-5xl">
              {t('stats.title')}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{t('stats.lede')}</p>
          </Reveal>
        </section>

        {stats === null && (
          <p data-testid="stats-loading" className="py-16 text-muted">
            {t('stats.loading')}
          </p>
        )}
        {stats === 'error' && (
          <p data-testid="stats-error" className="py-16 text-muted">
            {t('stats.error')}
          </p>
        )}
        {stats !== null && stats !== 'error' && <StatsView stats={stats} />}
      </main>

      <Footer />
    </div>
  )
}
