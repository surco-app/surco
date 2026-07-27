// El NML se edita como texto, no a través de un parser XML: un round-trip genérico
// normaliza comillas, entidades y espaciado del documento entero, y convertiría un
// cambio de tres atributos en un diff de toda la colección del usuario. Aquí cada
// ENTRY se localiza por posición y sólo se sustituyen los tramos que cambian.
import { readTraktorMarkers } from './traktor4'

export interface NmlEntry {
  start: number
  end: number
  volume: string
  dir: string
  file: string
}

const ENTRY_RE = /<ENTRY\b[^>]*>[\s\S]*?<\/ENTRY>/g

// \b after the name stops VOLUME from also matching inside VOLUMEID="..." — no real
// collision exists in Traktor's known LOCATION schema today, but the anchor is what
// makes that true by construction rather than by accident.
function attr(fragment: string, name: string): string {
  const m = fragment.match(new RegExp(`${name}\\b="([^"]*)"`))
  return m ? unescapeAttr(m[1]) : ''
}

// Traktor XML-escapes attribute values on write (escapeAttr below is the same
// table in reverse), so a FILE/DIR/VOLUME read back raw would never match a
// patch built from the real filesystem name once it contains &, <, > or ".
function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function findEntries(nml: string): NmlEntry[] {
  const entries: NmlEntry[] = []
  for (const match of nml.matchAll(ENTRY_RE)) {
    const block = match[0]
    const location = block.match(/<LOCATION\b[^>]*>/)?.[0] ?? ''
    entries.push({
      start: match.index,
      end: match.index + block.length,
      volume: attr(location, 'VOLUME'),
      dir: attr(location, 'DIR'),
      file: attr(location, 'FILE'),
    })
  }
  return entries
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface NmlPatch {
  volume: string
  dir: string
  file: string
  cueTree?: Uint8Array
  bpm?: number
  newFile?: string
  clearCoverArt?: boolean
}

const baseName = (file: string): string => file.replace(/\.[^.]*$/, '')

// APFS treats NFC and NFD as the same file, so a raw byte comparison of the path
// pieces can miss a real match when the two sides were normalized differently
// (e.g. one written by Traktor, the other read back through Node's fs). The
// delimiter between the three parts has to be a byte no volume/dir/file value can
// ever contain — a space or "/" would let a value straddling the boundary collide
// with a different split of the same three strings. NUL can't appear in any real
// filesystem path, so it can't collide.
const key = (volume: string, dir: string, file: string): string =>
  `${volume.normalize('NFC')}\0${dir.normalize('NFC')}\0${file.normalize('NFC')}`

// A real collection can be tens of thousands of ENTRY blocks; scanning every patch
// for every entry is O(entries × patches) with an expensive normalize() on each side
// of each comparison. Two lookup tables — exact file, and base name for the
// AIFF→FLAC fallback — turn that into one O(1) lookup per entry instead. The old
// scan (`patches.find(p => matches(entry, p))`) picked the first patch in array
// order, regardless of which rule matched it — so each map entry carries its
// patch's original index, and any collision (same key within one map, or an exact
// match and a base-name match both hit for one entry) keeps whichever index is
// lower. Without the index, either kind of collision could let a later patch win
// over an earlier one, reordering which patch actually applies.
function indexPatches(patches: NmlPatch[]): {
  byFile: Map<string, [number, NmlPatch]>
  byBaseName: Map<string, [number, NmlPatch]>
} {
  const byFile = new Map<string, [number, NmlPatch]>()
  const byBaseName = new Map<string, [number, NmlPatch]>()
  patches.forEach((patch, i) => {
    setIfEarlier(byFile, key(patch.volume, patch.dir, patch.file), i, patch)
    setIfEarlier(byBaseName, key(patch.volume, patch.dir, baseName(patch.file)), i, patch)
  })
  return { byFile, byBaseName }
}

function setIfEarlier(
  map: Map<string, [number, NmlPatch]>,
  k: string,
  i: number,
  patch: NmlPatch,
): void {
  const existing = map.get(k)
  if (!existing || i < existing[0]) map.set(k, [i, patch])
}

function matchPatch(
  entry: NmlEntry,
  index: { byFile: Map<string, [number, NmlPatch]>; byBaseName: Map<string, [number, NmlPatch]> },
): NmlPatch | undefined {
  const exact = index.byFile.get(key(entry.volume, entry.dir, entry.file))
  const byBase = index.byBaseName.get(key(entry.volume, entry.dir, baseName(entry.file)))
  if (exact && byBase) return (exact[0] <= byBase[0] ? exact : byBase)[1]
  return (exact ?? byBase)?.[1]
}

// Traktor writes COVERARTID only on <INFO>, so the removal is anchored there
// rather than to a bare `COVERARTID="..."` search — anchoring to the element it
// actually lives on is what makes stripping the "first occurrence" correct
// instead of coincidental. Non-global: the schema has exactly one INFO per ENTRY.
function stripCoverArt(block: string): string {
  return block.replace(/(<INFO\b[^>]*?)\s*COVERARTID="[^"]*"/, '$1')
}

// CUE_V2 elements are not always one contiguous run — another element can sit
// between two of them — so a single non-global replace can leave a later run
// behind, coexisting with the freshly written set. Global removal, then insert
// the fresh XML at one fixed anchor: right after </LOCATION>, the one element
// every ENTRY that reaches here is guaranteed to have (matches() requires it).
// This also covers the entry that had no CUE_V2 at all: nothing to remove, the
// new cues still land at the same anchor instead of being silently discarded.
function replaceCues(block: string, tree: Uint8Array, bpm: number | undefined): string {
  const withoutCues = block.replace(/<CUE_V2\b[^>]*>[\s\S]*?<\/CUE_V2>/g, '')
  return withoutCues.replace(/<\/LOCATION>/, `</LOCATION>${cuesToXml(tree, bpm)}`)
}

function patchEntry(block: string, patch: NmlPatch): string {
  let out = block
  if (patch.newFile) {
    out = out.replace(/(<LOCATION\b[^>]*\bFILE)="[^"]*"/, `$1="${escapeAttr(patch.newFile)}"`)
  }
  if (patch.clearCoverArt) {
    out = stripCoverArt(out)
  }
  if (patch.cueTree) {
    out = replaceCues(out, patch.cueTree, patch.bpm)
  }
  return out
}

// Matches each patch against the collection and rewrites only the ENTRY blocks
// that changed. Substitution runs back-to-front (descending index) so editing
// one entry never shifts the start/end span findEntries already computed for
// an earlier one still waiting to be patched.
export function applyPatches(nml: string, patches: NmlPatch[]): string {
  const entries = findEntries(nml)
  const index = indexPatches(patches)
  let out = nml
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    const patch = matchPatch(entry, index)
    if (!patch) continue
    const patched = patchEntry(out.slice(entry.start, entry.end), patch)
    out = out.slice(0, entry.start) + patched + out.slice(entry.end)
  }
  return out
}

