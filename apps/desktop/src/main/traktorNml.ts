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
// (e.g. one written by Traktor, the other read back through Node's fs).
function matches(entry: NmlEntry, patch: NmlPatch): boolean {
  const volume = entry.volume.normalize('NFC') === patch.volume.normalize('NFC')
  const dir = entry.dir.normalize('NFC') === patch.dir.normalize('NFC')
  if (!volume || !dir) return false
  if (entry.file.normalize('NFC') === patch.file.normalize('NFC')) return true
  // Fallback: the AIFF→FLAC conversion case. The entry still points at the old
  // file, matched by base name so the track stays ONE entry in Traktor instead of
  // a second one appearing, which would drop its playlists and play history.
  return baseName(entry.file).normalize('NFC') === baseName(patch.file).normalize('NFC')
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
  let out = nml
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    const patch = patches.find((p) => matches(entry, p))
    if (!patch) continue
    const patched = patchEntry(out.slice(entry.start, entry.end), patch)
    out = out.slice(0, entry.start) + patched + out.slice(entry.end)
  }
  return out
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
