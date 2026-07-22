# "Same as source" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir un valor `Same as source` a `Default format` que conserva el formato de cada fichero, para que un lote mixto pueda recibir metadatos sin recodificarse.

**Architecture:** `'source'` es una regla para elegir formato, no un formato. Vive solo en `Settings.outputFormat` (tipo nuevo `FormatSetting`) y se traduce a un `OutputFormat` concreto **en el renderer**, por track, antes de construir cada `ProcessJob`. `OutputFormat` no se toca y el main no cambia: siempre recibe un formato legítimo.

**Tech Stack:** TypeScript, React 19, Electron, Vitest, i18next, Biome.

**Spec:** `docs/superpowers/specs/2026-07-22-conservar-formato-original-design.md`

## Global Constraints

- **`OutputFormat` NO se modifica.** Sigue siendo `'aiff' | 'mp3' | 'wav' | 'flac' | 'alac'` en `src/shared/types.ts:10`. Decisión explícita del usuario.
- **`'source'` nunca cruza el IPC.** `ProcessJob.format` permanece `OutputFormat`. Si `'source'` llegara al main, `src/main/ffmpeg.ts:843` produciría un AIFF en silencio.
- **`.m4a` cae al fallback, nunca a `'alac'`.** Un `.m4a` puede contener AAC lossy; `INPUT_EXT.alac` es `/(?!)/` en `src/shared/format.ts:12` deliberadamente.
- **AIFF sigue siendo el valor por defecto de la app.** "Same as source" va primero en el control, pero no cambia el default de `src/main/settings.ts:29` ni de `src/renderer/src/lib/settingsContext.tsx:69`.
- **Fallback = `'aiff'`**, el mismo literal que ya usan los call sites `settings?.outputFormat ?? 'aiff'`.
- **Etiqueta exacta en inglés: `Same as source`** — el literal que Bit depth y Sample rate ya usan en ese panel.
- **Cero comentarios de código nuevos salvo los que expliquen el *porqué*,** siguiendo la densidad del fichero que se toca (este repo comenta el razonamiento, no la mecánica).
- **No ejecutar `npm run check`**: reformatea ~92 ficheros ajenos. Verificar por fichero con `npx biome check src/ruta/al/fichero`.
- Directorio de trabajo para todos los comandos: `/Users/vicent/code/surco/apps/desktop`.

---

### Task 1: `resolveJobFormat` — la regla de resolución

Toda la decisión de la feature vive en esta función pura. El resto del plan solo la conecta.

**Files:**
- Modify: `src/shared/types.ts` (añadir `FormatSetting` junto a `OutputFormat`, línea 10)
- Modify: `src/shared/format.ts` (añadir `resolveJobFormat` al final)
- Test: `src/shared/format.test.ts` (añadir un `describe` al final)

**Interfaces:**
- Produces: `type FormatSetting = OutputFormat | 'source'` (exportado de `src/shared/types.ts`)
- Produces: `resolveJobFormat(setting: FormatSetting, inputPath: string, fallback: OutputFormat): OutputFormat` (exportado de `src/shared/format.ts`)

- [ ] **Step 1: Write the failing test**

Añadir al final de `src/shared/format.test.ts`:

