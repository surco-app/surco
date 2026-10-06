# Revisar metadatos en Apple Music: primera entrega

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una vista, abierta desde el menú Archivo y ⌘K, que lee la biblioteca de Music, agrupa grafías distintas de lo mismo y duplicados, y los arregla en Music y en el fichero con copia de seguridad, deshacer y recuento final.

**Architecture:** Main gana tres piezas pequeñas sobre lo que ya existe: un volcado de biblioteca con más campos (`applemusic.ts`), una escritura de uno o varios campos por TagLib sobre una copia (`musicFieldWrite.ts`, mismo patrón copia → `assertDecodable` → `keepOriginal` → `renameWithRetry` que `convertAudio`), y dos orquestadores con dependencias inyectadas (`musicReviewApply.ts`, `musicDuplicates.ts`). El renderer gana lógica pura (`musicSpelling.ts`, `musicFixPlan.ts`, `duplicates.ts` ampliado), un hook (`useMusicReview.ts`) y una vista (`MusicReview.tsx`) que ocupa la columna de la lista mientras está abierta. No se usa el pipeline de conversión: así no se cuelan normalización, recorte, auto-match ni el reetiquetado completo.

**Tech Stack:** TypeScript, Electron (main + preload + renderer React 19), node-taglib-sharp, AppleScript por `osascript`, Vitest + Testing Library, ffmpeg-static para fixtures.

**Spec:** `docs/superpowers/specs/2026-10-06-revisar-metadatos-music-design.md`

## Global Constraints

- **Solo macOS.** Todo IPC nuevo devuelve vacío o no hace nada fuera de `darwin`. Los comandos no se registran fuera de macOS (patrón `openApplePlaylist` en `lib/commands.ts`) y las entradas de menú solo se añaden en macOS.
- **Nada se escribe sin la hoja de confirmación.** Ni en Music ni en disco.
- **Escritura mínima.** Solo cambian los campos de la tanda. Un fichero solo se toca si su valor actual es exactamente (NFC) el que leyó la revisión en Music. El audio decodificado queda idéntico.
- **Music primero, como guarda.** Cada campo se escribe en Music solo si la entrada sigue diciendo lo que se leyó (comparación exacta con `considering case, diacriticals…`). Si Music dice otra cosa, ese fichero no se toca.
- **Copia de seguridad siempre** vía `keepOriginal` (Copias de seguridad de Surco). Ojo: `policyKeeper` no está cableado en producción (`main/index.ts:184`), así que hoy se guarda siempre; si alguien arregla eso, esta escritura debe seguir guardando copia. Lo fija el test de la Task 5 al pasar `reencodes: false` y comprobar que el keeper se llama.
- **Tests desde `apps/desktop`**: `cd apps/desktop && npm test -- <ruta>`. Desde la raíz se salta el setup y da fallos falsos.
- **Typecheck explícito**: `cd apps/desktop && npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`. `tsc --noEmit` pelado no comprueba nada.
- **Comentarios**: el repo comenta los porqués no evidentes (estilo de `tags.ts`); la regla global del usuario pide cero comentarios. Conflicto señalado: se sigue el repo, solo porqués, nunca qué hace el código.
- **Cada test nuevo se ve fallar** (TDD rojo) y, en la lógica crítica, se verifica por mutación: romper la implementación y ver el test en rojo.
- **Textos**: castellano llano, sin guion largo ni dos puntos de explicación; las cinco lenguas (`es`, `en`, `de`, `fr`, `pt-BR`) con las mismas claves (`keys.test.ts`).
- **Selectores de test**: `data-testid`.
- **Commits**: título descriptivo en inglés, sin cuerpo ni prefijos, uno por tarea, en la rama `worktree-revisar-metadatos-music`. Nunca `--no-verify`.

## Review Focus

- **Dos entradas de Music apuntando al mismo fichero real** (enlace simbólico, las 34 ambiguas de la biblioteca real): quitar una como duplicado NO puede mandar a la Papelera el fichero que usa la otra. Test en la Task 8.
- **WAV cuyo fichero dice otra cosa que Music** (o nada): se corrige Music y el fichero queda intacto, nunca se escribe un valor que no se ha visto en el fichero. Tests en las Tasks 5 y 7.
- **Entrada cambiada en Music entre la lectura y Aplicar**: Music responde `mismatch`, no se escribe nada en esa pista. Test en la Task 7.
- **Una pista de la tanda abierta también en la lista de Surco**: tras aplicar, la fila se relee del disco para que un Actualizar posterior no devuelva el valor viejo. Test en la Task 12.
- **Cancelar a mitad**: lo terminado queda hecho y es deshacible, lo pendiente no se toca. Test en la Task 7.

---

### Task 1: Volcado de revisión de la biblioteca

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (añadir tipos junto a `AppleMusicLookupCandidate`)
- Modify: `apps/desktop/src/main/applemusic.ts` (tras `dumpAppleMusicLibrary`)
- Modify: `apps/desktop/src/main/appleMusicIpc.ts` (dentro de `registerAppleMusicIpc`)
- Modify: `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/test/api.ts` si define un mock completo de `Api`
- Test: `apps/desktop/src/main/applemusic.test.ts`

**Interfaces:**
- Produces:
  - `type MusicReviewField = 'title' | 'artist' | 'albumArtist' | 'album' | 'genre'`
  - `interface MusicReviewEntry { persistentId: string; title: string; artist: string; albumArtist: string; album: string; genre: string; durationSec?: number }`
  - `buildReviewDumpScript(): string`, `parseReviewDump(stdout: string): MusicReviewEntry[]`, `dumpMusicReview(): Promise<MusicReviewEntry[]>`
  - IPC `applemusic:reviewDump`; preload `loadMusicReview(): Promise<MusicReviewEntry[]>`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `applemusic.test.ts` (importando `buildReviewDumpScript`, `parseReviewDump`):

```ts
describe('parseReviewDump', () => {
  const RS = '\u001e'
  const FS = '\u001f'
  const row = (...f: string[]) => f.join(FS)

  it('reads every field of a file track, with the duration Music prints in a comma locale', () => {
    const out = parseReviewDump(
      `${row('6E592CFE07A6246A', 'Bleeding Love', 'DJ Lara, DJ Sergi Val', 'DJ Lara', 'Bleeding Love', 'Electronic', '384,26')}\n`,
    )
    expect(out).toEqual([
      {
        persistentId: '6E592CFE07A6246A',
        title: 'Bleeding Love',
        artist: 'DJ Lara, DJ Sergi Val',
        albumArtist: 'DJ Lara',
        album: 'Bleeding Love',
        genre: 'Electronic',
        durationSec: 384,
      },
    ])
  })

  // The whole point of the review is the value exactly as Music holds it: a trailing
  // space or an invisible character is a finding, so nothing may be trimmed away.
  it('keeps invisible characters, tabs and spaces inside a value', () => {
    const [e] = parseReviewDump(row('5FA52DD35E307CBB', 'Funk\tFreak ', 'Aar​ó​n Alfonso', '', '', '', '419'))
    expect(e.title).toBe('Funk\tFreak ')
    expect(e.artist).toBe('Aar​ó​n Alfonso')
  })

  it('splits rows on the record separator, not on line breaks a title may hold', () => {
    const out = parseReviewDump(
      [row('0000000000000001', 'A\nB', 'X', '', '', '', '1'), row('0000000000000002', 'C', 'Y', '', '', '', '2')].join(RS),
    )
    expect(out.map((e) => e.title)).toEqual(['A\nB', 'C'])
  })

  it('drops a row that is not seven fields or has no persistent ID', () => {
    expect(parseReviewDump(row('nope', 'A', 'B', '', '', '', '1'))).toEqual([])
    expect(parseReviewDump(row('0000000000000001', 'A'))).toEqual([])
  })

  it('reads an empty library as no entries', () => {
    expect(parseReviewDump('')).toEqual([])
    expect(parseReviewDump('\n')).toEqual([])
  })
})

describe('buildReviewDumpScript', () => {
  // Only file tracks can be fixed on disk, and asking an empty library for a property of
  // every track raises -1728 (see buildLibraryDumpScript), so the count guards first.
  it('reads file tracks only and returns nothing for an empty library', () => {
    const script = buildReviewDumpScript()
    expect(script).toContain('if (count of file tracks of library playlist 1) is 0 then return ""')
    expect(script).toContain('album artist of every file track of library playlist 1')
    expect(script).not.toMatch(/of every track of/)
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/main/applemusic.test.ts`
Expected: FAIL, `parseReviewDump is not a function` (o error de import).

- [ ] **Step 3: Implementar**

En `shared/types.ts`:

```ts
export type MusicReviewField = 'title' | 'artist' | 'albumArtist' | 'album' | 'genre'

export interface MusicReviewEntry {
  persistentId: string
  title: string
  artist: string
  albumArtist: string
  album: string
  genre: string
  durationSec?: number
}
```

En `applemusic.ts`, tras `dumpAppleMusicLibrary`:

```ts
const REVIEW_RS = '\u001e'
const REVIEW_FS = '\u001f'

// The review reads the values to correct, so it uses control separators instead of the
// tabs and newlines the membership dump uses: a title can hold either, and losing or
// trimming a character here would hide exactly what the review exists to find.
export function buildReviewDumpScript(): string {
  const of = (prop: string) => `${prop} of every file track of library playlist 1`
  return [
    'tell application "Music"',
    '  if (count of file tracks of library playlist 1) is 0 then return ""',
    `  set thePids to ${of('persistent ID')}`,
    `  set theNames to ${of('name')}`,
    `  set theArtists to ${of('artist')}`,
    `  set theAlbumArtists to ${of('album artist')}`,
    `  set theAlbums to ${of('album')}`,
    `  set theGenres to ${of('genre')}`,
    `  set theDurations to ${of('duration')}`,
    'end tell',
    'set RS to ASCII character 30',
    'set FS to ASCII character 31',
    'set out to {}',
    'repeat with i from 1 to count of thePids',
    '  set end of out to (item i of thePids) & FS & (item i of theNames) & FS & (item i of theArtists) & FS & (item i of theAlbumArtists) & FS & (item i of theAlbums) & FS & (item i of theGenres) & FS & (item i of theDurations)',
    'end repeat',
    "set AppleScript's text item delimiters to RS",
    'return out as text',
  ].join('\n')
}

export function parseReviewDump(stdout: string): MusicReviewEntry[] {
  const entries: MusicReviewEntry[] = []
  const body = stdout.replace(/\n$/, '')
  if (!body) return entries
  for (const row of body.split(REVIEW_RS)) {
    const fields = row.split(REVIEW_FS)
    if (fields.length !== 7) continue
    const [persistentId, title, artist, albumArtist, album, genre, duration] = fields
    if (!/^[0-9A-F]{16}$/.test(persistentId)) continue
    const entry: MusicReviewEntry = { persistentId, title, artist, albumArtist, album, genre }
    const sec = Math.round(Number(duration.replace(',', '.')))
    if (Number.isFinite(sec) && sec > 0) entry.durationSec = sec
    entries.push(entry)
  }
  return entries
}

export async function dumpMusicReview(): Promise<MusicReviewEntry[]> {
  const stdout = await runOsascript(buildReviewDumpScript(), { maxBuffer: 64 * 1024 * 1024 })
  return parseReviewDump(stdout)
}
```

(Importar `MusicReviewEntry` en el `import type` de `../shared/types` que ya tiene el fichero.)

En `appleMusicIpc.ts`, dentro de `registerAppleMusicIpc`, junto a `applemusic:library`:

```ts
  ipcMain.handle('applemusic:reviewDump', () =>
    process.platform === 'darwin' ? appleMusicLimiter.run(() => dumpMusicReview()) : [],
  )
```

En `preload/api.ts` (junto a `loadAppleMusicLibrary`): `loadMusicReview: () => Promise<MusicReviewEntry[]>`
En `preload/index.ts`: `loadMusicReview: () => ipcRenderer.invoke('applemusic:reviewDump'),`

- [ ] **Step 4: Ver que pasan y que compila**

Run: `cd apps/desktop && npm test -- src/main/applemusic.test.ts`
Expected: PASS.
Run el typecheck de Global Constraints. Expected: sin errores (si `renderer/src/test/api.ts` construye un `Api` completo, añadir `loadMusicReview: vi.fn()` ahí).

- [ ] **Step 5: Mutación**

Cambiar `fields.length !== 7` por `fields.length < 2` y ver en rojo el test de las siete columnas; deshacer.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/applemusic.ts apps/desktop/src/main/appleMusicIpc.ts apps/desktop/src/main/applemusic.test.ts apps/desktop/src/preload apps/desktop/src/renderer/src/test/api.ts
git commit -m "Read the Music library's names, albums and genres for the metadata review"
```

---

### Task 2: Grupos de grafías

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/musicSpelling.ts`
- Test: `apps/desktop/src/renderer/src/lib/musicSpelling.test.ts`

**Interfaces:**
- Consumes: `MusicReviewEntry`, `MusicReviewField` (Task 1).
- Produces:
  - `type SpellingKind = 'invisible' | 'case' | 'punctuation' | 'typo'`
  - `interface SpellingVariant { value: string; persistentIds: string[] }`
  - `interface SpellingGroup { key: string; field: MusicReviewField; kind: SpellingKind; variants: SpellingVariant[]; suggested: string | null }`
  - `splitActs(value: string): string[]`, `replaceAct(value: string, from: string, to: string): string`
  - `spellingGroups(entries: MusicReviewEntry[]): SpellingGroup[]`
  - `SAFE_KINDS: ReadonlySet<SpellingKind>` (`invisible`, `case`, `punctuation`)

Reglas (del spec y de lo medido):
- Artista y album artist se parten en actos (`,` `&` `feat.` `ft.` `featuring` `vs.` `pres.` ` x `).
- Álbum se agrupa dentro del mismo album artist (o artista si está vacío): `NEED YOU` de un artista y `Need You` de otro son dos discos.
- Género solo si es un valor único (sin `,` `;` `/`).
- Título solo se revisa por invisibles.
- Clave de mayúsculas: sin invisibles, NFD sin marcas, minúsculas. Clave de puntuación: la anterior sin nada que no sea letra o número.
- Varios valores exactos con la misma clave de puntuación forman grupo: `invisible` si alguno tiene invisibles o espacios sobrantes, `case` si todos comparten clave de mayúsculas, `punctuation` si no.
- `typo` une claves de puntuación de al menos 5 letras a distancia 1 (menos de 9 letras) o 2, si sus dígitos coinciden.
- Sugerencia: la variante limpia con más pistas; en empate, la que no está toda en mayúsculas ni toda en minúsculas; si sigue el empate, `null`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, expect, it } from 'vitest'
import type { MusicReviewEntry } from '../../../shared/types'
import { replaceAct, spellingGroups, splitActs } from './musicSpelling'

let n = 0
function entry(over: Partial<MusicReviewEntry>): MusicReviewEntry {
  n += 1
  return {
    persistentId: n.toString(16).toUpperCase().padStart(16, '0'),
    title: `T${n}`,
    artist: '',
    albumArtist: '',
    album: '',
    genre: '',
    ...over,
  }
}
const many = (count: number, over: Partial<MusicReviewEntry>) =>
  Array.from({ length: count }, () => entry(over))
const byField = (groups: ReturnType<typeof spellingGroups>, field: string) =>
  groups.filter((g) => g.field === field)

