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
  return m ? m[1] : ''
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

function patchEntry(block: string, patch: NmlPatch): string {
  let out = block
  if (patch.newFile) {
    out = out.replace(/(<LOCATION\b[^>]*\bFILE)="[^"]*"/, `$1="${escapeAttr(patch.newFile)}"`)
  }
  if (patch.clearCoverArt) {
    out = out.replace(/\s*COVERARTID="[^"]*"/, '')
  }
  if (patch.cueTree) {
    out = out.replace(/(<CUE_V2\b[^>]*>[\s\S]*?<\/CUE_V2>)+/, cuesToXml(patch.cueTree))
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
export function cuesToXml(tree: Uint8Array): string {
  return readTraktorMarkers(tree)
    .map(
      (m) =>
        `<CUE_V2 NAME="${escapeAttr(m.name)}" DISPL_ORDER="0" TYPE="${m.type}" ` +
        `START="${m.startMs.toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="${m.hotcue}"></CUE_V2>`,
    )
    .join('')
}
