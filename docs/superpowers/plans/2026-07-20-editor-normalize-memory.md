# Editor Normalize Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recordar entre pistas y sesiones los valores del panel de normalización del Editor (input Peak/Loudness + los dos checkboxes) sin afectar al default de conversión de Settings → Conversion ni activar la normalización de golpe.

**Architecture:** Se añade un campo nuevo `settings.editorNormalize: NormalizeConfig` a `Settings`, separado de `settings.normalize`. El Editor siembra cada pista desde `editorNormalize` (cuyo `mode` es siempre `'none'`) y persiste sus ajustes ahí. `settings.normalize` queda intacto como default de conversión de Settings → Conversion. Se reutiliza el tipo `NormalizeConfig` existente; no hay tipos nuevos.

**Tech Stack:** Electron + React 19 + TypeScript, Vitest + Testing Library. Persistencia propia en `settings.json` (main/settings.ts), sin electron-store.

## Global Constraints

- El campo persistido `editorNormalize` tiene **siempre** `mode: 'none'`. El modo del Editor NO se recuerda; cada pista abre en `off`.
- `editorNormalize` reutiliza el tipo `NormalizeConfig` (`shared/types.ts:62-77`). No se crean tipos nuevos.
- `editorNormalize` NO va en `LOCAL_KEYS` (`main/settings.ts`) → es sincronizable, igual que `normalize`.
- Valores base por defecto idénticos a los de `normalize`: `{ mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }`.
- El default de conversión `settings.normalize` NO se toca en ningún flujo del Editor.
- Sin comentarios de código añadidos salvo actualizar los ya existentes que queden obsoletos. Selectores de test: `data-testid`.
- Ejecutar tests desde `apps/desktop`: `npx vitest run <ruta>` (script del repo: `test` = `vitest run`). Linter: `npx biome lint src`.

---

## Task 1: Añadir `editorNormalize` al tipo `Settings`

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (interfaz `Settings`, junto a `normalize`)

**Interfaces:**
- Produces: campo `editorNormalize: NormalizeConfig` en `Settings`, consumido por todas las tareas siguientes.

- [ ] **Step 1: Localizar el campo `normalize` en la interfaz `Settings`**

Run: `grep -n "normalize: NormalizeConfig" apps/desktop/src/shared/types.ts`
Expected: una línea dentro de `interface Settings` (alrededor de la línea 223).

- [ ] **Step 2: Añadir el campo nuevo**

Justo debajo de la línea `normalize: NormalizeConfig`, añadir:

```ts
  // Como `normalize`, pero es la memoria del panel de normalización del Editor:
  // recuerda input y checkboxes entre pistas/sesiones. Su `mode` es siempre 'none'
  // — el modo del Editor no se recuerda — así que sembrar una pista desde aquí
  // nunca activa la normalización. Distinto de `normalize`, que es el default de
  // conversión de Settings → Conversion y sí puede activar el modo globalmente.
  editorNormalize: NormalizeConfig
```

- [ ] **Step 3: Verificar que compila el tipo**

Run: `cd apps/desktop && npx tsc --noEmit -p tsconfig.node.json 2>&1 | head`
Expected: errores en los sitios que construyen un `Settings` completo sin `editorNormalize` (defaults en main y renderer, y el helper `settings()` del test). Estos se arreglan en las Tasks 2, 3 y 4. Es la señal roja esperada.

No hay commit hasta la Task 2 (el tipo por sí solo deja el árbol sin compilar).

---

## Task 2: Default y merge en el proceso main

**Files:**
- Modify: `apps/desktop/src/main/settings.ts` (`defaults`, `mergeSettings`)
- Test: `apps/desktop/src/main/settings.test.ts`

**Interfaces:**
- Consumes: `Settings.editorNormalize` (Task 1).
- Produces: `defaults.editorNormalize` y el spread-merge de `editorNormalize` en `mergeSettings`, de modo que un `settings.json` viejo rellena campos ausentes desde defaults.

- [ ] **Step 1: Escribir el test rojo del merge**

En `apps/desktop/src/main/settings.test.ts`, justo debajo del test `fills a normalize field an older settings.json never wrote` (termina en la línea 143), añadir:

