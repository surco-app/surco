import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchAllReleases } from '../lib/downloads'
import {
  installsInLast,
  recordSnapshot,
  type Stats,
  type StatsRelease,
  type Week,
  weeklyInstalls,
} from '../lib/stats'
import Footer from './Footer'
import Header from './Header'
import Kicker from './Kicker'
import Reveal from './Reveal'

// Written by .github/workflows/stats.yml on its own branch, so the page reads the history
// without a redeploy. GitHub runs that hourly schedule only every 4 to 11 hours.
const STATS_URL = 'https://raw.githubusercontent.com/surco-app/surco-releases/stats/stats.json'
const RELEASES_REPO = 'surco-app/surco-releases'

export const fetchStats = () =>
  fetch(STATS_URL).then((res) => {
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
    return res.json() as Promise<Stats>
  })

// The stored file lags by however long GitHub delays the workflow, so the stats page counts
// today itself, the way the workflow would. A refused live count, such as GitHub's limit of
// 60 requests an hour per visitor, leaves the stored figures.
export async function fetchLiveStats(now = new Date().toISOString()): Promise<Stats> {
  const stored = await fetchStats()
  try {
    const releases = (await fetchAllReleases(RELEASES_REPO)) as StatsRelease[]
    return recordSnapshot(stored, releases, now)
  } catch {
    return stored
  }
}

export const hasFigures = (stats: Stats) => stats.days.length > 0 && Boolean(stats.versions)

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

export function useFormat() {
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

function WeeklyBars({ weeks, label }: { weeks: Week[]; label: string }) {
  const format = useFormat()
  const H = 180
  const max = niceMax(Math.max(...weeks.map((w) => w.mac + w.windows)))
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
      aria-label={label}
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
        <g key={w.week}>
          <rect
            x={LEFT + i * band + band * 0.15}
            y={y(w.mac)}
            width={band * 0.7}
            height={y(0) - y(w.mac)}
            className="fill-blue"
          >
            <title>{format.number(w.mac)}</title>
          </rect>
          <rect
            x={LEFT + i * band + band * 0.15}
            y={y(w.mac + w.windows)}
            width={band * 0.7}
            height={y(w.mac) - y(w.mac + w.windows)}
            className="fill-blue/45"
          >
            <title>{format.number(w.windows)}</title>
          </rect>
        </g>
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

function Legend() {
  const { t } = useTranslation()
  return (
    <p className="mt-3 flex gap-5 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-blue" />
        {t('stats.mac')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-blue/45" />
        {t('stats.windows')}
      </span>
    </p>
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

  return (
    <>
      <section className="py-10" data-testid="stats-totals">
        <Reveal eager>
          <p className="text-6xl font-semibold tracking-tight tabular-nums sm:text-7xl">
            <span data-testid="stats-total">{format.number(latest.mac + latest.windows)}</span>
          </p>
          <p data-testid="stats-total-label" className="mt-3 text-muted">
            {t('stats.total')}
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Figure value={format.number(latest.mac)} label={t('stats.mac')} testid="stats-mac" />
            <Figure
              value={format.number(latest.windows)}
              label={t('stats.windows')}
              testid="stats-windows"
            />
          </div>
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-muted">
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
        </Reveal>
      </section>

      <section className="py-12" data-testid="stats-weekly">
        <Kicker>{t('stats.weeklyHeading')}</Kicker>
        <div className="mt-8">
          <WeeklyBars weeks={weeklyInstalls(days)} label={t('stats.weeklyHeading')} />
        </div>
        <Legend />
      </section>

      <section className="py-12" data-testid="stats-usage">
        <Kicker>{t('stats.usageHeading')}</Kicker>
        <p className="mt-4 leading-relaxed text-muted">{t('stats.usageLede')}</p>
        <div className="mt-8">
          <WeeklyBars weeks={stats.usage} label={t('stats.usageHeading')} />
        </div>
        <Legend />
      </section>

      <section className="py-12" data-testid="stats-versions">
        <Kicker>{t('stats.versionsHeading')}</Kicker>
        <p className="mt-4 leading-relaxed text-muted">{t('stats.versionsLede')}</p>
        <table className="mt-6 w-full text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-faint">
              <td />
              <th className="pb-2 pl-3 text-right font-medium">{t('stats.mac')}</th>
              <th className="pb-2 pl-3 text-right font-medium">{t('stats.windows')}</th>
              <th className="pb-2 pl-3 text-right font-medium">{t('stats.versionsInstalls')}</th>
            </tr>
          </thead>
          <tbody>
            {stats.versions.map((v) => (
              <tr key={v.version} className="border-t border-line text-muted">
                <th className="py-2 text-left font-mono text-[0.8125rem] font-normal text-fg">
                  {v.version}
                </th>
                <td className="py-2 pl-3 text-right" data-testid={`stats-version-mac-${v.version}`}>
                  {format.number(v.mac)}
                </td>
                <td
                  className="py-2 pl-3 text-right"
                  data-testid={`stats-version-windows-${v.version}`}
                >
                  {format.number(v.windows)}
                </td>
                <td
                  className="py-2 pl-3 text-right"
                  data-testid={`stats-version-installs-${v.version}`}
                >
                  +{format.number(v.installs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="py-12" data-testid="stats-how">
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
      </section>
    </>
  )
}

const Bone = ({ className }: { className: string }) => (
  <span className={`skeleton block rounded-md bg-line/60 ${className}`} />
)

// Mirrors the totals and the first chart of StatsView, line box for line box, so the figures
// land where the bones were instead of pushing the page down when they arrive.
export function StatsSkeleton() {
  const { t } = useTranslation()
  return (
    <div data-testid="stats-loading" role="status" aria-label={t('stats.loading')}>
      <section className="py-10">
        <Bone className="h-15 w-56 sm:h-18 sm:w-72" />
        <Bone className="mt-3 h-6 w-80 max-w-full" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="grid gap-0.5 border-t border-line pt-3">
              <Bone className="h-8 w-20" />
              <Bone className="h-5 w-16" />
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:gap-8">
          <Bone className="h-7 w-36" />
          <Bone className="h-7 w-36" />
        </div>
      </section>
      <section className="py-12">
        <Bone className="h-5 w-40" />
        <Bone className="mt-8 aspect-[4/1] w-full" />
      </section>
    </div>
  )
}

export default function StatsPage() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<Stats | null | 'error'>(null)

  useEffect(() => {
    let cancelled = false
    fetchLiveStats()
      .then((data) => {
        if (!cancelled) setStats(hasFigures(data) ? data : 'error')
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
      <Header page="stats" />

      <main id="main" className="relative mx-auto max-w-3xl px-6 sm:px-10">
        <section className="pt-12 sm:pt-16">
          <Reveal eager>
            <Kicker>{t('stats.kicker')}</Kicker>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
              {t('stats.title')}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{t('stats.lede')}</p>
          </Reveal>
        </section>

        {stats === null && <StatsSkeleton />}
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
