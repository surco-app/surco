# Traktor collection.nml Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surco actualiza la `ENTRY` del `collection.nml` de Traktor (cues, carátula, ruta) de las pistas que convierte, para que Traktor deje de imponer sus datos cacheados sobre el fichero recién escrito.

**Architecture:** Tres módulos en `apps/desktop/src/main/`, copiando el reparto de la integración de Engine DJ. `traktorNml.ts` hace edición quirúrgica de texto sobre el XML (sin parser, sin dependencias nuevas) para que el diff sea mínimo. `traktorNmlLibrary.ts` pone la política: backup rotado, guarda de Traktor abierto, emparejado por ruta, una escritura por lote. `traktorProcess.ts` detecta el proceso.

**Tech Stack:** TypeScript, Node (`node:fs/promises`, `node:child_process`), Vitest. Sin dependencias nuevas.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-26-traktor-nml-sync-design.md`. Es la fuente de verdad; ante duda, manda el spec.
- **Sin dependencias nuevas.** Ni parser XML ni nada. Edición por texto.
- **Cero comentarios de código nuevos que expliquen el *qué*.** Este codebase comenta el *por qué* con prosa densa (ver `engineLibrary.ts`, `tags.ts`). Sigue ese estilo: comentarios que explican decisiones y trampas, nunca los que narran la línea siguiente. Las reglas globales del usuario prohíben comentarios; en este repo la convención existente es comentar el porqué. Conformidad con el repo gana: comenta como `engineLibrary.ts`.
- **Backup siempre antes de escribir.** Si el backup falla, no se escribe. No es configurable.
- **Traktor abierto ⇒ no se escribe.** Comprobar al empezar Y de nuevo justo antes del rename (`engineLibrary.ts` hace esto, y el comentario explica por qué: la ventana entre la comprobación y el swap es una carrera real).
- **Un fallo del NML nunca rompe la conversión.** Se reporta, no se lanza hacia arriba.
- **`START` de un `CUE_V2`** son milisegundos, float con 6 decimales (`f"{v:.6f}"`).
- **NUNCA hacer clamp del grid anchor a 0.** El `TYPE=4` es **fase**, no posición: ya se corrigió ese bug en Surco (`traktor4.ts`). El script de djotas sí hace clamp; no lo copies.
- **Tests desde `apps/desktop`**, nunca desde la raíz: `cd apps/desktop && npx vitest run <fichero>`. Desde la raíz se salta el setup y da fallos falsos.
- **Type-check:** `cd apps/desktop && npx tsc --build`.

## File Structure

| Fichero | Responsabilidad |
|---|---|
| `src/main/traktorNml.ts` (nuevo) | Edición de texto del NML: localizar ENTRYs, aplicar cambios, devolver el texto nuevo. Puro, sin IO. |
| `src/main/traktorNml.test.ts` (nuevo) | Tests del anterior sobre NMLs sintéticos en string. |
| `src/main/traktorProcess.ts` (nuevo) | ¿Traktor corriendo? + cierre educado. |
| `src/main/traktorNmlLibrary.ts` (nuevo) | Política: backup rotado, guardas, emparejado, escritura atómica del lote. |
| `src/main/traktorNmlLibrary.test.ts` (nuevo) | Tests de las guardas y del backup, con `fs` real en tmpdir. |
| `src/main/settings.ts` (modificar) | Añadir `traktorNmlPath` a defaults y a `LOCAL_KEYS`. |

**Nota de alcance:** este plan cubre el núcleo (módulos + settings). El cableado a la UI de Ajustes, la autodetección de rutas de versión y el disparo al final del lote de conversión se planifican después, cuando el núcleo esté verde y validado contra un NML real de djotas. El spec avisa de que la validación final no se puede hacer en esta máquina.

---

### Task 1: Localizar y leer ENTRYs del NML

**Files:**
- Create: `apps/desktop/src/main/traktorNml.ts`
- Test: `apps/desktop/src/main/traktorNml.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export interface NmlEntry { start: number; end: number; volume: string; dir: string; file: string }`
    (`start`/`end` son índices de carácter del bloque `<ENTRY ...>...</ENTRY>` en el texto)
  - `export function findEntries(nml: string): NmlEntry[]`

- [ ] **Step 1: Write the failing test**

```typescript
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { findEntries } from './traktorNml'