describe('splitActs / replaceAct', () => {
  it('splits a collaboration into its acts', () => {
    expect(splitActs('DJ Lara, DJ Sergi Val')).toEqual(['DJ Lara', 'DJ Sergi Val'])
    expect(splitActs('OceanLab x Ferry Corsten')).toEqual(['OceanLab', 'Ferry Corsten'])
    expect(splitActs('Alex C. Feat. Yasmin K.')).toEqual(['Alex C.', 'Yasmin K.'])
  })

  it('renames one act and leaves the rest of the credit as it was written', () => {
    expect(replaceAct('Dj Lara, DJ Sergi Val', 'Dj Lara', 'DJ Lara')).toBe('DJ Lara, DJ Sergi Val')
    expect(replaceAct('Dj Laraa & Dj Lara', 'Dj Lara', 'DJ Lara')).toBe('Dj Laraa & DJ Lara')
  })
})

describe('spellingGroups', () => {
  it('groups the same act written with other capitals and suggests the common spelling', () => {
    const groups = spellingGroups([...many(11, { artist: 'DJ Lara' }), entry({ artist: 'Dj Lara' })])
    const [g] = byField(groups, 'artist')
    expect(g.kind).toBe('case')
    expect(g.suggested).toBe('DJ Lara')
    expect(g.variants.map((v) => [v.value, v.persistentIds.length])).toEqual([
      ['DJ Lara', 11],
      ['Dj Lara', 1],
    ])
  })

  it('finds an act inside a collaboration', () => {
    const groups = spellingGroups([
      ...many(3, { artist: 'DJ Lara' }),
      entry({ artist: 'Dj Lara, DJ Sergi Val' }),
    ])
    expect(byField(groups, 'artist')[0].variants.map((v) => v.value)).toEqual(['DJ Lara', 'Dj Lara'])
  })

  // Measured on the real library: "Christian Millán" twice, one composed and one not.
  it('treats a composed and a decomposed accent as two spellings of one name', () => {
    const groups = spellingGroups([
      entry({ albumArtist: 'Christian Millán' }),
      entry({ albumArtist: 'Christian Millán' }),
    ])
    expect(byField(groups, 'albumArtist')[0].kind).toBe('case')
  })

  it('calls an apostrophe or a space a punctuation difference', () => {
    const groups = spellingGroups([...many(44, { artist: "Head Horny's" }), ...many(5, { artist: 'Head Horny´s' })])
    const [g] = byField(groups, 'artist')
    expect(g.kind).toBe('punctuation')
    expect(g.suggested).toBe("Head Horny's")
  })

  it('flags invisible characters even when nothing else is spelled differently', () => {
    const groups = spellingGroups([entry({ artist: 'Aar​ó​n Alfonso' })])
    const [g] = byField(groups, 'artist')
    expect(g.kind).toBe('invisible')
    expect(g.suggested).toBe('Aarón Alfonso')
  })

  it('checks titles for invisible characters only', () => {
    const groups = spellingGroups([
      entry({ title: 'El Trayon 2​.​0' }),
      entry({ title: 'Bleeding Love' }),
      entry({ title: 'bleeding love' }),
    ])
    const titles = byField(groups, 'title')
    expect(titles).toHaveLength(1)
    expect(titles[0].suggested).toBe('El Trayon 2.0')
  })

  it('suggests a likely typo but never marks it safe and names no winner on a tie', () => {
    const groups = spellingGroups([...many(2, { artist: 'Rachel Auburn' }), ...many(2, { artist: 'Rahcel Auburn' })])
    const [g] = byField(groups, 'artist')
    expect(g.kind).toBe('typo')
    expect(g.suggested).toBeNull()
  })

  it('does not call two names a typo when their numbers differ', () => {
    expect(spellingGroups([entry({ album: 'Hits Vol 1' }), entry({ album: 'Hits Vol 2' })])).toEqual([])
  })

  it('keeps albums of different artists apart', () => {
    const groups = spellingGroups([
      entry({ album: 'Need You', albumArtist: 'A' }),
      entry({ album: 'NEED YOU', albumArtist: 'B' }),
    ])
    expect(byField(groups, 'album')).toEqual([])
  })

  it('leaves a genre with several values alone', () => {
    const groups = spellingGroups([entry({ genre: 'Electronic, Latin, Pop' }), entry({ genre: 'electronic, latin, pop' })])
    expect(byField(groups, 'genre')).toEqual([])
  })

  it('gives the same group the same key on every read, so an ignore sticks', () => {
    const make = () => spellingGroups([...many(2, { genre: 'Electronic' }), entry({ genre: 'electronic' })])
    expect(make()[0].key).toBe(make()[0].key)
  })

  it('reports nothing for a clean library', () => {
    expect(spellingGroups([...many(3, { artist: 'DJ Lara', album: 'X', genre: 'House' })])).toEqual([])
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/musicSpelling.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `musicSpelling.ts`**

```ts
import type { MusicReviewEntry, MusicReviewField } from '../../../shared/types'

export type SpellingKind = 'invisible' | 'case' | 'punctuation' | 'typo'

export interface SpellingVariant {
  value: string
  persistentIds: string[]
}

export interface SpellingGroup {
  key: string
  field: MusicReviewField
  kind: SpellingKind
  variants: SpellingVariant[]
  suggested: string | null
}

export const SAFE_KINDS: ReadonlySet<SpellingKind> = new Set(['invisible', 'case', 'punctuation'])

const INVISIBLE = /[​-‏⁠﻿­]/g
const ACT_SEPARATOR = /(\s*,\s*|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring|vs\.?|pres\.?)\s+|\s+x\s+)/i
const MULTI_VALUE = /[,;/]/
const KIND_ORDER: SpellingKind[] = ['invisible', 'case', 'punctuation', 'typo']

export function splitActs(value: string): string[] {
  return value
    .split(ACT_SEPARATOR)
    .filter((_, i) => i % 2 === 0)
    .map((act) => act.trim())
    .filter(Boolean)
}

export function replaceAct(value: string, from: string, to: string): string {
  return value
    .split(ACT_SEPARATOR)
    .map((part, i) => (i % 2 === 0 && part.trim() === from ? part.replace(from, to) : part))
    .join('')
}

function clean(value: string): string {
  return value.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
}

function isClean(value: string): boolean {
  return clean(value) === value
}

function caseKey(value: string): string {
  return clean(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function punctuationKey(value: string): string {
  return caseKey(value).replace(/[^\p{L}\p{N}]+/gu, '')
}

function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++)
      row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)))
    prev = row
  }
  return prev[b.length]
}

function isTypoPair(a: string, b: string): boolean {
  const shorter = Math.min(a.length, b.length)
  if (shorter < 5) return false
  if (a.replace(/\D/g, '') !== b.replace(/\D/g, '')) return false
  const limit = shorter < 9 ? 1 : 2
  return distance(a, b, limit) <= limit
}

function mixedCase(value: string): boolean {
  return value !== value.toUpperCase() && value !== value.toLowerCase()
}

function suggest(variants: SpellingVariant[]): string | null {
  const candidates = variants.filter((v) => isClean(v.value))
  if (candidates.length === 0) return clean(variants[0].value)
  const top = candidates[0].persistentIds.length
  const tied = candidates.filter((v) => v.persistentIds.length === top)
  if (tied.length === 1) return tied[0].value
  const mixed = tied.filter((v) => mixedCase(v.value))
  return mixed.length === 1 ? mixed[0].value : null
}

type Bucket = Map<string, Map<string, Set<string>>>

function valuesOf(entry: MusicReviewEntry, field: MusicReviewField): { scope: string; value: string }[] {
  switch (field) {
    case 'artist':
    case 'albumArtist':
      return splitActs(entry[field]).map((value) => ({ scope: '', value }))
    case 'album':
      return entry.album
        ? [{ scope: punctuationKey(entry.albumArtist || entry.artist), value: entry.album }]
        : []
    case 'genre':
      return entry.genre && !MULTI_VALUE.test(entry.genre) ? [{ scope: '', value: entry.genre }] : []
    case 'title':
      return entry.title && !isClean(entry.title) ? [{ scope: '', value: entry.title }] : []
  }
}

function collect(entries: MusicReviewEntry[], field: MusicReviewField): Map<string, Bucket> {
  const scopes = new Map<string, Bucket>()
  for (const entry of entries) {
    for (const { scope, value } of valuesOf(entry, field)) {
      const clusters = scopes.get(scope) ?? new Map()
      scopes.set(scope, clusters)
      const key = punctuationKey(value)
      if (!key) continue
      const exact = clusters.get(key) ?? new Map<string, Set<string>>()
      clusters.set(key, exact)
      const ids = exact.get(value) ?? new Set<string>()
      exact.set(value, ids)
      ids.add(entry.persistentId)
    }
  }
  return scopes
}

function variantsOf(...clusters: Map<string, Set<string>>[]): SpellingVariant[] {
  return clusters
    .flatMap((c) => [...c].map(([value, ids]) => ({ value, persistentIds: [...ids].sort() })))
    .sort((a, b) => b.persistentIds.length - a.persistentIds.length || a.value.localeCompare(b.value))
}

function groupKey(field: MusicReviewField, scope: string, keys: string[], kind: SpellingKind): string {
  return [field, scope, kind, ...[...keys].sort()].join('|')
}

function kindOf(variants: SpellingVariant[]): SpellingKind {
  if (variants.some((v) => !isClean(v.value))) return 'invisible'
  return new Set(variants.map((v) => caseKey(v.value))).size === 1 ? 'case' : 'punctuation'
}

function typoGroups(field: MusicReviewField, scope: string, clusters: Bucket): SpellingGroup[] {
  const keys = [...clusters.keys()]
  const parent = new Map(keys.map((k) => [k, k]))
  const find = (k: string): string => {
    const p = parent.get(k) as string
    if (p === k) return k
    const root = find(p)
    parent.set(k, root)
    return root
  }
  const byLength = new Map<number, string[]>()
  for (const k of keys) byLength.set(k.length, [...(byLength.get(k.length) ?? []), k])
  for (const a of keys) {
    for (let len = a.length; len <= a.length + 2; len++) {
      for (const b of byLength.get(len) ?? []) {
        if (b <= a && len === a.length) continue
        if (isTypoPair(a, b)) parent.set(find(a), find(b))
      }
    }
  }
  const sets = new Map<string, string[]>()
  for (const k of keys) sets.set(find(k), [...(sets.get(find(k)) ?? []), k])
  return [...sets.values()]
    .filter((members) => members.length > 1)
    .map((members) => {
      const variants = variantsOf(...members.map((k) => clusters.get(k) as Map<string, Set<string>>))
      return {
        key: groupKey(field, scope, members, 'typo'),
        field,
        kind: 'typo' as const,
        variants,
        suggested: suggest(variants),
      }
    })
}

const FIELDS: MusicReviewField[] = ['artist', 'albumArtist', 'album', 'genre', 'title']

export function spellingGroups(entries: MusicReviewEntry[]): SpellingGroup[] {
  const groups: SpellingGroup[] = []
  for (const field of FIELDS) {
    for (const [scope, clusters] of collect(entries, field)) {
      for (const [key, exact] of clusters) {
        const variants = variantsOf(exact)
        if (variants.length < 2 && isClean(variants[0].value)) continue
        const kind = kindOf(variants)
        groups.push({ key: groupKey(field, scope, [key], kind), field, kind, variants, suggested: suggest(variants) })
      }
      if (field !== 'title') groups.push(...typoGroups(field, scope, clusters))
    }
  }
  const tracks = (g: SpellingGroup) => g.variants.reduce((n, v) => n + v.persistentIds.length, 0)
  return groups.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || tracks(b) - tracks(a))
}
```

- [ ] **Step 4: Ver que pasan**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/musicSpelling.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutaciones**

Una a una, viendo rojo y deshaciendo: quitar el filtro de dígitos en `isTypoPair`; quitar `scope` del álbum (devolver `''`); cambiar `return mixed.length === 1 ? … : null` por `return tied[0].value`.

- [ ] **Step 6: Contraste con la biblioteca real (solo lectura)**

Con la app de la Task 12 aún no hecha, comprobarlo desde un test temporal no commiteado o un script con el volcado de la Task 1. Esperado aproximado (medido el 06/10 con 2044 pistas): 2 `invisible` de actos o títulos, ~22 grupos de mayúsculas de actos, 16 de album artist, 5 de álbum, 3 de género, ~30 `typo`. Una desviación grande es un fallo de la regla, no del recuento.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/musicSpelling.ts apps/desktop/src/renderer/src/lib/musicSpelling.test.ts
git commit -m "Group names spelled differently across the Music library"
```

---

### Task 3: Duplicados por grabación y duración

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/duplicates.ts`
- Test: `apps/desktop/src/renderer/src/lib/duplicates.test.ts`

**Interfaces:**
- Consumes: `splitActs` (Task 2), `foldText` (`lib/normalizeText.ts`).
- Produces:
  - `interface RecordingItem { id: string; artist: string; title: string; durationSec?: number }`
  - `interface DuplicateGroup { key: string; kind: 'duplicate' | 'version'; ids: string[] }`
  - `SAME_RECORDING_SEC = 3`, `recordingKey(artist: string, title: string): string | null`, `duplicateGroups(items: RecordingItem[]): DuplicateGroup[]`
  - `duplicateIds(tracks)` mantiene su firma y ahora solo marca los `duplicate`.

- [ ] **Step 1: Escribir los tests que fallan** (añadir al `duplicates.test.ts` existente, sin borrar sus casos)

```ts
import { duplicateGroups, recordingKey } from './duplicates'

describe('recordingKey', () => {
  it('reads "(Original Mix)" as the plain title', () => {
    expect(recordingKey('DJ Ter', 'This Rap (Original Mix)')).toBe(recordingKey('Dj Ter', 'This Rap'))
  })

  it('ignores a featuring credit in the title and the order of the acts', () => {
    expect(recordingKey('A & B', 'Song (feat. C)')).toBe(recordingKey('B, A', 'Song'))
  })

  it('keeps a named mix apart from the original', () => {
    expect(recordingKey('A', 'Song (Extended Mix)')).not.toBe(recordingKey('A', 'Song'))
  })
})

describe('duplicateGroups', () => {
  const item = (id: string, title: string, durationSec?: number) => ({ id, artist: 'Transfer', title, durationSec })

  it('groups copies that last the same', () => {
    expect(duplicateGroups([item('a', 'Possession', 323), item('b', 'Possession', 323), item('c', 'Possession', 325)])).toEqual([
      expect.objectContaining({ kind: 'duplicate', ids: ['a', 'b', 'c'] }),
    ])
  })

  // Measured: "Make My Body Move [ADC075]" at 6:57 and 5:07 is another edit, which the
  // old artist+title rule marked as a duplicate to remove.
  it('calls the same title with a different length another version, not a duplicate', () => {
    expect(duplicateGroups([item('a', 'Make My Body Move', 417), item('b', 'Make My Body Move', 307)])).toEqual([
      expect.objectContaining({ kind: 'version', ids: ['a', 'b'] }),
    ])
  })

  it('keeps grouping copies whose length is unknown, as before', () => {
    expect(duplicateGroups([item('a', 'X'), item('b', 'X')])).toEqual([
      expect.objectContaining({ kind: 'duplicate', ids: ['a', 'b'] }),
    ])
  })
})
```

Y en el `describe('duplicateIds')` existente:

```ts
  it('stops flagging two edits of different length as duplicates', () => {
    const ids = duplicateIds([
      track({ id: 'a', duration: 417, meta: { ...emptyMetadata(), artist: 'ADC', title: 'Move' } }),
      track({ id: 'b', duration: 307, meta: { ...emptyMetadata(), artist: 'ADC', title: 'Move' } }),
    ])
    expect(ids.size).toBe(0)
  })
```

(Usar el helper de fila que ya tenga el fichero; si no tiene `track`, crear uno como el de `useAppleMusicFill.test.tsx`.)

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/duplicates.test.ts`
Expected: FAIL en los nuevos; los antiguos siguen verdes.

- [ ] **Step 3: Implementar** (sustituye el cuerpo de `duplicates.ts`)

```ts
import type { TrackItem } from '../types'
import { splitActs } from './musicSpelling'
import { foldText } from './normalizeText'

export interface RecordingItem {
  id: string
  artist: string
  title: string
  durationSec?: number
}

export interface DuplicateGroup {
  key: string
  kind: 'duplicate' | 'version'
  ids: string[]
}

export const SAME_RECORDING_SEC = 3

const FEATURING = /[([]\s*(?:feat|ft|featuring)\.?\s[^)\]]*[)\]]/gi
const ORIGINAL = /[([]\s*original(?:\s+(?:mix|version))?\s*[)\]]/gi

export function recordingKey(artist: string, title: string): string | null {
  const acts = [...new Set(splitActs(artist).map(foldText).filter(Boolean))].sort()
  const core = foldText(title.replace(FEATURING, '').replace(ORIGINAL, ''))
  if (acts.length === 0 || !core) return null
  return `${acts.join('+')}|${core}`
}

// Single-link clusters by length: a third copy 2 s off the second still joins the first.
function byLength(items: RecordingItem[]): RecordingItem[][] {
  const sorted = [...items].sort((a, b) => (a.durationSec ?? 0) - (b.durationSec ?? 0))
  const clusters: RecordingItem[][] = []
  for (const item of sorted) {
    const last = clusters.at(-1)
    const prev = last?.at(-1)
    if (last && prev && Math.abs((item.durationSec ?? 0) - (prev.durationSec ?? 0)) <= SAME_RECORDING_SEC)
      last.push(item)
    else clusters.push([item])
  }
  return clusters
}

export function duplicateGroups(items: RecordingItem[]): DuplicateGroup[] {
  const byKey = new Map<string, RecordingItem[]>()
  for (const item of items) {
    const key = recordingKey(item.artist, item.title)
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), item])
  }
  const groups: DuplicateGroup[] = []
  for (const [key, members] of byKey) {
    if (members.length < 2) continue
    if (members.some((m) => m.durationSec === undefined)) {
      groups.push({ key, kind: 'duplicate', ids: members.map((m) => m.id) })
      continue
    }
    const clusters = byLength(members)
    for (const c of clusters)
      if (c.length > 1) groups.push({ key, kind: 'duplicate', ids: c.map((m) => m.id) })
    if (clusters.length > 1) groups.push({ key: `${key}|version`, kind: 'version', ids: members.map((m) => m.id) })
  }
  return groups
}

