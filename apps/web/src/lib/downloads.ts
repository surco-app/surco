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
