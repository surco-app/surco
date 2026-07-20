# Analizar todo al importar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al importar una pista con `autoAnalyze` activo, Surco barre en segundo plano los 8 análisis pesados (llenando la caché a disco existente) para que reabrir la librería no dispare ningún análisis al tocar cada fila.

**Architecture:** Se extiende el barrido existente `useQualityAnalysis` (renderer) — que hoy hace 3 análisis a prioridad `low` bajo un botón — para cubrir los 8 análisis y para recoger los imports que llegan mientras corre. `App.onMetaLoaded` dispara el barrido bajo `autoAnalyze`. No se toca el proceso `main` ni `analysisCache.ts`: la caché a disco (`path+mtime`) ya persiste cada resultado.

**Tech Stack:** React 19 + TanStack Query, TypeScript, Vitest (jsdom). App Electron en `apps/desktop`.

## Global Constraints

- Tests se ejecutan desde `apps/desktop` con `npm test` (`vitest run`). Un test único: `npm test -- useQualityAnalysis`.
- Los análisis del barrido corren a prioridad `low` (background), NO `high`/`urgent`: el barrido no debe preemptar al track que el usuario tiene seleccionado. Las factories `spectrogramOptions`/`waveformOptions` sin argumento ya devuelven `low`; `loudness/clicks/bpm/key/properties` no toman prioridad en su forma de barrido — ver Task 1.
- Sin comentarios de código añadidos que no sigan la densidad del fichero; el repo comenta el "por qué". Igualar estilo existente.
- Commits: título descriptivo en español, sin body, sin prefijos `feat:`/`fix:`.
- El barrido salta los ya analizados vía `tracksToAnalyze` (`!t.spectrum`), así que reimportar un fichero ya con espectro no relanza nada.

---

