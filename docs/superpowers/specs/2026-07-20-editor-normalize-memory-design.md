# Separar la plantilla de normalización de su activación automática

## Problema

En el Editor, el panel de normalización de cada pista se siembra desde el default
global (`Editor.tsx:317`, `useState(normalize)`, con `normalize` de
`useAppSettings()`). Los usuarios reportan una regresión: al ajustar en una pista
el valor de Peak/Loudness (p. ej. Peak custom −1,5) y los checkboxes, esos valores
no reaparecen en la siguiente pista — vuelven a −1 / −14.

### La causa raíz: `mode` hace dos trabajos en conflicto

El campo `normalize.mode` (`none`/`loudness`/`peak`) mezcla dos preguntas
distintas:

1. **¿Cuál es el preset de valores por defecto** (Peak −1 con estos checkboxes,
   o Loudness −14)?
2. **¿La normalización arranca activa** en cada pista, o en `off`?

Por eso el usuario no puede expresar lo que quiere. Si configura sus valores
custom de Peak como default, tiene que poner `mode: 'peak'` — lo que **fuerza que
cada pista abra normalizando**. No hay forma de decir: *"mi plantilla por defecto
es Peak −1 con estos checkboxes, pero cada pista arranca en off; solo cuando pulse
Peak quiero ver mis valores"*.

El intento anterior (un campo `editorNormalize` como "memoria oculta del Editor")
se descarta: introducía un tercer estado sutil y desacoplaba el Editor de Settings
de una forma que el usuario no quiere. El usuario aclaró que:

- El override por pista debe ser **temporal** (muere con la pista, nunca escribe el
  global).
- Los valores que reaparecen al pulsar Peak deben ser **el default global
  configurado en Settings**, no una memoria aparte.

## Diseño

Separar los dos trabajos del `mode` en Settings → Conversion:

- **`normalize`** (sin cambios de forma) — la **plantilla** de valores por defecto:
  `mode` (qué preset), `peakDb`, `targetLufs`, `truePeakDb`, `peakRemoveDc`,
  `peakPerChannel`. El usuario la configura libremente en Settings → Conversion.
- **`normalizeAuto: boolean`** (nuevo, default `false`) — si la plantilla se
  **aplica automáticamente** a cada pista, o si cada pista arranca en `off`.

### Comportamiento

**Al abrir cada pista** (siembra en `Editor.tsx`):

- `normalizeAuto === true` → la pista abre con la plantilla tal cual (`normalize`
  íntegro, `mode` incluido). Si la plantilla es Peak −1, la pista abre normalizando
  a Peak −1.
- `normalizeAuto === false` → la pista abre con `{ ...normalize, mode: 'none' }`:
  arranca en `off`, PERO conserva `peakDb`/`targetLufs`/`truePeakDb`/checkboxes de
  la plantilla. Así, al pulsar Peak, aparecen los valores configurados. **Este es
  el arreglo del bug.**

**El override por pista es temporal:** cambiar cualquier cosa en el panel de una
pista (modo, input, checkboxes) afecta solo a esa pista y **nunca escribe el
global**. El único sitio para cambiar el default es Settings → Conversion.

**El flag `normalizeAuto` solo vive en Settings → Conversion.** El Editor no lo
muestra; el Editor solo tiene su segmentado temporal por pista.

### Cambio de comportamiento respecto a hoy

Hoy, tocar los dos checkboxes en el Editor **escribía el global** vía
`useEditorPicks.onNormalizeChange` (`useEditorPicks.ts:47-59`). Con el override
temporal, esto **deja de ocurrir**: `onNormalizeChange` ya no persiste nada, solo
mantiene el ref para el atajo de teclado de conversión. Más coherente y
predecible.

### Flujo de datos

```
settings.json
  normalize:     { mode, peakDb, targetLufs, truePeakDb, peakRemoveDc, peakPerChannel }  ← plantilla
  normalizeAuto: false                                                                    ← nuevo

Settings → Conversion  → edita normalize (segmentado + valores) y normalizeAuto (checkbox)
Editor abre pista      → siembra normalizeCfg:
                           normalizeAuto ? normalize : { ...normalize, mode: 'none' }
Editor ajusta pista    → solo normalizeCfg (temporal); NO escribe settings
```

## Componentes y cambios

1. **`shared/types.ts`** — añadir `normalizeAuto: boolean` a `Settings`.

2. **`main/settings.ts`**
   - `defaults`: `normalizeAuto: false`.
   - `normalizeAuto` es un booleano plano → el spread superficial de `mergeSettings`
     ya lo cubre; NO necesita línea propia de merge.
   - No va en `LOCAL_KEYS` → sincronizable, coherente con `normalize`.

3. **`renderer/src/lib/settingsContext.tsx`**
   - `DEFAULTS`: `normalizeAuto: false`.
   - `resolveSettings`: `normalizeAuto: settings.normalizeAuto ?? DEFAULTS.normalizeAuto`.