// Same matching rules as applyPatches, in one pass over the entries instead of
// one applyPatches (itself a full sweep) per patch — a caller that ran the
// per-patch version against a real collection (tens of thousands of entries,
// hundreds of patches) paid for a second full rewrite of the document per
// patch just to count. This never rewrites anything, only counts how many
// distinct patches matched some entry, which is what a caller reporting
// "N tracks actually updated" needs.
export function matchedPatchCount(nml: string, patches: NmlPatch[]): number {
  const entries = findEntries(nml)
  const index = indexPatches(patches)
  const matched = new Set<NmlPatch>()
  for (const entry of entries) {
    const patch = matchPatch(entry, index)
    if (patch) matched.add(patch)
  }
  return matched.size
}

// Traktor writes CUE_V2 as a self-closing-style pair with no children, START in
// milliseconds with exactly six decimals. TYPE=4's startMs is a phase (see
// traktor4.ts), copied through verbatim — clamping it here would desync the grid
// from what readTraktorMarkers already carried through unchanged.
//
// A TYPE=4 marker without a GRID child (or a GRID with BPM<=0) is not a real
// anchor to Traktor's own tooling — it gets skipped when the grid is read back
// (ground truth: traktor_nml_cleaner.py's _grid_anchors). The BPM isn't in the
// binary cue tree; it has to come from the caller (track metadata), same as
// shiftTraktorCues gets it from meta.bpm. When it isn't available, we drop the
// TYPE=4 marker rather than write a dead anchor: a CUE_V2 that looks like a
// saved beatgrid but that Traktor silently ignores is worse than no marker at
// all, since it hides the fact that nothing usable was written.
export function cuesToXml(tree: Uint8Array, bpm?: number): string {
  const hasGrid = Number.isFinite(bpm) && (bpm as number) > 0
  return readTraktorMarkers(tree)
    .filter((m) => m.type !== 4 || hasGrid)
    .map((m) => {
      const grid = m.type === 4 ? `<GRID BPM="${(bpm as number).toFixed(6)}"></GRID>` : ''
      return (
        `<CUE_V2 NAME="${escapeAttr(m.name)}" DISPL_ORDER="0" TYPE="${m.type}" ` +
        `START="${m.startMs.toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="${m.hotcue}">${grid}</CUE_V2>`
      )
    })
    .join('')
}
