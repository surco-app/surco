import { dirname, join } from 'node:path'

// Traktor keeps one collection folder per version ("Traktor 4.4.1", "Traktor 4.5.0", …)
// under Documents, so the real path shifts every time the app updates. Detection
// PROPOSES candidates, newest first — the caller must have the user confirm one
// before ever touching a file, since a collection.nml holds someone's whole library
// and the target user doesn't even keep his in the standard place (Documents is
// iCloud-synced, so his real collection lives under a "Documentos — Local" folder).
// Once one is confirmed in a version folder, followTraktorVersion keeps it on the
// folder Traktor actually uses.
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

// Which collection Traktor opens: the version folder whose settings Traktor saved last.
// Not the newest version (a DJ can go back to an older one) and not collection.nml's own
// date, which Surco moves itself whenever it writes there. Null when no folder says.
export function traktorInUse(
  candidates: string[],
  modifiedAt: (path: string) => number | null,
): string | null {
  let best: { path: string; at: number } | null = null
  for (const path of candidates) {
    if (modifiedAt(path) === null) continue
    const at = modifiedAt(join(dirname(path), 'Traktor Settings.tsi'))
    if (at !== null && (best === null || at > best.at)) best = { path, at }
  }
  return best?.path ?? null
}

// A version folder is only read by its own Traktor, so a collection confirmed in one
// follows Traktor to the folder it uses now; written to the old one, every save landed
// where Traktor never looks. A collection kept anywhere else is the DJ's choice and stays.
export function followTraktorVersion(
  configured: string,
  candidates: string[],
  inUse: string | null,
  samePath: (a: string, b: string) => boolean,
): string {
  if (!configured || !inUse || samePath(configured, inUse)) return configured
  return candidates.some((c) => samePath(c, configured)) ? inUse : configured
}
