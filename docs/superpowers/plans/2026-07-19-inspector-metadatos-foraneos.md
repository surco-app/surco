# Inspector de metadatos foráneos + arreglo del borrado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leer TODOS los tags de un fichero al cargarlo, mostrar los no-gestionados en un inspector desplegable (ver + borrar), y arreglar que "borrar todo" borre de verdad todos los tags foráneos al exportar.

**Architecture:** El proceso main ya lee los tags con ffprobe pero descarta los no-gestionados. Se añade una segunda salida `foreignTags` (nombre=valor) al lector, que viaja al `TrackItem`. El renderer los muestra en un toggle bajo el editor con borrado individual (`foreignRemoved`) y total. La escritura reutiliza las rutas existentes: `-map_metadata -1` (FLAC/ffmpeg) y el borrado de frames de TagLib (ID3), extendido a borrado por-nombre y a M4A. El bug del flag se corrige haciendo que editar campos deje de apagar `metaCleared`.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, ffmpeg/ffprobe (`ffmpeg-static`), `node-taglib-sharp`.

## Global Constraints

- Monorepo npm workspaces; app en `apps/desktop`. Tests con Vitest: `npm run test -w apps/desktop`.
- TDD estricto: red → green → refactor. Nunca saltar la fase roja.
- Selectores de test: `data-testid` obligatorio (regla del CLAUDE.md).
- Cero comentarios añadidos que no sigan la densidad/estilo del fichero; el código debe ser auto-documentado. (El repo SÍ usa comentarios explicativos densos — igualar ese estilo, no suprimirlos.)
- ID3 pinneado a v2.3 en `.mp3/.aiff/.wav` (no cambiar).
- "Borrar todo" = todo, incluidos cues DJ (Traktor/Serato). La preservación de cues en la conversión **normal** (`copyCueFrames`, `cueSource`) NO se toca.
- Commits: título descriptivo, sin body, sin `feat:`/`fix:`. Una funcionalidad por commit.

---

### Task 1: Lector de tags foráneos en el proceso main

**Files:**
- Modify: `apps/desktop/src/main/tagFields.ts` (añadir helper `MANAGED_ALIASES`)
- Modify: `apps/desktop/src/main/ffmpeg.ts:160-201` (`ProbeTags`, nueva función `foreignTagsFromProbe`)
- Test: `apps/desktop/src/main/tagFields.test.ts`

**Interfaces:**
- Produces: `foreignTagsFromProbe(data: ProbeTags): ForeignTag[]` donde `ForeignTag = { name: string; value: string }`.
- Produces: `MANAGED_ALIASES: Set<string>` (todos los `aliases` de `TAG_FIELDS` en minúsculas) exportado desde `tagFields.ts`.
- Consumes: `ProbeTags` (ya existe, `ffmpeg.ts:160`), `TAG_FIELDS` (`tagFields.ts:27`).

- [ ] **Step 1: Escribir el test que falla**

En `apps/desktop/src/main/tagFields.test.ts`, añadir:

```ts
import { MANAGED_ALIASES } from './tagFields'

describe('MANAGED_ALIASES', () => {
  it('incluye cada alias de TAG_FIELDS en minúsculas', () => {
    expect(MANAGED_ALIASES.has('serato_markers_v2')).toBe(false)
    expect(MANAGED_ALIASES.has('title')).toBe(true)
    expect(MANAGED_ALIASES.has('albumartist2')).toBe(true)
    expect(MANAGED_ALIASES.has('energylevel')).toBe(true)
  })
})
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm run test -w apps/desktop -- tagFields`
Expected: FAIL — `MANAGED_ALIASES` no está exportado.

- [ ] **Step 3: Implementar `MANAGED_ALIASES`**

Al final de `apps/desktop/src/main/tagFields.ts`, tras el array `TAG_FIELDS`:

```ts
// El conjunto plano de todos los alias que la app gestiona, en minúsculas. El lector
// de tags foráneos lo usa para saber qué NO es gestionado: cualquier clave del probe
// fuera de este set es un tag de terceros que el inspector debe mostrar.
export const MANAGED_ALIASES: Set<string> = new Set(
  TAG_FIELDS.flatMap((field) => field.aliases.map((a) => a.toLowerCase())),
)
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npm run test -w apps/desktop -- tagFields`
Expected: PASS.

- [ ] **Step 5: Escribir el test de `foreignTagsFromProbe` que falla**

En `apps/desktop/src/main/tags.test.ts` (o un `ffmpeg`-adyacente; usa el fichero donde ya se prueba `tagsFromProbe` si existe — si no, `tagFields.test.ts`), añadir:

