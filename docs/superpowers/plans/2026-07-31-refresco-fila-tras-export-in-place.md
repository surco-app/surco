# Refresco de la fila tras un export in-place — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tras un export in-place, releer el fichero y actualizar `listLabel`, `embeddedCover`, `embeddedCoverDims` y `duration` en la fila del panel izquierdo.

**Architecture:** `useTrackLibrary` expone una función nueva `refreshTrackFromDisk(id, path)` que relee el fichero con `window.api.readMeta` y aplica un parche de cuatro campos vía `enqueueMetaPatch`. `useTrackProcessing` la recibe como prop opcional y la invoca tras un export con `result.inPlace === true`, pasando `result.outputPath`. `App` las cablea.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, Electron IPC (`window.api.readMeta`).

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-07-31-refresco-fila-tras-export-in-place-design.md`
- Los tests se ejecutan **desde `apps/desktop`**, nunca filtrando por ruta desde la raíz del monorepo (salta el setup y da fallos falsos).
- Cero comentarios de código nuevos salvo los que expliquen el *porqué*, siguiendo la densidad del fichero (ambos hooks comentan decisiones, no mecánica).
- No tocar `meta`, `coverUrl`, `diskSignature` ni `metaReadFailed` en la ruta de refresco.
- Nombres en inglés (el código lo está); los tests describen el porqué.
- Sin `--no-verify` en ningún commit.

---

### Task 1: `refreshTrackFromDisk` en `useTrackLibrary`

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useTrackLibrary.ts` (interfaz `TrackLibrary` ~línea 113, cuerpo tras `startOverTrack` ~línea 385, objeto devuelto ~línea 598)
- Test: `apps/desktop/src/renderer/src/hooks/useTrackLibrary.test.tsx`

**Interfaces:**
- Consumes: `enqueueMetaPatch(id, applier)` (ya existe, línea 181), `searchFromTags(parsed, tags)` de `../lib/search`, `parseFileName(path)` de `../lib/filename`, `window.api.readMeta(path)`.
- Produces: `refreshTrackFromDisk: (id: string, path: string) => Promise<void>` en la interfaz `TrackLibrary`.

- [ ] **Step 1: Write the failing tests**

Añadir un `describe` nuevo al final de `useTrackLibrary.test.tsx`. El fichero ya
tiene los helpers que hacen falta:

- `setApi(over)` (línea 14) — monta `window.api` con `readMeta` ya mockeado y
  devuelve `{ fire, fireBatch }`. Se le pasa el `readMeta` propio de cada test.
- `setup()` (línea 45) — llama a `setApi()` sin argumentos y devuelve
  `{ result, fire, fireBatch, onDuplicatesSkipped }`.

Como cada test necesita su propio `readMeta`, hay que llamar a `setApi({ readMeta })`
**antes** de `renderHook`, igual que hace `setupWithTracks()` (línea 104). Añadir
un helper local siguiendo ese mismo patrón:

```tsx
function setupWith(readMeta: ReturnType<typeof vi.fn>): {
  result: { current: ReturnType<typeof useTrackLibrary> }
} {
  setApi({ readMeta })
  const { result } = renderHook(() =>
    useTrackLibrary({
      setSelection: vi.fn(),
      onForget: vi.fn(),
      onRemove: vi.fn(),
      onClear: vi.fn(),
      onMetaLoaded: vi.fn(),
      onDuplicatesSkipped: vi.fn(),
      onMetaReadFailed: vi.fn(),
    }),
  )
  return { result }
}
```

Los `tags` que devuelve el mock solo necesitan `title` y `artist` — es lo único
que `searchFromTags` lee (ver su firma: `Pick<TrackMetadata, 'title' | 'artist'>`).

