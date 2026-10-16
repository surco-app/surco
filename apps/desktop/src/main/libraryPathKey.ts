import { homedir } from 'node:os'

export interface PathMatchOptions {
  // Resolves a stored path to where it really lands, so a track imported through a
  // symlink still matches the path Surco scanned. Injected rather than calling
  // realpathSync directly so the tests can describe the user's layout without creating
  // it, and so a broken or offline path falls back to the literal string.
  realPath?: (path: string) => string
  // The music folder inside the home directory, whose link target becomes a rewrite rule.
  // Overridable so tests need no such folder on the machine running them.
  homeMusicDir?: string
}

// The music folder inside the user's home is a symlink on this machine, pointing at the
// volume their collection also references directly. Both prefixes name the same files,
// and a DJ library stores whichever was used at import. Resolving the link once gives the
// rewrite rule that makes the two spellings comparable even for files that no longer
// exist, which per-path resolution cannot do. Any other symlink still resolves normally.
function linkPrefixes(options: PathMatchOptions): [string, string][] {
  const resolve = options.realPath
  if (!resolve) return []
  const home = options.homeMusicDir ?? `${homedir()}/Music/Music`
  try {
    const target = resolve(home)
    if (target !== home) return [[home, target]]
  } catch {
    // No such folder, or not resolvable: there is no prefix rule to apply.
  }
  return []
}

// The comparable form of a path a DJ library stored: resolved, link prefix rewritten and
// lowercased, since the library's import and Surco's scan can spell the same file
// differently on macOS and Windows.
//
// Resolution answers where a path really lands, but only while the file is still there:
// 11 of the user's tracks are already gone and every one of their rows throws. Falling
// back to the raw string then makes two rows for one missing file look like two different
// files, so the pair stops reading as ambiguous and one gets picked. Mapping the known link
// prefixes keeps those rows comparable with no filesystem involved, and resolution handles
// the links nobody declared.
export function pathKey(options: PathMatchOptions = {}): (path: string) => string {
  const resolve = options.realPath ?? ((p: string) => p)
  const prefixes = linkPrefixes(options)
  return (p: string): string => {
    let out = p
    try {
      out = resolve(p)
    } catch {
      // Unresolvable: keep the literal path and let the prefix rules below do the work.
    }
    for (const [from, to] of prefixes) {
      if (out.toLowerCase().startsWith(from.toLowerCase())) {
        out = to + out.slice(from.length)
        break
      }
    }
    return out.toLowerCase()
  }
}

// One drag's worth: a selection is a few hundred rows, and the cap keeps one call from
// holding the main process for minutes.
export const MAX_ALIAS_PATHS = 5000

// Every spelling the OS may hand back for the dragged files: as given, resolved, and with
// the home music link swapped either way. A drag out of the list can come back into Surco's
// window with any of them, and its rows must still be known as the rows that were dragged.
// Called over IPC, so anything but a list of strings answers nothing. Each path is
// resolved once and the music folder once per call: on the NAS every resolve pays an
// lstat per path component.
export async function pathAliasesOf(
  input: unknown,
  options: { realPath: (path: string) => Promise<string>; homeMusicDir?: string },
): Promise<string[]> {
  if (!Array.isArray(input)) return []
  const paths = input.filter((p): p is string => typeof p === 'string').slice(0, MAX_ALIAS_PATHS)
  const home = options.homeMusicDir ?? `${homedir()}/Music/Music`
  const target = await options.realPath(home).catch(() => home)
  const resolved = await Promise.all(paths.map((p) => options.realPath(p).catch(() => p)))
  const out = new Set<string>()
  paths.forEach((p, i) => {
    for (const q of [p, resolved[i]]) {
      out.add(q)
      if (target === home) continue
      if (q.startsWith(home)) out.add(target + q.slice(home.length))
      if (q.startsWith(target)) out.add(home + q.slice(target.length))
    }
  })
  return [...out]
}
