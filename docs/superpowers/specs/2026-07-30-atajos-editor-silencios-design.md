# Atajos de teclado en el editor de silencios

Fecha: 2026-07-30
Estado: aprobado, pendiente de plan de implementación

## Origen

Petición de djotas (30/07/2026):

> ¿Podemos añadir asignación de teclas al editor de silencios? Para poder usar mi
> maravilla de teclado de ripeos. Creo que todas las funcionalidades de Surco deberían
> poder usarse con el teclado, y además ser configurables en settings, que ya tenemos
> una sección para ello.

Adjunta la foto de un macropad: 15 teclas y 3 encoders. Es la restricción de diseño
principal — teclas contadas, y los encoders emiten pulsaciones repetidas de una tecla,
no valores continuos.

## Estado actual (verificado en código)

Más de lo pedido ya existe. Lo que hay:

- `apps/desktop/src/shared/shortcutDefaults.ts` — `SHORTCUT_DEFAULTS`, 35 comandos con
  chord por defecto, `resolveBindings` (defaults + overrides del usuario), `matchChord`
  y `findConflicts`.
- `components/settings/ShortcutsTab.tsx` — tab de Settings con grabación de chord por
  comando, reset por fila, reset global y aviso de conflicto.
- `hooks/useKeyboardShortcuts.ts` — el único listener global de `keydown`.
- `lib/keymap.ts` — `isTypingTarget` y `keyToCommandId`.

En `components/TrimSection.tsx` concretamente:

- Cada handle de corte es `role="slider"` con `tabIndex={0}` y `aria-valuemin/max/now`
  (líneas 388-394). **Ya es alcanzable con Tab.**
- Su `onKeyDown` (líneas 404-410) maneja `←`/`→` con `e.preventDefault()`; el paso es
  `FINE_STEP_SEC = 0.001` (1 ms) y con Shift `COARSE_STEP_SEC = 0.1` (100 ms).
- El listener global sale antes de nada si `e.defaultPrevented`
  (`useKeyboardShortcuts.ts:38`), así que **no hay choque** entre las flechas del handle
  y los comandos globales `seek-back`/`seek-forward`.
- Audición (línea 300), limpiar (línea 315) y aplicar sugerencia (línea 453) son
  `<button type="button">` nativos: alcanzables con Tab + Enter/Space, pero sin atajo.

## Huecos reales

1. **Sin atajo para las tres acciones de botón.** Se llega tabulando, no con una tecla.
   Para un macropad, tabular no sirve.
2. **Las flechas no son configurables.** Están cableadas en el `onKeyDown` del
   componente, fuera de `SHORTCUT_DEFAULTS`. No salen en el tab de Shortcuts. Esto es la
   mitad de lo que pide djotas.
3. **El lado activo puede ser invisible.** `focus-visible` solo pinta cuando el foco
   llegó por teclado. Si el usuario arrastra el handle con el ratón y luego gira el
   encoder, el handle tiene el foco y las teclas actúan sobre él, pero no se ve
   resaltado.
4. **El botón de aplicar sugerencia baila.** Solo existe con el corte sin poner, así que
   es un objetivo de Tab que aparece y desaparece.

## Decisiones tomadas

- **Lado activo = handle enfocado.** No hay estado nuevo ni tecla para alternar lado: Tab
  pasa de un handle al otro. Se descartó una tecla de alternar (gasta tecla) y el "último
  lado tocado" (estado invisible).
- **Nudge fino + grueso con Shift.** Ya implementado; se conserva.
- **Ámbito por foco real del DOM**, no por estado en React ni por un modo modal. Se
  descartó hacerlos globales con modificador (desperdicia la ventaja del macropad) y un
  "modo trim" explícito (estado oculto que genera reportes de "se ha vuelto loco").

## Diseño

### Arquitectura: `scope` en las definiciones

Campo opcional `scope?: string` en `ShortcutDef`. Los 35 comandos actuales no lo declaran
y siguen siendo globales — cero migración.

`matchChord` recibe el ámbito activo: si una definición declara `scope` y no coincide, no
matchea. El ámbito activo se deriva del foco real del DOM
(`document.activeElement.closest('[data-shortcut-scope="trim"]')`), nunca de estado en
React, para que no pueda desincronizarse de lo que el usuario ve enfocado.

