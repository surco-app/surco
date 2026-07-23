# Chips de sugerencias adaptativos en una sola línea

## Problema

Los chips de sugerencias de un campo (Genre, Grouping…) muestran un número fijo:
`SUGGESTION_PREVIEW = 2` en `renderer/src/components/Field.tsx:16`, y el resto se
esconde tras un chip `+N`. El contenedor usa `flex-wrap`
(`Field.tsx:193`), así que cuando `2 chips + "+N"` no caben en la columna el `+N`
salta a una segunda línea y descuadra el formulario. Y al revés: en columnas anchas
donde cabrían 3 o 4 chips, se siguen mostrando solo 2 y se desperdicia el hueco.

## Qué se construye

**El corte deja de ser fijo y pasa a medirse**: en estado colapsado se muestran
tantos chips como quepan en el ancho real del contenedor, siempre en una sola
línea, con el resto tras el `+N`. `SUGGESTION_PREVIEW` desaparece.

### 1. Función pura de conteo

`computeVisibleChips(chipWidths, moreChipWidth, containerWidth, gap)` en un módulo
nuevo `renderer/src/lib/chipOverflow.ts` → número de chips visibles:

- Si todos los chips caben (suma de anchos + gaps ≤ contenedor), devuelve todos —
  sin `+N`.
- Si no, devuelve el mayor `k` tal que los primeros `k` chips + gaps + el ancho del
  `+N` caben en el contenedor.
- Mínimo 1: aunque ni el primer chip quepa, devuelve 1 (el chip se trunca con
  elipsis en el render).
- `containerWidth` 0 o negativo significa "sin medida fiable" y devuelve todos —
  es el degradado de jsdom/pre-layout, no un contenedor estrecho de verdad.

Aquí vive toda la lógica de conteo; se testea sin DOM.

### 2. Hook de medición

`useChipOverflow` en `renderer/src/hooks/useChipOverflow.ts`: encapsula los refs,
la medición y el `ResizeObserver`, y devuelve `{ containerRef, measureRef,
visibleCount }`.

- **Fila de medición oculta**: un span absoluto, invisible y `aria-hidden` dentro
  del contenedor renderiza *todos* los chips más un `+N` con el mayor resto posible
  (`suggestions.length - 1`, el caso más ancho). De ahí salen los anchos reales —
  exactos con cualquier fuente, padding o idioma.
- `useLayoutEffect` mide y fija `visibleCount` antes del paint (sin parpadeo);
  re-mide cuando cambian las sugerencias (un match de Discogs que llega tarde).
- `ResizeObserver` sobre el contenedor recalcula al cambiar el ancho (redimensionar
  la ventana, plegar un panel). Guardado con `typeof ResizeObserver === 'undefined'`
  como en `useScrollAffordance.ts:41`.
- **Degradado**: si el contenedor mide 0 (jsdom, o aún sin layout), `visibleCount`
  cae a "todos" — ningún chip desaparece por una medida que no existe.

### 3. Cambios en `Field.tsx`

- La fila colapsada pasa de `flex-wrap` a `flex-nowrap overflow-hidden`; renderiza
  `suggestions.slice(0, visibleCount)` + `+N` cuando hay resto. Los chips llevan
  `min-w-0 truncate` para el caso mínimo-1.
- La fila expandida (tras pulsar `+N`) no cambia: todos los chips con `flex-wrap`
  en varias líneas, como hoy. `chipsExpanded` se mantiene tal cual.
- La fila de medición se renderiza solo en estado colapsado.

## Qué NO cambia (YAGNI)

- El comportamiento de `+N` (expandir en sitio, queda expandido durante el mount
  del campo) es el mismo.
- El chip placeholder de detección (`suggestion-loading-*`) no se toca.
- Los testids (`chip-*`, `chip-more`, `field-suggestions`) y el aria-label
  `fields.suggestionsMore` se conservan.

## Casos borde

- **Todos caben**: sin `+N`, se ven todos.
- **Ni uno cabe**: se ve 1 truncado con elipsis + `+N`.
- **Sugerencias que cambian bajo un campo montado**: re-medición y nuevo corte.
- **jsdom / sin layout**: todos visibles, sin `+N` (degradado explícito).

## Tests

- `chipOverflow.test.ts` (TDD, rojo primero): todos caben → todos; corte exacto en
  el mayor `k` que cabe con hueco para `+N`; mínimo 1; contenedor 0 → todos.
- `useChipOverflow`: con anchos mockeados (`getBoundingClientRect` /
  `offsetWidth` por elemento) el hook produce el `visibleCount` esperado y
  reacciona a un cambio de sugerencias.
- `Field.test.tsx`: los tests actuales de colapso/expansión (líneas 181-216) asumen
  el corte fijo en 2; se adaptan mockeando medidas para forzar un corte concreto, y
  se añade el caso degradado (sin medidas → todos visibles, sin `chip-more`).
- `Editor.test.tsx` usa chips sin depender del corte (clic directo por testid): con
  el degradado "todos visibles" en jsdom siguen pasando sin cambios.