```ts
  it('fills an editorNormalize field an older settings.json never wrote', () => {
    writeFileSync(localFile(), JSON.stringify({ editorNormalize: { peakDb: -1.5 } }))
    const editorNormalize = getSettings().editorNormalize
    expect(editorNormalize.peakDb).toBe(-1.5)
    expect(editorNormalize.mode).toBe('none')
    expect(editorNormalize.targetLufs).toBe(-14)
    expect(editorNormalize.truePeakDb).toBe(-1)
  })
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `cd apps/desktop && npx vitest run src/main/settings.test.ts -t "editorNormalize field"`
Expected: FAIL — `editorNormalize` es `undefined` porque `defaults` aún no lo define.

- [ ] **Step 3: Añadir el default**

En `apps/desktop/src/main/settings.ts`, dentro del objeto `defaults`, justo debajo de la línea `normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },` (línea 75), añadir:

```ts
  // Memoria del panel de normalización del Editor. Mismo valor base que `normalize`;
  // su `mode` se mantiene 'none' siempre (ver types.ts).
  editorNormalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
```

- [ ] **Step 4: Añadir el spread-merge**

En `mergeSettings` (`settings.ts:164-174`), justo debajo de la línea `normalize: { ...base.normalize, ...patch.normalize },` (línea 169), añadir:

```ts
    editorNormalize: { ...base.editorNormalize, ...patch.editorNormalize },
```

- [ ] **Step 5: Ejecutar el test para verlo pasar**

Run: `cd apps/desktop && npx vitest run src/main/settings.test.ts -t "editorNormalize field"`
Expected: PASS.

- [ ] **Step 6: Ejecutar toda la suite de settings del main**

Run: `cd apps/desktop && npx vitest run src/main/settings.test.ts`
Expected: PASS (ningún test existente roto).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/settings.ts apps/desktop/src/main/settings.test.ts
git commit -m "Añadir editorNormalize a Settings con default y merge en el proceso main"
```

---

## Task 3: Resolver `editorNormalize` en el contexto del renderer

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/settingsContext.tsx` (`DEFAULTS`, `resolveSettings`)

**Interfaces:**
- Consumes: `Settings.editorNormalize` (Task 1).
- Produces: `ResolvedSettings.editorNormalize`, leído vía `useAppSettings()` en la Task 4.

- [ ] **Step 1: Añadir el default en `DEFAULTS`**

En `apps/desktop/src/renderer/src/lib/settingsContext.tsx`, dentro del objeto `DEFAULTS`, justo debajo de la línea `normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },` (línea 91), añadir:

```ts
  editorNormalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
```

- [ ] **Step 2: Resolver el campo en `resolveSettings`**

En `resolveSettings`, justo debajo de la línea `normalize: settings.normalize ?? DEFAULTS.normalize,` (línea 124), añadir:

```ts
    editorNormalize: settings.editorNormalize ?? DEFAULTS.editorNormalize,
```

- [ ] **Step 3: Verificar que `ResolvedSettings` compila**

Run: `cd apps/desktop && npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep -i "settingsContext\|editorNormalize" | head`
Expected: sin errores relativos a `settingsContext.tsx`. (Si `ResolvedSettings` es un tipo derivado que exige el campo, ahora queda satisfecho.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/settingsContext.tsx
git commit -m "Resolver editorNormalize en el contexto de settings del renderer"
```

---

## Task 4: El Editor persiste y siembra desde `editorNormalize`

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useEditorPicks.ts` (`onNormalizeChange` y su comentario)
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx` (desestructuración y siembra, línea ~235 y ~317)
- Test: `apps/desktop/src/renderer/src/App.test.tsx` (`describe('App normalize peak preferences')`, líneas 1182-1230; helper `settings()` línea 73)

**Interfaces:**
- Consumes: `ResolvedSettings.editorNormalize` (Task 3), `Settings.editorNormalize` (Task 1).
- Produces: comportamiento observable — un ajuste en el panel del Editor llama a `saveSettings({ editorNormalize: {...} })` con `mode: 'none'`; nunca llama a `saveSettings` con `normalize`.

- [ ] **Step 1: Actualizar el helper `settings()` del test para incluir el campo nuevo**

