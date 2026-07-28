# Traktor NML Sync — Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar el núcleo del NML (ya construido y revisado) al flujo real de conversión, para que convertir una pista actualice de verdad el `collection.nml` de Traktor.

**Architecture:** El main acumula un `NmlPatch` por pista durante la conversión — es donde ya viven el árbol de cues y el BPM — y los vuelca en UNA escritura cuando el lote termina. El renderer sólo avisa del fin del lote. La ruta al `collection.nml` se configura en Ajustes, autodetectada y confirmada por el usuario.

**Tech Stack:** TypeScript, Electron (main + preload + renderer React 19), Vitest. Sin dependencias nuevas.

## Estado de partida

La rama `worktree-traktor-nml-sync` está al día con `main` (0.75.3), 3291 tests verdes, `tsc` y lint limpios. El núcleo existe y está revisado:

- `traktorNml.ts` — `findEntries`, `cuesToXml(tree, bpm?)`, `applyPatches(nml, patches)`, `matchedPatchCount`, `NmlPatch`
- `traktorNmlLibrary.ts` — `syncCollection(nmlPath, patches): Promise<{written, matched, reason?}>` con backup rotado (10), guarda de Traktor abierto comprobada dos veces, y escritura atómica
- `traktorProcess.ts` — `isTraktorRunning()`, `quitTraktor()`
- `settings.ts` — `traktorNmlPath: ''` en defaults y en `LOCAL_KEYS`

**Nada de eso tiene todavía un solo caller.** Este plan lo cambia.

## Global Constraints

- **Sin dependencias nuevas.**
- **Comentar el PORQUÉ**, al estilo de `apps/desktop/src/main/tags.ts` y `engineLibrary.ts`: decisiones y trampas, nunca narrar la línea siguiente. (Las reglas globales del usuario prohíben comentarios; en este repo la convención es comentar el porqué y **conformidad con el repo gana**. Decidido explícitamente con el usuario.)
- **Un fallo del NML nunca rompe la conversión.** El audio ya está bien en disco; el NML es un extra. Se reporta, no se lanza.
- **`traktorNmlPath` vacío = feature apagada.** Cero trabajo, cero avisos, cero lecturas de disco.
- **Tests desde `apps/desktop`**, nunca desde la raíz: `cd apps/desktop && npx vitest run <fichero>`. Desde la raíz se salta el setup y da fallos falsos.
- **Type-check:** `cd apps/desktop && npx tsc --build` (exit 0). **Lint:** `npm run lint -w apps/desktop`.
- **npm, no pnpm.**
- **Al construir fixtures de test que contengan `$`, concatenar — nunca `String.replace`**, que expande `$&`, `` $` ``, `$'` y `$n` al montar el caso. Esto ya costó una sesión entera de depuración.

## File Structure

| Fichero | Cambio |
|---|---|
| `src/main/tags.ts` | Exportar un lector del árbol de cues del fichero **de salida**, para ambas familias (ID3 y FLAC) |
| `src/main/nmlBatch.ts` (nuevo) | Acumulador de `NmlPatch` del lote en curso, en el main |
| `src/main/nmlBatch.test.ts` (nuevo) | Tests del acumulador |
| `src/main/ffmpeg.ts` | Tras escribir los cues en el destino, registrar el patch en el acumulador |
| `src/main/index.ts` | `ensureTraktorClosed` (gemelo de `ensureEngineDjClosed`), IPC `process:batch-end`, volcado del lote |
| `src/preload/index.ts` + `api.ts` | `endConversionBatch()` |
| `src/renderer/src/hooks/useTrackProcessing.ts` | Llamar a `endConversionBatch()` al acabar el lote |
| `src/renderer/src/components/SettingsModal.tsx` | Selector de ruta del `collection.nml` |
| `src/main/traktorNmlPath.ts` (nuevo) | Autodetección de `~/Documents/Native Instruments/Traktor */collection.nml` |
| `src/main/traktorNmlPath.test.ts` (nuevo) | Tests de la autodetección |
| `src/renderer/src/i18n/locales/*.json` (5) | Textos del diálogo y de Ajustes |