```ts
describe('resolveJobFormat', () => {
  // "Same as source" is a rule for picking a format, not a format: the job that
  // reaches the main process must always name a real one, or ffmpeg's format chain
  // falls through to AIFF and silently rewrites the user's file as something else.
  it('resolves each supported extension to its own format', () => {
    expect(resolveJobFormat('source', '/music/song.mp3', 'aiff')).toBe('mp3')
    expect(resolveJobFormat('source', '/music/song.wav', 'aiff')).toBe('wav')
    expect(resolveJobFormat('source', '/music/song.flac', 'aiff')).toBe('flac')
    expect(resolveJobFormat('source', '/music/song.aiff', 'aiff')).toBe('aiff')
  })

  // .aif rips are as common as .aiff and must keep their own format rather than
  // falling back — the existing exportedFormat in Editor.tsx gets this wrong.
  it('resolves .aif to aiff', () => {
    expect(resolveJobFormat('source', '/music/song.aif', 'mp3')).toBe('aiff')
  })

  // An .m4a may hold lossy AAC, not ALAC. Calling it "already ALAC" would let an
  // overwrite re-encode the user's only copy and present it as lossless.
  it('never resolves .m4a to alac', () => {
    expect(resolveJobFormat('source', '/music/song.m4a', 'aiff')).toBe('aiff')
  })

  // Surco imports more extensions than it can export; these always transcoded and
  // still do, rather than blocking the file.
  it('falls back for inputs with no matching output format', () => {
    expect(resolveJobFormat('source', '/music/song.opus', 'aiff')).toBe('aiff')
    expect(resolveJobFormat('source', '/music/song.ogg', 'wav')).toBe('wav')
    expect(resolveJobFormat('source', '/music/song.aac', 'aiff')).toBe('aiff')
    expect(resolveJobFormat('source', '/music/no-extension', 'aiff')).toBe('aiff')
  })

  // A pinned format is the user overriding the rule; the source file has no say.
  it('returns a concrete setting untouched', () => {
    expect(resolveJobFormat('mp3', '/music/song.flac', 'aiff')).toBe('mp3')
    expect(resolveJobFormat('alac', '/music/song.m4a', 'aiff')).toBe('alac')
  })
})
```

Y actualizar el import de la primera línea del fichero:

```ts
import { editsInPlace, formatExtension, formatMatchesInput, resolveJobFormat } from './format'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/format.test.ts`
Expected: FAIL — `resolveJobFormat is not a function` / error de TypeScript por el import.

- [ ] **Step 3: Add the `FormatSetting` type**

En `src/shared/types.ts`, justo debajo de la línea 10 (`export type OutputFormat = ...`):

```ts
// The Default format setting, which accepts one thing OutputFormat deliberately cannot:
// 'source' is a rule for picking a format per file, not a format. It stays on this side
// of the IPC — resolveJobFormat turns it into a real OutputFormat before a job is built,
// so the main process only ever sees formats it knows how to mux.
export type FormatSetting = OutputFormat | 'source'
```

- [ ] **Step 4: Implement `resolveJobFormat`**

Al final de `src/shared/format.ts`:

```ts
// Turns the Default format setting into the format a single job will actually use.
// 'source' keeps each file in the format it already has, which is what lets a mixed
// batch be tagged without re-encoding — planConversion stream-copies when input and
// output formats agree. Inputs with no matching output format (Surco imports .opus,
// .ogg, .aac and .mp4, which no OutputFormat represents) fall back and transcode, the
// same as they do today. ALAC is never resolved from an .m4a source: INPUT_EXT.alac
// deliberately matches nothing, since the container may hold lossy AAC.
export function resolveJobFormat(
  setting: FormatSetting,
  inputPath: string,
  fallback: OutputFormat,
): OutputFormat {
  if (setting !== 'source') return setting
  const match = (Object.keys(INPUT_EXT) as OutputFormat[]).find((f) =>
    formatMatchesInput(f, inputPath),
  )
  return match ?? fallback
}
```

Y actualizar el import de la línea 1 de `src/shared/format.ts`:

```ts
import type { FormatSetting, OutputFormat } from './types'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/shared/format.test.ts`
Expected: PASS — todos los `describe`, incluidos los preexistentes de `formatExtension`, `formatMatchesInput` y `editsInPlace`.

- [ ] **Step 6: Verify types and lint**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx biome check src/shared/format.ts src/shared/format.test.ts src/shared/types.ts`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/shared/format.ts src/shared/format.test.ts src/shared/types.ts
git commit -m "Resolver el formato de cada job desde la extension del fichero"
```

---

### Task 2: Widen `Settings.outputFormat` to `FormatSetting`

Cambio de tipo aislado. El compilador señalará cada sitio que asume `OutputFormat`; esta tarea solo ensancha el tipo y arregla los dos lugares donde el valor se **almacena**. Los consumidores se arreglan en las tareas 3 y 4.

**Files:**
- Modify: `src/shared/types.ts:123` (`outputFormat: OutputFormat` → `FormatSetting`)
- Modify: `src/renderer/src/lib/settingsContext.tsx:32` (misma sustitución en el tipo del contexto)