const NML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<NML VERSION="19">
<COLLECTION ENTRIES="2">
<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A">
<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>
</ENTRY>
<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Dos" ARTIST="B">
<LOCATION DIR="/:Musica/:" FILE="dos.flac" VOLUME="Macintosh HD"></LOCATION>
</ENTRY>
</COLLECTION>
</NML>`

describe('findEntries', () => {
  // El emparejado por ruta necesita VOLUME+DIR+FILE de cada ENTRY, y los índices
  // exactos del bloque para poder sustituirlo sin tocar el resto del documento.
  it('reads each entry location and its span in the text', () => {
    const entries = findEntries(NML)

    expect(entries).toHaveLength(2)
    expect(entries[0].file).toBe('uno.aiff')
    expect(entries[0].dir).toBe('/:Musica/:')
    expect(entries[0].volume).toBe('Macintosh HD')
    expect(NML.slice(entries[0].start, entries[0].end)).toContain('TITLE="Uno"')
    expect(NML.slice(entries[0].start, entries[0].end)).not.toContain('TITLE="Dos"')
  })

  // Un NML sin colección (o con una vacía) es válido: no hay nada que emparejar.
  it('returns nothing for a collection with no entries', () => {
    expect(findEntries('<NML VERSION="19"><COLLECTION ENTRIES="0"></COLLECTION></NML>')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/traktorNml.test.ts`
Expected: FAIL — `findEntries` no existe (error de resolución del módulo).

- [ ] **Step 3: Write minimal implementation**

```typescript
// El NML se edita como texto, no a través de un parser XML: un round-trip genérico
// normaliza comillas, entidades y espaciado del documento entero, y convertiría un
// cambio de tres atributos en un diff de toda la colección del usuario. Aquí cada
// ENTRY se localiza por posición y sólo se sustituyen los tramos que cambian.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/main/traktorNml.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/traktorNml.ts apps/desktop/src/main/traktorNml.test.ts
git commit -m "Locate the entries of a Traktor collection by text span"
```

---

### Task 2: Traducir el árbol binario de cues a CUE_V2 XML

**Files:**
- Modify: `apps/desktop/src/main/traktorNml.ts`
- Test: `apps/desktop/src/main/traktorNml.test.ts`

**Interfaces:**
- Consumes: `traktor4Fixture.ts` → `buildTraktorTree(cues: Uint8Array[])`, `traktorCue(name: string, type: number, startMs: number, hot: number)`.
- Produces:
  - En `traktor4.ts`: `export interface TraktorMarker { name: string; type: number; startMs: number; hotcue: number }` y `export function readTraktorMarkers(tree: Uint8Array): TraktorMarker[]` (devuelve `[]` si el árbol no es un `TRMD` válido o no trae `CUEP`).
  - En `traktorNml.ts`: `export function cuesToXml(tree: Uint8Array): string`.

**Contexto imprescindible:** el fichero de audio guarda los cues como **árbol binario**; el NML los guarda como **elementos XML**. No es un volcado, es una traducción — ésta es la pieza realmente nueva de la feature.

`readTraktorMarkers` **no existe todavía; la creas en esta tarea**, en `traktor4.ts`, extrayendo el recorrido que ya hace `shiftTraktorCues` (líneas 58-100): valida la cabecera `TRMD`, recorre el árbol con la misma función `walk`, y en vez de reescribir los `CUEP` los lee. No dupliques el parseo binario en `traktorNml.ts` — comparte el recorrido con `shiftTraktorCues` para que un cambio de formato no haya que arreglarlo en dos sitios. Mira `traktorCue` en `traktor4Fixture.ts` para el layout exacto de un `CUEP` (nombre UTF-16, tipo, start, hotcue).

Recuerda la restricción global: el `TYPE=4` es **fase**, no posición. Al leerlo no lo trates como un tiempo que haya que clampear.