### Task 1: El worker del barrido cubre los 8 análisis

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useQualityAnalysis.ts:63-84`
- Modify (mocks de tests existentes): `apps/desktop/src/renderer/src/hooks/useQualityAnalysis.test.tsx`
- Test: `apps/desktop/src/renderer/src/hooks/useQualityAnalysis.test.tsx`

**Interfaces:**
- Consumes: `spectrogramOptions(inputPath)`, `waveformOptions(inputPath)`, `waveformScanOptions(inputPath)` (ya importados); y `analysisOptions(name, inputPath, probe)` de `../lib/analysisQueries` para los cinco restantes.
- Produces: sin cambio de firma pública (`analyzeAllQuality`, `cancelAnalysis`, `analysis`).

Las factories de barrido a prioridad `low` para los cinco análisis que hoy no están en el sweep. `useTrackLoudness`/`useBpm`/etc. piden `'high'` porque son del track seleccionado; el barrido pide background. Se construyen inline con `analysisOptions`, igual que hacen esos hooks pero sin el `'high'`:

- `loudness`: `analysisOptions('loudness', p, () => window.api.loudness(p, 'low'))`
- `clicks`: `analysisOptions('clicks', p, () => window.api.clicks(p, 'low'))`
- `bpm`: `analysisOptions('bpm', p, () => window.api.bpm(p, 'low'))`
- `key`: `analysisOptions('key', p, () => window.api.key(p, 'low'))`
- `properties`: `analysisOptions('properties', p, () => window.api.properties(p))`

- [ ] **Step 1: Ampliar el mock de `window.api` en los tests existentes**

Los cinco tests actuales definen `window.api` con solo `spectrogram/waveform/waveformScan/onWindowFocus`. Al añadir análisis al worker, `api.loudness` etc. serían `undefined` y romperían. Añadir un helper y usarlo en los cinco `beforeEach`/asignaciones. Sustituir cada bloque `;(window as unknown as { api: unknown }).api = { spectrogram, waveform: ..., waveformScan: ..., onWindowFocus: () => () => {} }` por el helper:

Añadir cerca del top del fichero (tras `wrapper`):

```tsx
function setApi(over: Record<string, unknown>): void {
  ;(window as unknown as { api: unknown }).api = {
    spectrogram: vi.fn().mockResolvedValue(spectrum),
    waveform: vi.fn().mockResolvedValue(null),
    waveformScan: vi.fn().mockResolvedValue(null),
    loudness: vi.fn().mockResolvedValue(null),
    clicks: vi.fn().mockResolvedValue(null),
    bpm: vi.fn().mockResolvedValue(null),
    key: vi.fn().mockResolvedValue(null),
    properties: vi.fn().mockResolvedValue(null),
    onWindowFocus: () => () => {},
    ...over,
  }
}
```

Reemplazar en cada test la asignación manual de `window.api` por `setApi({ spectrogram, ... })` pasando solo los mocks que ese test inspecciona. Ejemplo para el primer test:

```tsx
const spectrogram = vi.fn().mockResolvedValue(spectrum)
setApi({ spectrogram })
```

- [ ] **Step 2: Escribir el test que falla — el barrido decodifica loudness/clicks/bpm/key/properties**

Añadir al `describe`:

```tsx
it('runs the full analysis set for each not-yet-measured track', async () => {
  const loudness = vi.fn().mockResolvedValue(null)
  const clicks = vi.fn().mockResolvedValue(null)
  const bpm = vi.fn().mockResolvedValue(null)
  const key = vi.fn().mockResolvedValue(null)
  const properties = vi.fn().mockResolvedValue(null)
  setApi({ loudness, clicks, bpm, key, properties })
  const targetsRef = { current: [track('a'), track('b', { spectrum }), track('c')] }
  const { result } = renderHook(() => useQualityAnalysis({ targetsRef }), { wrapper: wrapper() })

  act(() => result.current.analyzeAllQuality())
  await waitFor(() => expect(result.current.analysis).toBeNull())

  for (const probe of [loudness, clicks, bpm, key, properties]) {
    const paths = probe.mock.calls.map((c) => c[0]).sort()
    expect(paths).toEqual(['/music/a.wav', '/music/c.wav'])
  }
})
```

- [ ] **Step 3: Verificar que falla**

Run: `cd apps/desktop && npm test -- useQualityAnalysis`
Expected: FAIL — el nuevo test falla (los mocks `loudness/clicks/bpm/key/properties` no se llaman); los cinco previos pasan (ya usan `setApi`).

- [ ] **Step 4: Ampliar el worker en `useQualityAnalysis.ts`**

En el cuerpo del `mapWithConcurrency` (`useQualityAnalysis.ts:69-76`), tras las tres `fetchQuery` actuales y dentro del mismo `try`, añadir el resto. Cada análisis en su propio `fetchQuery` secuencial reutiliza la caché por path; envolver cada uno para que el fallo de uno no tumbe los otros del mismo track:

```ts
try {
  await queryClient.fetchQuery(spectrogramOptions(t.inputPath))
  await queryClient.fetchQuery(waveformOptions(t.inputPath))
  await queryClient.fetchQuery(waveformScanOptions(t.inputPath))
  const rest = [
    analysisOptions('loudness', t.inputPath, () => window.api.loudness(t.inputPath, 'low')),
    analysisOptions('clicks', t.inputPath, () => window.api.clicks(t.inputPath, 'low')),
    analysisOptions('bpm', t.inputPath, () => window.api.bpm(t.inputPath, 'low')),
    analysisOptions('key', t.inputPath, () => window.api.key(t.inputPath, 'low')),
    analysisOptions('properties', t.inputPath, () => window.api.properties(t.inputPath)),
  ]
  for (const opts of rest) {
    try {
      await queryClient.fetchQuery(opts)
    } catch {
      // One analysis failing (e.g. bpm on a beatless rip) must not skip the others
      // of the same track — each fills its own cache entry independently.
    }
  }
} catch {
  failed += 1
}
```

Añadir el import al top del fichero:

```ts
import { analysisOptions } from '../lib/analysisQueries'
```

- [ ] **Step 5: Verificar que pasa**

Run: `cd apps/desktop && npm test -- useQualityAnalysis`
Expected: PASS — los seis tests pasan.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/useQualityAnalysis.ts apps/desktop/src/renderer/src/hooks/useQualityAnalysis.test.tsx
git commit -m "Barrer los ocho análisis en el import en vez de solo el espectro"
```

