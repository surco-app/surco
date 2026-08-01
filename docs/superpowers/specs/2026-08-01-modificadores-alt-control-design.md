# Cualquier combinación de teclas como atajo

Fecha: 2026-08-01
Estado: aprobado, pendiente de plan de implementación

## Origen

Djotas trabaja con un teclado de macros (15 teclas + 3 encoders) y remapea los atajos de
Surco a lo que emite su hardware. Al intentar grabar combinaciones con Option o Control,
el usuario del repo lo comprobó en la app:

> estoy option+E control+E o option+E no funciona, no hace nada

Y la decisión de alcance:

> yo soportaría cualquier combinación de teclas

## El bug, verificado en código

`eventToChord` (`shared/shortcuts.ts:46`) solo lee dos modificadores:

```ts
if (isMac ? e.metaKey : e.ctrlKey) chord.push('mod')
if (e.shiftKey && shiftIsModifier) chord.push('shift')
```

`altKey` y `ctrlKey`-en-Mac se ignoran por completo. Las consecuencias son dos, y ambas
silenciosas:

- **`⌥E` en teclado español**: `e.key` llega como `´` (carácter muerto). El Alt se pierde
  y el chord resultante no es el que se pulsó.
- **`⌃E` en Mac**: `ctrlKey` no se mira, así que se guardaría `['e']` — pisando la tecla
  suelta de otro comando.

En la práctica el grabador de Settings no llega a guardar nada, así que el usuario pulsa
y no pasa nada. Es el mejor de los desenlaces posibles: lo peor habría sido guardar en
silencio un atajo distinto del que se pidió.

## Estado actual (verificado)

- Un chord es una lista de tokens (`['mod','shift','r']`), con `mod` = ⌘ en macOS y Ctrl
  en el resto. Es lo que hace que un mismo atajo funcione en las tres plataformas.
- `formatShortcut` (`renderer/src/lib/shortcuts.ts`) traduce cada token a su símbolo, con
  un mapa por plataforma (`MAC` / `OTHER`).
- `chordToAccelerator` genera el acelerador del menú nativo desde el mismo chord, así que
  las tres superficies no pueden divergir.
- `captureChord` (`settings/ShortcutsTab.tsx`) graba la pulsación siguiente y descarta lo
  que `eventToChord` no sepa formar.
- **El repo no usa `KeyboardEvent.code` en ninguna parte**: la posición física es un
  concepto nuevo aquí.

## Decisiones tomadas

- **Cualquier combinación**, no solo Alt. Se descartó limitarse a Alt (más simple y
  simétrico entre plataformas) porque recorta justo lo que un macropad necesita: teclas
  que no pisen nada de lo que ya existe.
- **La tecla se guarda por posición física** cuando el chord lleva Alt o Control. Un
  macropad emite posiciones, no caracteres, y su firmware se configura por posición;
  guardar `´` haría que el mismo teclado se comportara distinto según el idioma del
  sistema — exactamente el fallo que esto viene a evitar.
- **Los atajos ya guardados no se migran.** Siguen almacenados por carácter y siguen
  funcionando. Se acepta la asimetría a cambio de no tocar lo que ya va.

## Diseño

### Los tokens

Dos modificadores nuevos sobre los dos existentes:

| Token | macOS | Windows / Linux |
|---|---|---|
| `mod` | ⌘ | Ctrl |
| `alt` | ⌥ | Alt |
| `ctrl` | ⌃ | *(no se genera al grabar: ahí Ctrl ya es `mod`)* |
| `shift` | ⇧ | Shift |

Un `ctrl` que llegue sincronizado desde un Mac se muestra y se respeta en Windows, pero
el grabador nunca lo produce allí.

**Orden canónico obligatorio**: `mod`, `alt`, `ctrl`, `shift`, y la tecla al final. Sin
él, `⌥⇧E` y `⇧⌥E` serían chords distintos para la misma pulsación.

### La tecla

Con Alt o Control presentes, el token de tecla es la **posición física** (`e.code`
normalizado: `KeyE` → `e`, `Comma` → `,`). Sin ellos, se conserva el comportamiento
actual por carácter, para que los atajos guardados sigan resolviendo igual.

El matcher acepta las dos formas: un chord almacenado por carácter y otro por posición
conviven sin ambigüedad porque solo los que llevan Alt/Control usan la segunda.

### Los cuatro puntos a tocar

- **`eventToChord`** — lee `altKey` y `ctrlKey`; resuelve la tecla por posición cuando
  alguno está presente.
- **`formatShortcut`** — `⌥`/`Alt` y `⌃`/`Ctrl` en los dos mapas de símbolos, para que
  Settings muestre la combinación en vez de un hueco.
- **`chordToAccelerator`** — dos entradas más (`Alt`, `Control`), que Electron ya acepta.
- **`captureChord`** — deja de descartar la pulsación cuando el chord lleva modificadores
  nuevos.

### Lo que este diseño NO resuelve

**Grabar un atajo que el sistema operativo ya usa** (⌥⌘Esc y compañía). El evento ni
siquiera llega a Surco, así que no hay forma de detectarlo desde aquí, y una lista
codificada de atajos del sistema envejecería mal entre versiones y configuraciones.

Lo que sí se mantiene: la detección de conflictos avisa de los choques *dentro* de Surco,
y un atajo que no responda se puede reasignar. Si aparece como problema real, se aborda
entonces con casos concretos.

## Pruebas

TDD, sobre lo que puede romperse de verdad:

- `⌥E` en teclado español se guarda como Alt + posición de la E, **no** como `´`.
- `⌃E` en Mac produce un chord con `ctrl`, no `['e']` — el fallo silencioso actual.
- Los atajos existentes (guardados por carácter) siguen resolviendo igual.
- El orden es canónico: `⌥⇧E` y `⇧⌥E` dan el mismo chord.
- `formatShortcut` muestra `⌥E`, `⌃E` y `⌥⇧E` correctamente en Mac, y `Alt+E` en Windows.
- `findConflicts` distingue `⌥E` de `E`.
- El acelerador del menú nativo incluye los modificadores nuevos.

## Fuera de alcance

- Migrar los atajos existentes a posición física.
- Detectar atajos reservados por el sistema operativo.