- [ ] **Step 1: Write the failing test**

```typescript
import { buildTraktorTree, traktorCue } from './traktor4Fixture'
import { cuesToXml } from './traktorNml'

describe('cuesToXml', () => {
  // La traducción binario→XML es la pieza nueva: el fichero guarda un árbol y el NML
  // elementos <CUE_V2>. START va en milisegundos con 6 decimales, como escribe Traktor.
  it('emits one CUE_V2 element per marker, with millisecond positions', () => {
    const tree = buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)])

    const xml = cuesToXml(tree)

    expect(xml).toContain('<CUE_V2')
    expect(xml).toContain('NAME="Drop"')
    expect(xml).toContain('HOTCUE="1"')
    expect(xml).toContain('START="79672.640000"')
  })

  // Un árbol sin marcadores no debe producir un CUE_V2 vacío que Traktor luego lea
  // como un cue en el segundo 0.
  it('emits nothing for a tree with no markers', () => {
    expect(cuesToXml(buildTraktorTree([]))).toBe('')
  })

  // Varios marcadores, incluido el grid (TYPE=4): salen todos, en orden, y el grid
  // conserva su valor tal cual — es fase, no una posición que haya que corregir.
  it('emits every marker including the grid anchor', () => {
    const xml = cuesToXml(
      buildTraktorTree([traktorCue('AutoGrid', 4, 143.38, 0), traktorCue('Drop', 0, 79672.64, 1)]),
    )

    expect(xml.match(/<CUE_V2/g)).toHaveLength(2)
    expect(xml).toContain('TYPE="4"')
    expect(xml).toContain('START="143.380000"')
  })
})

describe('readTraktorMarkers', () => {
  // La lectura comparte recorrido con shiftTraktorCues: un árbol que no es TRMD (o
  // viene corrupto) no debe lanzar, sino declarar que no hay marcadores que copiar.
  it('returns nothing for a tree that is not a valid TRMD', () => {
    expect(readTraktorMarkers(new Uint8Array([1, 2, 3, 4]))).toEqual([])
  })

  it('reads each marker back out of the tree', () => {
    const markers = readTraktorMarkers(buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)]))

    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ name: 'Drop', type: 0, hotcue: 1 })
    expect(markers[0].startMs).toBeCloseTo(79672.64)
  })
})
```