En `apps/desktop/src/renderer/src/App.test.tsx`, dentro del objeto que devuelve `settings()` (línea 73), justo debajo de la línea `normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },` (línea 119), añadir:

```ts
    editorNormalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
```

- [ ] **Step 2: Actualizar los dos tests existentes de `App normalize peak preferences`**

En el test `persists an editor checkbox toggle back to Settings` (línea 1193), reemplazar el bloque `expect(saveSettings).toHaveBeenCalledWith({ normalize: {...} })` (líneas 1203-1212) por:

```ts
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({
        editorNormalize: {
          mode: 'none',
          targetLufs: -14,
          truePeakDb: -1,
          peakDb: -1,
          peakRemoveDc: true,
          peakPerChannel: false,
        },
      }),
    )
```

En el test `never writes Settings for a bare per-track mode switch` (línea 1218), reemplazar el assert final (líneas 1226-1228) por:

```ts
    expect(saveSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ editorNormalize: expect.anything() }),
    )
```

- [ ] **Step 3: Añadir los tests nuevos**

Dentro del mismo `describe('App normalize peak preferences')`, antes de su cierre (`})` de la línea 1230), añadir:

```ts
  // El bug central de la regresión: cambiar el input del panel Peak debe recordarse
  // entre pistas. Se persiste a editorNormalize (no al default de conversión).
  it('persists the peak input value to editorNormalize', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({ saveSettings, getSettings: vi.fn().mockResolvedValue(settings(normalizeOpen)) })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    fireEvent.click(await screen.findByTestId('normalize-mode-peak'))
    const input = screen.getByTestId('normalize-peak')
    fireEvent.change(input, { target: { value: '-1.5' } })
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          editorNormalize: expect.objectContaining({ mode: 'none', peakDb: -1.5 }),
        }),
      ),
    )
  })

  // Trastear en el Editor nunca debe tocar el default de conversión de
  // Settings → Conversion.
  it('never writes the Settings conversion default from the editor', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({ saveSettings, getSettings: vi.fn().mockResolvedValue(settings(normalizeOpen)) })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    fireEvent.click(await screen.findByTestId('normalize-mode-peak'))
    fireEvent.click(screen.getByTestId('normalize-peak-remove-dc'))
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ editorNormalize: expect.anything() }),
      ),
    )
    expect(saveSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ normalize: expect.anything() }),
    )
  })
```

- [ ] **Step 4: Ejecutar los tests para verlos fallar**

Run: `cd apps/desktop && npx vitest run src/renderer/src/App.test.tsx -t "normalize peak preferences"`
Expected: FAIL — el código aún escribe a `normalize`, no a `editorNormalize`, y el input aún no persiste.

- [ ] **Step 5: Reescribir `onNormalizeChange` en `useEditorPicks.ts`**

En `apps/desktop/src/renderer/src/hooks/useEditorPicks.ts`, reemplazar el cuerpo de `onNormalizeChange` (líneas 47-59) por:

```ts
  const onNormalizeChange = useStableCallback((n: NormalizeConfig) => {
    normalizeRef.current = n
    // El panel de normalización del Editor es memoria duradera (feedback del usuario:
    // un relanzamiento debe reencontrar input y checkboxes como se dejaron), a diferencia
    // del `mode`, que sigue siendo one-shot por pista. Persistimos los valores a
    // `editorNormalize` con `mode: 'none'` fijo — así sembrar la siguiente pista nunca
    // activa la normalización — y NUNCA tocamos `settings.normalize` (el default de
    // Settings → Conversion). El mount report llega con el valor ya sembrado desde
    // editorNormalize, así que el guard evita la escritura redundante.
    const cur = settings?.editorNormalize
    if (!cur) return
    const next: NormalizeConfig = {
      mode: 'none',
      targetLufs: n.targetLufs,
      truePeakDb: n.truePeakDb,
      peakDb: n.peakDb,
      peakRemoveDc: n.peakRemoveDc === true,
      peakPerChannel: n.peakPerChannel === true,
    }
    if (
      cur.targetLufs !== next.targetLufs ||
      cur.truePeakDb !== next.truePeakDb ||
      cur.peakDb !== next.peakDb ||
      (cur.peakRemoveDc === true) !== next.peakRemoveDc ||
      (cur.peakPerChannel === true) !== next.peakPerChannel
    )
      saveSettings({ editorNormalize: next })
  })
```

