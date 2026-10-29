import { dirname, join } from 'node:path'

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

const ROOT_ENTRY = /<Entry Name="Browser\.Dir\.Root" Type="\d+" Value="([^"]*)"/

function decodeXml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// The folder Traktor reads and saves its collection in, from its settings file. It is not
// the folder of Traktor's own version: an updated Traktor can keep the Root Dir of an older
// one. On a Mac Traktor writes it as "Disk:Users:dj:…:", naming the disk first.
export function traktorRootDir(tsi: string, bootVolume: string): string | null {
  const match = tsi.match(ROOT_ENTRY)
  if (!match) return null
  const value = decodeXml(match[1])
  if (/^[A-Za-z]:[\\/]/.test(value)) return value.replace(/[\\/]+$/, '')
  const [volume, ...parts] = value.split(':').filter((part, i) => i === 0 || part !== '')
  if (!volume || parts.length === 0) return null
  const base = volume === bootVolume ? '' : `/Volumes/${volume}`
  return `${base}/${parts.join('/')}`
}

// The collection to point Surco at when no installed Traktor uses the chosen one: saved
// there, nothing ever reaches Traktor. In-use collections come newest Traktor first, and
// none at all means nothing is known, which is no reason to warn.
export function collectionTraktorUses(
  configured: string,
  inUse: string[],
  samePath: (a: string, b: string) => boolean,
): string | null {
  if (!configured || inUse.length === 0) return null
  if (inUse.some((path) => samePath(path, configured))) return null
  return inUse[0]
}

// The collection each installed Traktor uses, newest Traktor first, read from the settings
// file in each version folder; a Root Dir without a collection.nml is left out.
export function collectionsTraktorUses(
  candidates: string[],
  read: (path: string) => string | null,
  exists: (path: string) => boolean,
  bootVolume: string,
): string[] {
  const found: string[] = []
  for (const candidate of candidates) {
    const settings =
      read(join(dirname(candidate), 'Traktor Settings.tsi')) ??
      read(join(dirname(candidate), 'Traktor Play Settings.tsi'))
    const root = settings === null ? null : traktorRootDir(settings, bootVolume)
    if (root === null) continue
    const collection = join(root, 'collection.nml')
    if (exists(collection) && !found.includes(collection)) found.push(collection)
  }
  return found
}

// Whether two paths name the same collection: compared as the file system resolves them,
// since a Root Dir can come back under /Volumes/<boot disk>, a link to /. Windows ignores
// capitals; a path that cannot be resolved is compared as written.
export function sameCollection(
  a: string,
  b: string,
  realpath: (path: string) => string,
  platform: NodeJS.Platform,
): boolean {
  const canonical = (path: string): string => {
    let resolved = path
    try {
      resolved = realpath(path)
    } catch {}
    return platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return canonical(a) === canonical(b)
}