**Interfaces:**
- Consumes: `FormatSetting` de Task 1.
- Produces: `Settings.outputFormat: FormatSetting` — a partir de aquí, todo consumidor debe resolverlo antes de tratarlo como `OutputFormat`.

- [ ] **Step 1: Widen the Settings type**

En `src/shared/types.ts:123`, cambiar:

```ts
  outputFormat: OutputFormat
```

por:

```ts
  outputFormat: FormatSetting
```

- [ ] **Step 2: Widen the settings context type**

En `src/renderer/src/lib/settingsContext.tsx:32`, cambiar `outputFormat: OutputFormat` por `outputFormat: FormatSetting`, y añadir `FormatSetting` al import de tipos de ese fichero.

Los defaults (`settingsContext.tsx:69` y `src/main/settings.ts:29`) **siguen siendo `'aiff'`** — no se tocan.

- [ ] **Step 3: Run the type check to enumerate the consumers**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: FAIL, con errores del tipo `Type 'FormatSetting' is not assignable to type 'OutputFormat'`. Anotar la lista; es exactamente el trabajo de las tareas 3 y 4. Los sitios esperados son `useTrackProcessing.ts:162`, `useTrackProcessing.ts:356`, `ConversionTab.tsx:27`, `DestinationTab.tsx:36`, `librarySource.ts:24`, `ExportButton.tsx:234`, `OnboardingWizard.tsx:84`, `Overlays.tsx:161`, `commands.ts:677`, `App.tsx:1659`, `Editor.tsx:289`, `NamingTab.tsx:167`.

Este paso **deja el repo sin compilar**; se arregla en las tareas 3 y 4. No hay commit aquí — el commit de Task 3 cierra el hueco.

---

### Task 3: Resolve the format per track when building jobs

El corazón del cambio: el punto único donde `'source'` se traduce. Sin esto, `'source'` cruzaría el IPC por `processOne`, que hoy envía `format: formatOverride` (undefined cuando no hay override) y deja que el main lea el ajuste directamente.

**Files:**
- Modify: `src/renderer/src/hooks/useTrackProcessing.ts:162` (badge del row), `:197` (el campo `format` del job), `:356` (`pinnedFormat` del lote)
- Test: `src/renderer/src/hooks/useTrackProcessing.test.tsx`

**Interfaces:**
- Consumes: `resolveJobFormat` de Task 1; `Settings.outputFormat: FormatSetting` de Task 2.
- Produces: todo `ProcessJob` sale con `format: OutputFormat` explícito, nunca `undefined` ni `'source'`.

- [ ] **Step 1: Write the failing test**

Añadir a `src/renderer/src/hooks/useTrackProcessing.test.tsx`. Seguir el patrón de fixtures del fichero (ver el uso de `{ outputFormat: 'aiff' } as Settings` en la línea 749) y el helper de render que ya usen los tests vecinos:

```tsx
describe('Same as source', () => {
  // The whole point of the feature: one batch, one setting, and every file keeps its
  // own format — which is exactly what a single global format could never express.
  it('sends each track its own format when the setting is source', async () => {
    const settings = { outputFormat: 'source', overwriteOriginal: false } as Settings
    const tracks = [
      trackFixture({ id: 'a', inputPath: '/music/a.flac' }),
      trackFixture({ id: 'b', inputPath: '/music/b.mp3' }),
    ]

    await processAllWith(tracks, settings)

    const formats = processTrackMock.mock.calls.map(([job]) => job.format)
    expect(formats).toEqual(['flac', 'mp3'])
  })

  // 'source' is not a format ffmpeg knows: its format chain ends in an implicit else
  // that assumes AIFF, so a leaked value would silently rewrite the file as AIFF.
  it('never lets source reach the job', async () => {
    const settings = { outputFormat: 'source', overwriteOriginal: false } as Settings

    await processAllWith([trackFixture({ id: 'a', inputPath: '/music/a.opus' })], settings)

    expect(processTrackMock.mock.calls[0][0].format).toBe('aiff')
  })
})
```

