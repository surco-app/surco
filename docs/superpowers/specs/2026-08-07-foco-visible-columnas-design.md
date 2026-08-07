# Foco de teclado visible en la columna de resultados, y salto relativo entre columnas

Fecha: 2026-08-07
Estado: aprobado, pendiente de plan de implementación

## Origen

Reporte del usuario (06/08/2026), con capturas:

> me es imposible moverme por surco con el cursor, por ejemplo si estoy en la 1ra
> columna, con las flechas si puedo moverme arriba y abajo entre las canciones, pero no
> puedo pasarme a la 2da columna y hacer lo mismo. Podríamos por ejemplo usar
> Command+derecha para saltar a la 2da columna, luego flechas de arriba y abajo para
> movernos, enter para desplegar álbum. Command+izquierda vuelvo a la 1ra columna.

Sobre `⌘2` (que ya existe) añadió: *"parece que no pasa nada, debería pasar lo mismo que
si pulso el cursor en el primer álbum de la 2da columna"*, con una captura de la tarjeta
**clicada** — es decir, desplegada y rellena.

## Estado actual (verificado en la app, no solo en el código)

Lo verifiqué lanzando la app compilada con el driver de `run-desktop` y despachando el
atajo a mano:

```
eval (()=>{const e=new KeyboardEvent("keydown",{key:"2",code:"Digit2",metaKey:true,bubbles:true});
window.dispatchEvent(e);return document.activeElement.getAttribute("data-testid")})()
→ "discogs-query"
```

**`⌘2` funciona.** Mueve el foco a la columna de resultados (a la primera tarjeta, o a la
caja de búsqueda si aún no hay resultados, que es el caso reproducido).

Piezas que ya existen:

- `⌘1`/`⌘2`/`⌘3` saltan a lista / resultados / editor
  (`shared/shortcutDefaults.ts:73-75` → `App.tsx:1386-1394`). Son **configurables** desde
  Settings → Atajos, como todos los comandos del registro.
- La columna de resultados **ya tiene** navegación ↑/↓/j/k/Home/End propia
  (`DiscogsPanel.tsx:139-171`), con `preventDefault()` para que no se filtren a la lista
  de pistas de detrás.
- **Enter ya despliega** la tarjeta: es un `<button>` nativo con `aria-expanded`
  (`DiscogsPanel.tsx:318-399`), y el chevron vive dentro de él.
- El estado de desplegado es uno solo a la vez (acordeón): `openResult` en
  `useDiscogsBrowser.ts:102`.

El hueco real es uno solo: **el foco de teclado en la columna de resultados es
invisible.** El "cursor" es el foco del DOM y se apoya en el `:focus-visible` global
(`index.css:112-123`), que tras un `.focus()` programático no se dispara de forma fiable
en Chromium. El foco llega, pero mudo: de ahí "parece que no pasa nada".

El relleno azul que el usuario esperaba ver es el estado **desplegado**
(`DiscogsPanel.tsx:331-333`), que es lo que produce el clic — no el foco.

## Decisiones tomadas

- **Foco y despliegue son cosas distintas.** ↑/↓ mueven un resaltado visible sin abrir
  nada; `Enter` despliega. Se descartó desplegar al pasar (cada despliegue dispara una
  query de release a Discogs, `useDiscogsBrowser.ts:311-316`, y el contenido saltaría bajo
  el cursor mientras navegas), y también la variante con retardo de ~300 ms.
- **Solo se marca la tarjeta; no hay "columna activa".** Elegido sobre boceto a tamaño
  real. Se descartó marcar además la columna con foco: añade ruido visual y obligaría a
  introducir una noción de columna activa que hoy no existe en ninguna parte (el foco solo
  vive en el DOM).
- **El cursor se pinta con `:focus`, no con `:focus-visible`.** Consecuencia aceptada: la
  tarjeta también queda marcada al llegar **con el ratón**. Es correcto — te dice dónde
  continuará el teclado — pero es un cambio visible respecto a hoy.
- **El cursor sigue siendo el foco del DOM**, no un índice en estado de React. Cambiar a
  índice obligaría a reescribir la navegación de `DiscogsPanel` que ya funciona. Cambio
  quirúrgico.
- **`⌘←`/`⌘→` relativos, con tope en los extremos.** En la lista, `⌘←` no hace nada. Se
  descartó dar la vuelta: desorienta.
