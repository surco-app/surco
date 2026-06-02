#!/usr/bin/env node
// Reports how many times the app has been downloaded, straight from GitHub's
// per-asset download_count on the public releases repo — no analytics service
// and nothing added to the app. Run with `npm run downloads`.
//
// Only the installers (.dmg, .exe) are counted. The release also carries .zip,
// .blockmap and latest*.yml assets that electron-updater fetches on every
// auto-update; counting those would inflate "downloads" with update traffic.

const REPO = 'vigosan/surco-releases'

function osOf(name) {
  if (name.endsWith('arm64.dmg')) return 'macOS (Apple Silicon)'
  if (name.endsWith('x64.dmg')) return 'macOS (Intel)'
  if (name.endsWith('.exe')) return 'Windows'
  return null
}

// Folds the raw releases payload into download totals per OS and per version,
// keeping only installer assets. Pure so it can be reasoned about (and tested)
// without hitting the network.
export function summarize(releases) {
  const perOs = new Map()
  const perVersion = []
  let total = 0
  for (const rel of releases) {
    let versionTotal = 0
    for (const asset of rel.assets ?? []) {
      const os = osOf(asset.name)
      if (!os) continue
      const count = asset.download_count ?? 0
      perOs.set(os, (perOs.get(os) ?? 0) + count)
      versionTotal += count
      total += count
    }
    perVersion.push({ version: rel.tag_name, count: versionTotal })
  }
  return { total, perOs: [...perOs.entries()], perVersion }
}

async function main() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (res.status === 403) {
    console.error('GitHub rate limit alcanzado. Espera un rato o exporta GITHUB_TOKEN.')
    process.exit(1)
  }
  if (!res.ok) {
    console.error(`GitHub devolvió ${res.status}`)
    process.exit(1)
  }
  const releases = await res.json()
  if (!Array.isArray(releases) || releases.length === 0) {
    console.log('Aún no hay releases publicados.')
    return
  }

  const { total, perOs, perVersion } = summarize(releases)

  console.log(`\n  Descargas totales: ${total}\n`)
  for (const [os, count] of perOs.sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(6)}  ${os}`)
  }
  console.log('\n  Por versión:')
  for (const { version, count } of perVersion) {
    console.log(`    ${String(count).padStart(6)}  ${version}`)
  }
  console.log('')
}

// Only run the fetch when executed directly, so `summarize` can be imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
