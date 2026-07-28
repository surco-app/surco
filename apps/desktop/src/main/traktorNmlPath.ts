import { join } from 'node:path'

// Traktor keeps one collection folder per version ("Traktor 4.4.1", "Traktor 4.5.0", …)
// under Documents, so the real path shifts every time the app updates. This only
// PROPOSES candidates, newest first — the caller must have the user confirm one
// before ever touching a file, since a collection.nml holds someone's whole library
// and the target user doesn't even keep his in the standard place (Documents is
// iCloud-synced, so his real collection lives under a "Documentos — Local" folder).
const VERSION_FOLDER = /^Traktor (\d+(?:\.\d+)*)/

function versionOf(dirName: string): number[] | null {
  const match = dirName.match(VERSION_FOLDER)
  if (!match) return null
  return match[1].split('.').map(Number)
}

// Component-by-component numeric compare: "4.10" must sort after "4.9", which a
// plain string sort gets backwards (lexical "4.10" < "4.9").
function compareVersionsDesc(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function detectTraktorNmlPaths(home: string, readDir: (dir: string) => string[]): string[] {
  const niDir = join(home, 'Documents', 'Native Instruments')
  const versioned = readDir(niDir)
    .map((name) => ({ name, version: versionOf(name) }))
    .filter((entry): entry is { name: string; version: number[] } => entry.version !== null)
  versioned.sort((a, b) => compareVersionsDesc(a.version, b.version))
  return versioned.map((entry) => join(niDir, entry.name, 'collection.nml'))
}