Adaptar `trackFixture` / `processAllWith` / `processTrackMock` a los helpers reales del fichero — no inventar nombres nuevos si ya existen equivalentes.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/hooks/useTrackProcessing.test.tsx`
Expected: FAIL — los formatos recibidos son `undefined`, no `['flac','mp3']`.

- [ ] **Step 3: Resolve the format inside `processOne`**

En `src/renderer/src/hooks/useTrackProcessing.ts`, dentro de `processOne` y **antes** de la llamada a `updateTrack` de la línea 158, añadir:

```ts
      // The single point where the Default format setting becomes a real format. It has
      // to happen here, per track: 'source' is meaningless to the main process, and
      // sending `undefined` would make it read the setting itself and see 'source' too.
      const jobFormat = resolveJobFormat(
        formatOverride ?? settings?.outputFormat ?? 'aiff',
        track.inputPath,
        'aiff',
      )
```

En la línea 162, sustituir el badge:

```ts
        format: formatOverride ?? settings?.outputFormat ?? 'aiff',
```

por:

```ts
        format: jobFormat,
```

En la línea 197, sustituir el campo del job:

```ts
          format: formatOverride,
```

por:

```ts
          format: jobFormat,
```

Añadir `resolveJobFormat` al import de `../../../shared/format` en la cabecera del fichero (comprobar la ruta relativa exacta que ya usen los imports vecinos).

- [ ] **Step 4: Keep the batch pin honest**

En la línea 356, `pinnedFormat` pinea el ajuste del lote. Como `processOne` ahora resuelve por track, el pin debe seguir transportando la **regla**, no un formato ya resuelto — si resolviera aquí, todo el lote compartiría el formato del primer fichero.

Cambiar el tipo del pin para que acepte la regla:

```ts
      const pinnedFormat: FormatSetting | undefined = formatOverride ?? settings?.outputFormat
```

`processOne` recibe ese valor como `formatOverride` y lo resuelve por track, así que la firma de `processOne` debe aceptar `FormatSetting | undefined` en ese parámetro. El `formatOverride` público de `processAll` (el menú del split-button) **sigue siendo `OutputFormat`**: un override puntual siempre nombra un formato concreto.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/hooks/useTrackProcessing.test.tsx`
Expected: PASS, incluidos los tests preexistentes del fichero.

- [ ] **Step 6: Verify types and lint**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx biome check src/renderer/src/hooks/useTrackProcessing.ts src/renderer/src/hooks/useTrackProcessing.test.tsx`
Expected: los errores de `useTrackProcessing.ts` desaparecen. Siguen los de los componentes de UI — son Task 4.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/renderer/src/lib/settingsContext.tsx src/renderer/src/hooks/useTrackProcessing.ts src/renderer/src/hooks/useTrackProcessing.test.tsx
git commit -m "Resolver el formato por pista al construir cada trabajo"
```

---

### Task 4: Surface "Same as source" in Settings

La opción aparece en la UI y los consumidores que aún asumen `OutputFormat` se adaptan.

**Files:**
- Create: `src/shared/outputFormats.ts` (array único consolidado)
- Modify: `src/renderer/src/components/settings/ConversionTab.tsx:9,25-35,37,51,73`
- Modify: `src/renderer/src/components/ExportButton.tsx:12,234`
- Modify: `src/renderer/src/components/OnboardingWizard.tsx:15,84`
- Modify: `src/renderer/src/components/settings/DestinationTab.tsx:36`
- Modify: `src/renderer/src/lib/librarySource.ts:24`
- Modify: `src/renderer/src/components/DeclickSection.tsx:410`
- Modify: `src/renderer/src/components/Overlays.tsx:161`, `src/renderer/src/lib/commands.ts:677`, `src/renderer/src/App.tsx:1659`, `src/renderer/src/components/settings/NamingTab.tsx:167`
- Modify: `src/renderer/src/i18n/locales/{en,es,de,fr,pt-BR}.json:685-692`

**Interfaces:**
- Consumes: `FormatSetting` y `resolveJobFormat` de Task 1.
- Produces: `OUTPUT_FORMATS` y `FORMAT_SETTINGS` de `src/shared/outputFormats.ts`.

- [ ] **Step 1: Consolidate the duplicated FORMATS arrays**

