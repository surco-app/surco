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
  // Asks for this track's cached thumbnails to be rewritten after the collection is
  // saved. It does NOT change the ENTRY: the COVERARTID stays exactly as Traktor wrote
  // it, which is the whole point (see refreshedCoverIds).
  refreshCoverArt?: boolean
  // Where the converted file ended up, so the thumbnails can be rendered from the cover
  // it actually carries. Read at sync time rather than carried as an image: the temp
  // files a conversion works from are unlinked when it finishes, long before the batch
  // ends and the collection is written.
  outputPath?: string
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

// Traktor writes COVERARTID only on <INFO>, so the read is anchored there rather than
// to a bare `COVERARTID="..."` search — anchoring to the element it actually lives on is
// what makes taking the "first occurrence" correct instead of coincidental. Non-global:
// the schema has exactly one INFO per ENTRY.
const COVER_ID_RE = /<INFO\b[^>]*?\sCOVERARTID="([^"]*)"/

export interface CoverRefresh {
  coverId: string
  file: string
}

// Each entry whose artwork this patch set refreshes, paired with the converted file its
// new cover lives in. The id is kept, never stripped: Traktor serves the library's
// artwork from its own thumbnail cache, so removing the id only asks it to re-read that
// same stale cache — what actually retires the old picture is overwriting the files
// under the id it already has (see traktorCoverCache.ts).
export function refreshedCoverIds(nml: string, patches: NmlPatch[]): CoverRefresh[] {
  const entries = findEntries(nml)
  const index = indexPatches(patches)
  const out: CoverRefresh[] = []
  for (const entry of entries) {
    const patch = matchPatch(entry, index)
    if (!patch?.refreshCoverArt || !patch.outputPath) continue
    const coverId = nml.slice(entry.start, entry.end).match(COVER_ID_RE)?.[1]
    if (coverId) out.push({ coverId, file: patch.outputPath })
  }
  return out
}

// CUE_V2 has no children in the schema Traktor itself writes (see cuesToXml),
// so a serializer that self-closes empty elements — confirmed against the
// user's own traktor_nml_cleaner.py, which runs his collection through
// Python's ElementTree — emits `<CUE_V2 ... />` instead of the paired
// `<CUE_V2 ...></CUE_V2>` form. Same for LOCATION below. Both forms must be
// recognized or the removal/anchor silently misses every entry the user's own
// tool has touched.
const CUE_V2_RE = /<CUE_V2\b[^>]*?(?:\/>|>[\s\S]*?<\/CUE_V2>)/g
const LOCATION_END_RE = /<LOCATION\b[^>]*?(?:\/>|>(?:(?!<\/LOCATION>)[\s\S])*<\/LOCATION>)/

// CUE_V2 elements are not always one contiguous run — another element can sit
// between two of them — so a single non-global replace can leave a later run
// behind, coexisting with the freshly written set. Global removal, then insert
// the fresh XML at one fixed anchor: right after LOCATION's close, the one
// element every ENTRY that reaches here is guaranteed to have (matches()
// requires it). This also covers the entry that had no CUE_V2 at all: nothing
// to remove, the new cues still land at the same anchor instead of being
// silently discarded.
//
// cuesToXml drops TYPE=4 when no usable bpm was passed (see its own comment) —
// but the removal above is unconditional, so without this guard a track that
// already had a saved beatgrid would lose it the moment it's patched with any
// cueTree and no bpm, which is the default today since no caller passes bpm
// yet. shiftTraktorCues faces the identical question (re-anchor a grid without
// a usable bpm) and refuses by returning null rather than writing a guess; the
// same refusal here means keeping whatever GRID element was already on disk
// instead of letting the unconditional removal above delete it for nothing.
function replaceCues(block: string, tree: Uint8Array, bpm: number | undefined): string {
  const markers = readTraktorMarkers(tree)
  // readTraktorMarkers never throws: a bad checksum, an unknown Traktor variant or
  // a truncated blob all come back as [] (see walkTraktorTree's `return null` paths
  // and the catch here). Removal below is unconditional, so treating [] the same as
  // "a tree with real cues to write" would wipe every hotcue the ENTRY already had
  // and insert nothing — an unreadable tree carries no information worth writing,
  // so leave the block exactly as it is instead of erasing what Traktor already has.
  if (markers.length === 0) return block
  const newCues = cuesToXml(tree, bpm)
  const droppedGrid = markers.some((m) => m.type === 4) && !newCues.includes('TYPE="4"')
  const existingGrid = droppedGrid
    ? block.match(new RegExp(CUE_V2_RE.source.replace('[^>]*?', '[^>]*?TYPE="4"[^>]*?')))?.[0]
    : undefined

  const withoutCues = block.replace(CUE_V2_RE, '')
  const cuesXml = existingGrid ? existingGrid + newCues : newCues
  const location = withoutCues.match(LOCATION_END_RE)?.[0]
  if (!location) return withoutCues
  // Replacement as a function, not a string: cuesXml carries cue NAMEs the DJ typed,
  // and a string replacement expands $&, $`, $' and $n inside it — a marker named
  // with a dollar sign would splice surrounding document text into the element and
  // write invalid XML into the collection. The callback form never interprets them.
  return withoutCues.replace(location, () => `${location}${cuesXml}`)
}

function patchEntry(block: string, patch: NmlPatch): string {
  let out = block
  if (patch.newFile) {
    // Callback form for the same reason replaceCues uses it: the file name is the DJ's
    // own, and a string replacement expands $&, $`, $' and $n inside it — a track named
    // with a dollar sign would splice surrounding document text into the attribute and
    // write invalid XML into the collection.
    const newFile = escapeAttr(patch.newFile)
    out = out.replace(/(<LOCATION\b[^>]*\bFILE)="[^"]*"/, (_m, prefix) => `${prefix}="${newFile}"`)
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
// patch just to count. This never rewrites the document it returns, only
// counts how many distinct patches actually changed the bytes of some entry —
// syncCollection reports this number as "N tracks updated", so a patch that
// matched an entry but produced no real change (e.g. a cueTree whose only
// marker was a grid dropped for lack of bpm, see replaceCues) must not count,
// or the caller would claim a write that never happened.
export function matchedPatchCount(nml: string, patches: NmlPatch[]): number {
  const entries = findEntries(nml)
  const index = indexPatches(patches)
  const matched = new Set<NmlPatch>()
  for (const entry of entries) {
    const patch = matchPatch(entry, index)
    if (!patch) continue
    const block = nml.slice(entry.start, entry.end)
    if (patchEntry(block, patch) !== block) matched.add(patch)
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
