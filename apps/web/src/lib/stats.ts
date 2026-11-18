// The numbers behind the stats page. GitHub's download counters are the only data there
// is (the app has no telemetry), and they need two corrections to mean anything. Crawlers
// fetch every file of every release about once, so each count carries a bot floor. And on
// Windows the installer is also the update, so its installs are the fetches that came
// without the .exe.blockmap every update downloads. Linux is left out: its installer has
// no such twin and automatic fetches outnumber people there.
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
}

export interface Day extends Totals {
  date: string
  estimated?: true
}

export interface Version extends Totals {
  version: string
  hours: number
  installs: number
}

export interface Week extends Totals {
  week: string
}

export interface Stats {
  days: Day[]
  versions: Version[]
  usage: Week[]
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

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
    windows: sum('.exe', (a) => count(`${a.name}.blockmap`) ?? bots),
  }
}

const published = (releases: StatsRelease[]) =>
  releases
    .filter((r): r is StatsRelease & { published_at: string } => r.published_at !== null)
    .sort((a, b) => a.published_at.localeCompare(b.published_at))

function updatesOf(release: StatsRelease): Totals {
  const assets = release.assets ?? []
  const bots = botsOf(assets)
  const sum = (suffix: string) =>
    Math.round(
      assets
        .filter((a) => a.name.endsWith(suffix))
        .reduce((total, a) => total + net(a.download_count, bots), 0),
    )
  return { mac: sum('.zip'), windows: sum('.exe.blockmap') }
}

const stable = (releases: StatsRelease[]) => published(releases).filter((r) => !r.prerelease)

export function versions(releases: StatsRelease[], limit: number, now: string): Version[] {
  const list = stable(releases)
  return list
    .map((r, i) => {
      const until = Date.parse(list[i + 1]?.published_at ?? now)
      const totals = releaseTotals(r)
      return {
        version: r.tag_name,
        hours: Math.ceil((until - Date.parse(r.published_at)) / HOUR_MS),
        ...updatesOf(r),
        installs: Math.round(totals.mac + totals.windows),
      }
    })
    .reverse()
    .slice(0, limit)
}

export function usage(releases: StatsRelease[]): Week[] {
  const weeks = new Map<string, Totals>()
  for (const r of stable(releases)) {
    const week = mondayOf(r.published_at.slice(0, 10))
    const best = weeks.get(week) ?? { mac: 0, windows: 0 }
    const updates = updatesOf(r)
    weeks.set(week, {
      mac: Math.max(best.mac, updates.mac),
      windows: Math.max(best.windows, updates.windows),
    })
  }
  return [...weeks.entries()].map(([week, totals]) => ({ week, ...totals }))
}

const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const mondayOf = (date: string) => {
  const ms = Date.parse(date)
  return dateOf(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS)
}

const rounded = (date: string, t: Totals): Day => ({
  date,
  mac: Math.round(t.mac),
  windows: Math.round(t.windows),
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
      const day = perDay.get(date) ?? { mac: 0, windows: 0 }
      day.mac += totals.mac * share
      day.windows += totals.windows * share
      perDay.set(date, day)
      t = next
    }
  })
  const running = { mac: 0, windows: 0 }
  return [...perDay.entries()]
    .filter(([date]) => date < today)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => {
      running.mac += day.mac
      running.windows += day.windows
      return { ...rounded(date, running), estimated: true as const }
    })
}

// GitHub keeps only today's totals, so the history is whatever earlier runs stored. The
// first run has none and rebuilds it; after that the stored days are measured and must not
// be rewritten by an estimate made from later counts. A history stored while Windows still
// counted updates carries a Linux figure, and is rebuilt too.
export function recordSnapshot(
  previous: Stats | null,
  releases: StatsRelease[],
  now: string,
): Stats {
  const today = now.slice(0, 10)
  const totals = published(releases)
    .map(releaseTotals)
    .reduce((sum, t) => ({ mac: sum.mac + t.mac, windows: sum.windows + t.windows }), {
      mac: 0,
      windows: 0,
    })
  const comparable = previous?.days.every((d) => !('linux' in d))
  const history =
    previous && comparable ? previous.days.filter((d) => d.date < today) : rebuild(releases, today)
  return {
    days: [...history, rounded(today, totals)],
    versions: versions(releases, 8, now),
    usage: usage(releases),
  }
}

export function installsInLast(days: Day[], count: number): number {
  const last = days.at(-1)
  if (!last) return 0
  const cutoff = dateOf(Date.parse(last.date) - count * DAY_MS)
  const start = days.filter((d) => d.date <= cutoff).at(-1) ?? days[0]
  return last.mac + last.windows - start.mac - start.windows
}

export function weeklyInstalls(days: Day[]): Week[] {
  if (days.length === 0) return []
  const endOfWeek = new Map<string, Day>()
  for (const d of days) endOfWeek.set(mondayOf(d.date), d)
  const weeks: Week[] = []
  let before: Totals = { mac: 0, windows: 0 }
  const last = Date.parse(mondayOf(days[days.length - 1].date))
  for (let ms = Date.parse(mondayOf(days[0].date)); ms <= last; ms += 7 * DAY_MS) {
    const week = dateOf(ms)
    const total = endOfWeek.get(week) ?? before
    weeks.push({ week, mac: total.mac - before.mac, windows: total.windows - before.windows })
    before = total
  }
  return weeks
}