export function duplicateIds(tracks: TrackItem[]): Set<string> {
  const groups = duplicateGroups(
    tracks.map((t) => ({
      id: t.id,
      artist: t.meta.artist ?? '',
      title: t.meta.title ?? '',
      durationSec: t.duration,
    })),
  )
  return new Set(groups.filter((g) => g.kind === 'duplicate').flatMap((g) => g.ids))
}
```

Nota: la regla de antes ignoraba filas sin artista o sin título; `recordingKey` devuelve `null` en ese caso y se mantiene.

- [ ] **Step 4: Ver que pasan, incluida la suite que usa el chip**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/duplicates.test.ts src/renderer/src/hooks/useTracksView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mutación**

Cambiar `<= SAME_RECORDING_SEC` por `<= 1000` y ver rojo el test de ADC075; deshacer.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/duplicates.ts apps/desktop/src/renderer/src/lib/duplicates.test.ts
git commit -m "Find duplicates past an Original Mix suffix and tell another edit apart by its length"
```

---

### Task 4: Plan de cambios por pista

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/musicFixPlan.ts`
- Modify: `apps/desktop/src/shared/types.ts` (`MusicFieldFix`)
- Test: `apps/desktop/src/renderer/src/lib/musicFixPlan.test.ts`

**Interfaces:**
- Consumes: `SpellingGroup`, `replaceAct` (Task 2), `MusicReviewEntry` (Task 1).
- Produces:
  - `interface MusicFieldFix { persistentId: string; field: MusicReviewField; from: string; to: string }` (en `shared/types.ts`, main la usa)
  - `interface GroupChoice { group: SpellingGroup; to: string }`
  - `planFixes(entries: MusicReviewEntry[], choices: GroupChoice[]): MusicFieldFix[]`
  - `summarizeFixes(fixes: MusicFieldFix[]): { tracks: number; byField: Partial<Record<MusicReviewField, number>> }`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, expect, it } from 'vitest'
import type { MusicReviewEntry } from '../../../shared/types'
import { planFixes, summarizeFixes } from './musicFixPlan'
import { spellingGroups } from './musicSpelling'

const e = (persistentId: string, over: Partial<MusicReviewEntry>): MusicReviewEntry => ({
  persistentId,
  title: 'T',
  artist: '',
  albumArtist: '',
  album: '',
  genre: '',
  ...over,
})

describe('planFixes', () => {
  it('rewrites the act inside the full credit Music holds', () => {
    const entries = [e('A', { artist: 'DJ Lara' }), e('B', { artist: 'DJ Lara' }), e('C', { artist: 'Dj Lara, DJ Sergi Val' })]
    const [group] = spellingGroups(entries)
    expect(planFixes(entries, [{ group, to: 'DJ Lara' }])).toEqual([
      { persistentId: 'C', field: 'artist', from: 'Dj Lara, DJ Sergi Val', to: 'DJ Lara, DJ Sergi Val' },
    ])
  })

  it('folds two choices that touch the same credit into one change', () => {
    const entries = [
      e('A', { artist: 'DJ Lara' }),
      e('B', { artist: 'DJ Lara' }),
      e('C', { artist: 'Dj Lara & dj sergi val' }),
      e('D', { artist: 'DJ Sergi Val' }),
      e('F', { artist: 'DJ Sergi Val' }),
    ]
    const groups = spellingGroups(entries).filter((g) => g.field === 'artist')
    const fixes = planFixes(entries, groups.map((group) => ({ group, to: group.suggested as string })))
    expect(fixes).toEqual([{ persistentId: 'C', field: 'artist', from: 'Dj Lara & dj sergi val', to: 'DJ Lara & DJ Sergi Val' }])
  })

  it('replaces a whole album or genre only where it equals the variant', () => {
    const entries = [e('A', { genre: 'Electronic' }), e('B', { genre: 'Electronic' }), e('C', { genre: 'electronic' })]
    const [group] = spellingGroups(entries)
    expect(planFixes(entries, [{ group, to: 'Electronic' }])).toEqual([
      { persistentId: 'C', field: 'genre', from: 'electronic', to: 'Electronic' },
    ])
  })

  it('plans nothing when the chosen spelling is what every track already has', () => {
    const entries = [e('A', { genre: 'Electronic' }), e('C', { genre: 'electronic' })]
    const [group] = spellingGroups(entries)
    const onlyChosen = { ...group, variants: group.variants.filter((v) => v.value === 'Electronic') }
    expect(planFixes(entries, [{ group: onlyChosen, to: 'Electronic' }])).toEqual([])
  })
})

describe('summarizeFixes', () => {
  it('counts tracks once and changes per field', () => {
    expect(
      summarizeFixes([
        { persistentId: 'A', field: 'artist', from: 'a', to: 'b' },
        { persistentId: 'A', field: 'genre', from: 'a', to: 'b' },
        { persistentId: 'B', field: 'artist', from: 'a', to: 'b' },
      ]),
    ).toEqual({ tracks: 2, byField: { artist: 2, genre: 1 } })
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/musicFixPlan.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

En `shared/types.ts`:

```ts
export interface MusicFieldFix {
  persistentId: string
  field: MusicReviewField
  from: string
  to: string
}
```

`musicFixPlan.ts`:

```ts
import type { MusicFieldFix, MusicReviewEntry, MusicReviewField } from '../../../shared/types'
import { replaceAct, type SpellingGroup } from './musicSpelling'

export interface GroupChoice {
  group: SpellingGroup
  to: string
}

const ACT_FIELDS: ReadonlySet<MusicReviewField> = new Set(['artist', 'albumArtist'])

export function planFixes(entries: MusicReviewEntry[], choices: GroupChoice[]): MusicFieldFix[] {
  const byPid = new Map(entries.map((entry) => [entry.persistentId, entry]))
  const next = new Map<string, { persistentId: string; field: MusicReviewField; value: string }>()
  for (const { group, to } of choices) {
    for (const variant of group.variants) {
      if (variant.value === to) continue
      for (const persistentId of variant.persistentIds) {
        const entry = byPid.get(persistentId)
        if (!entry) continue
        const key = `${persistentId}|${group.field}`
        const before = next.get(key)?.value ?? entry[group.field]
        const after = ACT_FIELDS.has(group.field)
          ? replaceAct(before, variant.value, to)
          : before === variant.value
            ? to
            : before
        next.set(key, { persistentId, field: group.field, value: after })
      }
    }
  }
  const fixes: MusicFieldFix[] = []
  for (const { persistentId, field, value } of next.values()) {
    const from = (byPid.get(persistentId) as MusicReviewEntry)[field]
    if (from !== value) fixes.push({ persistentId, field, from, to: value })
  }
  return fixes
}

export function summarizeFixes(fixes: MusicFieldFix[]): {
  tracks: number
  byField: Partial<Record<MusicReviewField, number>>
} {
  const byField: Partial<Record<MusicReviewField, number>> = {}
  for (const fix of fixes) byField[fix.field] = (byField[fix.field] ?? 0) + 1
  return { tracks: new Set(fixes.map((f) => f.persistentId)).size, byField }
}
```

- [ ] **Step 4: Ver que pasan**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/musicFixPlan.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutación**

Cambiar `next.get(key)?.value ?? entry[group.field]` por `entry[group.field]` y ver rojo el test de las dos elecciones; deshacer.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/renderer/src/lib/musicFixPlan.ts apps/desktop/src/renderer/src/lib/musicFixPlan.test.ts
git commit -m "Turn the chosen spellings into one change per track and field"
```

---

### Task 5: Escribir campos en el fichero sin tocar nada más

**Files:**
- Create: `apps/desktop/src/main/musicFieldWrite.ts`
- Modify: `apps/desktop/src/main/workerJobs.ts` (job `setTagFields` y su resultado)
- Test: `apps/desktop/src/main/musicFieldWrite.test.ts`

**Interfaces:**
- Consumes: `MusicReviewField` (Task 1), `convertTmpPath`, `assertDecodable` (`ffmpeg.ts`), `keepOriginal`, `discardBackup` (`originalKeeper.ts`), `renameWithRetry` (`renameRetry.ts`), `runInWorker` (`worker.ts`).
- Produces:
  - `type FieldWrite = 'written' | 'unchanged'`
  - `interface TagFieldChange { field: MusicReviewField; from: string; to: string }`
  - `setTagFields(file: string, changes: TagFieldChange[]): FieldWrite[]` (síncrona, corre en el worker)
  - `rewriteTagFields(file: string, changes: TagFieldChange[]): Promise<{ outcomes: FieldWrite[]; backup?: TrashEntry }>`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  type Id3v2Tag,
  Id3v2PrivateFrame,
  StringType,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { rewriteTagFields } from './musicFieldWrite'
import { configureOriginalKeeper } from './originalKeeper'
import { diffSnapshots, snapshotTags } from './tagSnapshot'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-field-write-'))
const FORMATS = [
  { ext: 'mp3', codec: ['-c:a', 'libmp3lame', '-b:a', '320k'] },
  { ext: 'flac', codec: ['-c:a', 'flac'] },
  { ext: 'aiff', codec: ['-c:a', 'pcm_s16be'] },
  { ext: 'wav', codec: ['-c:a', 'pcm_s16le'] },
  { ext: 'm4a', codec: ['-c:a', 'alac'] },
] as const

function audioMd5(file: string): string {
  return execFileSync(FF, ['-v', 'error', '-i', file, '-map', '0:a', '-f', 'md5', '-']).toString().trim()
}

function make(ext: string, codec: readonly string[], artist: string): string {
  const file = join(dir, `${ext}-${Math.random().toString(36).slice(2)}.${ext}`)
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...codec, file])
  const f = TagFile.createFromPath(file)
  try {
    f.tag.title = 'Bleeding Love'
    f.tag.performers = [artist]
    f.tag.album = 'Bleeding Love'
    f.tag.genres = ['Electronic']
    f.tag.comment = 'A2S B1S - E6 F4'
    f.tag.beatsPerMinute = 128
    f.tag.initialKey = '8A'
    f.tag.grouping = 'Peak'
    if (ext === 'mp3') {
      const priv = Id3v2PrivateFrame.fromOwner('TRAKTOR4')
      priv.privateData = ByteVector.fromString('cue tree', StringType.Latin1)
      ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(priv)
      const serato = Id3v2PrivateFrame.fromOwner('Serato Markers2')
      serato.privateData = ByteVector.fromString('serato payload', StringType.Latin1)
      ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(serato)
    }
    f.save()
  } finally {
    f.dispose()
  }
  return file
}

afterEach(() => configureOriginalKeeper(null))

describe.each(FORMATS)('rewriting the artist of a $ext', ({ ext, codec }) => {
  let file: string
  let before: string[]
  let md5: string

  beforeAll(() => {
    file = make(ext, codec, 'Dj Lara')
    before = snapshotTags(file)
    md5 = audioMd5(file)
  }, 60000)

  // The review promises one field and nothing else: BPM, key, comment, grouping, the
  // Traktor and Serato private frames and the audio itself come out as they went in.
  it('changes the artist and nothing else', async () => {
    const { outcomes } = await rewriteTagFields(file, [{ field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }])
    expect(outcomes).toEqual(['written'])
    const { added, removed } = diffSnapshots(before, snapshotTags(file))
    expect(added.every((line) => line.includes('DJ Lara'))).toBe(true)
    expect(removed.every((line) => line.includes('Dj Lara'))).toBe(true)
    expect(added.length).toBeGreaterThan(0)
    expect(audioMd5(file)).toBe(md5)
  }, 60000)
})