```ts
import { foreignTagsFromProbe } from './ffmpeg'

describe('foreignTagsFromProbe', () => {
  it('devuelve los tags no gestionados y omite los gestionados y el encoder', () => {
    const data = {
      format: {
        tags: {
          TITLE: 'Original',
          ARTIST: 'Artista',
          SERATO_MARKERS_V2: 'YXBwbGlj',
          TRAKTOR4: 'dlVHblob',
          MUSICBRAINZ_TRACKID: '7c2136cc',
          encoder: 'Lavf60.16.100',
        },
      },
    }
    const foreign = foreignTagsFromProbe(data)
    const names = foreign.map((t) => t.name.toUpperCase())
    expect(names).toContain('SERATO_MARKERS_V2')
    expect(names).toContain('TRAKTOR4')
    expect(names).toContain('MUSICBRAINZ_TRACKID')
    expect(names).not.toContain('TITLE')
    expect(names).not.toContain('ARTIST')
    expect(names.map((n) => n.toLowerCase())).not.toContain('encoder')
  })

  it('omite la descripción de la carátula del stream de vídeo', () => {
    const data = {
      format: { tags: { SERATO_ANALYSIS: 'x' } },
      streams: [{ codec_type: 'video', tags: { comment: 'Cover (front)' } }],
    }
    const foreign = foreignTagsFromProbe(data)
    expect(foreign.map((t) => t.name)).toEqual(['SERATO_ANALYSIS'])
  })
})
```

- [ ] **Step 6: Ejecutar el test y verificar que falla**

Run: `npm run test -w apps/desktop -- ffmpeg` (o el fichero elegido)
Expected: FAIL — `foreignTagsFromProbe` no existe.

- [ ] **Step 7: Implementar `foreignTagsFromProbe` y el tipo `ForeignTag`**

En `apps/desktop/src/shared/types.ts`, junto a `MetaRead`:

```ts
// Un tag que el fichero lleva pero que la app no gestiona (SERATO_MARKERS_V2, TRAKTOR4,
// MUSICBRAINZ_*, REPLAYGAIN_*…). El inspector los muestra y permite borrarlos. El valor
// puede venir truncado por ffprobe en blobs enormes; se muestra tal cual (solo lectura).
export interface ForeignTag {
  name: string
  value: string
}
```

En `apps/desktop/src/main/ffmpeg.ts`, tras `tagsFromProbe` (línea ~201), importar `MANAGED_ALIASES` de `./tagFields` y `ForeignTag` de `../shared/types`, y añadir:

```ts
// Como tagsFromProbe, pero al revés: recoge las claves que la app NO gestiona. Recorre las
// mismas fuentes (format.tags + los stream.tags no-vídeo, saltando la descripción de la
// carátula que vive en el stream de vídeo), y devuelve cada par cuyo nombre en minúsculas
// no está en MANAGED_ALIASES. El `encoder` que ffmpeg estampa se descarta: no es metadato
// del usuario. La primera aparición de un nombre gana, para no duplicar un tag que aparezca
// en varias fuentes.
export function foreignTagsFromProbe(data: ProbeTags): ForeignTag[] {
  const sources: Record<string, unknown>[] = [
    data.format?.tags,
    ...(data.streams ?? []).filter((s) => s.codec_type !== 'video').map((s) => s.tags),
  ].filter((t): t is Record<string, unknown> => Boolean(t))
  const seen = new Set<string>()
  const foreign: ForeignTag[] = []
  for (const tags of sources) {
    for (const [key, value] of Object.entries(tags)) {
      const lower = key.toLowerCase()
      if (lower === 'encoder' || MANAGED_ALIASES.has(lower) || seen.has(lower)) continue
      seen.add(lower)
      foreign.push({ name: key, value: String(value ?? '') })
    }
  }
  return foreign
}
```

- [ ] **Step 8: Ejecutar los tests y verificar que pasan**

Run: `npm run test -w apps/desktop -- ffmpeg tagFields`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/main/tagFields.ts apps/desktop/src/main/ffmpeg.ts apps/desktop/src/shared/types.ts apps/desktop/src/main/tagFields.test.ts apps/desktop/src/main/tags.test.ts
git commit -m "Leer los tags foráneos que la app no gestiona"
```

---

### Task 2: Exponer `foreignTags` en `readMeta` y el IPC

**Files:**
- Modify: `apps/desktop/src/shared/types.ts:399-403` (`MetaRead` gana `foreignTags`)
- Modify: `apps/desktop/src/main/ffmpeg.ts:347-378` (`readMeta` lo rellena)
- Test: `apps/desktop/src/main/ffmpeg.test.ts` (o donde se pruebe `readMeta`; si `readMeta` no tiene test unitario por spawnear ffprobe, cubrir vía el retorno construido)

**Interfaces:**
- Consumes: `foreignTagsFromProbe` (Task 1).
- Produces: `MetaRead.foreignTags: ForeignTag[]`.

- [ ] **Step 1: Escribir el test que falla**

En `apps/desktop/src/main/ffmpeg.test.ts`, añadir un test que verifique que `readMeta` incluye `foreignTags`. Como `readMeta` spawnea ffprobe, si el repo ya tiene un patrón de fixtures de audio (ver `tags.test.ts`, que construye ficheros semilla), crear un FLAC semilla con un tag foráneo y afirmar:

```ts
import { readMeta } from './ffmpeg'
// (usar el helper de fixture del repo para crear un FLAC con SERATO_MARKERS_V2)