- **`⌘←`/`⌘→` disparan siempre, también mientras se escribe** — igual que `⌘1/2/3`.

  *Esta decisión se revirtió durante la implementación.* El diseño original los dejaba
  inertes al escribir, para conservar inicio/fin de línea de macOS. Al verificar en la app
  compilada resultó que eso los rompía: casi todos los destinos del salto **son campos de
  texto** (la caja de búsqueda de Discogs y los campos del editor), así que el salto era de
  ida sin vuelta — medido: `track-row → discogs-query`, y allí se quedaba. El usuario
  decidió quitar el guardián. Precio aceptado: dentro de un campo se pierde inicio/fin de
  línea. Implementado en `31975103`.
- **`→`/`←` no despliegan ni cierran la tarjeta.** Colisionan con `seek-back`/
  `seek-forward` del reproductor (`shortcutDefaults.ts:38-39`). `Enter` ya cubre el
  despliegue.

## Alcance

### Se hace

1. **Cursor de teclado visible en la columna de resultados.** Fondo
   `--color-accent-soft`, borde `--color-accent`, título en blanco — distinto del relleno
   fuerte `--color-row-selected` que marca la tarjeta desplegada/aplicada, para que no se
   confundan dos estados. Aplica a las tarjetas (`discogs-result`) y a las pistas de
   dentro (`discogs-track`), que son los ítems que ya rovea `DiscogsPanel.tsx:143-145`.
2. **Dos comandos nuevos**: `focus-column-prev` (`⌘←`) y `focus-column-next` (`⌘→`), que
   se mueven por el ciclo lista → resultados → editor con tope en los extremos. Al ser
   comandos del registro, aparecen solos en Settings → Atajos y son reasignables, sin
   trabajo extra.

### No se hace

- No se toca `⌘1/2/3`.
- No se toca `AlbumMatchRows.tsx` (el modo multiselección de la columna de resultados no
  tiene navegación por teclado: es un hueco real, pero no es lo pedido).
- No se añade `data-shortcut-scope` a la columna de resultados, ni se llevan sus teclas
  ↑/↓/j/k a la tabla de atajos configurables (hoy están fijas en `DiscogsPanel.tsx:166`).

## Diseño

### Resolución de la columna destino

Función pura, junto a `moveIndex`/`jumpIndex` en `renderer/src/lib/keymap.ts`, que ya es
el sitio de este tipo de lógica:

```
type Column = 'list' | 'matches' | 'editor'
nextColumn(current: Column, delta: 1 | -1): Column   // con tope, sin ciclo
```

La columna actual se deduce del DOM (igual que `activeScope`, y por la misma razón: no
puede desincronizarse de lo que el usuario ve enfocado), mirando en qué contenedor cae
`document.activeElement`. Si el foco no está en ninguna columna, `⌘→` entra por la lista.

El salto reutiliza `focusList`/`focusMatches`/`focusEditor` de `App.tsx:1386-1394` tal
como están.

### Guardián de tecleo

`suppressWhileTyping: true` en ambos comandos (`shortcutDefaults.ts`), el mismo mecanismo
que ya usan `remove`, `select-all` y `undo-meta`.

### Marcado visual

En `DiscogsPanel.tsx`, sobre los botones ya existentes. Sin estado nuevo en React.

## Pruebas

- `keymap.test.ts`: `nextColumn` — avance, retroceso, **tope en ambos extremos**, y
  entrada por la lista cuando no hay columna.
- `shortcutDefaults.test.ts`: los dos chords nuevos no entran en conflicto con los
  existentes (`findConflicts`), y quedan suprimidos al escribir.
- `DiscogsPanel.test.tsx`: la tarjeta enfocada lleva la marca de cursor; moverse con ↓
  **no** cambia `aria-expanded` de ninguna tarjeta (es la garantía de la decisión
  "foco ≠ despliegue"); `Enter` sí lo cambia.
- Verificación en la app real con el driver de `run-desktop`: `⌘→` desde la lista deja el
  foco en la columna de resultados **y se ve** en la captura.

## Preguntas abiertas

- El usuario aprobó "tope en los extremos" y "el cursor también se marca al clicar" de
  forma implícita (dijo "ok" a la propuesta que las recomendaba). Ambas son de una línea
  si al probarlas prefiere lo contrario.
- Perder inicio/fin de línea dentro de un campo es el precio del cambio de decisión de
  arriba. Conviene comprobar en uso real si molesta; `⌥←/⌥→` y `Home/End` siguen ahí.