```tsx
describe('useTrackLibrary refresh after an in-place export', () => {
  // El fichero de disco cambió bajo la fila (export in-place): la fila debe
  // reetiquetarse y mostrar la carátula nueva, o seguiría describiendo un
  // fichero que ya no existe con ese nombre ni con ese arte.
  it('relabels the row and takes the new cover from the file', async () => {
    const { result } = setupWith(
      vi.fn().mockResolvedValue({
        tags: { title: 'From Absolom To Heaven', artist: 'Mike Absolom' },
        duration: 345,
        cover: { thumbUrl: 'data:image/jpeg;base64,NEW', width: 600, height: 600 },
        foreignTags: [],
      }),
    )
    await act(async () => {
      await result.current.addPaths(['/m/a.wav'])
    })
    const id = result.current.tracks[0].id
    await act(async () => {
      await result.current.refreshTrackFromDisk(id, '/m/a.wav')
    })
    expect(result.current.tracks[0].listLabel).toBe('From Absolom To Heaven')
    expect(result.current.tracks[0].embeddedCover).toBe('data:image/jpeg;base64,NEW')
    expect(result.current.tracks[0].embeddedCoverDims).toEqual({ w: 600, h: 600 })
    expect(result.current.tracks[0].duration).toBe(345)
  })

  // El refresco es cosmético y la conversión que lo precede ya fue correcta: una
  // lectura fallida deja la fila como estaba y, sobre todo, no la marca como
  // ilegible — el fichero está perfectamente bien.
  it('leaves the row untouched and unflagged when the read fails', async () => {
    const { result } = setupWith(
      vi
        .fn()
        .mockResolvedValueOnce({
          tags: { title: 'Old', artist: 'Old Artist' },
          duration: 100,
          cover: { thumbUrl: 'data:image/jpeg;base64,OLD', width: 300, height: 300 },
          foreignTags: [],
        })
        .mockRejectedValueOnce(new Error('EBUSY')),
    )
    await act(async () => {
      await result.current.addPaths(['/m/a.wav'])
    })
    const id = result.current.tracks[0].id
    await act(async () => {
      await result.current.refreshTrackFromDisk(id, '/m/a.wav')
    })
    expect(result.current.tracks[0].listLabel).toBe('Old')
    expect(result.current.tracks[0].embeddedCover).toBe('data:image/jpeg;base64,OLD')
    expect(result.current.tracks[0].metaReadFailed).toBeUndefined()
  })

  // El refresco solo describe el fichero: lo que el usuario tenga en el editor
  // (metadatos editados, el match aplicado) no es asunto suyo y sobrevive intacto.
  it('keeps the editor state out of the refresh', async () => {
    const { result } = setupWith(
      vi.fn().mockResolvedValue({
        tags: { title: 'On Disk', artist: 'On Disk Artist' },
        duration: 200,
        cover: null,
        foreignTags: [],
      }),
    )
    await act(async () => {
      await result.current.addPaths(['/m/a.wav'])
    })
    const id = result.current.tracks[0].id
    act(() => {
      result.current.updateTrack(id, {
        meta: { ...result.current.tracks[0].meta, title: 'Typed By User' },
        matched: true,
      })
    })
    await act(async () => {
      await result.current.refreshTrackFromDisk(id, '/m/a.wav')
    })
    expect(result.current.tracks[0].meta.title).toBe('Typed By User')
    expect(result.current.tracks[0].matched).toBe(true)
    expect(result.current.tracks[0].listLabel).toBe('On Disk')
  })
})
```

Nota para quien lo ejecute: `addPaths` filtra por extensión de audio y `setApi`
mockea `expandPaths` devolviendo `[]`, así que la ruta debe pasarse ya expandida
y con extensión válida (`.wav`), como arriba. Si tras `addPaths` la lista sale
vacía, revisar ese filtro antes de tocar la implementación.

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
cd apps/desktop && npx vitest run src/renderer/src/hooks/useTrackLibrary.test.tsx -t 'relabels the row'
```

Expected: FAIL — `result.current.refreshTrackFromDisk is not a function`.

- [ ] **Step 3: Add the field to the `TrackLibrary` interface**

En `useTrackLibrary.ts`, junto a `startOverTrack` (línea ~113):

```ts
  startOverTrack: (track: TrackItem) => void
  // Re-reads the file after an in-place export rewrote it, so the row stops
  // describing bytes that no longer exist. Only the fields the row renders —
  // everything the user staged in the editor is left alone.
  refreshTrackFromDisk: (id: string, path: string) => Promise<void>
```

- [ ] **Step 4: Implement it**

Tras `startOverTrack` (línea ~385):

```ts
  // Deliberately not loadTrackMeta: that one merges into meta, consumes the restored
  // edit overlay and restamps diskSignature — all editor state, none of it ours. A
  // failed read is swallowed, and notably does not set metaReadFailed: the export
  // that triggered this succeeded, so the file is fine and the row is merely stale.
  const refreshTrackFromDisk = useStableCallback(async (id: string, path: string) => {
    try {
      const { tags, duration, cover } = await window.api.readMeta(path)
      const s = searchFromTags(parseFileName(path), tags)
      enqueueMetaPatch(id, (t) => ({
        ...t,
        listLabel: s.title || parseFileName(path).fileName,
        duration: duration ?? undefined,
        embeddedCover: cover?.thumbUrl,
        embeddedCoverDims:
          cover && cover.width > 0 ? { w: cover.width, h: cover.height } : undefined,
      }))
    } catch {
      // Cosmetic refresh: the row keeps its previous values.
    }
  })
```

Y añadirlo al objeto devuelto (línea ~598), junto a `startOverTrack`.

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
cd apps/desktop && npx vitest run src/renderer/src/hooks/useTrackLibrary.test.tsx
```