it('readMeta expone los tags foráneos del fichero', async () => {
  const file = await seedFlacWithForeignTag('SERATO_MARKERS_V2', 'YXBwbGlj')
  const result = await readMeta(file)
  expect(result.foreignTags.map((t) => t.name.toUpperCase())).toContain('SERATO_MARKERS_V2')
})
```

Si no hay infraestructura de fixture FLAC accesible en ese fichero, saltar el test de integración aquí y cubrir `readMeta` indirectamente: afirmar en un test unitario que el objeto que `readMeta` construye pasa `foreignTagsFromProbe(data)` a `foreignTags` (refactor para testabilidad NO necesario — `foreignTagsFromProbe` ya está testeado en Task 1; basta con un test de humo del wiring).

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm run test -w apps/desktop -- ffmpeg`
Expected: FAIL — `readMeta` no devuelve `foreignTags`.

- [ ] **Step 3: Añadir el campo a `MetaRead`**

En `apps/desktop/src/shared/types.ts`:

```ts
export interface MetaRead {
  tags: TrackMetadata
  duration: number | null
  cover: CoverRead | null
  // Los tags de terceros que el fichero lleva y la app no gestiona, para el inspector.
  foreignTags: ForeignTag[]
}
```

- [ ] **Step 4: Rellenarlo en `readMeta`**

En `apps/desktop/src/main/ffmpeg.ts`, en el `return` de `readMeta` (línea ~373) añadir `foreignTags: foreignTagsFromProbe(data),`. En el `catch` (línea ~379), añadir `foreignTags: []` al objeto de retorno vacío.

- [ ] **Step 5: Ejecutar los tests y verificar que pasan**

Run: `npm run test -w apps/desktop -- ffmpeg`
Expected: PASS. Ejecutar además `npm run test -w apps/desktop` para confirmar que ningún consumidor de `MetaRead` se rompe por el campo nuevo.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/ffmpeg.ts apps/desktop/src/main/ffmpeg.test.ts
git commit -m "Devolver los tags foráneos en readMeta"
```

---

### Task 3: Guardar `foreignTags` en el `TrackItem`

**Files:**
- Modify: `apps/desktop/src/renderer/src/types.ts` (`TrackItem` gana `foreignTags` y `foreignRemoved`)
- Modify: `apps/desktop/src/renderer/src/hooks/useTrackLibrary.ts:264-287` (aplicar al patch)
- Test: test del hook si existe, o test de merge en `readMerge.test.ts`

**Interfaces:**
- Consumes: `MetaRead.foreignTags` (Task 2).
- Produces: `TrackItem.foreignTags?: ForeignTag[]`, `TrackItem.foreignRemoved?: string[]`.

- [ ] **Step 1: Escribir el test que falla**

Si hay test del hook `useTrackLibrary`/`readMerge`, afirmar que un `readMeta` con `foreignTags` los deja en el patch del track. Si no hay test directo del hook (spawnea IPC), añadir un test de tipos/merge mínimo en `readMerge.test.ts` que verifique que `foreignTags` sobrevive al merge. Ejemplo de aserción:

```ts
it('conserva foreignTags del read en el track', () => {
  const foreign = [{ name: 'SERATO_MARKERS_V2', value: 'x' }]
  const patch = buildPatchFromRead({ foreignTags: foreign /* + resto */ })
  expect(patch.foreignTags).toEqual(foreign)
})
```

(Adaptar al helper real; si no existe helper puro, este test valida el tipo y el paso en el objeto `patch`.)

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm run test -w apps/desktop -- readMerge`
Expected: FAIL.

- [ ] **Step 3: Añadir los campos a `TrackItem`**

En `apps/desktop/src/renderer/src/types.ts`, junto a `metaCleared`:

```ts
  // Los tags de terceros que el fichero lleva y la app no gestiona, leídos al importar.
  // El inspector de metadatos avanzados los muestra. Solo lectura en fase 1.
  foreignTags?: ForeignTag[]
  // Los nombres de tags foráneos que el usuario ha marcado para borrar en el inspector.
  // Se aplican al exportar (siempre, haya o no clearExtras). Vacío = no se borra ninguno.
  foreignRemoved?: string[]
```

Importar `ForeignTag` desde `../../shared/types` (ajustar ruta).

- [ ] **Step 4: Aplicarlo en el hook**