---

### Task 1: Leer el árbol de cues del fichero de salida

**Files:**
- Modify: `apps/desktop/src/main/tags.ts`
- Test: `apps/desktop/src/main/tags.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `export function readCueTree(file: string): Uint8Array | null` — el árbol Traktor del fichero, sea ID3 (MP3/AIFF) o FLAC (comentario `TRAKTOR4` armado en basE91). `null` si no hay ninguno o el fichero no se puede leer.

**Contexto:** ya existen las dos mitades por separado. `readTraktorTree` (privada, línea ~207) lee la familia ID3 prefiriendo el frame PRIV y cayendo al GEOB. El lado FLAC se lee en `shiftFlacCues` (línea ~150): campo Xiph `FLAC_CUE_FIELD` (`'TRAKTOR4'`) decodificado con `decodeBase91`. Esta tarea las unifica bajo una función pública que decide por lo que el fichero realmente lleva, no por su extensión — el NML necesita el árbol **ya re-anclado del destino**, después de que la conversión lo haya escrito.

- [ ] **Step 1: Write the failing tests**

```typescript
  // El NML necesita los cues del fichero YA convertido, no los del origen: son los
  // que la conversión re-ancló. Un solo lector para las dos familias, porque quien
  // llama (el acumulador del lote) no debe saber cómo guarda cada formato.
  it('reads the cue tree back out of an ID3 file', () => {
    const file = seedPrivMp3()

    const tree = readCueTree(file)

    expect(tree).not.toBeNull()
    expect(readTraktorMarkers(tree as Uint8Array)).toHaveLength(1)
  })

  it('reads the cue tree back out of a FLAC file', () => {
    const file = seedFlacWithArmoredCues()

    const tree = readCueTree(file)

    expect(tree).not.toBeNull()
    expect(readTraktorMarkers(tree as Uint8Array)).toHaveLength(1)
  })

  // Sin cues no es un error: la pista simplemente no tiene nada que llevar al NML.
  it('returns null for a file with no Traktor cues', () => {
    expect(readCueTree(seedPlainMp3())).toBeNull()
  })
```

Los helpers `seedPrivMp3` / `seedFlacWithArmoredCues` / `seedPlainMp3`: mira cómo `tags.test.ts` ya siembra ficheros (hay un `priv-seed.mp3` alrededor de la línea 693 y fixtures FLAC en `convertCues.test.ts`). Reutiliza esos patrones en vez de inventar otros; `buildTraktorTree`/`traktorCue` de `traktor4Fixture.ts` construyen el árbol, `encodeBase91` lo arma para FLAC.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/tags.test.ts -t readCueTree`
Expected: FAIL — `readCueTree` no está exportada.

- [ ] **Step 3: Implement**

Exporta `readCueTree`. Prueba primero la vía ID3 (reutiliza `readTraktorTree`, hazla pública o llámala desde la nueva) y, si no hay nada, la Xiph: `getTag(TagTypes.Xiph, false)`, campo `FLAC_CUE_FIELD`, `decodeBase91`. Envuelto en try/catch que devuelve `null` — misma política best-effort que el resto del fichero. Comenta por qué se decide por contenido y no por extensión.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/tags.test.ts`
Expected: PASS, sin regresiones en el resto del fichero

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/tags.ts apps/desktop/src/main/tags.test.ts
git commit -m "Read a converted file's Traktor cue tree whatever its format"
```

---

### Task 2: Acumulador del lote en el main

**Files:**
- Create: `apps/desktop/src/main/nmlBatch.ts`
- Test: `apps/desktop/src/main/nmlBatch.test.ts`

**Interfaces:**
- Consumes: `NmlPatch` de `./traktorNml`.
- Produces:
  - `export function recordNmlPatch(patch: NmlPatch): void`
  - `export function takeNmlPatches(): NmlPatch[]` — devuelve lo acumulado y vacía
  - `export function resetNmlPatches(): void`