Los comandos del trim **no** se registran en `lib/commands.ts` como los demás, porque
necesitan actuar sobre un lado concreto que solo el componente conoce. `TrimSection`
consulta las bindings resueltas y las compara en su propio `onKeyDown`, donde ya vive el
manejo de flechas. Mantiene el patrón `defaultPrevented` ya probado y evita cablear
estado del trim hasta `App`.

**Consecuencia aceptada:** estos comandos salen en el tab de Shortcuts y son
rebindeables, pero no aparecen en la command palette (⌘K), que ejecuta comandos globales
sin lado activo. "Auditar el corte de inicio" no tiene sentido desde la palette.

### Los cinco comandos

| id | Qué hace | Tecla por defecto |
|---|---|---|
| `trim-nudge-back` | Mueve el corte atrás (fino; ⇧ grueso) | `←` |
| `trim-nudge-forward` | Mueve el corte adelante (fino; ⇧ grueso) | `→` |
| `trim-audition` | Escucha el corte del lado activo | `a` |
| `trim-clear` | Quita el corte del lado activo | `c` |
| `trim-apply` | Aplica el silencio detectado | `s` |

Los dos de nudge ya existen cableados; el cambio es que pasan a leerse de las bindings
para ser rebindeables. Su comportamiento no cambia.

Teclas sueltas sin modificador, que es lo que hace útil el macropad. Solo viven con el
foco dentro del editor de silencios, así que no compiten con nada global. Son valores por
defecto: djotas los remapeará a lo que su teclado emita.

- `trim-apply` con el corte ya puesto no hace nada, igual que el botón no existe en ese
  estado. Re-aplicar la sugerencia encima de un corte manual sería comportamiento nuevo
  que nadie ha pedido.
- Sin repetición acelerada: mantener `←` repite al ritmo del sistema operativo. Para un
  encoder es irrelevante (cada click es una pulsación limpia).

### Lado activo visible en la onda

Único cambio visual. Para el handle, marcar el **foco real** (`:focus`) en lugar de solo
`focus-visible`, reutilizando el tratamiento que ya existe en las líneas 429-437 (línea
afinada + glow ceñido, diseñado para no emborronar la onda).

Es una desviación deliberada de la convención web —`focus-visible` existe justo para no
marcar el foco de ratón— y se justifica porque aquí el foco no es un detalle de
accesibilidad: es el estado que determina sobre qué lado actúan las teclas. Si es
invisible, es una trampa (hueco 3).

Ninguna otra parte de la app cambia de aspecto.

### Settings

Los cinco van bajo un encabezado propio ("Editor de silencios") en el tab de Shortcuts,
para que se lea que son de ámbito y no globales. Hoy la lista es plana; un separador es
el cambio mínimo que comunica la diferencia.

`findConflicts` debe dejar de marcar choque entre un comando con `scope` y uno global:
`a` para audición y una `a` global no colisionan si nunca están vivos a la vez. Es un
cambio real en la función, no cosmético.

### Pruebas

TDD, red-green-refactor:

- `matchChord` respeta `scope`: un comando con ámbito no dispara fuera de él; los
  globales siguen disparando dentro.
- `findConflicts` no da falso positivo entre ámbitos distintos, y sí lo da dentro del
  mismo ámbito.
- `TrimSection`: cada tecla actúa sobre el handle enfocado y **no** sobre el otro. Es la
  prueba que encierra el porqué de la feature.

## Fuera de alcance

- **Auditoría del resto de la app** — fase 2, decidida pero separada. Responde al "todas
  las funcionalidades de Surco deberían poder usarse con el teclado". Su tamaño se
  dimensiona con los datos de la auditoría, no antes.
- **Paso de nudge grande.** Fino son 1 ms y grueso 100 ms: ambos son de precisión.
  Ninguno sirve para recorrer la pista (del segundo 3 al 12). Puede ser una carencia real
  para djotas, pero no la ha planteado y no se inventa aquí. **Pendiente de preguntarle.**
- **Los encoders.** Surco recibe teclas normales; qué emite cada encoder es cosa del
  firmware del macropad.

## Preguntas abiertas para djotas

1. ¿Echa en falta un paso de nudge grande para recorrer la pista, además del fino y el
   grueso actuales?
2. ¿Qué emiten exactamente sus encoders y teclas? Determina si los defaults propuestos le
   sirven o los remapeará todos.