En `apps/desktop/src/renderer/src/hooks/useTrackLibrary.ts`, en el `patch` (línea ~273) añadir `foreignTags,` (destructurando `foreignTags` del `await window.api.readMeta(path)` en la línea 264: `const { tags, duration, cover, foreignTags } = ...`).

- [ ] **Step 5: Ejecutar los tests y verificar que pasan**

Run: `npm run test -w apps/desktop -- readMerge`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/types.ts apps/desktop/src/renderer/src/hooks/useTrackLibrary.ts apps/desktop/src/renderer/src/lib/readMerge.test.ts
git commit -m "Guardar los tags foráneos en el estado de la pista"
```

---

### Task 4: Arreglar el flag — editar campos ya no cancela "borrar todo"

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx:497-501` (`setField`)
- Test: `apps/desktop/src/renderer/src/components/Editor.test.tsx` (si existe) o test del comportamiento del handler

**Interfaces:**
- Consumes: nada nuevo.
- Produces: cambio de comportamiento observable — `metaCleared` persiste tras editar un campo.

**NOTA (el bug):** Hoy `setField` pone `metaCleared: false`. Ese es el bug: rellenar un campo tras "borrar todo" cancela la intención de borrado, y el export re-copia los foráneos. Este task lo elimina.

- [ ] **Step 1: Escribir el test de regresión que falla**

En el test del editor, simular: track con `metaCleared: true` → el usuario edita el campo `title` → afirmar que el `onChange` resultante **conserva** `metaCleared` (no lo pone en false). Si el test del editor prueba vía render + `data-testid`, escribir el campo y capturar el patch de `onChange`:

```tsx
it('mantener metaCleared al editar un campo tras borrar todo', () => {
  const onChange = vi.fn()
  render(<Editor item={{ ...baseItem, metaCleared: true }} onChange={onChange} /* props */ />)
  fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Nuevo' } })
  const patch = onChange.mock.calls.at(-1)?.[0]
  expect(patch).not.toHaveProperty('metaCleared', false)
})
```

(Ajustar `data-testid` del campo título al real; si no lo tiene, este task añade `data-testid="field-title"` al input.)

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm run test -w apps/desktop -- Editor`
Expected: FAIL — el patch actual incluye `metaCleared: false`.

- [ ] **Step 3: Eliminar el reset del flag**

En `apps/desktop/src/renderer/src/components/Editor.tsx`, cambiar `setField` (líneas 497-501):

```tsx
  const setField = useStableCallback((key: keyof TrackItem['meta'], value: string): void => {
    onChange({ meta: { ...item.meta, [key]: value } })
  })
```

Actualizar el comentario de las líneas 498-499 para reflejar el nuevo contrato: editar un campo ya NO cancela el borrado; "borrar todo" persiste hasta que el usuario lo deshaga.

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm run test -w apps/desktop -- Editor`
Expected: PASS.

- [ ] **Step 5: Verificar que no se rompió el flujo de rating**

Buscar tests que dependieran del reset (`grep -rn "metaCleared" apps/desktop/src/renderer/**/*.test.*`). Si alguno afirmaba el reset como comportamiento correcto, actualizarlo al nuevo contrato (el reset era el bug).

Run: `npm run test -w apps/desktop`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/Editor.tsx apps/desktop/src/renderer/src/components/Editor.test.tsx
git commit -m "Mantener la intención de borrar todo al editar campos"
```

---

### Task 5: Borrado individual de foráneos — escritura FLAC (ffmpeg)

**Files:**
- Modify: `apps/desktop/src/main/ffmpeg.ts:595-655` (`convertArgs` acepta `foreignRemoved`)
- Modify: `apps/desktop/src/main/ffmpeg.ts:537-559` (`metadataArgs` o un helper de clears)
- Test: `apps/desktop/src/main/ffmpeg.test.ts`

**Interfaces:**
- Consumes: `TrackItem.foreignRemoved` (Task 3) — llega por el job (Task 7).
- Produces: `convertArgs(input, output, plan, meta, coverPath?, audioFilter?, clearExtras?, foreignRemoved?)` — nuevo último parámetro `foreignRemoved?: string[]`.

- [ ] **Step 1: Escribir el test que falla**

En `apps/desktop/src/main/ffmpeg.test.ts`:

```ts
it('vacía cada tag foráneo pedido con -metadata NOMBRE=', () => {
  const meta = { /* meta mínima como en los tests existentes */ } as TrackMetadata
  const args = convertArgs('/in.flac', '/o.flac', { codec: 'flac' }, meta, undefined, undefined, false, ['SERATO_MARKERS_V2', 'TRAKTOR4'])
  const joined = args.join(' ')
  expect(joined).toContain('-metadata SERATO_MARKERS_V2=')
  expect(joined).toContain('-metadata TRAKTOR4=')
})

