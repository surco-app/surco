// The numbers behind the stats page. GitHub's download counters are the only data there
// is (the app has no telemetry), and they need two corrections to mean anything. Crawlers
// fetch every file of every release about once, so each count carries a bot floor. And on
// Windows and Linux the installer is also the update, so only the Mac .dmg counts people.
//
// Imported by scripts/stats-snapshot.ts as plain TypeScript run by Node, so this file
// keeps to erasable syntax and imports nothing.

export interface StatsAsset {
  name: string
  download_count: number
}

export interface StatsRelease {
  tag_name: string
  published_at: string | null
  prerelease?: boolean
  assets?: StatsAsset[]
}

export interface Totals {
  mac: number
  windows: number
  linux: number
}

export interface Day extends Totals {
  date: string
  estimated?: true
}

export interface MacUpdate {
  version: string
  count: number
}

export interface Stats {
  days: Day[]
  macUpdates: MacUpdate[]
}

const DAY_MS = 86_400_000

const net = (count: number, bots: number) => Math.max(0, count - bots)

// No person or updater ever asks for a .dmg.blockmap, so its count is the release's bots.
function botsOf(assets: StatsAsset[]): number {
  const blockmaps = assets.filter((a) => a.name.endsWith('.dmg.blockmap'))
  if (blockmaps.length === 0) return 0
  return blockmaps.reduce((sum, a) => sum + a.download_count, 0) / blockmaps.length
}

export function releaseTotals(release: StatsRelease): Totals {
  const assets = release.assets ?? []
  const bots = botsOf(assets)
  const count = (name: string) => assets.find((a) => a.name === name)?.download_count
  const sum = (suffix: string, botsFor: (a: StatsAsset) => number) =>
    assets
      .filter((a) => a.name.endsWith(suffix))
      .reduce((total, a) => total + net(a.download_count, botsFor(a)), 0)
  return {
    mac: sum('.dmg', (a) => count(`${a.name}.blockmap`) ?? bots),
    windows: sum('.exe', () => bots),
    linux: sum('.AppImage', () => bots),
  }
}

const published = (releases: StatsRelease[]) =>
  releases
    .filter((r): r is StatsRelease & { published_at: string } => r.published_at !== null)
    .sort((a, b) => a.published_at.localeCompare(b.published_at))

export function macUpdates(releases: StatsRelease[], limit: number): MacUpdate[] {
  return published(releases)
    .filter((r) => !r.prerelease)
    .reverse()
    .slice(0, limit)
    .map((r) => {
      const assets = r.assets ?? []
      const bots = botsOf(assets)
      const count = assets
        .filter((a) => a.name.endsWith('.zip'))
        .reduce((sum, a) => sum + net(a.download_count, bots), 0)
      return { version: r.tag_name, count: Math.round(count) }
    })
}

const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const rounded = (date: string, t: Totals): Day => ({
  date,
  mac: Math.round(t.mac),
  windows: Math.round(t.windows),
  linux: Math.round(t.linux),
})

// The web always serves the newest installer, so a release's downloads fell between its
// publication and the next one. Spreading them evenly over that window gives each day its
// share; the newest release's window runs to the end of today.
function rebuild(releases: StatsRelease[], today: string): Day[] {
  const list = published(releases)
  if (list.length === 0) return []
  const end = Date.parse(today) + DAY_MS
  const perDay = new Map<string, Totals>()
  list.forEach((release, i) => {
    const totals = releaseTotals(release)
    const from = Date.parse(release.published_at)
    const to = i + 1 < list.length ? Date.parse(list[i + 1].published_at) : end
    const span = Math.max(to - from, 1)
    for (let t = from; t < to; ) {
      const next = Math.min(to, Math.floor(t / DAY_MS) * DAY_MS + DAY_MS)
      const share = (next - t) / span
      const date = dateOf(t)
      const day = perDay.get(date) ?? { mac: 0, windows: 0, linux: 0 }
      day.mac += totals.mac * share
      day.windows += totals.windows * share
      day.linux += totals.linux * share
      perDay.set(date, day)
      t = next
    }
  })
  const running = { mac: 0, windows: 0, linux: 0 }
  return [...perDay.entries()]
    .filter(([date]) => date < today)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => {
      running.mac += day.mac
      running.windows += day.windows
      running.linux += day.linux
      return { ...rounded(date, running), estimated: true as const }
    })
}

// GitHub keeps only today's totals, so the history is whatever earlier runs stored. The
// first run has none and rebuilds it; after that the stored days are measured and must not
// be rewritten by an estimate made from later counts.
export function recordSnapshot(
  previous: Stats | null,
  releases: StatsRelease[],
  today: string,
): Stats {
  const totals = published(releases)
    .map(releaseTotals)
    .reduce(
      (sum, t) => ({
        mac: sum.mac + t.mac,
        windows: sum.windows + t.windows,
        linux: sum.linux + t.linux,
      }),
      { mac: 0, windows: 0, linux: 0 },
    )
  const history = previous ? previous.days.filter((d) => d.date < today) : rebuild(releases, today)
  return {
    days: [...history, rounded(today, totals)],
    macUpdates: macUpdates(releases, 8),
  }
}

export function lastTwelveMonths(days: Day[]): Day[] {
  const last = days.at(-1)
  if (!last) return days
  const cutoff = `${Number(last.date.slice(0, 4)) - 1}${last.date.slice(4)}`
  return days.filter((d) => d.date >= cutoff)
}

export function installsInLast(days: Day[], count: number): number {
  const last = days.at(-1)
  if (!last) return 0
  const cutoff = dateOf(Date.parse(last.date) - count * DAY_MS)
  const start = days.filter((d) => d.date <= cutoff).at(-1) ?? days[0]
  return last.mac - start.mac
}

const mondayOf = (date: string) => {
  const ms = Date.parse(date)
  return dateOf(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS)
}

export function weeklyMacInstalls(days: Day[]): { week: string; count: number }[] {
  if (days.length === 0) return []
  const endOfWeek = new Map<string, number>()
  for (const d of days) endOfWeek.set(mondayOf(d.date), d.mac)
  const weeks: { week: string; count: number }[] = []
  let before = 0
  const last = Date.parse(mondayOf(days[days.length - 1].date))
  for (let ms = Date.parse(mondayOf(days[0].date)); ms <= last; ms += 7 * DAY_MS) {
    const week = dateOf(ms)
    const total = endOfWeek.get(week) ?? before
    weeks.push({ week, count: total - before })
    before = total
  }
  return weeks
}
