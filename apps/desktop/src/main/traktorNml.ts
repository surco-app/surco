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

function attr(fragment: string, name: string): string {
  const m = fragment.match(new RegExp(`${name}="([^"]*)"`))
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
