// Counts installer downloads across every published release, mirroring the
// filter in scripts/downloads.mjs: only .dmg/.exe/.AppImage count. The .zip,
// .blockmap and latest*.yml assets are update traffic electron-updater pulls on
// each launch, so counting them would inflate the number.

interface ReleaseAsset {
  name: string
  download_count: number
}

interface Release {
  assets?: ReleaseAsset[]
}

function isInstaller(name: string): boolean {
  return name.endsWith('.dmg') || name.endsWith('.exe') || name.endsWith('.AppImage')
}

export function countDownloads(releases: Release[]): number {
  return releases.reduce(
    (total, rel) =>
      total +
      (rel.assets ?? [])
        .filter((a) => isInstaller(a.name))
        .reduce((sum, a) => sum + (a.download_count ?? 0), 0),
    0,
  )
}

// GitHub caps per_page at 100, so a single request stops seeing the oldest
// releases (and their download counts) once the repo passes 100 of them. Walks
// the pages until one comes back short. Throws on any failed page: a partial
// list would silently undercount, which is the very bug this exists to avoid.
export async function fetchAllReleases(repo: string): Promise<Release[]> {
  const releases: Release[] = []
  for (let pageNum = 1; ; pageNum++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${pageNum}`,
    )
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
    const pageReleases = (await res.json()) as Release[]
    releases.push(...pageReleases)
    if (pageReleases.length < 100) return releases
  }
}

// The walk above costs one request per 100 releases, and GitHub's unauthenticated limit
// is 60 per hour PER IP — shared by everyone behind an office, campus or CGNAT address.
// Every page mounting the download button repeated the whole walk, so one visit through
// home → features → guide → changelog spent it four times over; exhausting the limit
// answers 403, which drops the visitor onto a raw asset list instead of an installer.
// Caching is safe here because this is a vanity count, not live data: minutes out of
// date is invisible. sessionStorage is read through globalThis because it is absent in
// the SSG prerender and throws in private-mode Safari.
export async function fetchReleasesCached(repo: string): Promise<Release[]> {
  const key = `surco:releases:${repo}`
  try {
    const raw = globalThis.sessionStorage?.getItem(key)
    if (raw) return JSON.parse(raw) as Release[]
  } catch {
    // A corrupt entry throws on parse; falling through to the walk is the answer.
  }
  const releases = await fetchAllReleases(repo)
  try {
    globalThis.sessionStorage?.setItem(key, JSON.stringify(releases))
  } catch {
    // Storage blocked or full: the count still renders, it just costs the walk again
    // on the next page. Caching must never break the thing it exists to speed up.
  }
  return releases
}

export interface InstallerRelease {
  tag_name: string
  draft?: boolean
  // size rides in the same payload the download URL comes from, so showing the
  // installer weight costs no extra request against the 60/hour rate limit.
  assets?: { name: string; browser_download_url: string; size?: number }[]
}

// The button asking for the installer is mounted on every page — three times on the home
// page alone (hero, closing CTA, install section) — and each mount used to spend its own
// request against the same 60/hour-per-IP budget the count walks. A visit through home →
// features → guide → changelog cost a dozen, which is how a shared office or CGNAT address
// reaches the 403 that drops visitors onto a raw asset list. The installer URL only changes
// when a release ships, so one request per session is enough.
//
// Kept separate from the count's cache on purpose: that one walks every page of 100 to sum
// download counts, while this asks for a single page of 20 and needs the asset URL and size
// the count's payload doesn't carry.

// Requests still in flight, so the mounts that render together share one. The stored copy
// only helps the NEXT page: all three of the home page's buttons run their effect in the
// same tick, before any response has landed, which measured 2 requests with the cache alone.
const inFlight = new Map<string, Promise<InstallerRelease[]>>()

export async function fetchInstallerReleasesCached(repo: string): Promise<InstallerRelease[]> {
  const key = `surco:installers:${repo}`
  try {
    const raw = globalThis.sessionStorage?.getItem(key)
    if (raw) return JSON.parse(raw) as InstallerRelease[]
  } catch {
    // A corrupt entry throws on parse; falling through to the request is the answer.
  }
  const pending = inFlight.get(key)
  if (pending) return pending

  const request = (async () => {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`)
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
    const releases = (await res.json()) as InstallerRelease[]
    try {
      // Only a successful response is stored. Caching a failure would pin the outage to the
      // rest of the session, still claiming the download is unreachable after GitHub recovers.
      globalThis.sessionStorage?.setItem(key, JSON.stringify(releases))
    } catch {
      // Storage blocked or full: the button still works, it just costs a request per page.
    }
    return releases
  })()

  // The shared promise is the one handed back, not a `.finally` branch off it: that branch
  // would be a second, unobserved chain, and a rejected request would surface as an
  // unhandled rejection in the visitor's browser. The eviction rides on a swallowed copy
  // instead. Dropped either way once it settles, so a failure stays retryable — the same
  // reason a failure is never written to storage.
  inFlight.set(key, request)
  void request.then(
    () => inFlight.delete(key),
    () => inFlight.delete(key),
  )
  return request
}

// The newest release whose installer for `suffix` (e.g. "arm64.dmg", ".exe") is actually
// uploaded. During a release CI creates the new release before it finishes uploading its
// assets, so /releases/latest would point at a build with no installer yet; walking the
// list and skipping it falls back to the previous build that still downloads, instead of
// reporting no installer. GitHub returns releases newest-first, so the first match wins.
export function pickInstallerRelease(
  releases: InstallerRelease[],
  suffix: string,
): InstallerRelease | undefined {
  return releases.find((r) => !r.draft && (r.assets ?? []).some((a) => a.name.endsWith(suffix)))
}