**Contexto:** el NML puede pesar decenas de MB, así que un lote de 300 pistas debe producir UNA escritura, no 300. El main acumula durante la conversión y vuelca al final. Módulo con estado a nivel de módulo, como `coverMemo`/`stickyConflict` en `index.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { recordNmlPatch, resetNmlPatches, takeNmlPatches } from './nmlBatch'

const patch = (file: string) => ({ volume: 'HD', dir: '/:M/:', file })

beforeEach(() => resetNmlPatches())

describe('nmlBatch', () => {
  // Un lote de 300 pistas debe producir UNA escritura del NML, no 300: el fichero
  // es la colección entera y puede pesar decenas de MB.
  it('collects the patches of a batch and hands them over at once', () => {
    recordNmlPatch(patch('uno.aiff'))
    recordNmlPatch(patch('dos.aiff'))

    expect(takeNmlPatches()).toHaveLength(2)
  })

  // Tomar el lote lo vacía: un segundo volcado no puede reescribir el NML con los
  // patches del lote anterior, que ya se aplicaron.
  it('empties itself once taken', () => {
    recordNmlPatch(patch('uno.aiff'))
    takeNmlPatches()

    expect(takeNmlPatches()).toEqual([])
  })

  // Un lote nuevo empieza limpio aunque el anterior acabara a medias (cancelado,
  // fallado): un patch huérfano se aplicaría a destiempo sobre la colección.
  it('starts clean after a reset', () => {
    recordNmlPatch(patch('uno.aiff'))
    resetNmlPatches()

    expect(takeNmlPatches()).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/nmlBatch.test.ts`
Expected: FAIL — el módulo no existe

- [ ] **Step 3: Implement**

Un array a nivel de módulo con las tres funciones. Comenta por qué el estado vive aquí y no viaja por el IPC (el árbol de cues es binario y ya está en el main).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/nmlBatch.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/nmlBatch.ts apps/desktop/src/main/nmlBatch.test.ts
git commit -m "Collect a conversion batch's collection patches in the main process"
```

---

### Task 3: Registrar el patch al convertir

**Files:**
- Modify: `apps/desktop/src/main/ffmpeg.ts`
- Test: `apps/desktop/src/main/convertCues.test.ts`

**Interfaces:**
- Consumes: `readCueTree` (Task 1), `recordNmlPatch` (Task 2).
- Produces: nada nuevo; efecto sobre el acumulador.

**Contexto:** en `ffmpeg.ts`, alrededor de las líneas 1137-1175, están las tres ramas que escriben cues en el destino (`copyCueFrames` para ID3, `copyCuesToFlac` para ID3→FLAC, `shiftFlacCues` para FLAC→FLAC). **Después** de esas ramas, y sólo si `getSettings().traktorNmlPath` no está vacío, hay que registrar el patch de esta pista.

El patch necesita: `volume`/`dir`/`file` derivados de la ruta **de entrada** (la que Traktor tiene fichada), `newFile` con el nombre del fichero de salida si cambió la extensión, `cueTree` leído del destino con `readCueTree`, y `bpm` de `meta.bpm`.

**El BPM es crítico:** sin él, `cuesToXml` descarta todo ancla `TYPE=4` y el beatgrid no llega al NML. `meta.bpm` es un string; conviértelo con cuidado (vacío o no numérico ⇒ `undefined`, nunca `NaN`).

**Formato de la ruta en el NML:** Traktor guarda `VOLUME` (nombre del volumen), `DIR` con su propia sintaxis `/:carpeta/:subcarpeta/:` y `FILE` aparte. Hay que traducir de ruta del sistema a esa forma.

**Referencia fiable, léela antes de escribir la tuya:** `split_os_path()` en `/Users/vicent/Desktop/traktor_nml_cleaner.py`, **línea 1142**. Está probada contra colecciones reales y cubre los casos que importan: `/Volumes/X/MUSICA` → volumen `X` + carpeta `/MUSICA/`; ruta Windows `D:/Musica/X` → volumen `D:`; y el resto de rutas dejando el volumen tal cual. Ojo: esa función devuelve la carpeta con separadores `/` normales — la sintaxis `/:` del atributo `DIR` se construye aparte, así que busca también dónde el script arma el `DIR` final antes de decidir tu formato.

**No inventes el formato:** si algún caso no queda claro del script, dilo en el informe en vez de adivinar. Una ruta mal traducida no rompe nada visiblemente — simplemente ninguna ENTRY casa nunca, y la feature parece no hacer nada.

- [ ] **Step 1: Write the failing test**

```typescript
  // El NML se actualiza con lo que la conversión dejó en el fichero de salida, así
  // que el patch se registra después de escribir los cues, no antes. Sin ruta de
  // colección configurada no se registra nada: la feature está apagada.
  it('records a collection patch for a converted track when a collection is configured', async () => {
    resetNmlPatches()
    const out = join(dir, 'out-nml.flac')
    await convertAudio(src, out, 'flac', { ...meta, bpm: '138.30' })

    const patches = takeNmlPatches()

    expect(patches).toHaveLength(1)
    expect(patches[0].file).toBe('in.aiff')
    expect(patches[0].newFile).toBe('out-nml.flac')
    expect(patches[0].bpm).toBeCloseTo(138.3)
    expect(patches[0].cueTree).toBeDefined()
  })

  // Con la ruta vacía (por defecto) no se toca nada: ni lecturas de disco extra ni
  // patches acumulados que nadie va a volcar.
  it('records nothing when no collection path is configured', async () => {
    resetNmlPatches()
    // getSettings mockeado con traktorNmlPath: ''
    await convertAudio(src, join(dir, 'out-off.flac'), 'flac', meta)

    expect(takeNmlPatches()).toEqual([])
  })
