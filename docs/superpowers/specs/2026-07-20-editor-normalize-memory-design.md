# Recordar los valores de normalización del Editor entre pistas y sesiones

## Problema

En el Editor, el panel de normalización de cada pista se siembra desde el default
global de Settings (`Editor.tsx:317`, `useState(normalize)`, con `normalize`
leído de `useAppSettings()` → `settings.normalize`).

Hoy, cuando el usuario ajusta el panel en una pista:

- Los **dos checkboxes** (`peakRemoveDc`, `peakPerChannel`) SÍ se persisten en
  disco, porque `useEditorPicks.onNormalizeChange` (`useEditorPicks.ts:47-59`)
  escribe esos dos flags de vuelta a `settings.normalize`.
- El **input** (`peakDb` en modo Peak; `targetLufs`/`truePeakDb` en modo Loudness)
  NO se persiste. Al cambiar de pista, `normalizeCfg` se re-siembra desde
  `settings.normalize` y el input vuelve a su valor anterior (−1 / −14).

Esto es una regresión: el usuario espera que, tras ajustar Peak custom a −1.5 (o
2, o lo que sea) en una pista, la siguiente pista —al pulsar Peak— reencuentre ese
valor y sus checkboxes tal como los dejó.

### Por qué no basta con "añadir el input a lo que ya se guarda"

`settings.normalize` cumple **dos** propósitos a la vez hoy:

1. Es el **default de conversión** que se muestra y edita en
   **Settings → Conversion** (`ConversionTab.tsx:112`).
2. Es la **semilla** de cada pista en el Editor.

Su campo `mode` está pensado para el propósito 1: si el usuario pone
`mode: 'peak'` en Settings → Conversion, es una decisión deliberada de que TODAS
las conversiones normalicen a Peak — y como el Editor siembra el objeto entero
(`useState(normalize)`, `mode` incluido), cada pista abre con Peak activo. Eso es
correcto para el propósito 1.

Pero el usuario quiere lo contrario para el trasteo en el Editor: cada pista debe
abrir con la normalización en `off`, y solo repoblar los valores al pulsar
Peak/Loudness. El `mode` NO debe recordarse desde el Editor.

Por tanto, persistir los valores del Editor dentro de `settings.normalize`
tendría dos efectos colaterales inaceptables:

- Contaminaría el default de conversión global con ajustes puntuales de una pista.
- Para arrastrar el input habría que arrastrar también el `mode`, arriesgándose a
  activar la normalización en todas las pistas de golpe.

## Diseño

Separar los dos propósitos en dos campos independientes de `Settings`:

- **`settings.normalize`** — sin cambios. Sigue siendo el default de conversión de
  Settings → Conversion. Su `mode` sí activa la normalización globalmente, a
  propósito. **El Editor nunca lo escribe.**
- **`settings.editorNormalize`** (nuevo) — la memoria de trasteo del Editor.
  Guarda `peakDb`, `targetLufs`, `truePeakDb`, `peakRemoveDc`, `peakPerChannel`.
  **Su `mode` es siempre `'none'`**, de modo que cada pista abre en `off` y nunca
  activa la normalización en bloque; solo repuebla los valores cuando el usuario
  pulsa Peak/Loudness.

### Flujo de datos

```
settings.json
  normalize:        { mode, targetLufs, truePeakDb, peakDb, ... }  ← Settings → Conversion (NO cambia)
  editorNormalize:  { mode:'none', targetLufs, truePeakDb, peakDb, peakRemoveDc, peakPerChannel }  ← Editor

Editor abre pista   → siembra normalizeCfg desde settings.editorNormalize (mode='none')
Editor ajusta valor → escribe settings.editorNormalize (mode forzado a 'none')
Settings→Conversion → lee/escribe settings.normalize como hasta ahora
```

### Componentes y cambios

Reutiliza el tipo `NormalizeConfig` existente para el nuevo campo — misma forma,
cero tipos nuevos.

1. **`shared/types.ts`** — añadir `editorNormalize: NormalizeConfig` a la interfaz
   `Settings`, junto a `normalize`.

2. **`main/settings.ts`**
   - `defaults`: añadir `editorNormalize: { mode: 'none', targetLufs: -14,
     truePeakDb: -1, peakDb: -1 }` (mismos valores base que `normalize`).
   - `mergeSettings`: añadir el spread-merge robusto
     `editorNormalize: { ...base.editorNormalize, ...patch.editorNormalize }`,
     igual que la línea existente para `normalize` (`settings.ts:169`), para que un
     `settings.json` viejo rellene campos ausentes desde defaults.
   - `editorNormalize` NO va en `LOCAL_KEYS` → es sincronizable, coherente con
     `normalize`.

3. **`renderer/src/lib/settingsContext.tsx`**
   - `DEFAULTS`: añadir `editorNormalize` con el mismo objeto que `normalize`.
   - `resolveSettings`: añadir
     `editorNormalize: settings.editorNormalize ?? DEFAULTS.editorNormalize`.