describe('rewriteTagFields', () => {
  // A WAV's own tags can disagree with Music (Music keeps its own copy for WAV). The
  // review only ever saw Music's value, so a file that says something else is left alone.
  it('leaves the file untouched when its value is not the one Music had', async () => {
    const file = make('wav', ['-c:a', 'pcm_s16le'], 'Someone Else')
    const before = snapshotTags(file)
    const { outcomes, backup } = await rewriteTagFields(file, [{ field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }])
    expect(outcomes).toEqual(['unchanged'])
    expect(backup).toBeUndefined()
    expect(snapshotTags(file)).toEqual(before)
  }, 60000)

  it('matches a composed accent against a decomposed one', async () => {
    const file = make('mp3', ['-c:a', 'libmp3lame'], 'Christian Millán')
    const { outcomes } = await rewriteTagFields(file, [
      { field: 'artist', from: 'Christian Millán', to: 'Christian Millán' },
    ])
    expect(outcomes).toEqual(['written'])
  }, 60000)

  it('writes several fields in one pass with one backup', async () => {
    const file = make('mp3', ['-c:a', 'libmp3lame'], 'Dj Lara')
    const keeper = vi.fn().mockResolvedValue({ id: 'b1' })
    configureOriginalKeeper(keeper)
    const { outcomes, backup } = await rewriteTagFields(file, [
      { field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
      { field: 'genre', from: 'Electronic', to: 'House' },
    ])
    expect(outcomes).toEqual(['written', 'written'])
    expect(keeper).toHaveBeenCalledTimes(1)
    expect(keeper).toHaveBeenCalledWith(file, 'replaced', file, { reencodes: false })
    expect(backup).toEqual({ id: 'b1' })
  }, 60000)
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/main/musicFieldWrite.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

En `workerJobs.ts`, añadir al union `WorkerJob`:

```ts
  | { type: 'setTagFields'; file: string; changes: TagFieldChange[] }
```

al union `WorkerJobResult`: `| FieldWrite[]`, y al `switch`:

```ts
    case 'setTagFields':
      return setTagFields(job.file, job.changes)
```

(importando `setTagFields`, `type FieldWrite`, `type TagFieldChange` de `./musicFieldWrite`).

`musicFieldWrite.ts`:

```ts
import { constants as fsConstants } from 'node:fs'
import { copyFile, unlink } from 'node:fs/promises'
import { extname } from 'node:path'
import { File as TagFile, type Tag } from 'node-taglib-sharp'
import type { MusicReviewField, TrashEntry } from '../shared/types'
import { assertDecodable, convertTmpPath } from './ffmpeg'
import { discardBackup, keepOriginal } from './originalKeeper'
import { renameWithRetry } from './renameRetry'
import { runInWorker } from './worker'

export type FieldWrite = 'written' | 'unchanged'

export interface TagFieldChange {
  field: MusicReviewField
  from: string
  to: string
}

const same = (a: string, b: string): boolean => a.normalize('NFC') === b.normalize('NFC')

function setOne(tag: Tag, { field, from, to }: TagFieldChange): FieldWrite {
  switch (field) {
    case 'title':
      if (!same(tag.title ?? '', from)) return 'unchanged'
      tag.title = to
      return 'written'
    case 'album':
      if (!same(tag.album ?? '', from)) return 'unchanged'
      tag.album = to
      return 'written'
    case 'artist':
      if (tag.performers.length !== 1 || !same(tag.performers[0], from)) return 'unchanged'
      tag.performers = [to]
      return 'written'
    case 'albumArtist':
      if (tag.albumArtists.length !== 1 || !same(tag.albumArtists[0], from)) return 'unchanged'
      tag.albumArtists = [to]
      return 'written'
    case 'genre':
      if (tag.genres.length !== 1 || !same(tag.genres[0], from)) return 'unchanged'
      tag.genres = [to]
      return 'written'
  }
}

export function setTagFields(file: string, changes: TagFieldChange[]): FieldWrite[] {
  const f = TagFile.createFromPath(file)
  try {
    const outcomes = changes.map((change) => setOne(f.tag, change))
    if (outcomes.includes('written')) f.save()
    return outcomes
  } finally {
    f.dispose()
  }
}

// The same copy, check, back up and rename that convertAudio does for an in-place update,
// minus everything else it does: no ffmpeg pass, no full retag, no cues to carry. TagLib
// only rewrites the frames it was handed, so DJ data it was not handed stays byte for byte.
export async function rewriteTagFields(
  file: string,
  changes: TagFieldChange[],
): Promise<{ outcomes: FieldWrite[]; backup?: TrashEntry }> {
  const tmp = convertTmpPath(file, extname(file))
  let archived: TrashEntry | null = null
  try {
    await copyFile(file, tmp, fsConstants.COPYFILE_FICLONE)
    const outcomes = await runInWorker<FieldWrite[]>({ type: 'setTagFields', file: tmp, changes })
    if (!outcomes.includes('written')) {
      await unlink(tmp).catch(() => undefined)
      return { outcomes }
    }
    await assertDecodable(tmp, file)
    archived = await keepOriginal(file, 'replaced', file, { reencodes: false })
    await renameWithRetry(tmp, file)
    return { outcomes, backup: archived ?? undefined }
  } catch (e) {
    if (archived) await discardBackup(archived).catch(() => undefined)
    await unlink(tmp).catch(() => undefined)
    throw e
  }
}
```

Si `Tag` no se exporta con ese nombre en la versión instalada de `node-taglib-sharp`, usar `TagFile['tag']` como tipo.

- [ ] **Step 4: Ver que pasan**

Run: `cd apps/desktop && npm test -- src/main/musicFieldWrite.test.ts src/main/workerJobs.test.ts`
Expected: PASS en los 5 formatos y en los casos sueltos.

- [ ] **Step 5: Mutaciones**

Una a una: quitar la comprobación `same(...)` de `artist` (rojo el WAV ajeno); escribir `tag.comment = ''` dentro de `setOne` (rojo el "nothing else"); pasar `reencodes: true` (rojo la llamada al keeper). Deshacer cada una.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/musicFieldWrite.ts apps/desktop/src/main/musicFieldWrite.test.ts apps/desktop/src/main/workerJobs.ts
git commit -m "Rewrite only the reviewed fields of a file, with a backup and the audio untouched"
```

---

### Task 6: Escribir un campo en Music con guarda

**Files:**
- Modify: `apps/desktop/src/main/applemusic.ts`
- Test: `apps/desktop/src/main/applemusic.test.ts`

**Interfaces:**
- Produces:
  - `type MusicSetResult = 'set' | 'missing' | 'mismatch'`
  - `buildSetFieldScript(persistentId: string, field: MusicReviewField, from: string, to: string): string`
  - `setAppleMusicField(persistentId, field, from, to): Promise<MusicSetResult>`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe('buildSetFieldScript', () => {
  it('maps the field onto the Music property and guards on the value the review read', () => {
    const script = buildSetFieldScript('6E592CFE07A6246A', 'albumArtist', 'Dj Lara', 'DJ Lara')
    expect(script).toContain('whose persistent ID is "6E592CFE07A6246A"')
    expect(script).toContain('if (album artist of theTrack) is not "Dj Lara" then return "mismatch"')
    expect(script).toContain('set album artist of theTrack to "DJ Lara"')
  })

  // AppleScript compares text ignoring case by default, so "Dj Lara" would pass a guard
  // reading "DJ Lara". The review's whole job is the case, so the guard must not ignore it.
  it('compares the current value exactly, case and accents included', () => {
    const script = buildSetFieldScript('6E592CFE07A6246A', 'artist', 'Dj Lara', 'DJ Lara')
    expect(script).toContain('considering case, diacriticals, hyphens, punctuation and white space')
  })

  it('writes the title through the name property', () => {
    expect(buildSetFieldScript('6E592CFE07A6246A', 'title', 'a', 'b')).toContain('set name of theTrack to "b"')
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/main/applemusic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** (en `applemusic.ts`)

```ts
export type MusicSetResult = 'set' | 'missing' | 'mismatch'

const MUSIC_PROPERTY: Record<MusicReviewField, string> = {
  title: 'name',
  artist: 'artist',
  albumArtist: 'album artist',
  album: 'album',
  genre: 'genre',
}

export function buildSetFieldScript(
  persistentId: string,
  field: MusicReviewField,
  from: string,
  to: string,
): string {
  const prop = MUSIC_PROPERTY[field]
  return [
    'tell application "Music"',
    `  set theMatches to (every track of library playlist 1 whose persistent ID is ${JSON.stringify(persistentId)})`,
    '  if (count of theMatches) is 0 then return "missing"',
    '  set theTrack to item 1 of theMatches',
    '  considering case, diacriticals, hyphens, punctuation and white space',
    `    if (${prop} of theTrack) is not ${JSON.stringify(from)} then return "mismatch"`,
    '  end considering',
    `  set ${prop} of theTrack to ${JSON.stringify(to)}`,
    '  return "set"',
    'end tell',
  ].join('\n')
}

export async function setAppleMusicField(
  persistentId: string,
  field: MusicReviewField,
  from: string,
  to: string,
): Promise<MusicSetResult> {
  const result = (await runOsascript(buildSetFieldScript(persistentId, field, from, to))).trim()
  if (result === 'set' || result === 'missing' || result === 'mismatch') return result
  throw new Error(`unexpected Music answer: ${result}`)
}
```

- [ ] **Step 4: Ver que pasan**

Run: `cd apps/desktop && npm test -- src/main/applemusic.test.ts`
Expected: PASS.

- [ ] **Step 5: Prueba manual del guard (una vez, en tu Mac)**

Con `osascript` y una pista de prueba: comprobar que `considering case…` hace que `"Dj Lara" is not "DJ Lara"` dé `true`. Si AppleScript rechaza alguno de los atributos, quitar solo ese atributo y anotarlo en el commit.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/applemusic.ts apps/desktop/src/main/applemusic.test.ts
git commit -m "Set one Music field only when the entry still holds the value the review read"
```

---

### Task 7: Aplicar la tanda (Music primero, luego el fichero)

**Files:**
- Create: `apps/desktop/src/main/musicReviewApply.ts`
- Modify: `apps/desktop/src/main/appleMusicIpc.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/shared/types.ts`
- Test: `apps/desktop/src/main/musicReviewApply.test.ts`

**Interfaces:**
- Consumes: `MusicFieldFix` (Task 4), `rewriteTagFields` (Task 5), `setAppleMusicField`, `MusicSetResult` (Task 6), `appleMusicEntryLocation`.
- Produces (tipos en `shared/types.ts`):
  - `type MusicFieldOutcome = 'set' | 'missing' | 'mismatch' | 'failed'`
  - `interface MusicFixOutcome { persistentId: string; path?: string; fixes: MusicFieldFix[]; music: MusicFieldOutcome[]; file: 'written' | 'unchanged' | 'missing' | 'failed' | 'skipped'; backupId?: string; error?: string }`
  - `applyMusicFixes(fixes, deps, hooks?): Promise<MusicFixOutcome[]>`
  - IPC `applemusic:applyFixes(fixes)`, `applemusic:cancelFixes`, `applemusic:setField(pid, field, from, to)`, evento `applemusic:fixProgress {done,total}`
  - Preload `applyMusicFixes`, `cancelMusicFixes`, `setMusicField`, `onMusicFixProgress(cb): () => void`

Orden por pista: todos los campos a Music; solo los que respondieron `set` pasan al fichero. Si ninguno respondió `set`, el fichero queda `skipped`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, expect, it, vi } from 'vitest'
import type { MusicFieldFix } from '../shared/types'
import { type ApplyDeps, applyMusicFixes } from './musicReviewApply'

const fix = (persistentId: string, field: MusicFieldFix['field'] = 'artist'): MusicFieldFix => ({
  persistentId,
  field,
  from: 'Dj Lara',
  to: 'DJ Lara',
})

function deps(over: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    setField: vi.fn().mockResolvedValue('set'),
    locate: vi.fn().mockResolvedValue('/m/a.mp3'),
    exists: vi.fn().mockResolvedValue(true),
    rewrite: vi.fn().mockResolvedValue({ outcomes: ['written'], backup: { id: 'b1' } }),
    ...over,
  }
}

describe('applyMusicFixes', () => {
  it('sets Music, then the file, and keeps the backup id for undo', async () => {
    const d = deps()
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(out).toMatchObject({ persistentId: 'A', path: '/m/a.mp3', music: ['set'], file: 'written', backupId: 'b1' })
    expect(d.rewrite).toHaveBeenCalledWith('/m/a.mp3', [{ field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }])
  })

  it('writes the fields of one track in a single pass', async () => {
    const d = deps({ rewrite: vi.fn().mockResolvedValue({ outcomes: ['written', 'written'] }) })
    await applyMusicFixes([fix('A'), fix('A', 'genre')], d)
    expect(d.rewrite).toHaveBeenCalledTimes(1)
  })

  // The entry changed in Music after the review read it: the review no longer knows what
  // the right value is, so neither Music nor the file is touched for that field.
  it('touches nothing on disk when Music no longer holds the value', async () => {
    const d = deps({ setField: vi.fn().mockResolvedValue('mismatch') })
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(out).toMatchObject({ music: ['mismatch'], file: 'skipped' })
    expect(d.rewrite).not.toHaveBeenCalled()
  })

  it('reports a Music-only fix when the entry has no file on disk', async () => {
    const d = deps({ exists: vi.fn().mockResolvedValue(false) })
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(out).toMatchObject({ music: ['set'], file: 'missing' })
  })

  it('reports a failed file write and carries on with the next track', async () => {
    const rewrite = vi.fn().mockRejectedValueOnce(new Error('EACCES')).mockResolvedValue({ outcomes: ['written'] })
    const outs = await applyMusicFixes([fix('A'), fix('B')], deps({ rewrite }))
    expect(outs.map((o) => o.file)).toEqual(['failed', 'written'])
    expect(outs[0].error).toBe('EACCES')
  })

  it('stops before the next track when cancelled and leaves the rest untouched', async () => {
    let cancelled = false
    const d = deps({
      setField: vi.fn().mockImplementation(async () => {
        cancelled = true
        return 'set'
      }),
    })
    const outs = await applyMusicFixes([fix('A'), fix('B')], d, { isCancelled: () => cancelled })
    expect(outs.map((o) => o.persistentId)).toEqual(['A'])
  })

  it('reports progress per track', async () => {
    const onProgress = vi.fn()
    await applyMusicFixes([fix('A'), fix('B')], deps(), { onProgress })
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]])
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/main/musicReviewApply.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Tipos en `shared/types.ts`:

```ts
export type MusicFieldOutcome = 'set' | 'missing' | 'mismatch' | 'failed'

export interface MusicFixOutcome {
  persistentId: string
  path?: string
  fixes: MusicFieldFix[]
  music: MusicFieldOutcome[]
  file: 'written' | 'unchanged' | 'missing' | 'failed' | 'skipped'
  backupId?: string
  error?: string
}
```

`musicReviewApply.ts`:

```ts
import type { MusicFieldFix, MusicFieldOutcome, MusicFixOutcome, MusicReviewField, TrashEntry } from '../shared/types'
import type { MusicSetResult } from './applemusic'
import type { FieldWrite, TagFieldChange } from './musicFieldWrite'

export interface ApplyDeps {
  setField: (persistentId: string, field: MusicReviewField, from: string, to: string) => Promise<MusicSetResult>
  locate: (persistentId: string) => Promise<string>
  exists: (path: string) => Promise<boolean>
  rewrite: (file: string, changes: TagFieldChange[]) => Promise<{ outcomes: FieldWrite[]; backup?: TrashEntry }>
}

export interface ApplyHooks {
  isCancelled?: () => boolean
  onProgress?: (done: number, total: number) => void
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

async function applyTrack(persistentId: string, fixes: MusicFieldFix[], deps: ApplyDeps): Promise<MusicFixOutcome> {
  const music: MusicFieldOutcome[] = []
  for (const f of fixes) music.push(await deps.setField(persistentId, f.field, f.from, f.to).catch(() => 'failed' as const))
  const accepted = fixes.filter((_, i) => music[i] === 'set')
  if (accepted.length === 0) return { persistentId, fixes, music, file: 'skipped' }
  const path = await deps.locate(persistentId).catch(() => '')
  if (!path || !(await deps.exists(path))) return { persistentId, fixes, music, file: 'missing', path: path || undefined }
  try {
    const { outcomes, backup } = await deps.rewrite(
      path,
      accepted.map(({ field, from, to }) => ({ field, from, to })),
    )
    const file = outcomes.includes('written') ? 'written' : 'unchanged'
    return { persistentId, path, fixes, music, file, backupId: backup?.id }
  } catch (e) {
    return { persistentId, path, fixes, music, file: 'failed', error: message(e) }
  }
}

export async function applyMusicFixes(
  fixes: MusicFieldFix[],
  deps: ApplyDeps,
  { isCancelled = () => false, onProgress }: ApplyHooks = {},
): Promise<MusicFixOutcome[]> {
  const byTrack = new Map<string, MusicFieldFix[]>()
  for (const f of fixes) byTrack.set(f.persistentId, [...(byTrack.get(f.persistentId) ?? []), f])
  const outcomes: MusicFixOutcome[] = []
  for (const [persistentId, trackFixes] of byTrack) {
    if (isCancelled()) break
    outcomes.push(await applyTrack(persistentId, trackFixes, deps))
    onProgress?.(outcomes.length, byTrack.size)
  }
  return outcomes
}
```

En `appleMusicIpc.ts` (importar `applyMusicFixes`, `rewriteTagFields`, `setAppleMusicField`, `access` de `node:fs/promises`):

```ts
  let fixesCancelled = false
  ipcMain.handle('applemusic:applyFixes', async (e, fixes: MusicFieldFix[]) => {
    if (process.platform !== 'darwin') return []
    fixesCancelled = false
    return applyMusicFixes(
      fixes,
      {
        setField: (pid, field, from, to) => appleMusicLimiter.run(() => setAppleMusicField(pid, field, from, to)),
        locate: (pid) => appleMusicLimiter.run(() => appleMusicEntryLocation(pid)),
        exists: (path) => access(path).then(() => true, () => false),
        rewrite: rewriteTagFields,
      },
      {
        isCancelled: () => fixesCancelled,
        onProgress: (done, total) => e.sender.send('applemusic:fixProgress', { done, total }),
      },
    )
  })
  ipcMain.handle('applemusic:cancelFixes', () => {
    fixesCancelled = true
  })
  ipcMain.handle('applemusic:setField', (_e, pid: string, field: MusicReviewField, from: string, to: string) =>
    process.platform === 'darwin'
      ? appleMusicLimiter.run(() => setAppleMusicField(pid, field, from, to))
      : 'missing',
  )
```

Preload (`api.ts` y su implementación en `index.ts`, siguiendo `onProcessProgress`):

```ts
  applyMusicFixes: (fixes: MusicFieldFix[]) => Promise<MusicFixOutcome[]>
  cancelMusicFixes: () => Promise<void>
  setMusicField: (persistentId: string, field: MusicReviewField, from: string, to: string) => Promise<'set' | 'missing' | 'mismatch'>
  onMusicFixProgress: (cb: (p: { done: number; total: number }) => void) => () => void
```

```ts
  applyMusicFixes: (fixes) => ipcRenderer.invoke('applemusic:applyFixes', fixes),
  cancelMusicFixes: () => ipcRenderer.invoke('applemusic:cancelFixes'),
  setMusicField: (pid, field, from, to) => ipcRenderer.invoke('applemusic:setField', pid, field, from, to),
  onMusicFixProgress: (cb) => {
    const listener = (_e: unknown, p: { done: number; total: number }): void => cb(p)
    ipcRenderer.on('applemusic:fixProgress', listener)
    return () => ipcRenderer.removeListener('applemusic:fixProgress', listener)
  },
```

- [ ] **Step 4: Ver que pasan y que compila**

Run: `cd apps/desktop && npm test -- src/main/musicReviewApply.test.ts` y el typecheck.
Expected: PASS y sin errores.

- [ ] **Step 5: Mutación**

Quitar el `if (accepted.length === 0) return …skipped` y ver rojo el test del mismatch; deshacer.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/musicReviewApply.ts apps/desktop/src/main/musicReviewApply.test.ts apps/desktop/src/main/appleMusicIpc.ts apps/desktop/src/preload apps/desktop/src/shared/types.ts
git commit -m "Apply a reviewed batch to Music first and then to each file, with progress and cancel"
```

---

### Task 8: Quitar una copia duplicada sin perder playlists ni el fichero compartido

**Files:**
- Create: `apps/desktop/src/main/musicDuplicates.ts`
- Modify: `apps/desktop/src/main/applemusic.ts` (`buildPlaylistTransferScript`), `apps/desktop/src/main/appleMusicIpc.ts`, preload
- Test: `apps/desktop/src/main/musicDuplicates.test.ts`, `apps/desktop/src/main/applemusic.test.ts`

**Interfaces:**
- Consumes: `appleMusicEntryLocation`, `deleteFromAppleMusic` (lanza `applemusic-delete-mismatch`).
- Produces:
  - `buildPlaylistTransferScript(fromPid: string, toPid: string, expectedLabel: string): string` → devuelve `"missing"`, `"mismatch"` o el número de playlists
  - `interface RemoveCopyResult { outcome: 'removed' | 'missing' | 'mismatch'; playlists: number; fileTrashed: boolean }`
  - `removeDuplicateCopy(req: { removePid: string; keepPid: string; label: string }, deps): Promise<RemoveCopyResult>`
  - IPC `applemusic:removeDuplicate`; preload `removeMusicDuplicate(req): Promise<RemoveCopyResult>`

- [ ] **Step 1: Escribir los tests que fallan**

`musicDuplicates.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { type RemoveCopyDeps, removeDuplicateCopy } from './musicDuplicates'

function deps(over: Partial<RemoveCopyDeps> = {}): RemoveCopyDeps {
  return {
    locate: vi.fn(async (pid: string) => (pid === 'KEEP' ? '/m/keep.aiff' : '/m/old.mp3')),
    realpath: vi.fn(async (p: string) => p),
    transferPlaylists: vi.fn().mockResolvedValue('2'),
    deleteEntry: vi.fn().mockResolvedValue('/m/old.mp3'),
    trash: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}
const req = { removePid: 'OLD', keepPid: 'KEEP', label: 'Transfer - Possession' }

describe('removeDuplicateCopy', () => {
  it('moves the playlists to the kept copy, then deletes the entry and trashes its file', async () => {
    const d = deps()
    expect(await removeDuplicateCopy(req, d)).toEqual({ outcome: 'removed', playlists: 2, fileTrashed: true })
    expect(d.transferPlaylists).toHaveBeenCalledWith('OLD', 'KEEP', 'Transfer - Possession')
    expect(d.trash).toHaveBeenCalledWith('/m/old.mp3')
  })

  // Measured: 34 entries of the real library are two Music entries on one file through a
  // symlink. Trashing "the duplicate's file" there would take the kept copy's audio with it.
  it('never trashes a file the kept copy also points to', async () => {
    const d = deps({ realpath: vi.fn().mockResolvedValue('/Volumes/Musica/same.aiff') })
    expect(await removeDuplicateCopy(req, d)).toMatchObject({ outcome: 'removed', fileTrashed: false })
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('deletes nothing when the entry no longer carries the confirmed label', async () => {
    const d = deps({ transferPlaylists: vi.fn().mockResolvedValue('mismatch') })
    expect(await removeDuplicateCopy(req, d)).toEqual({ outcome: 'mismatch', playlists: 0, fileTrashed: false })
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  it('treats an entry already gone as done', async () => {
    const d = deps({ deleteEntry: vi.fn().mockResolvedValue(null) })
    expect(await removeDuplicateCopy(req, d)).toMatchObject({ outcome: 'missing', fileTrashed: false })
  })
})
```

En `applemusic.test.ts`:

```ts
describe('buildPlaylistTransferScript', () => {
  it('adds the kept copy to plain playlists only and checks the label first', () => {
    const s = buildPlaylistTransferScript('OLD0000000000000', 'KEEP000000000000', 'A - B')
    expect(s).toContain('if (artist of src) & " - " & (name of src) is not "A - B" then return "mismatch"')
    expect(s).toContain('every user playlist whose smart is false and special kind is none')
    expect(s).toContain('duplicate dst to p')
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/main/musicDuplicates.test.ts src/main/applemusic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

En `applemusic.ts`:

```ts
// Smart playlists recompute from their rules and refuse a manual add (-54), and folders
// hold no tracks, so only plain playlists are touched. The kept copy lands at the end of
// each one: Music offers no way to insert at a position, and the sheet says so.
export function buildPlaylistTransferScript(fromPid: string, toPid: string, expectedLabel: string): string {
  return [
    'tell application "Music"',
    `  set srcs to (every track of library playlist 1 whose persistent ID is ${JSON.stringify(fromPid)})`,
    `  set dsts to (every track of library playlist 1 whose persistent ID is ${JSON.stringify(toPid)})`,
    '  if (count of srcs) is 0 or (count of dsts) is 0 then return "missing"',
    '  set src to item 1 of srcs',
    '  set dst to item 1 of dsts',
    `  if (artist of src) & " - " & (name of src) is not ${JSON.stringify(expectedLabel)} then return "mismatch"`,
    '  set moved to 0',
    '  repeat with p in (every user playlist whose smart is false and special kind is none)',
    '    try',
    `      if (exists (some track of p whose persistent ID is ${JSON.stringify(fromPid)})) and not (exists (some track of p whose persistent ID is ${JSON.stringify(toPid)})) then`,
    '        duplicate dst to p',
    '        set moved to moved + 1',
    '      end if',
    '    end try',
    '  end repeat',
    '  return moved as text',
    'end tell',
  ].join('\n')
}

export async function transferPlaylists(fromPid: string, toPid: string, expectedLabel: string): Promise<string> {
  return (await runOsascript(buildPlaylistTransferScript(fromPid, toPid, expectedLabel))).trim()
}
```

`musicDuplicates.ts`:

```ts
export interface RemoveCopyDeps {
  locate: (persistentId: string) => Promise<string>
  realpath: (path: string) => Promise<string | null>
  transferPlaylists: (fromPid: string, toPid: string, label: string) => Promise<string>
  deleteEntry: (persistentId: string, label: string) => Promise<string | null>
  trash: (path: string) => Promise<void>
}

export interface RemoveCopyResult {
  outcome: 'removed' | 'missing' | 'mismatch'
  playlists: number
  fileTrashed: boolean
}

async function sharesFile(a: string, b: string, deps: RemoveCopyDeps): Promise<boolean> {
  if (!a || !b) return false
  const [ra, rb] = await Promise.all([deps.realpath(a), deps.realpath(b)])
  return ra !== null && ra.normalize('NFC') === rb?.normalize('NFC')
}

export async function removeDuplicateCopy(
  { removePid, keepPid, label }: { removePid: string; keepPid: string; label: string },
  deps: RemoveCopyDeps,
): Promise<RemoveCopyResult> {
  const moved = await deps.transferPlaylists(removePid, keepPid, label)
  if (moved === 'mismatch') return { outcome: 'mismatch', playlists: 0, fileTrashed: false }
  if (moved === 'missing') return { outcome: 'missing', playlists: 0, fileTrashed: false }
  const playlists = Number(moved) || 0
  const [removeLoc, keepLoc] = await Promise.all([deps.locate(removePid), deps.locate(keepPid)])
  const shared = await sharesFile(removeLoc, keepLoc, deps)
  let location: string | null
  try {
    location = await deps.deleteEntry(removePid, label)
  } catch (e) {
    if (e instanceof Error && e.message === 'applemusic-delete-mismatch')
      return { outcome: 'mismatch', playlists, fileTrashed: false }
    throw e
  }
  if (location === null) return { outcome: 'missing', playlists, fileTrashed: false }
  if (!location || shared) return { outcome: 'removed', playlists, fileTrashed: false }
  await deps.trash(location)
  return { outcome: 'removed', playlists, fileTrashed: true }
}
```

IPC en `appleMusicIpc.ts` (importar `realpath` de `node:fs/promises`):

```ts
  ipcMain.handle('applemusic:removeDuplicate', (_e, req: { removePid: string; keepPid: string; label: string }) =>
    process.platform === 'darwin'
      ? appleMusicLimiter.run(() =>
          removeDuplicateCopy(req, {
            locate: appleMusicEntryLocation,
            realpath: (p) => realpath(p).catch(() => null),
            transferPlaylists,
            deleteEntry: deleteFromAppleMusic,
            trash: (p) => shell.trashItem(p),
          }),
        )
      : { outcome: 'missing', playlists: 0, fileTrashed: false },
  )
```

Preload: `removeMusicDuplicate: (req: { removePid: string; keepPid: string; label: string }) => Promise<RemoveCopyResult>` (mover `RemoveCopyResult` a `shared/types.ts` para que el preload lo tipe).

- [ ] **Step 4: Ver que pasan**

Run: `cd apps/desktop && npm test -- src/main/musicDuplicates.test.ts src/main/applemusic.test.ts` y typecheck.
Expected: PASS.

- [ ] **Step 5: Mutación**

Cambiar `if (!location || shared)` por `if (!location)` y ver rojo el test del enlace simbólico; deshacer.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/musicDuplicates.ts apps/desktop/src/main/musicDuplicates.test.ts apps/desktop/src/main/applemusic.ts apps/desktop/src/main/applemusic.test.ts apps/desktop/src/main/appleMusicIpc.ts apps/desktop/src/preload apps/desktop/src/shared/types.ts
git commit -m "Remove a duplicate Music copy after moving its playlists, keeping a file the other copy shares"
```

---

### Task 9: Grupos ignorados, guardados por máquina

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (`Settings`), `apps/desktop/src/main/settings.ts` (defaults y `LOCAL_KEYS`), `apps/desktop/src/renderer/src/test/api.ts` (settings de test)
- Test: `apps/desktop/src/main/settings.test.ts`

**Interfaces:**
- Produces: `Settings.musicReviewIgnored: string[]` (claves de `SpellingGroup.key` y `DuplicateGroup.key`), por defecto `[]`, local.

- [ ] **Step 1: Escribir el test que falla** (junto a "keeps the beta channel on the machine that opted in")

```ts
  // The ignored groups name this Mac's Music library; on another Mac they mean nothing.
  it('keeps the ignored review groups on this machine', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-config-'))
    setConfigDir(dir)
    saveSettings({ musicReviewIgnored: ['artist||case|djlara'] })
    expect(read(syncedFile(dir))).not.toHaveProperty('musicReviewIgnored')
    expect(getSettings().musicReviewIgnored).toEqual(['artist||case|djlara'])
    rmSync(dir, { recursive: true, force: true })
  })
```

- [ ] **Step 2: Ver que falla**

Run: `cd apps/desktop && npm test -- src/main/settings.test.ts`
Expected: FAIL (tipo o propiedad sincronizada).

- [ ] **Step 3: Implementar**

`shared/types.ts` en `Settings`: `musicReviewIgnored: string[]`
`main/settings.ts`: en defaults `musicReviewIgnored: [],` y en `LOCAL_KEYS`, tras `commandUsage`:

```ts
  // Group keys of this Mac's Music library; another Mac's library has other entries.
  'musicReviewIgnored',
```

`renderer/src/test/api.ts`: `musicReviewIgnored: [],` en los settings por defecto.

- [ ] **Step 4: Ver que pasa**

Run: `cd apps/desktop && npm test -- src/main/settings.test.ts` y typecheck.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/settings.ts apps/desktop/src/main/settings.test.ts apps/desktop/src/renderer/src/test/api.ts
git commit -m "Remember the review groups the user ignores, on this Mac only"
```

---

### Task 10: Hook `useMusicReview`

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/useMusicReview.ts`
- Test: `apps/desktop/src/renderer/src/hooks/useMusicReview.test.tsx`

**Interfaces:**
- Consumes: `loadMusicReview`, `applyMusicFixes`, `cancelMusicFixes`, `onMusicFixProgress`, `setMusicField`, `removeMusicDuplicate`, `appleMusicEntryLocation`, `trashRestore` (preload); `spellingGroups`, `SAFE_KINDS` (Task 2); `duplicateGroups` (Task 3); `planFixes`, `summarizeFixes` (Task 4).
- Produces:

```ts
export type ReviewFilter = 'all' | 'spelling' | 'duplicates'
export interface DuplicateCard { group: DuplicateGroup; entries: MusicReviewEntry[]; formats: Record<string, string> }
export interface ReviewRun {
  outcomes: MusicFixOutcome[]
  removed: RemoveCopyResult[]
  before: number
  after: number
}
export interface MusicReview {
  status: 'loading' | 'ready' | 'empty' | 'error' | 'applying' | 'done'
  filter: ReviewFilter
  setFilter: (f: ReviewFilter) => void
  spelling: SpellingGroup[]
  duplicates: DuplicateCard[]
  choice: (key: string) => string | null
  choose: (key: string, value: string) => void
  staged: ReadonlySet<string>
  toggleStaged: (key: string) => void
  ignore: (key: string) => void
  summary: { tracks: number; byField: Partial<Record<MusicReviewField, number>>; duplicates: number }
  progress: { done: number; total: number } | null
  apply: () => Promise<void>
  cancel: () => void
  undo: () => Promise<void>
  lastRun: ReviewRun | null
}
export function useMusicReview(p: {
  initialFilter: ReviewFilter
  ignored: string[]
  saveIgnored: (keys: string[]) => void
  onFilesChanged: (paths: string[]) => void
}): MusicReview
```

Comportamiento:
- Al montar lee `loadMusicReview()`. `[]` → `empty`; excepción → `error`.
- `spelling` = `spellingGroups(entries)` sin ignorados. `duplicates` = `duplicateGroups` sobre `{ id: persistentId, artist, title, durationSec }`, sin ignorados, con las entradas de cada grupo y su formato (extensión en mayúsculas) pedido con `appleMusicEntryLocation` solo para los miembros de grupos de duplicados.
- `choice(key)`: lo elegido o `group.suggested`; para duplicados, el `persistentId` que se queda (por defecto el primer miembro sin pérdida: `.aiff`, `.aif`, `.wav`, `.flac`, `.m4a`; si no, el primero).
- Solo se puede escenificar (`toggleStaged`) un grupo con elección no nula; los `version` nunca se escenifican por defecto, el usuario sí puede.
- `apply()`: `planFixes` de los grupos escenificados → `applyMusicFixes`; luego `removeMusicDuplicate` por cada copia a quitar (label `artist - title` de la entrada); luego vuelve a leer la biblioteca y calcula `after` (grupos pendientes) frente a `before`; llama a `onFilesChanged` con los `path` de los `file: 'written'`; `status: 'done'`.
- `undo()`: `trashRestore` de cada `backupId`, `setMusicField(pid, field, to, from)` de cada campo `set`, vuelve a leer, `onFilesChanged` con esos `path`.

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { MusicReviewEntry } from '../../../shared/types'
import { useMusicReview } from './useMusicReview'

const e = (persistentId: string, artist: string, extra: Partial<MusicReviewEntry> = {}): MusicReviewEntry => ({
  persistentId,
  title: `T${persistentId}`,
  artist,
  albumArtist: '',
  album: '',
  genre: '',
  ...extra,
})
const LIB = [e('A', 'DJ Lara'), e('B', 'DJ Lara'), e('C', 'Dj Lara')]

function setApi(over: Partial<Record<keyof Api, unknown>> = {}) {
  const api = {
    loadMusicReview: vi.fn<Api['loadMusicReview']>().mockResolvedValue(LIB),
    applyMusicFixes: vi.fn<Api['applyMusicFixes']>().mockResolvedValue([
      {
        persistentId: 'C',
        path: '/m/c.mp3',
        fixes: [{ persistentId: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
        music: ['set'],
        file: 'written',
        backupId: 'b1',
      },
    ]),
    cancelMusicFixes: vi.fn<Api['cancelMusicFixes']>().mockResolvedValue(undefined),
    onMusicFixProgress: vi.fn<Api['onMusicFixProgress']>().mockReturnValue(() => {}),
    setMusicField: vi.fn<Api['setMusicField']>().mockResolvedValue('set'),
    removeMusicDuplicate: vi.fn<Api['removeMusicDuplicate']>(),
    appleMusicEntryLocation: vi.fn<Api['appleMusicEntryLocation']>().mockResolvedValue('/m/x.aiff'),
    trashRestore: vi.fn<Api['trashRestore']>().mockResolvedValue({ restoredTo: '/m/c.mp3' }),
    ...over,
  }
  ;(window as unknown as { api: unknown }).api = api
  return api
}

const props = (over = {}) => ({
  initialFilter: 'all' as const,
  ignored: [],
  saveIgnored: vi.fn(),
  onFilesChanged: vi.fn(),
  ...over,
})

afterEach(() => vi.restoreAllMocks())

describe('useMusicReview', () => {
  it('reads the library and offers the common spelling', async () => {
    setApi()
    const { result } = renderHook(() => useMusicReview(props()))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const [g] = result.current.spelling
    expect(result.current.choice(g.key)).toBe('DJ Lara')
  })

  it('says the library is empty instead of showing an empty review', async () => {
    setApi({ loadMusicReview: vi.fn().mockResolvedValue([]) })
    const { result } = renderHook(() => useMusicReview(props()))
    await waitFor(() => expect(result.current.status).toBe('empty'))
  })

  it('hides a group the user ignored and saves it', async () => {
    setApi()
    const saveIgnored = vi.fn()
    const { result } = renderHook(() => useMusicReview(props({ saveIgnored })))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const key = result.current.spelling[0].key
    act(() => result.current.ignore(key))
    expect(saveIgnored).toHaveBeenCalledWith([key])
    expect(result.current.spelling).toEqual([])
  })

  // Nothing is written until the user applies: staging a group only fills the tray.
  it('writes only the staged groups, rereads and reports the files it changed', async () => {
    const api = setApi()
    const onFilesChanged = vi.fn()
    const { result } = renderHook(() => useMusicReview(props({ onFilesChanged })))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    expect(api.applyMusicFixes).not.toHaveBeenCalled()
    expect(result.current.summary).toMatchObject({ tracks: 1, byField: { artist: 1 } })
    await act(() => result.current.apply())
    expect(api.applyMusicFixes).toHaveBeenCalledWith([{ persistentId: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }])
    expect(api.loadMusicReview).toHaveBeenCalledTimes(2)
    expect(onFilesChanged).toHaveBeenCalledWith(['/m/c.mp3'])
    expect(result.current.status).toBe('done')
  })

  it('undoes a run by restoring the backups and setting Music back', async () => {
    const api = setApi()
    const { result } = renderHook(() => useMusicReview(props()))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    await act(() => result.current.undo())
    expect(api.trashRestore).toHaveBeenCalledWith('b1')
    expect(api.setMusicField).toHaveBeenCalledWith('C', 'artist', 'DJ Lara', 'Dj Lara')
  })

  it('never stages a tie until the user picks a spelling', async () => {
    setApi({ loadMusicReview: vi.fn().mockResolvedValue([e('A', 'Rachel Auburn'), e('B', 'Rahcel Auburn')]) })
    const { result } = renderHook(() => useMusicReview(props()))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const key = result.current.spelling[0].key
    act(() => result.current.toggleStaged(key))
    expect(result.current.staged.has(key)).toBe(false)
    act(() => result.current.choose(key, 'Rachel Auburn'))
    act(() => result.current.toggleStaged(key))
    expect(result.current.staged.has(key)).toBe(true)
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/renderer/src/hooks/useMusicReview.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar `useMusicReview.ts`**

```ts
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  MusicFixOutcome,
  MusicReviewEntry,
  MusicReviewField,
  RemoveCopyResult,
} from '../../../shared/types'
import { type DuplicateGroup, duplicateGroups } from '../lib/duplicates'
import { planFixes, summarizeFixes } from '../lib/musicFixPlan'
import { type SpellingGroup, spellingGroups } from '../lib/musicSpelling'

export type ReviewFilter = 'all' | 'spelling' | 'duplicates'

export interface DuplicateCard {
  group: DuplicateGroup
  entries: MusicReviewEntry[]
  formats: Record<string, string>
}

export interface ReviewRun {
  outcomes: MusicFixOutcome[]
  removed: RemoveCopyResult[]
  before: number
  after: number
}

const LOSSLESS = ['AIFF', 'AIF', 'WAV', 'FLAC', 'M4A']
const extOf = (path: string) => (path.match(/\.([^./]+)$/)?.[1] ?? '').toUpperCase()

function pendingCount(entries: MusicReviewEntry[], ignored: ReadonlySet<string>): number {
  const spelling = spellingGroups(entries).filter((g) => !ignored.has(g.key)).length
  const dups = duplicateGroups(entries.map(toItem)).filter((g) => g.kind === 'duplicate' && !ignored.has(g.key)).length
  return spelling + dups
}

function toItem(e: MusicReviewEntry) {
  return { id: e.persistentId, artist: e.artist, title: e.title, durationSec: e.durationSec }
}

export function useMusicReview({
  initialFilter,
  ignored,
  saveIgnored,
  onFilesChanged,
}: {
  initialFilter: ReviewFilter
  ignored: string[]
  saveIgnored: (keys: string[]) => void
  onFilesChanged: (paths: string[]) => void
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error' | 'applying' | 'done'>('loading')
  const [entries, setEntries] = useState<MusicReviewEntry[]>([])
  const [filter, setFilter] = useState<ReviewFilter>(initialFilter)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [staged, setStaged] = useState<ReadonlySet<string>>(new Set())
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set(ignored))
  const [formats, setFormats] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [lastRun, setLastRun] = useState<ReviewRun | null>(null)

  const load = useCallback(async () => {
    const next = await window.api.loadMusicReview()
    setEntries(next)
    return next
  }, [])

  useEffect(() => {
    load().then(
      (next) => setStatus(next.length === 0 ? 'empty' : 'ready'),
      () => setStatus('error'),
    )
  }, [load])

  const byPid = useMemo(() => new Map(entries.map((e) => [e.persistentId, e])), [entries])
  const spelling = useMemo(() => spellingGroups(entries).filter((g) => !hidden.has(g.key)), [entries, hidden])
  const dupGroups = useMemo(
    () => duplicateGroups(entries.map(toItem)).filter((g) => !hidden.has(g.key)),
    [entries, hidden],
  )

  useEffect(() => {
    const missing = dupGroups.flatMap((g) => g.ids).filter((pid) => !(pid in formats))
    if (missing.length === 0) return
    let live = true
    Promise.all(missing.map(async (pid) => [pid, extOf(await window.api.appleMusicEntryLocation(pid).catch(() => ''))] as const)).then(
      (pairs) => live && setFormats((f) => ({ ...f, ...Object.fromEntries(pairs) })),
    )
    return () => {
      live = false
    }
  }, [dupGroups, formats])

  const duplicates: DuplicateCard[] = useMemo(
    () =>
      dupGroups.map((group) => ({
        group,
        entries: group.ids.map((id) => byPid.get(id)).filter((x): x is MusicReviewEntry => !!x),
        formats,
      })),
    [dupGroups, byPid, formats],
  )

  const spellingByKey = useMemo(() => new Map(spelling.map((g) => [g.key, g])), [spelling])
  const dupByKey = useMemo(() => new Map(dupGroups.map((g) => [g.key, g])), [dupGroups])

  const choice = useCallback(
    (key: string): string | null => {
      if (choices[key]) return choices[key]
      const s = spellingByKey.get(key)
      if (s) return s.suggested
      const d = dupByKey.get(key)
      if (!d) return null
      return d.ids.find((id) => LOSSLESS.includes(formats[id] ?? '')) ?? d.ids[0]
    },
    [choices, spellingByKey, dupByKey, formats],
  )

  const choose = useCallback((key: string, value: string) => setChoices((c) => ({ ...c, [key]: value })), [])

  const toggleStaged = useCallback(
    (key: string) => {
      if (!choice(key)) return
      setStaged((s) => {
        const next = new Set(s)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    },
    [choice],
  )

  const ignore = useCallback(
    (key: string) => {
      const next = new Set(hidden)
      next.add(key)
      setHidden(next)
      saveIgnored([...next])
      setStaged((s) => {
        const copy = new Set(s)
        copy.delete(key)
        return copy
      })
    },
    [hidden, saveIgnored],
  )

  const fixes = useMemo(
    () =>
      planFixes(
        entries,
        spelling.filter((g) => staged.has(g.key)).map((group) => ({ group, to: choice(group.key) as string })),
      ),
    [entries, spelling, staged, choice],
  )

  const removals = useMemo(
    () =>
      dupGroups
        .filter((g) => staged.has(g.key))
        .flatMap((g) => {
          const keepPid = choice(g.key) as string
          return g.ids
            .filter((id) => id !== keepPid)
            .map((removePid) => {
              const e = byPid.get(removePid) as MusicReviewEntry
              return { removePid, keepPid, label: `${e.artist} - ${e.title}` }
            })
        }),
    [dupGroups, staged, choice, byPid],
  )

  const summary = useMemo(() => ({ ...summarizeFixes(fixes), duplicates: removals.length }), [fixes, removals])

  const apply = useCallback(async () => {
    setStatus('applying')
    const before = pendingCount(entries, hidden)
    const off = window.api.onMusicFixProgress(setProgress)
    try {
      const outcomes = fixes.length ? await window.api.applyMusicFixes(fixes) : []
      const removed: RemoveCopyResult[] = []
      for (const r of removals) removed.push(await window.api.removeMusicDuplicate(r))
      const next = await load()
      setStaged(new Set())
      setChoices({})
      setLastRun({ outcomes, removed, before, after: pendingCount(next, hidden) })
      const written = outcomes.filter((o) => o.file === 'written' && o.path).map((o) => o.path as string)
      if (written.length) onFilesChanged(written)
    } finally {
      off()
      setProgress(null)
      setStatus('done')
    }
  }, [entries, hidden, fixes, removals, load, onFilesChanged])

  const cancel = useCallback(() => {
    void window.api.cancelMusicFixes()
  }, [])

  const undo = useCallback(async () => {
    if (!lastRun) return
    setStatus('applying')
    const paths: string[] = []
    for (const o of lastRun.outcomes) {
      if (o.backupId) {
        await window.api.trashRestore(o.backupId).catch(() => undefined)
        if (o.path) paths.push(o.path)
      }
      for (const [i, f] of o.fixes.entries())
        if (o.music[i] === 'set') await window.api.setMusicField(f.persistentId, f.field, f.to, f.from).catch(() => undefined)
    }
    await load()
    setLastRun(null)
    if (paths.length) onFilesChanged(paths)
    setStatus('ready')
  }, [lastRun, load, onFilesChanged])

  return {
    status,
    filter,
    setFilter,
    spelling,
    duplicates,
    choice,
    choose,
    staged,
    toggleStaged,
    ignore,
    summary,
    progress,
    apply,
    cancel,
    undo,
    lastRun,
  }
}

export type MusicReview = ReturnType<typeof useMusicReview>
export type { MusicReviewField, SpellingGroup }
```

(`RemoveCopyResult` vive en `shared/types.ts` desde la Task 8.)

- [ ] **Step 4: Ver que pasan**

Run: `cd apps/desktop && npm test -- src/renderer/src/hooks/useMusicReview.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mutación**

En `undo`, intercambiar `f.to, f.from` y ver rojo el test de deshacer; deshacer.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/useMusicReview.ts apps/desktop/src/renderer/src/hooks/useMusicReview.test.tsx
git commit -m "Hold the Music review state: groups, choices, the tray, apply, undo and the recount"
```

---

### Task 11: La vista de revisión

**Files:**
- Create: `apps/desktop/src/renderer/src/components/MusicReview.tsx`
- Modify: `apps/desktop/src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json`
- Test: `apps/desktop/src/renderer/src/components/MusicReview.test.tsx`

**Interfaces:**
- Consumes: `MusicReview`, `ReviewFilter` (Task 10), `SAFE_KINDS` (Task 2).
- Produces: `<MusicReview review={MusicReview} onClose={() => void} />`

Diseño: el boceto B aprobado (https://claude.ai/artifact/54YEuiNBhTo6nPPRNNjKuD), sin la parte de búsqueda (segunda entrega). Cabecera con título, chips `Todo`, `Grafías`, `Duplicados` y `Cerrar`; lista de grupos; bandeja fija abajo; hoja de confirmación; hoja final con `Deshacer`. Punto de color `good` para seguro, `warn` para revisar, con `aria-label`. Sin texto redundante ([[ui-minimalista-apple]]).

Claves i18n (bloque `musicReview`), texto en `es`:

```json
"musicReview": {
  "title": "Revisar metadatos",
  "close": "Cerrar",
  "filter": { "all": "Todo", "spelling": "Grafías", "duplicates": "Duplicados" },
  "field": { "artist": "Artista", "albumArtist": "Artista del álbum", "album": "Álbum", "genre": "Género", "title": "Título" },
  "kind": { "invisible": "caracteres invisibles", "case": "mayúsculas o acentos", "punctuation": "espacios o signos", "typo": "posible errata", "duplicate": "{{count}} copias", "version": "otra versión" },
  "safe": "Seguro",
  "review": "Revisar",
  "tie": "Empate. Elige cuál se queda.",
  "unify": "Unificar",
  "remove_one": "Quitar {{count}}",
  "remove_other": "Quitar {{count}}",
  "staged": "Deshacer",
  "ignore": "Ignorar",
  "notSame": "No es el mismo",
  "different": "Son distintas",
  "keeps": "Se queda",
  "tracks_one": "{{count}} pista",
  "tracks_other": "{{count}} pistas",
  "tray": { "empty": "Elige en cada grupo y aplica al final", "count_one": "{{count}} cambio", "count_other": "{{count}} cambios", "apply": "Revisar y aplicar" },
  "confirm": {
    "title_one": "Vas a cambiar {{count}} pista",
    "title_other": "Vas a cambiar {{count}} pistas",
    "removed": "Copias quitadas de Apple Music",
    "playlists": "La copia que se queda entra al final de las playlists de la otra",
    "trash": "Los ficheros de las copias quitadas van a la Papelera",
    "untouched": "BPM, key, cues y rating no se tocan",
    "backup": "Copia de seguridad de cada fichero",
    "cancel": "Cancelar",
    "apply": "Aplicar"
  },
  "applying": "Aplicando {{done}} de {{total}}",
  "stop": "Detener",
  "done": {
    "title": "Biblioteca revisada",
    "updated_one": "{{count}} pista actualizada",
    "updated_other": "{{count}} pistas actualizadas",
    "musicOnly_one": "{{count}} solo en Apple Music, su fichero dice otra cosa",
    "musicOnly_other": "{{count}} solo en Apple Music, sus ficheros dicen otra cosa",
    "failed_one": "{{count}} no se pudo cambiar",
    "failed_other": "{{count}} no se pudieron cambiar",
    "left_one": "Queda {{count}} grupo por revisar",
    "left_other": "Quedan {{count}} grupos por revisar",
    "undo": "Deshacer",
    "continue": "Seguir revisando"
  },
  "empty": "Tu biblioteca de Apple Music está vacía.",
  "clean": "No hay nada que revisar.",
  "error": "No se pudo leer la biblioteca de Apple Music."
}
```

Y su traducción en `en` (y equivalentes en `de`, `fr`, `pt-BR` con las mismas claves):

```json
"musicReview": {
  "title": "Review metadata",
  "close": "Close",
  "filter": { "all": "All", "spelling": "Spellings", "duplicates": "Duplicates" },
  "field": { "artist": "Artist", "albumArtist": "Album artist", "album": "Album", "genre": "Genre", "title": "Title" },
  "kind": { "invisible": "invisible characters", "case": "capitals or accents", "punctuation": "spaces or punctuation", "typo": "possible typo", "duplicate": "{{count}} copies", "version": "another version" },
  "safe": "Safe",
  "review": "Review",
  "tie": "Tied. Pick the one to keep.",
  "unify": "Unify",
  "remove_one": "Remove {{count}}",
  "remove_other": "Remove {{count}}",
  "staged": "Undo",
  "ignore": "Ignore",
  "notSame": "Not the same",
  "different": "They differ",
  "keeps": "Kept",
  "tracks_one": "{{count}} track",
  "tracks_other": "{{count}} tracks",
  "tray": { "empty": "Choose in each group and apply at the end", "count_one": "{{count}} change", "count_other": "{{count}} changes", "apply": "Review and apply" },
  "confirm": {
    "title_one": "You're about to change {{count}} track",
    "title_other": "You're about to change {{count}} tracks",
    "removed": "Copies removed from Apple Music",
    "playlists": "The kept copy joins the end of the other copy's playlists",
    "trash": "Removed copies' files go to the Trash",
    "untouched": "BPM, key, cues and rating stay as they are",
    "backup": "Backup of every file",
    "cancel": "Cancel",
    "apply": "Apply"
  },
  "applying": "Applying {{done}} of {{total}}",
  "stop": "Stop",
  "done": {
    "title": "Library reviewed",
    "updated_one": "{{count}} track updated",
    "updated_other": "{{count}} tracks updated",
    "musicOnly_one": "{{count}} in Apple Music only, its file says something else",
    "musicOnly_other": "{{count}} in Apple Music only, their files say something else",
    "failed_one": "{{count}} could not be changed",
    "failed_other": "{{count}} could not be changed",
    "left_one": "{{count}} group left to review",
    "left_other": "{{count}} groups left to review",
    "undo": "Undo",
    "continue": "Keep reviewing"
  },
  "empty": "Your Apple Music library is empty.",
  "clean": "Nothing to review.",
  "error": "Couldn't read your Apple Music library."
}
```

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { MusicReview as Review } from '../hooks/useMusicReview'
import { MusicReview } from './MusicReview'

const group = {
  key: 'artist||case|djlara',
  field: 'artist' as const,
  kind: 'case' as const,
  variants: [
    { value: 'DJ Lara', persistentIds: ['A', 'B'] },
    { value: 'Dj Lara', persistentIds: ['C'] },
  ],
  suggested: 'DJ Lara',
}

function review(over: Partial<Review> = {}): Review {
  return {
    status: 'ready',
    filter: 'all',
    setFilter: vi.fn(),
    spelling: [group],
    duplicates: [],
    choice: () => 'DJ Lara',
    choose: vi.fn(),
    staged: new Set(),
    toggleStaged: vi.fn(),
    ignore: vi.fn(),
    summary: { tracks: 0, byField: {}, duplicates: 0 },
    progress: null,
    apply: vi.fn(),
    cancel: vi.fn(),
    undo: vi.fn(),
    lastRun: null,
    ...over,
  }
}

describe('MusicReview', () => {
  it('shows each spelling with its track count and stages the group on Unify', () => {
    const r = review()
    render(<MusicReview review={r} onClose={vi.fn()} />)
    expect(screen.getByTestId('music-review-group')).toHaveTextContent('Dj Lara')
    fireEvent.click(screen.getByTestId('music-review-stage'))
    expect(r.toggleStaged).toHaveBeenCalledWith(group.key)
  })

  // Nothing touches a file from the list itself: the tray opens a confirmation first.
  it('asks before applying and lists what stays untouched', () => {
    const r = review({ staged: new Set([group.key]), summary: { tracks: 1, byField: { artist: 1 }, duplicates: 0 } })
    render(<MusicReview review={r} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('music-review-tray-apply'))
    expect(r.apply).not.toHaveBeenCalled()
    expect(screen.getByTestId('music-review-confirm')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('music-review-confirm-apply'))
    expect(r.apply).toHaveBeenCalled()
  })

  it('disables the tray while nothing is staged', () => {
    render(<MusicReview review={review()} onClose={vi.fn()} />)
    expect(screen.getByTestId('music-review-tray-apply')).toBeDisabled()
  })

  it('offers undo after a run', () => {
    const r = review({
      status: 'done',
      lastRun: { outcomes: [], removed: [], before: 3, after: 2 },
    })
    render(<MusicReview review={r} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('music-review-undo'))
    expect(r.undo).toHaveBeenCalled()
  })

  it('says the library is empty', () => {
    render(<MusicReview review={review({ status: 'empty', spelling: [] })} onClose={vi.fn()} />)
    expect(screen.getByTestId('music-review-empty')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/renderer/src/components/MusicReview.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar `MusicReview.tsx`**

Código (clases con los tokens de `index.css`, como `TrashPanel.tsx`; el `t` de `useTranslation`):

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DuplicateCard, MusicReview as Review, ReviewFilter } from '../hooks/useMusicReview'
import { SAFE_KINDS, type SpellingGroup } from '../lib/musicSpelling'

const BTN = 'press rounded-md px-2.5 py-1 text-xs outline-none disabled:opacity-40'
const PRIMARY = `${BTN} bg-[var(--color-accent)] text-[var(--color-on-accent)]`
const GHOST = `${BTN} text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg`
const CARD = 'grid gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-3'

const clock = (sec?: number) =>
  sec === undefined ? '' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

function Dot({ safe }: { safe: boolean }) {
  const { t } = useTranslation()
  return (
    <span
      role="img"
      aria-label={t(safe ? 'musicReview.safe' : 'musicReview.review')}
      className={`h-2 w-2 shrink-0 rounded-full ${safe ? 'bg-[var(--color-good)]' : 'bg-[var(--color-warn)]'}`}
    />
  )
}

function SpellingCard({ group, review }: { group: SpellingGroup; review: Review }) {
  const { t } = useTranslation()
  const chosen = review.choice(group.key)
  const staged = review.staged.has(group.key)
  return (
    <article data-testid="music-review-group" className={`${CARD} ${staged ? 'opacity-60' : ''}`}>
      <div className="flex min-w-0 items-center gap-2">
        <Dot safe={SAFE_KINDS.has(group.kind)} />
        <b className="truncate text-sm">{chosen ?? group.variants[0].value}</b>
        <span className="truncate text-xs text-fg-faint">
          {t(`musicReview.field.${group.field}`)} · {t(`musicReview.kind.${group.kind}`)}
        </span>
        <div className="ml-auto flex shrink-0 gap-1.5">
          <button type="button" data-testid="music-review-ignore" className={GHOST} onClick={() => review.ignore(group.key)}>
            {t(group.kind === 'typo' ? 'musicReview.notSame' : 'musicReview.ignore')}
          </button>
          <button
            type="button"
            data-testid="music-review-stage"
            className={PRIMARY}
            disabled={chosen === null}
            onClick={() => review.toggleStaged(group.key)}
          >
            {t(staged ? 'musicReview.staged' : 'musicReview.unify')}
          </button>
        </div>
      </div>
      <div className="grid gap-0.5">
        {group.variants.map((v) => (
          <label key={v.value} className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1 hover:bg-[var(--color-hover)]">
            <input
              type="radio"
              name={group.key}
              checked={chosen === v.value}
              onChange={() => review.choose(group.key, v.value)}
              className="accent-[var(--color-accent)]"
            />
            <span className="truncate text-sm">{v.value}</span>
            <span className="ml-auto shrink-0 text-xs tabular-nums text-fg-faint">
              {t('musicReview.tracks', { count: v.persistentIds.length })}
            </span>
          </label>
        ))}
      </div>
      {chosen === null && <p className="text-xs text-fg-faint">{t('musicReview.tie')}</p>}
    </article>
  )
}

function DuplicateCardView({ card, review }: { card: DuplicateCard; review: Review }) {
  const { t } = useTranslation()
  const { group, entries, formats } = card
  const keep = review.choice(group.key)
  const staged = review.staged.has(group.key)
  const version = group.kind === 'version'
  const first = entries[0]
  return (
    <article data-testid="music-review-duplicate" className={`${CARD} ${staged ? 'opacity-60' : ''}`}>
      <div className="flex min-w-0 items-center gap-2">
        <Dot safe={!version} />
        <b className="truncate text-sm">
          {first?.artist} · {first?.title}
        </b>
        <span className="shrink-0 text-xs text-fg-faint">
          {version ? t('musicReview.kind.version') : t('musicReview.kind.duplicate', { count: entries.length })}
        </span>
        <div className="ml-auto flex shrink-0 gap-1.5">
          <button type="button" data-testid="music-review-ignore" className={GHOST} onClick={() => review.ignore(group.key)}>
            {t(version ? 'musicReview.different' : 'musicReview.ignore')}
          </button>
          <button
            type="button"
            data-testid="music-review-stage"
            className={version ? GHOST : PRIMARY}
            onClick={() => review.toggleStaged(group.key)}
          >
            {staged ? t('musicReview.staged') : t('musicReview.remove', { count: entries.length - 1 })}
          </button>
        </div>
      </div>
      <div className="grid gap-0.5">
        {entries.map((e) => (
          <label
            key={e.persistentId}
            className={`flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1 ${keep === e.persistentId ? 'bg-[var(--color-accent-soft)]' : ''}`}
          >
            <input
              type="radio"
              name={group.key}
              checked={keep === e.persistentId}
              onChange={() => review.choose(group.key, e.persistentId)}
              className="accent-[var(--color-accent)]"
            />
            <span className="grid min-w-0">
              <span className="truncate text-sm">{e.title}</span>
              <span className="truncate text-xs text-fg-faint tabular-nums">
                {e.artist} · {clock(e.durationSec)}
              </span>
            </span>
            <span className="ml-auto shrink-0 rounded bg-[var(--color-panel-2)] px-1.5 text-[11px] text-fg-dim">
              {formats[e.persistentId] ?? ''}
            </span>
            {keep === e.persistentId && (
              <span className="shrink-0 text-[11px] font-semibold text-[var(--color-accent)]">{t('musicReview.keeps')}</span>
            )}
          </label>
        ))}
      </div>
    </article>
  )
}

function Confirm({ review, onCancel }: { review: Review; onCancel: () => void }) {
  const { t } = useTranslation()
  const { tracks, byField, duplicates } = review.summary
  return (
    <div className="absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--color-scrim)_55%,transparent)] p-4">
      <div data-testid="music-review-confirm" role="dialog" aria-modal="true" className="grid w-full max-w-sm gap-3 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-4">
        <h3 className="text-sm font-semibold">{t('musicReview.confirm.title', { count: tracks + duplicates })}</h3>
        <dl className="grid gap-1 text-sm">
          {Object.entries(byField).map(([field, n]) => (
            <div key={field} className="flex justify-between border-b border-[var(--color-line)] py-1">
              <dt>{t(`musicReview.field.${field}`)}</dt>
              <dd className="tabular-nums">{n}</dd>
            </div>
          ))}
          {duplicates > 0 && (
            <div className="flex justify-between border-b border-[var(--color-line)] py-1">
              <dt>{t('musicReview.confirm.removed')}</dt>
              <dd className="tabular-nums">{duplicates}</dd>
            </div>
          )}
        </dl>
        {duplicates > 0 && (
          <p className="text-xs text-fg-dim">
            {t('musicReview.confirm.playlists')}. {t('musicReview.confirm.trash')}.
          </p>
        )}
        <p className="text-xs text-fg-dim">{t('musicReview.confirm.untouched')}</p>
        <label className="flex items-center gap-2 text-xs text-fg-dim">
          <input type="checkbox" checked disabled readOnly /> {t('musicReview.confirm.backup')}
        </label>
        <div className="flex justify-end gap-1.5">
          <button type="button" data-testid="music-review-confirm-cancel" className={GHOST} onClick={onCancel}>
            {t('musicReview.confirm.cancel')}
          </button>
          <button
            type="button"
            data-testid="music-review-confirm-apply"
            className={PRIMARY}
            onClick={() => {
              onCancel()
              void review.apply()
            }}
          >
            {t('musicReview.confirm.apply')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Done({ review, onContinue }: { review: Review; onContinue: () => void }) {
  const { t } = useTranslation()
  const run = review.lastRun
  if (!run) return null
  const updated = run.outcomes.filter((o) => o.music.includes('set')).length
  const musicOnly = run.outcomes.filter((o) => o.music.includes('set') && (o.file === 'unchanged' || o.file === 'missing')).length
  const failed = run.outcomes.filter((o) => o.file === 'failed' || o.music.some((m) => m === 'failed' || m === 'mismatch')).length
  return (
    <div className="absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--color-scrim)_55%,transparent)] p-4">
      <div data-testid="music-review-done" role="dialog" aria-modal="true" className="grid w-full max-w-sm gap-2 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-4 text-sm">
        <h3 className="font-semibold">{t('musicReview.done.title')}</h3>
        <p>{t('musicReview.done.updated', { count: updated + run.removed.length })}</p>
        {musicOnly > 0 && <p className="text-fg-dim">{t('musicReview.done.musicOnly', { count: musicOnly })}</p>}
        {failed > 0 && <p className="text-[var(--color-danger)]">{t('musicReview.done.failed', { count: failed })}</p>}
        <p className="text-fg-dim tabular-nums">{t('musicReview.done.left', { count: run.after })}</p>
        <div className="flex justify-end gap-1.5">
          <button type="button" data-testid="music-review-undo" className={GHOST} onClick={() => void review.undo()}>
            {t('musicReview.done.undo')}
          </button>
          <button type="button" data-testid="music-review-continue" className={PRIMARY} onClick={onContinue}>
            {t('musicReview.done.continue')}
          </button>
        </div>
      </div>
    </div>
  )
}

const FILTERS: ReviewFilter[] = ['all', 'spelling', 'duplicates']

export function MusicReview({ review, onClose }: { review: Review; onClose: () => void }) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const [doneSeen, setDoneSeen] = useState<object | null>(null)
  const counts = { all: review.spelling.length + review.duplicates.length, spelling: review.spelling.length, duplicates: review.duplicates.length }
  const showSpelling = review.filter !== 'duplicates'
  const showDuplicates = review.filter !== 'spelling'
  const pending = review.summary.tracks + review.summary.duplicates
  const nothing = review.status === 'ready' && counts.all === 0
  return (
    <div data-testid="music-review" className="relative flex min-h-0 flex-1 flex-col">
      <div className="grid gap-2.5 border-b border-[var(--color-line)] px-3 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t('musicReview.title')}</h2>
          <button type="button" data-testid="music-review-close" className={`${GHOST} ml-auto`} onClick={onClose}>
            {t('musicReview.close')}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              data-testid={`music-review-filter-${f}`}
              aria-pressed={review.filter === f}
              onClick={() => review.setFilter(f)}
              className="press rounded-full border border-[var(--color-line-strong)] px-2.5 py-0.5 text-xs text-fg-dim outline-none aria-pressed:border-transparent aria-pressed:bg-[var(--color-accent-soft)] aria-pressed:text-fg"
            >
              {t(`musicReview.filter.${f}`)} <span className="tabular-nums text-fg-faint">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-3 pb-24">
        {review.status === 'loading' && <p className="text-xs text-fg-faint">…</p>}
        {review.status === 'empty' && <p data-testid="music-review-empty" className="text-xs text-fg-faint">{t('musicReview.empty')}</p>}
        {review.status === 'error' && <p data-testid="music-review-error" className="text-xs text-fg-faint">{t('musicReview.error')}</p>}
        {nothing && <p data-testid="music-review-clean" className="text-xs text-fg-faint">{t('musicReview.clean')}</p>}
        {showSpelling && review.spelling.map((g) => <SpellingCard key={g.key} group={g} review={review} />)}
        {showDuplicates && review.duplicates.map((c) => <DuplicateCardView key={c.group.key} card={c} review={review} />)}
      </div>
      <div data-testid="music-review-tray" className="absolute right-3 bottom-3 left-3 flex items-center gap-2.5 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2.5">
        {review.status === 'applying' ? (
          <>
            <span className="text-xs tabular-nums">
              {t('musicReview.applying', { done: review.progress?.done ?? 0, total: review.progress?.total ?? 0 })}
            </span>
            <button type="button" data-testid="music-review-stop" className={`${GHOST} ml-auto`} onClick={review.cancel}>
              {t('musicReview.stop')}
            </button>
          </>
        ) : (
          <>
            <span className="min-w-0 truncate text-xs">
              {pending > 0 ? t('musicReview.tray.count', { count: pending }) : t('musicReview.tray.empty')}
            </span>
            <button
              type="button"
              data-testid="music-review-tray-apply"
              className={`${PRIMARY} ml-auto shrink-0`}
              disabled={review.staged.size === 0}
              onClick={() => setConfirming(true)}
            >
              {t('musicReview.tray.apply')}
            </button>
          </>
        )}
      </div>
      {confirming && <Confirm review={review} onCancel={() => setConfirming(false)} />}
      {review.status === 'done' && review.lastRun && doneSeen !== review.lastRun && (
        <Done review={review} onContinue={() => setDoneSeen(review.lastRun)} />
      )}
    </div>
  )
}
```

Comprobar al implementarlo que la clase `aria-pressed:` existe en la versión de Tailwind del repo (v4 la trae); si no, usar `data-[pressed=true]:` con un atributo `data-pressed`.

Añadir el bloque `musicReview` a los cinco ficheros de idioma.

- [ ] **Step 4: Ver que pasan, con la paridad de claves**

Run: `cd apps/desktop && npm test -- src/renderer/src/components/MusicReview.test.tsx src/renderer/src/i18n`
Expected: PASS, incluidos `keys.test.ts` y `usedKeys.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/MusicReview.tsx apps/desktop/src/renderer/src/components/MusicReview.test.tsx apps/desktop/src/renderer/src/i18n/locales
git commit -m "Show the Music review as groups to resolve, a tray of pending changes and a confirmation"
```

---

### Task 12: Entradas por menú y ⌘K, y la vista en la columna de la lista

**Files:**
- Modify: `apps/desktop/src/main/appMenu.ts`, `apps/desktop/src/main/i18n.ts`, `apps/desktop/src/main/index.ts` (pasar `mac`)
- Modify: `apps/desktop/src/renderer/src/lib/commands.ts`, `apps/desktop/src/renderer/src/App.tsx`, locales (`commands.musicReview`, `commands.musicDuplicates`)
- Test: `apps/desktop/src/main/appMenu.test.ts`, `apps/desktop/src/renderer/src/lib/commands.test.ts`, `apps/desktop/src/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: `useMusicReview` (Task 10), `MusicReview` (Task 11), `rereadTrackMeta`, `refreshTrackFromDisk` (`useTrackLibrary`), `saveSettings`.
- Produces: comandos `music-review` y `music-duplicates`; `CommandDeps.openMusicReview?: (filter: 'all' | 'duplicates') => void`; `appMenuTemplate({ …, mac })`.

- [ ] **Step 1: Escribir los tests que fallan**

`appMenu.test.ts` (añadir `mac` al helper `build`, por defecto `true`):

```ts
  it('reviews the Music library from the File menu on a Mac', () => {
    const { template, run } = build()
    const file = menu(template, 'File')
    click(itemFor(file, 'Review metadata in Apple Music…'))
    click(itemFor(file, 'Show duplicates in Apple Music…'))
    expect(run.mock.calls.map((c) => c[0])).toEqual(['music-review', 'music-duplicates'])
  })

  it('has no Music review where there is no Music to script', () => {
    const file = menu(build('en', false).template, 'File')
    expect(file.find((i) => i.label === 'Review metadata in Apple Music…')).toBeUndefined()
  })
```

`commands.test.ts` (con el helper de deps que ya use el fichero):

```ts
  it('registers the Music review only where it can run', () => {
    const open = vi.fn()
    const mac = buildCommands({ ...deps(), openMusicReview: open })
    runCommand(mac, 'music-duplicates')
    expect(open).toHaveBeenCalledWith('duplicates')
    expect(buildCommands({ ...deps(), openMusicReview: undefined }).some((c) => c.id === 'music-review')).toBe(false)
  })
```

`App.test.tsx` (usa el arnés del fichero: `setApi`, `renderApp`, `runMenu`, `addOneTrack`; `App` lee `platform` al importarse, de ahí el `vi.resetModules()` como en los tests de la línea ~3406):

```tsx
  // The review takes the list column while open and gives it back as it was.
  it('swaps the list for the Music review and back', async () => {
    vi.resetModules()
    setApi({
      platform: 'darwin',
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      loadMusicReview: vi.fn().mockResolvedValue([]),
    })
    await renderApp()
    await addOneTrack()
    runMenu('music-review')
    expect(await screen.findByTestId('music-review-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('track-row')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('music-review-close'))
    expect(await screen.findAllByTestId('track-row')).toHaveLength(1)
  })

  // A file the review rewrote may be open in the list; rereading it keeps a later
  // Update from writing the old artist back over the fix.
  it('rereads a listed track whose file the review changed', async () => {
    vi.resetModules()
    const readTags = vi.fn().mockResolvedValue({ title: 'T', artist: 'Dj Lara' })
    const entry = (persistentId: string, artist: string) => ({
      persistentId,
      title: 'T',
      artist,
      albumArtist: '',
      album: '',
      genre: '',
    })
    setApi({
      platform: 'darwin',
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags,
      loadMusicReview: vi
        .fn()
        .mockResolvedValue([entry('0000000000000001', 'DJ Lara'), entry('0000000000000002', 'DJ Lara'), entry('0000000000000003', 'Dj Lara')]),
      applyMusicFixes: vi.fn().mockResolvedValue([
        {
          persistentId: '0000000000000003',
          path: '/music/a.wav',
          fixes: [{ persistentId: '0000000000000003', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
          music: ['set'],
          file: 'written',
          backupId: 'b1',
        },
      ]),
      onMusicFixProgress: () => () => {},
      appleMusicEntryLocation: vi.fn().mockResolvedValue(''),
    })
    await renderApp()
    await addOneTrack()
    const readsBefore = readTags.mock.calls.length
    runMenu('music-review')
    fireEvent.click(await screen.findByTestId('music-review-stage'))
    fireEvent.click(screen.getByTestId('music-review-tray-apply'))
    fireEvent.click(screen.getByTestId('music-review-confirm-apply'))
    await waitFor(() => expect(readTags.mock.calls.length).toBeGreaterThan(readsBefore))
    expect(readTags.mock.calls.at(-1)?.[0]).toBe('/music/a.wav')
  })
```

Si el arnés lee los tags con `readMeta` y no con `readTags` (el fichero tiene los dos mocks), afirmar sobre el que use `rereadTrackMeta`.

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/main/appMenu.test.ts src/renderer/src/lib/commands.test.ts src/renderer/src/App.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`main/i18n.ts`: añadir `reviewMusic` y `musicDuplicates` a `MenuStrings` y a las cinco lenguas:

| clave | es | en | de | fr | pt-BR |
|---|---|---|---|---|---|
| `reviewMusic` | Revisar metadatos en Apple Music… | Review metadata in Apple Music… | Metadaten in Apple Music prüfen… | Vérifier les métadonnées dans Apple Music… | Revisar metadados no Apple Music… |
| `musicDuplicates` | Mostrar duplicados en Apple Music… | Show duplicates in Apple Music… | Duplikate in Apple Music anzeigen… | Afficher les doublons dans Apple Music… | Mostrar duplicados no Apple Music… |

`main/appMenu.ts`: `Params` gana `mac: boolean`; en el submenú Archivo, tras `keymapItem(t('addAppleMusic'), 'add-apple-music')`:

```ts
        ...(mac
          ? [keymapItem(t('reviewMusic'), 'music-review'), keymapItem(t('musicDuplicates'), 'music-duplicates')]
          : []),
```

`main/index.ts:349`: pasar `mac: process.platform === 'darwin'`.

`lib/commands.ts`: en `CommandDeps`, junto a `openApplePlaylist`:

```ts
  // Opens the Music library review. Undefined off macOS, like openApplePlaylist.
  openMusicReview?: (filter: 'all' | 'duplicates') => void
```

y en la lista, tras el bloque de `import-apple-playlist`:

```ts
    ...(openMusicReview
      ? [
          { id: 'music-review', group: 'library' as const, title: tr('commands.musicReview'), hint: hintFor('music-review'), enabled: true, run: () => openMusicReview('all') },
          { id: 'music-duplicates', group: 'library' as const, title: tr('commands.musicDuplicates'), hint: hintFor('music-duplicates'), enabled: true, run: () => openMusicReview('duplicates') },
        ]
      : []),
```

(`commands.musicReview` / `commands.musicDuplicates` en los cinco locales con los mismos textos del menú sin los puntos suspensivos.)

`App.tsx`:
- Estado `const [musicReview, setMusicReview] = useState<'all' | 'duplicates' | null>(null)`.
- `openMusicReview: isMac ? setMusicReview : undefined` en las deps de comandos (junto a `openApplePlaylist`, línea ~1754).
- Un componente pequeño dentro del fichero o en `components/MusicReviewColumn.tsx` que llama a `useMusicReview({ initialFilter: musicReview, ignored: settings?.musicReviewIgnored ?? [], saveIgnored: (keys) => saveSettings({ musicReviewIgnored: keys }), onFilesChanged })` y pinta `<MusicReview review={…} onClose={() => setMusicReview(null)} />`. Va dentro de la columna (`div ref={listScrollRef}` de la línea ~1933) en lugar de `TrackListHeader`/`TrackList` cuando `musicReview !== null`. La lista no se desmonta del estado (`tracks` vive en `useTrackLibrary`), así que al cerrar vuelve tal como estaba.
- `onFilesChanged(paths)`: para cada fila con `inputPath` en `paths`, `await rereadTrackMeta(row.id)` y `await refreshTrackFromDisk(row.id, row.inputPath)`, como hace la restauración de copias en `App.tsx:1305`.

- [ ] **Step 4: Ver que pasan y la suite completa**

Run: `cd apps/desktop && npm test` y el typecheck.
Expected: todo verde. Si algo falla fuera de estos ficheros, comprobar si también falla en `main` antes de tocar nada ([[suite-flaky-fichero-entero]], [[disco-lleno-tests-papelera]]).

- [ ] **Step 5: Lint**

Run: `cd apps/desktop && npm run lint`
Expected: sin avisos.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/appMenu.ts apps/desktop/src/main/appMenu.test.ts apps/desktop/src/main/i18n.ts apps/desktop/src/main/index.ts apps/desktop/src/renderer/src/lib/commands.ts apps/desktop/src/renderer/src/lib/commands.test.ts apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.test.tsx apps/desktop/src/renderer/src/i18n/locales
git commit -m "Open the Music metadata review from the File menu and the palette, in place of the list"
```

---

### Task 13: Verificación en la app real

**Files:** ninguno (si aparece un fallo, vuelve a la tarea dueña con un test rojo primero).

- [ ] **Step 1: Lectura sobre la biblioteca real (solo lectura)**

Con la skill `run-desktop` (desde este worktree, ojo [[driver-binario-equivocado]] y [[driver-worktree-ffmpeg]]), abrir Archivo → "Revisar metadatos en Apple Music…". Comprobar que salen `DJ Lara` ×11 / `Dj Lara` ×1, `Head Horny's`, `Álex Cervera`/`Álex Cevera`, `Rachel`/`Rahcel` sin grafía marcada, `Electronic`/`electronic`, y en Duplicados `Possession (Dececio Remix)` ×3 y `Make My Body Move [ADC075]` como otra versión. Nada se escribe.

- [ ] **Step 2: Escritura sobre pistas de prueba, nunca sobre la biblioteca real sin permiso**

Pedir al usuario permiso y dos o tres pistas desechables (un MP3 con cues de Traktor y un WAV) añadidas a Music con una grafía rota a propósito. Unificar, aplicar, y comprobar:
- en Music el campo nuevo;
- en el fichero, con `snapshotTags` o mp3tag, solo ese campo cambiado y los cues intactos;
- en Copias de seguridad, una entrada por fichero;
- "Deshacer" devuelve fichero y Music a su estado.

- [ ] **Step 3: Duplicado de prueba**

Dos entradas del mismo tema (una en una playlist normal). Quitar la peor y comprobar que la otra entra en esa playlist, que el fichero quitado está en la Papelera y que una pareja por enlace simbólico no tira el fichero.

- [ ] **Step 4: Informe al usuario**

Qué se probó, qué no y lo que se vio, con capturas. Sin merge hasta su visto bueno ([[cierre-features-merge-local]]).