Los tres arrays están copiados literalmente en `ExportButton.tsx:12`, `OnboardingWizard.tsx:15` y `ConversionTab.tsx:9`, y al estar tipados `OutputFormat[]` aceptan subconjuntos: añadir un valor no rompe nada y el hueco pasa desapercibido.

Crear `src/shared/outputFormats.ts`:

```ts
import type { FormatSetting, OutputFormat } from './types'

// Typed so the compiler flags a missing entry if OutputFormat ever grows: a plain
// OutputFormat[] accepts a subset silently, which is how three copies of this list
// drifted apart in the first place.
export const OUTPUT_FORMATS = ['aiff', 'alac', 'mp3', 'wav', 'flac'] as const satisfies
  readonly OutputFormat[]

// "Same as source" leads, matching Bit depth and Sample rate in the same panel. AIFF
// stays the app default — the position is for visual consistency, not a behavior change.
export const FORMAT_SETTINGS = ['source', ...OUTPUT_FORMATS] as const satisfies
  readonly FormatSetting[]
```

Sustituir las tres constantes locales por imports de este módulo. `ExportButton.tsx` exporta hoy su `FORMATS` y `Editor.tsx` lo reimporta: mantener ese re-export o actualizar el import de `Editor.tsx`, lo que resulte más limpio al hacerlo.

- [ ] **Step 2: Add the option to the format control**

En `ConversionTab.tsx:25-35`, alimentar el `SegmentedControl` con `FORMAT_SETTINGS` en vez de `FORMATS`. `labelFor` ya resuelve `tr('settings.formats.${id}')`, así que la clave nueva basta.

- [ ] **Step 3: Show every quality block when the format is per-file**

Hoy los tres bloques son mutuamente excluyentes (`ConversionTab.tsx:37` MP3 quality, `:51` bit depth/sample rate, `:73` FLAC compression). Con `'source'` cualquiera puede aplicar según el fichero del lote, así que los tres deben verse.

Cambiar las tres condiciones para que `'source'` cuente como "puede ser este formato":

```tsx
{(synced.outputFormat === 'mp3' || synced.outputFormat === 'source') && (
```

```tsx
{(synced.outputFormat !== 'mp3' || synced.outputFormat === 'source') && (
```

```tsx
{(synced.outputFormat === 'flac' || synced.outputFormat === 'source') && (
```

- [ ] **Step 4: Update the i18n keys in all five locales**

En `src/renderer/src/i18n/locales/en.json`, añadir a `settings.formats` (líneas 685-691) la clave `"source": "Same as source"` **como primera entrada**, y reescribir `settings.outputFormatHint` (línea 692):

```json
"outputFormatHint": "“Same as source” keeps each file in its own format, so a mixed batch is never re-encoded. AIFF/WAV/FLAC are lossless (FLAC compressed); MP3 is smaller. A file already in the format is copied without re-encoding.",
```

Replicar en `es.json`, `de.json`, `fr.json` y `pt-BR.json`. Para la etiqueta, **reutilizar textualmente el literal que `bitDepth`/`sampleRate` ya usan en cada idioma** (buscar `"source"` dentro de esos bloques en cada fichero) para que los tres controles coincidan.

- [ ] **Step 5: Fix the FLAC gates and remaining consumers**

Con `'source'` no se sabe a priori si el lote contiene FLAC, así que `flacOnly` es `false` y los FLAC se saltan en silencio en el motor — comportamiento heredado, decidido en el spec.

- `DestinationTab.tsx:36` — `const flacOnly = synced.outputFormat === 'flac'` sigue siendo correcto (`'source'` da `false`); solo hay que satisfacer al compilador si se queja del tipo.
- `librarySource.ts:24`, `ExportButton.tsx:234`, `OnboardingWizard.tsx:84` — comparaciones `=== 'flac'` que con `'source'` dan `false`: correcto, ajustar tipos si hace falta.
- `Overlays.tsx:161`, `commands.ts:677`, `App.tsx:1659`, `Editor.tsx:289` — pasan el ajuste a funciones que esperan `OutputFormat`. Envolver con `resolveJobFormat(setting, inputPath, 'aiff')` donde haya un track a mano; donde no lo haya (el `RenameModal` de `Overlays.tsx` usa `editorFormatRef.current ?? settings?.outputFormat`), usar `'aiff'` como fallback, que es lo que ya hace ese call site.
- `NamingTab.tsx:167` — hoy hace `` `${...}.${synced.outputFormat}` `` sin `formatExtension`, así que ya muestra `.alac` en vez de `.m4a` (bug preexistente). Con `'source'` diría `.source`. Arreglar usando `formatExtension` y, para `'source'`, mostrar la extensión del fallback.