```

`convertCues.test.ts` ya mockea `electron`; añade el mock de `getSettings` en la misma línea, devolviendo `traktorNmlPath` según el caso.

Y la traducción de ruta aparte, porque es donde un fallo pasa desapercibido — con `VOLUME`/`DIR` mal formados ninguna ENTRY casa nunca y la feature simplemente no hace nada, sin error:

```typescript
  // Traktor no guarda la ruta del sistema: parte el volumen, la carpeta en su
  // sintaxis /: y el fichero. Una traducción mal hecha no falla — no casa ninguna
  // ENTRY, que es el fallo silencioso que más cuesta diagnosticar.
  it('splits a volume path into the collection s own shape', () => {
    expect(toNmlLocation('/Volumes/Musica_Sono/MUSICA/track.aiff')).toEqual({
      volume: 'Musica_Sono',
      dir: '/:MUSICA/:',
      file: 'track.aiff',
    })
  })

  it('keeps nested folders in order', () => {
    expect(toNmlLocation('/Volumes/X/A/B/t.mp3').dir).toBe('/:A/:B/:')
  })
```

Exporta `toNmlLocation` para poder testearla; su ubicación natural es junto al registro del patch.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/convertCues.test.ts -t "collection patch"`
Expected: FAIL — no se registra nada

- [ ] **Step 3: Implement**

Añade la traducción de ruta a formato NML (función propia, testeable) y el registro del patch tras las ramas de cues. Sólo cuando `traktorNmlPath` no esté vacío. Best-effort: un fallo leyendo el árbol o traduciendo la ruta se salta el registro, nunca rompe la conversión.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/convertCues.test.ts src/main/ffmpeg.test.ts`
Expected: PASS, sin regresiones

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ffmpeg.ts apps/desktop/src/main/convertCues.test.ts
git commit -m "Record what each conversion changed for the Traktor collection"
```

---