- [ ] **Step 6: Actualizar el comentario de bloque del hook**

En `useEditorPicks.ts`, en el comentario de bloque sobre `useEditorPicks` (líneas 26-30), reemplazar la frase que dice que `onNormalizeChange` persiste "the two peak checkboxes to Settings" por una que refleje el nuevo destino:

```ts
// Gathered here because they were four refs, four writers and a reset smeared across App,
// and because one of those writers is not what it looks like: onNormalizeChange also
// PERSISTS the editor's normalize values (input + the two peak checkboxes) to Settings'
// `editorNormalize` field — its own memory, never the Settings → Conversion default — so
// the next track reseeds with what the user last dialed. Deliberate, but as a hidden write
// inside a ref-mirror it was the last place a reader would think to look for a settings save.
```

- [ ] **Step 7: Sembrar el Editor desde `editorNormalize`**

En `apps/desktop/src/renderer/src/components/Editor.tsx`:

En la desestructuración de `useAppSettings()` (línea 235), reemplazar `normalize,` por `editorNormalize,`.

En la siembra (línea 317), reemplazar:

```ts
  const [normalizeCfg, setNormalizeCfg] = useState(normalize)
```

por:

```ts
  const [normalizeCfg, setNormalizeCfg] = useState(editorNormalize)
```

- [ ] **Step 8: Ejecutar los tests del panel para verlos pasar**

Run: `cd apps/desktop && npx vitest run src/renderer/src/App.test.tsx -t "normalize peak preferences"`
Expected: PASS (los cuatro tests: los dos actualizados + los dos nuevos).

- [ ] **Step 9: Ejecutar toda la suite de App.test y comprobar tipos**

Run: `cd apps/desktop && npx vitest run src/renderer/src/App.test.tsx && npx tsc --noEmit -p tsconfig.web.json 2>&1 | head`
Expected: PASS y sin errores de tipos. (Si `tsc` señala que `normalize` queda sin usar en `Editor.tsx`, es que la desestructuración no se sustituyó; corregir.)

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/useEditorPicks.ts apps/desktop/src/renderer/src/components/Editor.tsx apps/desktop/src/renderer/src/App.test.tsx
git commit -m "Recordar los valores de normalización del Editor en editorNormalize"
```

---

## Task 5: Verificación completa

**Files:**
- (ninguno nuevo)

- [ ] **Step 1: Ejecutar toda la suite de tests del paquete**

Run: `cd apps/desktop && npx vitest run`
Expected: PASS. Prestar atención a `Editor.test.tsx`, `NormalizeControls.test.tsx` y `settings.test.ts` por si algún test daba por hecho que el Editor sembraba/escribía `normalize`.

- [ ] **Step 2: Comprobación de tipos completa**

Run: `cd apps/desktop && npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: sin errores.

- [ ] **Step 3: Linter**

Run: `cd apps/desktop && npx biome lint src`
Expected: sin warnings en los archivos tocados (`useEditorPicks.ts`, `Editor.tsx`, `settings.ts`, `settingsContext.tsx`, `types.ts`).

- [ ] **Step 4 (opcional, manual): Verificación en la app real**

Usar el skill `run-desktop` para lanzar Surco. Abrir pista A → Peak → cambiar input a −1.5 y marcar los dos checkboxes. Cambiar a pista B → normalización en `off` (correcto). Pulsar Peak → el input muestra −1.5 y los checkboxes marcados. Abrir Settings → Conversion → su normalización sigue en el default (no cambió). Cerrar y reabrir la app → repetir en una pista: los valores persisten.
```

## Verificación cruzada del punto delicado

El mount report (`Editor.tsx:325-330`) dispara `onNormalizeChange(normalizeCfg)` con `normalizeCfg` sembrado desde `editorNormalize`. Como el guard del Step 5 compara contra `settings?.editorNormalize` con los cinco campos de valor, y `next.mode` es siempre `'none'` (no se compara), el report inicial es idéntico a lo persistido → no escribe. Cubierto por el test `never writes Settings for a bare per-track mode switch` (que ahora comprueba `editorNormalize`) y por el hecho de que abrir una pista sin tocar nada no dispara `saveSettings`.