Expected: PASS (los tres nuevos y todos los preexistentes).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/useTrackLibrary.ts apps/desktop/src/renderer/src/hooks/useTrackLibrary.test.tsx
git commit -m "Add a disk refresh for a single track row"
```

---

### Task 2: Disparar el refresco solo en export in-place

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts` (interfaz `Params` ~línea 38, desestructuración ~línea 96, cuerpo ~línea 274)
- Test: `apps/desktop/src/renderer/src/hooks/useTrackProcessing.test.tsx`

**Interfaces:**
- Consumes: `refreshTrackFromDisk: (id: string, path: string) => Promise<void>` de la Task 1.
- Produces: prop opcional `refreshTrackFromDisk` en `Params` de `useTrackProcessing`.

- [ ] **Step 1: Write the failing tests**

Añadir al `describe('useTrackProcessing')` existente:

```tsx
  // El in-place reescribió el fichero original: la fila lo describe y debe releerse,
  // o se queda con el título y la carátula de antes de convertir.
  it('refreshes the row after an in-place export', async () => {
    setApi({
      processTrack: vi.fn().mockResolvedValue({ outputPath: '/m/a.wav', inPlace: true }),
    })
    const refreshTrackFromDisk = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a' })],
          settings: null,
          updateTrack: vi.fn(),
          refreshTrackFromDisk,
        }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(refreshTrackFromDisk).toHaveBeenCalledWith('a', '/m/a.wav')
  })

  // Exportar a otra ruta deja la original intacta, así que refrescar su fila
  // la haría mentir: mostraría metadatos que ese fichero no tiene. Este test
  // protege la decisión de diseño frente a una reversión accidental.
  it('leaves the row alone when the export went somewhere else', async () => {
    setApi({
      processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff', inPlace: false }),
    })
    const refreshTrackFromDisk = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a' })],
          settings: null,
          updateTrack: vi.fn(),
          refreshTrackFromDisk,
        }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(refreshTrackFromDisk).not.toHaveBeenCalled()
  })

  // Un in-place puede renombrar el fichero: leer la ruta de entrada devolvería
  // los datos del fichero viejo, o fallaría por no existir ya.
  it('reads the file at its post-rename path', async () => {
    setApi({
      processTrack: vi
        .fn()
        .mockResolvedValue({ outputPath: '/m/Mike Absolom - Heaven.wav', inPlace: true }),
    })
    const refreshTrackFromDisk = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', inputPath: '/m/old-name.wav' })],
          settings: null,
          updateTrack: vi.fn(),
          refreshTrackFromDisk,
        }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(refreshTrackFromDisk).toHaveBeenCalledWith('a', '/m/Mike Absolom - Heaven.wav')
  })

  // La conversión no se anula porque el refresco cosmético falle: el fichero
  // se escribió y el usuario debe verlo reportado como convertido.
  it('still reports the track converted when the refresh throws', async () => {
    setApi({
      processTrack: vi.fn().mockResolvedValue({ outputPath: '/m/a.wav', inPlace: true }),
    })
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a' })],
          settings: null,
          updateTrack: vi.fn(),
          refreshTrackFromDisk: vi.fn().mockRejectedValue(new Error('EBUSY')),
        }),
      { wrapper: withClient() },
    )
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.processOne('a')
    })
    expect(outcome).toBe('converted')
  })
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
cd apps/desktop && npx vitest run src/renderer/src/hooks/useTrackProcessing.test.tsx -t 'refreshes the row'
```

Expected: FAIL — `refreshTrackFromDisk` no se llama nunca.

- [ ] **Step 3: Add the prop**

En `Params` (~línea 38), tras `updateTrack`:

```ts
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
  // Called only after an in-place export, with the file's post-rename path: that
  // is the one case where the bytes the row describes were actually rewritten.
  refreshTrackFromDisk?: (id: string, path: string) => Promise<void>
```

Y en la desestructuración del hook (~línea 96), tras `updateTrack,`:

```ts
  refreshTrackFromDisk,
```

- [ ] **Step 4: Call it after the export patch**

En el cuerpo, tras `removeAnalysisQueries(queryClient, track.inputPath)` (~línea 275). Va después de `updateTrack(id, exportedPatch(...))` para que el repunte de `inputPath`/`fileName` esté aplicado y el refresco no lo pise:

```ts
        removeAnalysisQueries(queryClient, result.outputPath)
        if (result.inPlace) {
          removeAnalysisQueries(queryClient, track.inputPath)
          // Awaited so a batch's rows settle in order, but never allowed to fail the
          // conversion: the file is written either way and this only repaints a row.
          await refreshTrackFromDisk?.(id, result.outputPath).catch(() => {})
        }
        return 'converted'
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
cd apps/desktop && npx vitest run src/renderer/src/hooks/useTrackProcessing.test.tsx
```