Añade el import: `import { readTraktorMarkers } from './traktor4'`

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/traktorNml.test.ts -t cuesToXml`
Expected: FAIL — `cuesToXml` no está exportada.

- [ ] **Step 3: Write minimal implementation**

Lee primero `apps/desktop/src/main/traktor4.ts` para reutilizar su recorrido del árbol (no dupliques el parseo binario: si hace falta, exporta desde `traktor4.ts` una función que devuelva los marcadores como objetos `{ name, type, startMs, hotcue }` y consúmela aquí). Luego:

```typescript
export interface TraktorMarker {
  name: string
  type: number
  startMs: number
  hotcue: number
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function cuesToXml(tree: Uint8Array): string {
  return readTraktorMarkers(tree)
    .map(
      (m) =>
        `<CUE_V2 NAME="${escapeAttr(m.name)}" DISPL_ORDER="0" TYPE="${m.type}" ` +
        `START="${m.startMs.toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="${m.hotcue}"></CUE_V2>`,
    )
    .join('')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/main/traktorNml.test.ts`
Expected: PASS (7 tests: los 2 de Task 1 más los 5 nuevos)

Comprueba además que no has roto el re-anclado al extraer el recorrido compartido:

Run: `cd apps/desktop && npx vitest run src/main/traktor4.test.ts src/main/convertCues.test.ts`
Expected: PASS, sin regresiones

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/traktorNml.ts apps/desktop/src/main/traktorNml.test.ts apps/desktop/src/main/traktor4.ts
git commit -m "Translate a Traktor cue tree into the collection's CUE_V2 elements"
```

---

### Task 3: Aplicar cambios a una ENTRY preservando el resto

**Files:**
- Modify: `apps/desktop/src/main/traktorNml.ts`
- Test: `apps/desktop/src/main/traktorNml.test.ts`

**Interfaces:**
- Consumes: `findEntries`, `cuesToXml` (Tasks 1-2).
- Produces:
  - `export interface NmlPatch { volume: string; dir: string; file: string; cueTree?: Uint8Array; newFile?: string; clearCoverArt?: boolean }`
  - `export function applyPatches(nml: string, patches: NmlPatch[]): string`

- [ ] **Step 1: Write the failing test**

```typescript
import { applyPatches } from './traktorNml'

describe('applyPatches', () => {
  // El caso AIFF→FLAC: la ENTRY existe pero apunta al fichero viejo. Se reapunta
  // LOCATION para que la pista siga siendo UNA en Traktor, con sus playlists.
  it('repoints LOCATION when the conversion changed the extension', () => {
    const out = applyPatches(NML, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', newFile: 'uno.flac' },
    ])

    expect(out).toContain('FILE="uno.flac"')
    expect(out).not.toContain('FILE="uno.aiff"')
    expect(out).toContain('FILE="dos.flac"')
  })

  // COVERARTID es una referencia a la caché de carátulas de Traktor: mientras esté,
  // Traktor sigue mostrando la vieja aunque el fichero lleve otra imagen.
  it('drops COVERARTID so Traktor re-reads the artwork', () => {
    const withCover = NML.replace(
      '<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A">',
      '<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A"><INFO COVERARTID="042/ABC" BITRATE="1411"></INFO>',
    )

    const out = applyPatches(withCover, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', clearCoverArt: true },
    ])

    expect(out).not.toContain('COVERARTID')
    expect(out).toContain('BITRATE="1411"')
  })

  // Lo esencial del enfoque por texto: una pista que no está en la colección no
  // produce ningún cambio. Ni una coma del documento del usuario se mueve.
  it('leaves the document byte-for-byte identical when nothing matches', () => {
    expect(applyPatches(NML, [{ volume: 'Otro', dir: '/:X/:', file: 'nope.mp3' }])).toBe(NML)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/traktorNml.test.ts -t applyPatches`
Expected: FAIL — `applyPatches` no existe.

- [ ] **Step 3: Write minimal implementation**

Sustituye de atrás hacia adelante (índices descendentes) para que los `start`/`end` calculados por `findEntries` sigan siendo válidos mientras editas. Dentro de cada bloque: reemplaza el `FILE="..."` del `<LOCATION>` si hay `newFile`; borra el atributo `COVERARTID="..."` del `<INFO>` si `clearCoverArt`; sustituye los `<CUE_V2 ...></CUE_V2>` existentes por `cuesToXml(cueTree)` si hay `cueTree`. Emparejado: `volume`+`dir`+`file` normalizados NFC (APFS trata NFC y NFD como el mismo fichero), y si no hay coincidencia exacta, prueba mismo `volume`+`dir` y mismo nombre base ignorando extensión.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/main/traktorNml.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/traktorNml.ts apps/desktop/src/main/traktorNml.test.ts
git commit -m "Patch a collection entry's cues, artwork and location in place"
```

---

### Task 4: Detectar si Traktor está abierto

**Files:**
- Create: `apps/desktop/src/main/traktorProcess.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `export async function isTraktorRunning(): Promise<boolean>` y `export async function quitTraktor(): Promise<boolean>`.

**Contexto:** copia `apps/desktop/src/main/engineProcess.ts` — mismo problema, misma solución. Léelo entero antes de escribir. El binario de Traktor se llama `Traktor` en macOS (`pgrep -x Traktor`) y `Traktor.exe` en Windows. Sin tests propios: `engineProcess.ts` tampoco los tiene, porque son llamadas a binarios del sistema; la política que sí se testea es la de Task 6.

- [ ] **Step 1: Read the reference and write the module**

Run: `cat apps/desktop/src/main/engineProcess.ts`

Adapta ambas funciones cambiando el nombre del proceso, conservando el razonamiento de los comentarios (por qué el proceso es la señal fiable, por qué un `pgrep` que falla significa "no puedo saberlo" y devuelve `false`).

- [ ] **Step 2: Type-check**

Run: `cd apps/desktop && npx tsc --build`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/traktorProcess.ts
git commit -m "Detect a running Traktor before touching its collection"
```

---

### Task 5: Ajuste traktorNmlPath

**Files:**
- Modify: `apps/desktop/src/main/settings.ts`

**Interfaces:**
- Produces: la clave `traktorNmlPath: string` en los settings, `''` por defecto.

- [ ] **Step 1: Add the setting**

En el objeto de defaults, junto a `engineLibraryDir` (línea ~43), añade `traktorNmlPath: ''`. Vacío significa feature apagada: no hay ruta por defecto fiable (Traktor crea una carpeta por versión y la del usuario puede estar fuera del sitio estándar — ver spec).

Añade `'traktorNmlPath'` al array `LOCAL_KEYS` (línea ~110), con un comentario en el estilo del fichero explicando que una ruta de máquina no se sincroniza. Es una clave **nueva**, así que no hace falta migración de lectura.

- [ ] **Step 2: Type-check and run the settings tests**

Run: `cd apps/desktop && npx tsc --build && npx vitest run src/main/settings.test.ts`
Expected: exit 0 y tests en verde

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/settings.ts
git commit -m "Add the Traktor collection path setting"
```

---

### Task 6: Backup rotado, guardas y escritura del lote

**Files:**
- Create: `apps/desktop/src/main/traktorNmlLibrary.ts`
- Test: `apps/desktop/src/main/traktorNmlLibrary.test.ts`

**Interfaces:**
- Consumes: `applyPatches`/`NmlPatch` (Task 3), `isTraktorRunning` (Task 4).
- Produces: `export async function syncCollection(nmlPath: string, patches: NmlPatch[]): Promise<{ written: boolean; matched: number; reason?: 'traktor-running' | 'backup-failed' | 'no-matches' | 'unreadable' }>`

**Contexto:** lee `apps/desktop/src/main/engineLibrary.ts` (función `writeBatch`, líneas ~162-240) antes de empezar. De ahí sale todo el patrón, incluida una lección que hay que copiar: la guarda de proceso se comprueba **dos veces**, al empezar y otra vez justo antes del rename, porque la app puede arrancar en esa ventana y el swap sería la carrera que la guarda intenta evitar.

- [ ] **Step 1: Write the failing tests**

```typescript
// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./traktorProcess', () => ({ isTraktorRunning: vi.fn().mockResolvedValue(false) }))

import { isTraktorRunning } from './traktorProcess'
import { syncCollection } from './traktorNmlLibrary'

const NML = `<NML VERSION="19"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Uno"><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION></ENTRY>
</COLLECTION></NML>`

let dir: string
let nmlPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'surco-nml-'))
  nmlPath = join(dir, 'collection.nml')
  writeFileSync(nmlPath, NML)
  vi.mocked(isTraktorRunning).mockResolvedValue(false)
})

const patch = { volume: 'HD', dir: '/:M/:', file: 'uno.aiff', newFile: 'uno.flac' }

describe('syncCollection', () => {
  // La colección es la biblioteca entera de un DJ: nunca se escribe sin una copia
  // recuperable al lado, y el backup va ANTES de tocar el original.
  it('writes a dated backup before touching the collection', async () => {
    const result = await syncCollection(nmlPath, [patch])

    expect(result.written).toBe(true)
    const backups = readdirSync(dir).filter((f) => f.includes('surco') && f.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(dir, backups[0]), 'utf8')).toBe(NML)
    expect(readFileSync(nmlPath, 'utf8')).toContain('uno.flac')
  })

  // Traktor carga la colección al arrancar y la reescribe al cerrar: escribir con
  // Traktor abierto se pierde al salir, sin error visible. Mejor no escribir.
  it('refuses to write while Traktor is running', async () => {
    vi.mocked(isTraktorRunning).mockResolvedValue(true)

    const result = await syncCollection(nmlPath, [patch])

    expect(result).toMatchObject({ written: false, reason: 'traktor-running' })
    expect(readFileSync(nmlPath, 'utf8')).toBe(NML)
  })

  // El flujo real es iterativo (probar, comprobar en Traktor, volver a probar), así
  // que una sola copia pisada en cada escritura deja al usuario sin red. Se rotan 10.
  it('keeps only the ten most recent backups', async () => {
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(dir, `collection.nml.surco-2026-07-0${i % 10}T0${i % 10}-00.bak`), 'old')
    }

    await syncCollection(nmlPath, [patch])

    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toHaveLength(10)
  })

  // Una pista que no está en la colección no es un error: es el caso normal de
  // "esta no la tiene Traktor". No se escribe, y no se toca el fichero.
  it('does not write when no entry matches', async () => {
    const result = await syncCollection(nmlPath, [
      { volume: 'X', dir: '/:otro/:', file: 'nope.mp3' },
    ])

    expect(result).toMatchObject({ written: false, reason: 'no-matches' })
    expect(readFileSync(nmlPath, 'utf8')).toBe(NML)
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toHaveLength(0)
  })

  // El NML puede ser de decenas de MB: un lote de N pistas es UNA lectura y UNA
  // escritura, no N reescrituras del fichero entero.
  it('writes once for a batch of several tracks', async () => {
    const many = `<NML VERSION="19"><COLLECTION ENTRIES="2">
<ENTRY TITLE="Uno"><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION></ENTRY>
<ENTRY TITLE="Dos"><LOCATION DIR="/:M/:" FILE="dos.aiff" VOLUME="HD"></LOCATION></ENTRY>
</COLLECTION></NML>`
    writeFileSync(nmlPath, many)

    const result = await syncCollection(nmlPath, [
      patch,
      { volume: 'HD', dir: '/:M/:', file: 'dos.aiff', newFile: 'dos.flac' },
    ])

    expect(result).toMatchObject({ written: true, matched: 2 })
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toHaveLength(1)
    const out = readFileSync(nmlPath, 'utf8')
    expect(out).toContain('uno.flac')
    expect(out).toContain('dos.flac')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/traktorNmlLibrary.test.ts`
Expected: FAIL — `syncCollection` no existe.

- [ ] **Step 3: Write the implementation**

Orden obligatorio: comprobar Traktor → leer el NML → `applyPatches` → si el texto no cambió, salir con `no-matches` (sin backup, sin escritura) → backup con fecha ISO (`:` sustituidos por `-`) → rotar dejando los 10 más recientes → **volver a comprobar Traktor** → escribir a temporal y `rename` sobre el original. Un `readFile` que falla devuelve `unreadable`; un `copyFile` de backup que falla devuelve `backup-failed` **sin escribir nada**. Nada de esto lanza excepción hacia arriba: la conversión no debe romperse porque el NML falle.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/traktorNmlLibrary.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Full suite and type-check**

Run: `cd apps/desktop && npx tsc --build` y luego, desde la raíz, `npm test`
Expected: exit 0 en ambos, sin regresiones

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/traktorNmlLibrary.ts apps/desktop/src/main/traktorNmlLibrary.test.ts
git commit -m "Sync a batch of tracks into the Traktor collection behind a backup"
```

---

## Lo que queda fuera de este plan

Deliberadamente, porque el núcleo debe validarse contra un NML real antes de cablearlo:

1. **UI de Ajustes** (selector de fichero + autodetección de `~/Documents/Native Instruments/Traktor */collection.nml` + aviso de versión nueva).
2. **Disparo automático** al final del lote de conversión, construyendo los `NmlPatch` desde las pistas procesadas.
3. **i18n** de los avisos ("Traktor está abierto", "actualizada la colección").

## Validación antes de cablear (del spec)

La primera prueba real va **sobre una copia** de la colección de djotas, nunca sobre la buena: apuntar `traktorNmlPath` a la copia, convertir una pista, abrir esa colección en Traktor y comprobar que los cues salen donde deben. Ni la autodetección de rutas ni un `collection.nml` real se pueden probar en esta máquina (no tiene Traktor instalado), así que esa validación es de djotas.
