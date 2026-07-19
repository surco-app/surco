# Inspector "Other metadata" con el estilo de Properties

Fecha: 2026-07-19

## Problema

El inspector "Other metadata" quedó como un toggle desnudo pegado a una línea
separadora, con dos defectos visuales:

1. **Falta aire arriba:** queda pegado a la fila de chips del formulario. La sección
   Properties respira más (`mt-5 border-t pt-5`).
2. **El patrón "línea + toggle" no es bonito:** un toggle suelto sobre un borde, frente al
   `SectionHeader` con título en mayúsculas + filas en tarjeta que usa Properties.

## Decisión

Rediseñar `ForeignTagsInspector` para que adopte el **lenguaje visual de la sección
Properties** (`PropertiesSection` + `PropertiesReadout`), manteniendo su **ubicación fija**
(dentro del editor, atado al plegado de la sección de metadatos, solo pista única). NO se
convierte en una sección configurable del sistema (`editorSections`).

### Aspecto visual (tomado de Properties)

- **Contenedor:** `mt-5 border-t border-[var(--color-line)] pt-5` — el aire arriba que
  hoy falta.
- **Cabecera:** un `SectionHeader` con:
  - Título "OTHER METADATA" en mayúsculas (como "PROPERTIES"), vía i18n.
  - Chevron plegable.
  - Summary/digest cuando está plegado: el conteo, p.ej. "7 tags" (i18n con `{{count}}`).
  - El toggle propio de plegado del inspector se sustituye por este SectionHeader.
- **Cuerpo (`SectionBody`):** se pliega con el header. Las filas de tags foráneos en el
  estilo de tarjeta de `PropertiesReadout`:
  - Contenedor `<dl>` (o `<ul>`) con `grid gap-px overflow-hidden rounded-lg bg-[var(--color-line)]`
    y cada fila `bg-[var(--color-field)] px-3 py-2` — el truco de `gap-px` sobre fondo
    `--color-line` que dibuja los separadores sin bordes por celda.
  - Cada fila: NOMBRE del tag a la izquierda (`dt`, `text-fg-dim`), valor a la derecha
    (`dd`, truncado, `tabular-nums` no aplica aquí — es texto libre). A diferencia de
    Properties (grid de 2 columnas), aquí las filas van a **una columna** (`grid-cols-1`),
    porque nombre y valor de un tag foráneo pueden ser largos (base64).

### Borrado por fila

- Cada fila tiene una **X al final que aparece al hover** (`opacity-0
  group-hover:opacity-100` o equivalente), discreta. Llama `onRemove(name)`.
- Un tag ya en `foreignRemoved` se muestra **tachado/atenuado** (`line-through opacity-60`),
  como hoy. El `data-removed` se conserva para el test.
- Se mantienen los `data-testid`: `foreign-tags-toggle` (ahora el botón del SectionHeader,
  o su equivalente — ver nota), `foreign-tags-list`, `foreign-tag-remove`, `foreign-tag-row`.

### Comportamiento (sin cambios)

- Solo pista única (`!isMulti`), atado a `formOpen` (se oculta al plegar la sección de
  metadatos — ya implementado).
- Retorna `null` si no hay tags foráneos.
- Ver + borrar (individual). Sin editar valores ni añadir (fase 2, fuera de alcance).

## Nota sobre el plegado propio

Hoy el inspector tiene su **propio** estado de plegado (el toggle abre/cierra la lista).
Con el rediseño hay dos plegados posibles: (a) el de la sección de metadatos (formOpen, que
ya oculta todo el inspector), y (b) el propio del inspector (abrir/cerrar la lista de tags).

**Decisión:** conservar el plegado propio del inspector (estado local `open`), igual que
hoy — el SectionHeader del inspector controla ese `open` local. Así el usuario puede tener
la sección de metadatos abierta pero "Other metadata" plegado (solo ve la cabecera con el
conteo). Es coherente con cómo se comporta hoy y con Properties (cada sección tiene su
plegado). El `data-testid="foreign-tags-toggle"` pasa a ser el botón del SectionHeader.

## i18n

- Nueva clave para el título de la sección: `editor.otherTagsTitle` = "Other metadata" /
  "Otros metadatos" / etc. (sin el conteo — el conteo va en el summary).
- Nueva clave de summary: `editor.otherTagsSummary` = "{{count}} tags" / "{{count}}
  etiquetas" / etc.
- La clave existente `editor.otherTags` ("Other metadata ({{count}})") **se elimina** de los
  5 locales, ya que su único uso (el toggle) se sustituye por el título + summary. Verificar
  con grep que no queda ninguna referencia a `editor.otherTags` antes de borrarla.

## Testing

- El inspector retorna `null` sin tags foráneos (test existente).
- Renderiza el SectionHeader con el título y el conteo en el summary.
- El plegado propio: cerrado por defecto; al abrir muestra la lista de tarjetas.
- Click en la X de una fila llama `onRemove` con el nombre.
- Un tag en `foreignRemoved` se muestra con `data-removed="true"`.
- Los tests existentes de `ForeignTagsInspector` siguen verdes (o se actualizan al nuevo
  DOM manteniendo la misma intención).
- i18n: claves nuevas en los 5 locales.

## Fuera de alcance

- Convertir el inspector en una sección configurable del sistema (editorSections/Settings).
- Editar valores o añadir tags nuevos.
- Grid de 2 columnas para los tags (van a 1 columna por longitud del valor).