---

### Task 2: El barrido recoge los imports que llegan mientras corre

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useQualityAnalysis.ts:55-90`
- Test: `apps/desktop/src/renderer/src/hooks/useQualityAnalysis.test.tsx`

**Interfaces:**
- Consumes: `tracksToAnalyze(targetsRef.current, new Set())` (ya usado).
- Produces: `analyzeAllQuality()` re-evaluado al terminar el drain — si `targetsRef` tiene tracks nuevos sin analizar, vuelve a barrer sin que una segunda llamada durante el barrido inicie un pass concurrente.

Hoy `runningRef` (`useQualityAnalysis.ts:45,57-58`) ignora un re-trigger mientras el barrido corre (test "ignores a re-trigger while a sweep is in flight"). Con `onMetaLoaded` disparando por import, eso dejaría los tracks importados durante un barrido sin analizar. La solución (patrón de `pumpAutoMatch`'s `finally` en `useAutoMatch.ts:267-289`): al terminar el drain, re-evaluar `tracksToAnalyze`; si quedan, re-lanzar. Un re-trigger externo mientras corre sigue sin iniciar un pass paralelo (el `finally` lo recoge), preservando el test existente.

- [ ] **Step 1: Escribir el test que falla — imports durante el barrido se analizan**

```tsx
it('picks up tracks appended to targets while a sweep is running', async () => {
  let release: (v: SpectrumResult) => void = () => {}
  const gate = new Promise<SpectrumResult>((r) => { release = r })
  let first = true
  const spectrogram = vi.fn((): Promise<SpectrumResult> => {
    if (first) { first = false; return gate }
    return Promise.resolve(spectrum)
  })
  setApi({ spectrogram })
  const targetsRef = { current: [track('a')] }
  const { result } = renderHook(() => useQualityAnalysis({ targetsRef }), { wrapper: wrapper() })

  act(() => result.current.analyzeAllQuality())
  // A new import lands while 'a' is still decoding.
  targetsRef.current = [track('a', { spectrum }), track('b')]
  await act(async () => { release(spectrum); await gate })
  await waitFor(() => expect(result.current.analysis).toBeNull())

  const measured = spectrogram.mock.calls.map((c) => c[0]).sort()
  expect(measured).toEqual(['/music/a.wav', '/music/b.wav'])
})
```

- [ ] **Step 2: Verificar que falla**

Run: `cd apps/desktop && npm test -- useQualityAnalysis`
Expected: FAIL — `b.wav` nunca se mide (el re-trigger implícito no existe; el drain termina y no re-evalúa).

- [ ] **Step 3: Re-evaluar al terminar el drain**

En el `.finally(...)` de `analyzeAllQuality` (`useQualityAnalysis.ts:85-89`), antes de poner `analysis` a null, comprobar si quedan targets y, si es así, re-lanzar. Reemplazar el `.finally`:

```ts
    }).finally(() => {
      runningRef.current = false
      if (failed > 0) onErrorsRef.current?.(failed)
      // A drop that landed mid-sweep added rows to targetsRef the running pass never saw;
      // re-evaluate and drain them before idling, so an import during analysis isn't stranded.
      if (!analyzeCancel.current && tracksToAnalyze(targetsRef.current, new Set()).length > 0) {
        analyzeAllQuality()
        return
      }
      setAnalysis(null)
    })