Expected: PASS (los cuatro nuevos y todos los preexistentes).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts apps/desktop/src/renderer/src/hooks/useTrackProcessing.test.tsx
git commit -m "Refresh the row only when the export rewrote the original"
```

---

### Task 3: Cablear ambos hooks en `App`

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx` (destructuring de `useTrackLibrary`, llamada a `useTrackProcessing`)

**Interfaces:**
- Consumes: `refreshTrackFromDisk` de la Task 1, la prop de la Task 2.
- Produces: nada nuevo. Cierra el circuito.

- [ ] **Step 1: Locate both call sites**

```bash
cd apps/desktop && rg -n "startOverTrack|useTrackProcessing\(" src/renderer/src/App.tsx
```

`startOverTrack` aparece en el destructuring de `useTrackLibrary` (~línea 393) y como prop `onStartOver` (~línea 1254). El nuevo campo se saca en el mismo destructuring.

- [ ] **Step 2: Wire it**

Añadir `refreshTrackFromDisk` al destructuring de `useTrackLibrary`, junto a `startOverTrack`. Después, pasarlo a `useTrackProcessing` junto a `updateTrack`:

```ts
    updateTrack,
    refreshTrackFromDisk,
```

Respetar el orden y el formato del objeto existente.

- [ ] **Step 3: Typecheck and run the full renderer suite**

```bash
cd apps/desktop && npx tsc --noEmit -p tsconfig.web.json && npx vitest run
```

Expected: sin errores de tipos, toda la suite en verde. (Recordatorio: `tsc --noEmit` pelado desde la raíz no comprueba nada — hay que pasar el tsconfig explícito.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx
git commit -m "Wire the row refresh into the conversion pipeline"
```

---

### Task 4: Verificar en la app real

**Files:** ninguno (verificación manual).

- [ ] **Step 1: Reproduce the reported case**

Con el skill `apps/desktop:run-desktop`: arrancar la app, importar una pista **sin carátula embebida**, buscarla en Discogs, aplicar un match que traiga carátula, poner el destino en **sobrescribir el original** y convertir.

- [ ] **Step 2: Confirm the row**

La fila del panel izquierdo debe pasar del placeholder de nota musical al thumbnail nuevo, y el título al del match. Capturar la pantalla.

- [ ] **Step 3: Confirm the negative case**

Repetir con destino **carpeta de salida**. La fila original no debe cambiar. Esto es lo que se le prometió al usuario en el chat y lo que evita que la lista mienta.

- [ ] **Step 4: Report**

Si algo no cuadra, volver a la tarea correspondiente. No dar la feature por terminada sin las dos comprobaciones.

---

## Self-Review

**Cobertura del spec:**

| Requisito del spec | Tarea |
|---|---|
| Señal `result.inPlace` | 2 |
| Punto de enganche tras las líneas 274-275 | 2 |
| Leer `result.outputPath`, no `track.inputPath` | 2 (test 3) |
| Cuatro campos: `listLabel`, `embeddedCover`, `embeddedCoverDims`, `duration` | 1 (test 1) |
| `enqueueMetaPatch` para agrupar en lotes | 1 |
| No reutilizar `loadTrackMeta` ni `startOverTrack` | 1 (función independiente) |
| Fallo silencioso, sin `metaReadFailed` | 1 (test 2), 2 (test 4) |
| Panel derecho intacto | 1 (test 3) |
| Destino distinto no refresca | 2 (test 2) |
| Verificación con `run-desktop` | 4 |

**Placeholders:** ninguno. Todos los pasos llevan el código o el comando exacto.

**Consistencia de tipos:** `refreshTrackFromDisk: (id: string, path: string) => Promise<void>` es idéntica en la interfaz `TrackLibrary` (Task 1), en `Params` de `useTrackProcessing` (Task 2, opcional) y en el cableado (Task 3). Los campos del parche coinciden con `TrackItem` tal como los escribe `loadTrackMeta` (`embeddedCoverDims` como `{ w, h }`, `duration` como `number | undefined`).

**Helpers verificados:** `useTrackLibrary.test.tsx` existe y define `setApi` (línea 14), `setup` (45) y `setupWithTracks` (104). La Task 1 añade `setupWith` siguiendo el patrón de `setupWithTracks` — llamar a `setApi({ readMeta })` antes de `renderHook` — porque cada test necesita su propio mock de lectura. `useTrackProcessing.test.tsx` define `meta`, `track`, `setApi` y `withClient`, que la Task 2 reutiliza tal cual.