it('no añade clears de foráneos cuando la lista está vacía', () => {
  const meta = { /* meta mínima */ } as TrackMetadata
  const args = convertArgs('/in.flac', '/o.flac', { codec: 'flac' }, meta, undefined, undefined, false, [])
  expect(args.join(' ')).not.toContain('SERATO_MARKERS_V2')
})
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm run test -w apps/desktop -- ffmpeg`
Expected: FAIL — `convertArgs` no acepta el 8º parámetro.

- [ ] **Step 3: Implementar el parámetro en `convertArgs`**

En `apps/desktop/src/main/ffmpeg.ts`, añadir `foreignRemoved?: string[],` como último parámetro de `convertArgs` (línea 602). Antes de `args.push(output)` (línea 653), añadir:

```ts
  // El usuario marcó estos tags de terceros para borrar en el inspector: un -metadata
  // NOMBRE= vacío los elimina del fichero exportado. Se aplica siempre — es una intención
  // explícita sobre tags concretos, independiente del "borrar todo" (-map_metadata -1, que
  // ya se los lleva por delante cuando está activo, así que estos clears son redundantes
  // pero inofensivos en ese caso).
  for (const name of foreignRemoved ?? []) args.push('-metadata', `${name}=`)
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npm run test -w apps/desktop -- ffmpeg`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ffmpeg.ts apps/desktop/src/main/ffmpeg.test.ts
git commit -m "Borrar tags foráneos concretos en la ruta ffmpeg"
```

---

### Task 6: Borrado individual + M4A — escritura TagLib (ID3/M4A)

**Files:**
- Modify: `apps/desktop/src/main/tags.ts:228-355` (`writeTags` acepta `foreignRemoved`; M4A limpia foráneos)
- Test: `apps/desktop/src/main/tags.test.ts`

**Interfaces:**
- Consumes: `foreignRemoved?: string[]`.
- Produces: `writeTags(file, meta, coverPath?, removeCover?, cueSource?, cueShift?, clearExtras?, foreignRemoved?)` — nuevo último parámetro.

- [ ] **Step 1: Escribir los tests que fallan**

En `apps/desktop/src/main/tags.test.ts`, siguiendo el patrón de los tests de frames existentes (el fichero ya construye MP3/AIFF semilla y afirma sobre frames):

```ts
it('borra un frame foráneo concreto pedido en foreignRemoved', () => {
  // sembrar un MP3 con un TXXX foráneo, p.ej. "REPLAYGAIN_TRACK_GAIN"
  writeTags(file, blankMeta, undefined, false, undefined, undefined, false, ['REPLAYGAIN_TRACK_GAIN'])
  // afirmar que ese frame ya no está, y que un frame gestionado (título) sigue
})

it('borra los atoms foráneos en M4A cuando clearExtras está activo', () => {
  // sembrar un .m4a con un atom foráneo
  writeTags(m4aFile, blankMeta, undefined, false, undefined, undefined, true)
  // afirmar que el atom foráneo ya no está
})
```

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `npm run test -w apps/desktop -- tags`
Expected: FAIL.

- [ ] **Step 3: Implementar en `writeTags`**

En `apps/desktop/src/main/tags.ts`:

1. Añadir `foreignRemoved: string[] = [],` como último parámetro de `writeTags` (tras `clearExtras`, línea 235).

2. **M4A (rama early-return, líneas 263-272):** cuando `clearExtras` esté activo, limpiar los atoms no-gestionados antes de `f.save()`. TagLib expone los atoms de iTunes vía la API de `AppleTag`; usar el patrón que la librería ofrece para enumerar y quitar los DASH/`----` atoms y los `©`-atoms que no correspondan a campos gestionados. Si la API de enumeración de atoms arbitrarios no está accesible de forma segura, aplicar al menos el borrado por-nombre de `foreignRemoved` sobre M4A y documentar en el spec que el "borrar todo" de M4A cubre los atoms conocidos + los marcados. (Investigar la API real de `node-taglib-sharp` para M4A en este step; el fixture del test dicta el alcance verificable.)

3. **ID3 (tras el bloque `clearExtras` de la línea 285-286):** añadir el borrado por-nombre:

```ts
    // Los tags de terceros que el usuario marcó en el inspector: quitarlos por nombre.
    // Cubre el TXXX de descripción libre (setUserText con '' lo elimina) y cualquier
    // frame cuyo id coincida con el nombre pedido. Se aplica siempre, no solo en clearExtras.
    for (const name of foreignRemoved) {
      setUserText(id3, name, '')
      const upper = name.toUpperCase()
      for (const fr of id3.frames.filter((f) => f.frameId.toString().toUpperCase() === upper)) {
        id3.removeFrame(fr)
      }
    }
```

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm run test -w apps/desktop -- tags`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/tags.ts apps/desktop/src/main/tags.test.ts
git commit -m "Borrar tags foráneos concretos y limpiar M4A en la ruta TagLib"
```