```

Nota: `analyzeAllQuality` se auto-referencia; como es un `useCallback`, la referencia dentro del `finally` es la misma instancia estable (sus deps `[queryClient, targetsRef]` no cambian). No hace falta tocar las deps.

- [ ] **Step 4: Verificar que pasa (y que el test de re-trigger sigue verde)**

Run: `cd apps/desktop && npm test -- useQualityAnalysis`
Expected: PASS — el nuevo test pasa; "ignores a re-trigger while a sweep is in flight" sigue pasando (una segunda llamada síncrona mientras `runningRef` es true sigue devolviendo temprano; el `finally` solo re-lanza si de verdad quedan targets, y en ese test `a` queda medida así que no re-lanza).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/useQualityAnalysis.ts apps/desktop/src/renderer/src/hooks/useQualityAnalysis.test.tsx
git commit -m "Recoger en el barrido las pistas importadas mientras ya corría"
```

---

### Task 3: Importar dispara el barrido completo bajo autoAnalyze

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx:490-501` (`onMetaLoaded`)
- Test: `apps/desktop/src/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: `analyzeAllQuality` (ya desestructurado de `useQualityAnalysis` en `App.tsx:614`), `settings.autoAnalyze`.
- Produces: al importar con `autoAnalyze`, `analyzeAllQuality()` corre (llena la caché de los 8 análisis para el `bulkTracksRef` actual, saltando ya-analizados).

`onMetaLoaded` hoy (`App.tsx:499-500`) hace `prefetchQuery(spectrogramOptions)` solo bajo `autoAnalyze && showSpectrum`. Se reemplaza por un disparo del barrido completo bajo solo `autoAnalyze`. `analyzeAllQuality` ya lee `bulkTracksRef` (los visibles), así que respeta filtros visible-only sin pasarle el track.

**Ordering:** `analyzeAllQuality` está declarado en `App.tsx:614`, después de `onMetaLoaded` (~490). `onMetaLoaded` es una propiedad de un objeto de callbacks pasado a un hook; se ejecuta en respuesta a eventos, no en render, así que puede referenciar `analyzeAllQuality` por su binding estable. Verificar durante la implementación que el objeto que contiene `onMetaLoaded` no se construye antes de que `analyzeAllQuality` exista en el scope; si el linter marca use-before-define, envolver la llamada en `queueMicrotask(() => analyzeAllQuality())` NO es necesario — mover no aplica porque es un cierre. Si TypeScript se queja de TDZ, declarar `analyzeAllQuality` con `useStableCallback` ya existente (`App.tsx:1023` usa `useStableCallback(analyzeAllQuality)` como `onAnalyzeAll`) y llamar a esa versión estable. **Preferir referenciar directamente `analyzeAllQuality`**; solo si hay error de referencia, usar el binding estable.

- [ ] **Step 1: Escribir el test que falla — importar con autoAnalyze corre el barrido**

El fichero ya tiene los helpers `settings(over)` (`App.test.tsx:73`, con `autoAnalyze: false` por defecto), `setApi(over)` (`:176`, donde `getSettings` devuelve `settings()`), `renderApp()` (`:267`) y `addTwoTracks()` (`:278`, importa `/music/a.wav` y `/music/b.wav`). Se activa `autoAnalyze` sobrescribiendo `getSettings`. `loudness` es uno de los cinco análisis nuevos, así que su llamada es señal inequívoca del barrido completo (no del viejo prefetch de solo-espectro). Añadir dentro del `describe('App quality triage', ...)`:

```tsx
// With autoAnalyze on, importing must warm every heavy analysis on disk — not just the
// spectrum the old prefetch warmed — so reopening the crate never re-decodes. loudness is
// one of the sweep-only probes, so its call proves the full sweep ran, not the old path.
it('runs the full analysis sweep on import when autoAnalyze is on', async () => {
  const loudness = vi.fn().mockResolvedValue(null)
  setApi({
    loudness,
    getSettings: vi.fn().mockResolvedValue(settings({ autoAnalyze: true })),
  })
  await renderApp()
  await addTwoTracks()
  await waitFor(() => {
    const paths = loudness.mock.calls.map((c) => c[0]).sort()
    expect(paths).toEqual(['/music/a.wav', '/music/b.wav'])
  })
})
```