- [ ] **Step 6: Keep the cue warning honest**

`DeclickSection.tsx:410` muestra el aviso ámbar de pérdida de cues cuando el formato no está en `CUES_SURVIVE = ['mp3','aiff']`. Con `'source'` el aviso saldría siempre, pero MP3→MP3 y AIFF→AIFF **sí** conservan los cues. Excluir `'source'` de la condición para que el aviso no aparezca en ese modo.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: PASS. Si algún test preexistente falla por el tipo ensanchado, corregir el test, no el tipo.

- [ ] **Step 8: Verify types and lint**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: sin errores.

Luego `npx biome check` **solo sobre los ficheros tocados en esta tarea**, listándolos explícitamente. No usar `npm run check`.

- [ ] **Step 9: Verify in the running app**

Usar la skill `run-desktop` para arrancar la app. Comprobar: `Same as source` aparece primero en Settings → Output → Format; AIFF sigue seleccionado por defecto en un perfil nuevo; al elegir `Same as source` se ven los tres bloques de calidad a la vez.

- [ ] **Step 10: Commit**

```bash
git add -A src/shared/outputFormats.ts src/renderer/src
git commit -m "Anadir Same as source al formato por defecto"
```

---

### Task 5: End-to-end check with a real mixed batch

La feature existe para un caso concreto — inyectar metadatos de Discogs/Bandcamp sin convertir — y solo un lote real lo demuestra.

**Files:** ninguno (verificación manual).

- [ ] **Step 1: Build a mixed batch**

Preparar una carpeta con al menos un `.wav`, un `.flac` y un `.mp3`. Anotar el tamaño y la fecha de modificación de cada uno.

- [ ] **Step 2: Convert with the feature on**

En Settings: `Default format = Same as source`, destino `Overwrite original`, y normalize / declick / trim **apagados**. Editar un campo de metadatos en cada pista y convertir el lote.

- [ ] **Step 3: Verify the promise held**

Cada fichero conserva su extensión original, los metadatos nuevos están escritos, y el audio no se recodificó. Verificar la duración y el códec con:

```bash
ffprobe -v error -show_entries format=format_name,duration -show_entries stream=codec_name /ruta/al/fichero
```

Recordatorio del repo: ffprobe no lee tags TXXX de WAV — para comprobar metadatos en WAV, usar `ffmpeg -f ffmetadata` o TagLib, no ffprobe.

- [ ] **Step 4: Verify the filters still work**

Repetir con normalize activado. Ahora **sí** debe recodificar, pero cada fichero sigue saliendo en su formato original.

---

## Self-Review

**Cobertura del spec:**
- Valor `Same as source` en `Default format`, primero, sin cambiar el default → Task 4 (steps 1, 2)
- `FormatSetting` y `OutputFormat` intacto → Tasks 1, 2
- `resolveJobFormat` con `.m4a`, `.aif` y fallbacks → Task 1
- Punto único de traducción en el renderer → Task 3
- Consolidar los tres `FORMATS` → Task 4 (step 1)
- Bloques de calidad simultáneos → Task 4 (step 3)
- Gates de FLAC y aviso de cues → Task 4 (steps 5, 6)
- i18n en 5 locales + hint → Task 4 (step 4)
- Override puntual sigue `OutputFormat` → Task 3 (step 4)
- Comportamiento heredado FLAC + Apple Music silencioso → Task 4 (step 5), sin cambio de código

**Riesgo residual:** Task 2 deja el repo sin compilar entre tareas, deliberadamente — el error de tipos es lo que enumera los consumidores. Task 3 cierra el hueco y es la que commitea el cambio de tipo.