---

### Task 7: Cablear `foreignRemoved` por el pipeline de conversión

**Files:**
- Modify: `apps/desktop/src/shared/types.ts:405+` (`ProcessJob` gana `foreignRemoved`)
- Modify: `apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts:189-209` (pasar `track.foreignRemoved`)
- Modify: `apps/desktop/src/main/processTrack.ts` (propagar a `convertAudio`)
- Modify: `apps/desktop/src/main/ffmpeg.ts:891+` (`convertAudio` propaga a `convertArgs`/`writeTags`)
- Modify: `apps/desktop/src/main/workerJobs.ts:44-87` (job `writeTags` propaga)
- Test: `apps/desktop/src/main/processTrack.test.ts` si existe; si no, un test de humo de que el job lleva el campo

**Interfaces:**
- Consumes: `convertArgs(...foreignRemoved)` (Task 5), `writeTags(...foreignRemoved)` (Task 6).
- Produces: `ProcessJob.foreignRemoved?: string[]`.

- [ ] **Step 1: Escribir el test que falla**

Si hay test de `processTrack`, afirmar que un job con `foreignRemoved` lo propaga a `convertAudio`. Si no, añadir a `useTrackProcessing` un test (o de tipos) que confirme que `window.api.processTrack` recibe `foreignRemoved: track.foreignRemoved`. Mínimo verificable: un test que construya el job y afirme el campo.

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/desktop -- processTrack`
Expected: FAIL.

- [ ] **Step 3: Añadir `foreignRemoved` a `ProcessJob`**

En `apps/desktop/src/shared/types.ts`, en `ProcessJob` junto a `clearExtras`:

```ts
  // Los tags de terceros que el usuario marcó para borrar en el inspector. Se aplican al
  // exportar tanto en la ruta ffmpeg (convertArgs) como en la TagLib (writeTags).
  foreignRemoved?: string[]
```

- [ ] **Step 4: Pasarlo desde el renderer**

En `apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts`, en el objeto de `processTrack` (junto a `clearExtras: track.metaCleared,`, línea 196):

```ts
          foreignRemoved: track.foreignRemoved,
```

- [ ] **Step 5: Propagar en main**

- `processTrack.ts`: aceptar `job.foreignRemoved` y pasarlo a la llamada de `convertAudio` (añadir el argumento al final de la firma de `convertAudio` en su tipo, línea 40-52, y en la invocación).
- `ffmpeg.ts` `convertAudio` (línea 891+): añadir `foreignRemoved?: string[]` como último parámetro y pasarlo a `convertArgs(...)` (línea 1002) y a las llamadas `runInWorker({ type: 'writeTags', ... })` (líneas 991, 1016, 1024).
- `workerJobs.ts`: el job `writeTags` (línea 44-87) gana `foreignRemoved?: string[]` y lo pasa a `writeTags(...)` (línea 87).

- [ ] **Step 6: Ejecutar los tests y verificar que pasan**

Run: `npm run test -w apps/desktop`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts apps/desktop/src/main/processTrack.ts apps/desktop/src/main/ffmpeg.ts apps/desktop/src/main/workerJobs.ts
git commit -m "Propagar los tags foráneos a borrar por el pipeline de conversión"
```

---

