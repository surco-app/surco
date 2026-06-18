// Counts installer downloads across every published release, mirroring the
// filter in scripts/downloads.mjs: only .dmg/.exe count. The .zip, .blockmap and
// latest*.yml assets are update traffic electron-updater pulls on each launch,
// so counting them would inflate the number.

interface ReleaseAsset {
  name: string
  download_count: number
}

interface Release {
  assets?: ReleaseAsset[]
}

function isInstaller(name: string): boolean {
  return name.endsWith('.dmg') || name.endsWith('.exe')
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