El `setApi` base (`App.test.tsx:176-235`) ya define `properties`, `loudness`, `clicks`, `spectrogram`, `waveform`. Faltan `bpm`, `key` y `waveformScan`, que el barrido ampliado llamará en cada test que importe con `autoAnalyze`. Ver Step 3.5 — hay que añadirlos al `setApi` base o los tests existentes fallarán con `api.bpm is not a function` en cuanto un import dispare el barrido.

- [ ] **Step 2: Verificar que falla**

Run: `cd apps/desktop && npm test -- App`
Expected: FAIL — `loudness` se llama como mucho para el track seleccionado (su editor), no para ambos imports; el barrido completo no corre en import.

- [ ] **Step 2.5: Completar el `setApi` base con los mocks que el barrido llamará**

En `setApi` (`App.test.tsx:176-235`), junto a `properties`/`loudness`/`clicks`/`spectrogram`/`waveform` ya presentes, añadir los tres que faltan para que cualquier test que importe con `autoAnalyze` no reviente:

```tsx
    bpm: vi.fn().mockResolvedValue(null),
    key: vi.fn().mockResolvedValue(null),
    waveformScan: vi.fn().mockResolvedValue(null),
```

- [ ] **Step 3: Disparar el barrido en `onMetaLoaded`**

Reemplazar en `App.tsx:495-500`:

```ts
      // Auto-analyze warms the same shared spectrum cache as the sweep and the hover
      // prefetch, at low priority so the selected track's own decode still preempts it.
      // Unlike the hover path it ignores the quality-section fold — this is an explicit
      // "always triage my imports" setting, not incidental pointer traffic.
      if (settings?.autoAnalyze && settings.showSpectrum)
        void queryClient.prefetchQuery(spectrogramOptions(t.inputPath))
```

por:

```ts
      // Auto-analyze runs the full background sweep so a reopened crate has every heavy
      // analysis already on disk — the sweep reads bulkTracksRef (the visible rows) and
      // skips any already measured, so this stays a cheap re-trigger per import. Ignores
      // the quality-section fold: this is an explicit "always analyze my imports" setting.
      if (settings?.autoAnalyze) analyzeAllQuality()
```

Si tras el cambio `spectrogramOptions` queda sin uso en App, eliminar su import (el linter lo marcará). Verificar antes de borrar: puede seguir usándose en el hover prefetch (`App.tsx:598`).

- [ ] **Step 4: Verificar que pasa**

Run: `cd apps/desktop && npm test -- App`
Expected: PASS.

- [ ] **Step 5: Ejecutar toda la suite del renderer**

Run: `cd apps/desktop && npm test`
Expected: PASS — sin regresiones. Prestar atención a tests de `onMetaLoaded`/prefetch que asumían el comportamiento antiguo (solo espectro); si alguno verificaba "importar prefetcha spectrogram y nada más", actualizarlo al nuevo contrato (importar corre el barrido) o reconciliar con el implementador.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.test.tsx
git commit -m "Disparar el barrido completo al importar cuando autoAnalyze está activo"
```

---

## Verificación final

- [ ] `cd apps/desktop && npm test` — toda la suite en verde.
- [ ] `cd apps/desktop && npm run lint` (o el gate de lint del repo) — sin warnings nuevos.
- [ ] Comprobación manual (opcional, vía skill run-desktop): con `autoAnalyze` on, soltar una carpeta; ver el pill de progreso barrer; cerrar y reabrir la app cargando los mismos ficheros; confirmar que abrir una fila es instantáneo (aciertos de caché, sin decodificación ffmpeg).