4. **`renderer/src/components/Editor.tsx`**
   - Desestructurar `editorNormalize` de `useAppSettings()` en lugar de `normalize`.
     La única lectura de `normalize` en este componente es la siembra de la línea
     317 (las otras dos coincidencias de "normalize" son strings de UI de secciones,
     no la variable), así que la sustitución es directa: `normalize` deja de usarse.
   - Sembrar `normalizeCfg` desde `editorNormalize`
     (`useState(editorNormalize)`, `Editor.tsx:317`). Como `editorNormalize.mode`
     es siempre `'none'`, cada pista abre en `off` con los valores recordados.

5. **`renderer/src/hooks/useEditorPicks.ts`** — `onNormalizeChange`:
   - En vez de escribir solo los dos checkboxes a `settings.normalize`, escribe la
     config completa de valores a `settings.editorNormalize`, **forzando
     `mode: 'none'`**:
     ```
     saveSettings({ editorNormalize: {
       mode: 'none',
       targetLufs: n.targetLufs,
       truePeakDb: n.truePeakDb,
       peakDb: n.peakDb,
       peakRemoveDc: n.peakRemoveDc === true,
       peakPerChannel: n.peakPerChannel === true,
     }})
     ```
   - Comparar contra `settings.editorNormalize` (no `settings.normalize`) para el
     guard, de modo que el **mount report** —que llega con la config recién sembrada
     desde `editorNormalize`— no dispare una escritura redundante.
   - El guard compara los cinco campos de valor. `mode` no participa en la
     comparación (siempre `'none'` en el campo persistido), así que cambiar el modo
     en una pista jamás persiste nada.
   - Actualizar el comentario del bloque para describir el nuevo destino y contrato.

### Punto delicado: el mount report

`Editor.tsx:325-330` dispara `onNormalizeChange(normalizeCfg)` en el montaje con
la config recién sembrada. El guard en `onNormalizeChange` debe comparar contra
`settings.editorNormalize` para que ese report inicial —idéntico a lo ya
persistido— no re-escriba en cada apertura de pista. Se mantiene el guard,
ampliado a los cinco campos de valor.

## Testing (TDD)

Los tests de este comportamiento viven en `App.test.tsx`, bajo
`describe('App normalize peak preferences')` (líneas 1182-1230). NO hay un
`useEditorPicks.test.tsx` propio.

### Tests existentes a actualizar (parte del cambio, no solo añadidos)

- **`persists an editor checkbox toggle back to Settings`** (línea 1193): hoy
  espera `saveSettings({ normalize: { mode:'none', ..., peakRemoveDc:true,
  peakPerChannel:false } })`. Debe pasar a esperar
  `saveSettings({ editorNormalize: { mode:'none', targetLufs:-14, truePeakDb:-1,
  peakDb:-1, peakRemoveDc:true, peakPerChannel:false } })`. (El `mode:'none'` ya
  se forzaba antes vía `{ ...cur }` con `cur.mode==='none'`; ahora es explícito.)
- **`never writes Settings for a bare per-track mode switch`** (línea 1218): su
  assert `not.toHaveBeenCalledWith({ normalize: anything })` debe pasar a
  comprobar `editorNormalize` en vez de `normalize`.

### Tests nuevos (rojo primero)

- **Ajustar `peakDb`** (input en modo Peak) persiste `editorNormalize` con
  `mode:'none'` y el nuevo `peakDb`, sin tocar `settings.normalize`. Este es el
  caso central de la regresión (hoy el input no persiste en absoluto).
- **Ajustar `targetLufs`/`truePeakDb`** (modo Loudness) persiste igual a
  `editorNormalize`.
- **Mount report con valores iguales** a `settings.editorNormalize` NO escribe
  (sin escritura redundante al abrir pista).
- **Verificación de aislamiento**: ajustar valores en el Editor nunca llama a
  `saveSettings` con `normalize` — Settings → Conversion no se ve afectado.

## Alcance de archivos

Producción:
- `apps/desktop/src/shared/types.ts` — campo `editorNormalize` en `Settings`.
- `apps/desktop/src/main/settings.ts` — default + merge.
- `apps/desktop/src/renderer/src/lib/settingsContext.tsx` — default + resolve.
- `apps/desktop/src/renderer/src/components/Editor.tsx` — siembra desde `editorNormalize`.
- `apps/desktop/src/renderer/src/hooks/useEditorPicks.ts` — persiste a `editorNormalize`.

Tests:
- `apps/desktop/src/renderer/src/App.test.tsx` — actualizar los dos tests de
  `App normalize peak preferences` y añadir los casos nuevos.

## Fuera de alcance (YAGNI)

- **UI en Settings para `editorNormalize`**: no se expone; es memoria interna.
- **Recordar el `mode` del Editor**: deliberadamente NO; cada pista abre en `off`.
- **Migración de datos**: un `settings.json` sin `editorNormalize` obtiene el
  default vía `mergeSettings`; no hace falta migración explícita.
- **`NormalizeControls.tsx`**: no se toca; sigue siendo un componente puro.
