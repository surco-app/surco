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
// The walk costs one request per 100 releases, and GitHub's unauthenticated limit is 60
// per hour PER IP — shared by everyone behind an office, campus or CGNAT address. Every
// page that mounts the download button used to repeat the whole walk, so a single visit
// through home → features → guide → changelog spent it four times over. The result is
// cached for the session because it is a vanity count, not live data: a number minutes
// out of date is invisible, while a 403 sends the visitor to a raw asset list.
function cached(key: string): Release[] | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Release[]) : null
  } catch {
    // Private-mode Safari throws on sessionStorage access, and a corrupt entry throws
    // on parse. Either way the fetch below is the answer, not a broken page.
    return null
  }
}

export async function fetchAllReleases(repo: string): Promise<Release[]> {
  const key = `surco:releases:${repo}`
  const hit = cached(key)
  if (hit) return hit
  const releases: Release[] = []
  for (let pageNum = 1; ; pageNum++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${pageNum}`,
    )
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
    const pageReleases = (await res.json()) as Release[]
    releases.push(...pageReleases)
    if (pageReleases.length < 100) break
  }
  try {
    sessionStorage.setItem(key, JSON.stringify(releases))
  } catch {
    // Storage full or blocked: the count still renders, it just costs the walk again
    // on the next page. Never let caching break the thing it exists to speed up.
  }
  return releases
}

interface InstallerRelease {
  tag_name: string
  draft?: boolean
  assets?: { name: string; browser_download_url: string }[]
}

// The newest release whose installer for `suffix` (e.g. "arm64.dmg", ".exe") is actually
// uploaded. During a release CI creates the new release before it finishes uploading its
// assets, so /releases/latest would point at a build with no installer yet; walking the
// list and skipping it falls back to the previous build that still downloads, instead of
// showing "unavailable". GitHub returns releases newest-first, so the first match wins.
export function pickInstallerRelease(
  releases: InstallerRelease[],
  suffix: string,
): InstallerRelease | undefined {
  return releases.find((r) => !r.draft && (r.assets ?? []).some((a) => a.name.endsWith(suffix)))
}