### Task 4: Volcar el lote, avisando si Traktor está abierto

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`, `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts`
- Modify: los 5 `apps/desktop/src/renderer/src/i18n/locales/*.json`

**Interfaces:**
- Consumes: `takeNmlPatches` (Task 2), `syncCollection` de `./traktorNmlLibrary`, `isTraktorRunning`/`quitTraktor` de `./traktorProcess`.
- Produces: IPC `process:batch-end`; `window.api.endConversionBatch(): void`.

**Contexto y patrón a copiar:** `ensureEngineDjClosed` en `index.ts:171-192` resuelve exactamente este problema para Engine DJ — diálogo que nombra la app, ofrece cerrarla, y **deduplica la petición** (`engineQuitPrompt`) para que un lote no abra veinte ventanas. Léelo entero y haz el gemelo `ensureTraktorClosed`. Las claves i18n existentes (`engineQuitMessage`, `engineQuitDetail`, `engineQuitConfirm`, `engineQuitCancel`) son el modelo de las nuevas.

**Aviso del ledger:** el usuario consiente cerrar "Traktor", y `traktorProcess.ts` empareja el proceso **por subcadena** porque el nombre real del binario no se pudo verificar. El diálogo debe nombrar la app claramente.

El flujo del volcado: `process:batch-end` → si `traktorNmlPath` vacío, salir → `takeNmlPatches()`, si vacío salir → `ensureTraktorClosed()`, si el usuario declina, avisar y salir sin escribir → `syncCollection(path, patches)` → informar del resultado al renderer.

- [ ] **Step 1: Write the failing test**

En `apps/desktop/src/renderer/src/hooks/useTrackProcessing.test.tsx`:

```typescript
  // El volcado del NML va al final del lote, no por pista: una escritura de un
  // fichero que puede pesar decenas de MB, no una por cada track convertido.
  it('closes the conversion batch so the collection is written once', async () => {
    const endConversionBatch = vi.fn()
    const { result } = setup({ endConversionBatch })

    await act(() => result.current.processAll(['a', 'b']))

    expect(endConversionBatch).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/renderer/src/hooks/useTrackProcessing.test.tsx -t "closes the conversion batch"`
Expected: FAIL — `endConversionBatch` no se llama

- [ ] **Step 3: Implement**

Renderer: llamar a `window.api.endConversionBatch()` en `useTrackProcessing.ts` **después del `finally`** del lote (alrededor de la línea 440), donde ya se sabe que todo terminó. Debe llamarse aunque el lote se cancele o falle — si no, los patches quedan huérfanos para el siguiente lote; por eso conviene que vaya en el propio `finally` o inmediatamente después.

Preload: `endConversionBatch: (): void => ipcRenderer.send('process:batch-end')`, junto a `beginConversionBatch`.

Main: `ipcMain.on('process:batch-end', ...)` con el flujo de arriba, más `ensureTraktorClosed`. Y en `process:batch-begin`, llamar a `resetNmlPatches()` para que un lote nuevo no arrastre restos del anterior.

i18n: claves nuevas en los 5 locales, calcadas en tono a las de Engine DJ.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run` (suite completa: toca main, preload y renderer)
Expected: PASS, sin regresiones

- [ ] **Step 5: Verify locale parity**

Run: `cd apps/desktop && npx vitest run src/renderer/src/i18n`
Expected: PASS — las 5 locales con las mismas claves

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/preload apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts apps/desktop/src/renderer/src/hooks/useTrackProcessing.test.tsx apps/desktop/src/renderer/src/i18n/locales
git commit -m "Write the Traktor collection once a conversion batch finishes"
```

---

### Task 5: Ruta de la colección en Ajustes, con autodetección

**Files:**
- Create: `apps/desktop/src/main/traktorNmlPath.ts`, `apps/desktop/src/main/traktorNmlPath.test.ts`
- Modify: `apps/desktop/src/main/index.ts` (IPC del selector + autodetección)
- Modify: `apps/desktop/src/renderer/src/components/SettingsModal.tsx`
- Modify: los 5 locales

**Interfaces:**
- Produces: `export function detectTraktorNmlPaths(home: string, readDir: (d: string) => string[]): string[]` — rutas candidatas ordenadas de versión más nueva a más vieja.

**Contexto:** Traktor guarda el NML en `~/Documents/Native Instruments/Traktor <versión>/collection.nml`, **una carpeta por versión** (`Traktor 4.4.1`, `4.5.0`…). La instalación del usuario objetivo NO está en el sitio estándar (tiene Documentos en iCloud). Por eso: **autodetectar propone, el usuario confirma**; y siempre hay selector manual. Vacío = apagado.

La detección se inyecta el lector de directorio para poder testearla sin tocar disco.

- [ ] **Step 1: Write the failing tests**

```typescript
  // Traktor crea una carpeta por versión y la ruta cambia al actualizar. Se propone
  // la más nueva, pero se devuelven todas: el usuario puede tener varias y saber
  // cuál usa de verdad.
  it('proposes the newest Traktor version first', () => {
    const dirs = ['Traktor 4.4.1', 'Traktor 4.5.0', 'Traktor 4.4.2']

    const found = detectTraktorNmlPaths('/Users/dj', () => dirs)

    expect(found[0]).toContain('Traktor 4.5.0')
    expect(found).toHaveLength(3)
  })

  // Comparación por número, no alfabética: "4.10" es posterior a "4.9" aunque
  // ordene antes como texto.
  it('orders versions numerically, not lexically', () => {
    const found = detectTraktorNmlPaths('/Users/dj', () => ['Traktor 4.9.0', 'Traktor 4.10.0'])

    expect(found[0]).toContain('Traktor 4.10.0')
  })

  // Sin Traktor instalado no hay nada que proponer, y no es un error: el usuario
  // elegirá su .nml a mano si lo tiene fuera del sitio estándar.
  it('finds nothing when there is no Traktor folder', () => {
    expect(detectTraktorNmlPaths('/Users/dj', () => [])).toEqual([])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/traktorNmlPath.test.ts`
Expected: FAIL — el módulo no existe

- [ ] **Step 3: Implement the detection**

Filtra las carpetas que casen `/^Traktor \d/`, extrae los números de versión, ordena descendente comparando componente a componente (numérico), y devuelve `join(home, 'Documents', 'Native Instruments', <carpeta>, 'collection.nml')`. No comprueba existencia — eso lo hace quien llama, con `existsSync`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/traktorNmlPath.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire the Settings UI**

En `SettingsModal.tsx`, junto a los ajustes de Engine DJ (mismo patrón de selector de ruta): campo de sólo lectura con la ruta y un botón para elegir fichero (`dialog.showOpenDialog` con filtro `*.nml`, vía IPC nuevo). Si `traktorNmlPath` está vacío y la autodetección encuentra algo, mostrarlo como propuesta que el usuario acepta — nunca guardarlo sin confirmación. Textos en los 5 locales.

Estudia antes cómo `SettingsModal.tsx` presenta hoy `engineLibraryDir` y sigue ese patrón exactamente.

- [ ] **Step 6: Run the full suite, type-check and lint**

Run: `cd apps/desktop && npx vitest run && npx tsc --build` y `npm run lint -w apps/desktop`
Expected: todo verde

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/traktorNmlPath.ts apps/desktop/src/main/traktorNmlPath.test.ts apps/desktop/src/main/index.ts apps/desktop/src/renderer/src/components/SettingsModal.tsx apps/desktop/src/renderer/src/i18n/locales
git commit -m "Let the user point Surco at their Traktor collection"
```

---

## Validación real (imprescindible antes de dar esto por bueno)

Nada de lo anterior está verificado contra un Traktor de verdad, y en esta máquina no se puede: no hay Traktor instalado. Tres incógnitas siguen abiertas y **sólo djotas puede cerrarlas**:

1. **El nombre real del binario.** `traktorProcess.ts` empareja por subcadena "traktor" porque no se pudo confirmar. Si el proceso real no la contiene, la guarda no dispara nunca y en silencio. Comprobar con `ps -axo comm | grep -i traktor` con Traktor abierto.
2. **La forma de las etiquetas.** Todo el código asume `<LOCATION ...></LOCATION>` con cierre pareado. El propio script del usuario serializa con Python ElementTree, que **siempre autocierra** — el núcleo ya tolera ambas formas, pero conviene verlo contra su fichero real.
3. **El formato de `DIR`/`VOLUME`** de su colección, que depende de dónde tenga la música (volumen externo, red, disco de arranque).

**La primera prueba se hace sobre una COPIA de su colección**, nunca sobre la buena: apuntar `traktorNmlPath` a la copia, convertir una pista, abrir esa copia en Traktor y comprobar que los cues salen donde deben.