4. **`renderer/src/lib/settingsDraft.ts`** — `SyncedDraft` enumera los campos
   sincronizables explícitamente (`normalize` está en la línea 39) y `pickSynced`
   los copia uno a uno (línea 95). Añadir `normalizeAuto: boolean` a la interfaz
   `SyncedDraft` y `normalizeAuto: s.normalizeAuto` en `pickSynced`. Verificar
   además la función inversa (la que arma el patch a guardar) e incluirlo si
   enumera campos explícitamente.

5. **`renderer/src/components/settings/ConversionTab.tsx`**
   - Bajo `<NormalizeControls value={synced.normalize} ... />` (línea 112), añadir
     un checkbox controlado para `normalizeAuto`
     (`onChange={(v) => patch('normalizeAuto', v)}`), con su copy i18n
     (`normalize.auto`).

6. **`renderer/src/components/Editor.tsx`**
   - Desestructurar también `normalizeAuto` de `useAppSettings()`.
   - Sembrar `normalizeCfg` (línea 317) con:
     `normalizeAuto ? normalize : { ...normalize, mode: 'none' }`.

7. **`renderer/src/hooks/useEditorPicks.ts`** — `onNormalizeChange`:
   - Reducir a solo `normalizeRef.current = n` (mantener el ref para el atajo de
     conversión). Eliminar la escritura a Settings. Actualizar el comentario de
     bloque, que hoy describe ese write.
   - `saveSettings` solo se usa en esa línea 58 dentro de `useEditorPicks`
     (verificado). Al eliminar la escritura, el parámetro queda sin uso: quitarlo de
     la firma (`useEditorPicks.ts:31-34`) y del argumento en `App.tsx:395`.

8. **i18n** (`en`, `es`, `fr`, `de`, `pt-BR`) — añadir `normalize.auto` (label del
   checkbox) en los cinco locales. Ajustar `normalize.hint` si procede para reflejar
   que el default ahora depende del flag.

## Copy propuesta (en.json)

- `normalize.auto`: "Apply to every track by default" (o equivalente). El hint
  existente "Off by default…" (`en.json:552`) pasa a describir el flag: cuando está
  desmarcado, off por defecto; cada pista puede activarlo.

## Testing (TDD)

### `main/settings.test.ts`
- Un `settings.json` viejo sin `normalizeAuto` → `getSettings().normalizeAuto`
  es `false` (default del spread-merge).

### `App.test.tsx` (`describe('App normalize peak preferences')`, líneas 1182-1230)
Reemplazar los dos tests actuales (que asumían que el Editor escribe el global):

- **`normalizeAuto=false` (default) → la pista abre en None** aunque la plantilla
  sea Peak. Abrir una pista con `settings({ normalize: { mode:'peak', peakDb:-1,5, … } })`
  y `normalizeAuto` ausente/`false`: el segmentado de la pista muestra None
  (`normalize-mode-none` con `aria-pressed`), y al pulsar `normalize-mode-peak` el
  input `normalize-peak` vale −1,5 (la plantilla). Este es el arreglo del bug.
- **`normalizeAuto=true` → la pista abre en Peak** con los valores de la plantilla.
- **Ajustar el panel en una pista NO llama a `saveSettings`** con `normalize` ni
  con nada: el override es temporal.

### `ConversionTab` (test del tab, si existe)
- Marcar el checkbox `normalize-auto` llama a `patch('normalizeAuto', true)`.

## Alcance de archivos

Producción:
- `apps/desktop/src/shared/types.ts` — `normalizeAuto` en `Settings`.
- `apps/desktop/src/main/settings.ts` — default.
- `apps/desktop/src/renderer/src/lib/settingsContext.tsx` — default + resolve.
- `apps/desktop/src/renderer/src/lib/settingsDraft.ts` — si aplica.
- `apps/desktop/src/renderer/src/components/settings/ConversionTab.tsx` — checkbox.
- `apps/desktop/src/renderer/src/components/Editor.tsx` — siembra condicional.
- `apps/desktop/src/renderer/src/hooks/useEditorPicks.ts` — override temporal.
- `apps/desktop/src/renderer/src/App.tsx` — si se simplifica la firma de `useEditorPicks`.
- i18n: `en/es/fr/de/pt-BR.json` — `normalize.auto`.

Tests:
- `apps/desktop/src/main/settings.test.ts`
- `apps/desktop/src/renderer/src/App.test.tsx`
- Test de `ConversionTab` si existe.

## Fuera de alcance (YAGNI)

- **Campo `editorNormalize` / "memoria del Editor"**: descartado.
- **Recordar overrides por pista entre sesiones**: no; son temporales por diseño.
- **Mostrar `normalizeAuto` en el Editor**: no; vive solo en Settings.
- **Migración de datos**: `normalizeAuto` ausente → `false` vía merge; sin migración.
- **`NormalizeControls.tsx`**: no se toca; sigue siendo puro.