### Task 8: "Borrar todo" marca todos los foráneos como borrados

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx:549-569` (`clearAllMeta`)
- Modify: `apps/desktop/src/renderer/src/App.tsx:1067-1069` (`onClearExtras` — bulk)
- Test: `apps/desktop/src/renderer/src/components/Editor.test.tsx`

**Interfaces:**
- Consumes: `TrackItem.foreignTags`, `foreignRemoved` (Task 3).
- Produces: al pulsar "borrar todo", `foreignRemoved` = todos los nombres de `foreignTags`.

- [ ] **Step 1: Escribir el test que falla**

```tsx
it('borrar todo marca cada tag foráneo como eliminado', () => {
  const onChange = vi.fn()
  const item = { ...baseItem, foreignTags: [{ name: 'SERATO_MARKERS_V2', value: 'x' }, { name: 'TRAKTOR4', value: 'y' }] }
  render(<Editor item={item} onChange={onChange} /* props */ />)
  fireEvent.click(screen.getByTestId('clear-meta-btn'))
  const patch = onChange.mock.calls.at(-1)?.[0]
  expect(patch.foreignRemoved).toEqual(['SERATO_MARKERS_V2', 'TRAKTOR4'])
  expect(patch.metaCleared).toBe(true)
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/desktop -- Editor`
Expected: FAIL.

- [ ] **Step 3: Implementar en `clearAllMeta`**

En `apps/desktop/src/renderer/src/components/Editor.tsx`, en la rama single de `clearAllMeta` (líneas 559-568) añadir al patch `foreignRemoved: (item.foreignTags ?? []).map((t) => t.name),`. En la rama multi (`onChangeAllMeta` + `onClearExtras`), como el inspector no aparece en bulk y cada track tiene foráneos distintos, `onClearExtras` (App.tsx) debe marcar por-track: cambiar `onClearExtras` para que, además de `coverRemoved`/`metaCleared`, ponga `foreignRemoved` = los nombres de cada track individual (usar `patchTracks` con una función por id si la API lo permite; si `patchTracks` solo acepta un patch plano, añadir un helper que mapee cada track a su propio `foreignRemoved`).

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm run test -w apps/desktop -- Editor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/Editor.tsx apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/components/Editor.test.tsx
git commit -m "Borrar todo marca todos los tags foráneos como eliminados"
```

---

### Task 9: El inspector desplegable en la UI

**Files:**
- Create: `apps/desktop/src/renderer/src/components/ForeignTagsInspector.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx` (renderizar el inspector bajo el form)
- Modify: locales `es/en/de/fr/pt.json` (claves nuevas)
- Test: `apps/desktop/src/renderer/src/components/ForeignTagsInspector.test.tsx`

**Interfaces:**
- Consumes: `item.foreignTags`, `item.foreignRemoved`, `onChange`.
- Produces: componente `ForeignTagsInspector` con `data-testid` `foreign-tags-toggle`, `foreign-tags-list`, `foreign-tag-remove`.

- [ ] **Step 1: Escribir el test que falla**

```tsx
it('no se muestra cuando no hay tags foráneos', () => {
  render(<ForeignTagsInspector foreignTags={[]} foreignRemoved={[]} onRemove={vi.fn()} />)
  expect(screen.queryByTestId('foreign-tags-toggle')).toBeNull()
})

it('lista los foráneos al abrir el toggle y permite borrar uno', () => {
  const onRemove = vi.fn()
  render(<ForeignTagsInspector foreignTags={[{ name: 'SERATO_MARKERS_V2', value: 'x' }]} foreignRemoved={[]} onRemove={onRemove} />)
  fireEvent.click(screen.getByTestId('foreign-tags-toggle'))
  expect(screen.getByTestId('foreign-tags-list')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('foreign-tag-remove'))
  expect(onRemove).toHaveBeenCalledWith('SERATO_MARKERS_V2')
})

it('muestra tachado un tag ya en foreignRemoved', () => {
  render(<ForeignTagsInspector foreignTags={[{ name: 'TRAKTOR4', value: 'y' }]} foreignRemoved={['TRAKTOR4']} onRemove={vi.fn()} />)
  fireEvent.click(screen.getByTestId('foreign-tags-toggle'))
  // afirmar la clase/estado de tachado por data-testid del row
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/desktop -- ForeignTagsInspector`
Expected: FAIL — el componente no existe.

- [ ] **Step 3: Implementar `ForeignTagsInspector`**

Crear `apps/desktop/src/renderer/src/components/ForeignTagsInspector.tsx`. Props: `{ foreignTags: ForeignTag[]; foreignRemoved: string[]; onRemove: (name: string) => void }`. Estado local `open` (colapsado por defecto). Si `foreignTags.length === 0`, retorna `null`. El toggle muestra el conteo (usar clave i18n `editor.advancedTags` con `{count}`). Lista `nombre = valor` con valor truncado (CSS `truncate`), cada fila con botón X (`foreign-tag-remove`) que llama `onRemove(name)`. Un tag cuyo `name` esté en `foreignRemoved` se muestra tachado/atenuado. Seguir el estilo Tailwind y los tokens de color existentes del editor (`var(--color-line)`, `text-fg-muted`, etc.).

- [ ] **Step 4: Cablear en `Editor.tsx`**

Renderizar `<ForeignTagsInspector>` bajo el form, solo cuando NO es multi-select (`!isMulti`). El `onRemove` construye el nuevo `foreignRemoved` (añadir el nombre sin duplicar) y llama `onChange({ foreignRemoved: [...] })`.

- [ ] **Step 5: Añadir claves i18n**

En cada locale (`es/en/de/fr/pt.json`), bajo `editor`, añadir p.ej. `"advancedTags": "Metadatos avanzados ({{count}})"` con su traducción. (es: "Metadatos avanzados", en: "Advanced metadata", de: "Erweiterte Metadaten", fr: "Métadonnées avancées", pt: "Metadados avançados".)

- [ ] **Step 6: Ejecutar los tests y verificar que pasan**

Run: `npm run test -w apps/desktop -- ForeignTagsInspector Editor`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/components/ForeignTagsInspector.tsx apps/desktop/src/renderer/src/components/Editor.tsx apps/desktop/src/renderer/src/components/ForeignTagsInspector.test.tsx apps/desktop/src/renderer/src/i18n/locales/*.json
git commit -m "Inspector desplegable de metadatos avanzados"
```

---

### Task 10: Verificación end-to-end y limpieza de la preservación de cues en la ruta de borrado

**Files:**
- Modify: `apps/desktop/src/main/tags.ts:279-286` (quitar la excepción de cues en `clearExtras`)
- Test: `apps/desktop/src/main/tags.test.ts`, `apps/desktop/src/main/ffmpeg.test.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: "borrar todo" también elimina GEOB/PRIV "TRAKTOR4" (cues DJ).

**NOTA:** Hoy `tags.ts:286` filtra `!isTraktorCue(fr)` al borrar, preservando los cues. La decisión del spec es "borrar todo = todo, cues incluidos". Este task quita esa excepción SOLO en la ruta de `clearExtras`. La preservación de cues en la conversión normal (`copyCueFrames`, `cueSource`) NO se toca.

- [ ] **Step 1: Actualizar el test existente de cues (fase roja)**

En `apps/desktop/src/main/tags.test.ts`, el test "wipes the rating and cover but keeps the cue frame when clearExtras is set" (línea ~292) ahora debe afirmar lo contrario: `clearExtras` **elimina** también el frame de cue. Editar la aserción para esperar que el GEOB/PRIV "TRAKTOR4" ya NO esté tras el borrado.

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/desktop -- tags`
Expected: FAIL — el código actual aún preserva el cue.

- [ ] **Step 3: Quitar la excepción en `writeTags`**

En `apps/desktop/src/main/tags.ts`, línea 285-286, cambiar:

```ts
    if (clearExtras) for (const frame of id3.frames.slice()) id3.removeFrame(frame)
```

(quitar el `.filter((fr) => !isTraktorCue(fr))`). Actualizar el comentario de las líneas 279-286 para reflejar que ahora también se van los cues. Si `isTraktorCue`/`removeCueFrames` quedan sin uso en la ruta de borrado pero siguen usándose en `copyCueFrames`/`cueSource`, dejarlos. Si `isTraktorCue` queda totalmente sin uso, mencionarlo (regla: no borrar código no relacionado sin avisar) — verificar con grep antes.

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm run test -w apps/desktop -- tags`
Expected: PASS.

- [ ] **Step 5: Verificación E2E manual con ffmpeg real (FLAC)**

Reproducir el flujo completo con la app corriendo (skill `run-desktop`): cargar un FLAC con tags foráneos (SERATO/TRAKTOR/MUSICBRAINZ), abrir el inspector y confirmar que se listan, pulsar "borrar todo", rellenar título/artista, exportar, y verificar con `ffprobe -show_entries format_tags` que el fichero exportado solo lleva los campos rellenados (ni foráneos ni cues, salvo `encoder` silenciado). Documentar el resultado.

- [ ] **Step 6: Ejecutar toda la suite**

Run: `npm run test -w apps/desktop`
Expected: PASS. Además correr el linter (Biome) y el typecheck del build.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/tags.ts apps/desktop/src/main/tags.test.ts apps/desktop/src/main/ffmpeg.test.ts
git commit -m "Borrar todo elimina también los cues de Traktor/Serato"
```

---

## Self-Review

**Cobertura del spec:**
- §1 Leer todos los metadatos → Task 1, 2, 3 ✓
- §2 Inspector (toggle, lista, borrado individual/total, solo pista única, se vacía al borrar todo) → Task 8, 9 ✓
- §3 Arreglo del flag (editar no cancela; M4A borra; borrado individual FLAC/ID3) → Task 4, 5, 6, 7 ✓
- §4 "Borrar todo" = todo, cues incluidos → Task 10 ✓
- §4 Bulk: solo botón global, inspector no aparece en bulk → Task 8 (bulk marca por-track), Task 9 (`!isMulti`) ✓
- Testing → cada task tiene su ciclo TDD; Task 10 el E2E ✓
- Fuera de alcance (editar valores, añadir tags, inspector bulk combinado) → no hay tasks ✓

**Consistencia de tipos:** `ForeignTag = { name; value }` definido en Task 1, usado consistentemente en 2/3/8/9. `foreignRemoved: string[]` (nombres) en 3/5/6/7/8/9. `convertArgs` 8º param y `writeTags` 8º param, ambos `foreignRemoved`. `ProcessJob.foreignRemoved` en Task 7. `MetaRead.foreignTags` en Task 2.

**Riesgo señalado:** Task 6 step 3 (API de M4A de `node-taglib-sharp` para enumerar atoms arbitrarios) es el punto más incierto — depende de qué exponga la librería. El fixture del test acota el alcance verificable; si la enumeración genérica de atoms no está accesible, el borrado por-nombre (`foreignRemoved`) cubre el caso del inspector y se documenta la limitación de "borrar todo" en M4A.
