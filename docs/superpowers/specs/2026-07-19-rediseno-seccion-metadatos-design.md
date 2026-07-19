# Rediseño de la sección de metadatos — Propuesta A

Fecha: 2026-07-19

## Problema

La sección de metadatos del editor (la más usada de la app) tiene tres defectos visuales:

1. **Header apretado.** La fila `right` del `SectionHeader` (Editor.tsx:847-915) mete el badge
   de biblioteca ("Already in your Apple Music library", muy largo) + dos grupos de iconos
   con un divisor, todo en una línea. El badge empuja/solapa el título.
2. **Chips de sugerencia apilados.** `Field` renderiza `suggestions`/`multiSuggestions`
   con `flex-wrap` (Field.tsx:183) bajo un input de media columna. Con muchos chips
   (Genre puede traer 9-11: Electronic, asia records, eurobeat…), hacen wrap casi vertical,
   empujan el campo hacia abajo y desalinean Genre vs Grouping en la grid de 2 columnas.
3. **Inspector suelto.** "Otros metadatos" (ForeignTagsInspector) cuelga bajo el
   `SectionBody` sin integrarse visualmente con el formulario.

## Decisión: Propuesta A (conservadora)

Cambio acotado que resuelve los tres defectos sin tocar la grid de campos ni el orden/
agrupación de campos (eso queda para una posible iteración futura).

### 1. Header en dos filas

El header de la sección METADATA pasa de una fila a dos:

- **Fila 1:** chevron + título ("Metadata" / "Editando N pistas") + el badge de biblioteca.
- **Fila 2:** los dos grupos de acciones, cada uno con una etiqueta corta en mayúsculas:
  - "Archivo" → copiar nombre + buscar en la web (actúan sobre el nombre del fichero).
  - "Etiquetas" → borrar todo + rellenar (actúan sobre los metadatos).
  - Separados por el divisor vertical actual.

Las etiquetas ("Archivo"/"Etiquetas") son texto corto en mayúsculas pequeñas, color
`--color-fg-faint`. Se traducen en los 5 locales.

**Badge acortado:** el texto del badge de biblioteca pasa de "Already in your Apple Music
library" a **"En biblioteca" / "In library"**, con el icono de disco actual. Se **mantienen
las claves i18n** (`editor.inLibrary`, `editor.notInLibrary`, `editor.inLibraryEngine`,
`editor.notInLibraryEngine`, `editor.checkingLibrary`) y solo se acorta su **valor** en los
5 locales — menos cambios, menos riesgo. El icono + tooltip conservan el matiz de qué
biblioteca. Los estados yes/no/checking mantienen su lógica (Editor.tsx:856-891).

**Comportamiento de plegado:** igual que hoy — las acciones (fila 2) se ocultan cuando la
sección está plegada o en multi-select donde no aplican; el badge (estado) permanece.
La segunda fila solo aparece cuando `formOpen` (como hoy los grupos de iconos).

### 2. Chips de sugerencia en fila con scroll horizontal

En `Field` (Field.tsx:182-183), el contenedor de `suggestions` cambia de
`flex-wrap` a **una sola fila con scroll horizontal**:

- `flex` sin `wrap`, `overflow-x: auto`, sin cambiar la altura del campo.
- Los chips nunca apilan en vertical → nunca desalinean la grid.
- Sin desvanecido ni recorte "+N más" (decisión: la fila con scroll basta).
- Aplica a los chips de valor (Genre, Grouping presets). El chip único de BPM/Key
  detectado y el placeholder `suggesting` no se ven afectados (son 0-1 chips).

### 3. Integración del inspector

"Otros metadatos" (ForeignTagsInspector) se integra como un cierre visual del formulario:
comparte el borde superior con el cuerpo y no queda como un bloque flotante aparte. Cambio
menor de estilo/posición; la funcionalidad (ver + borrar) no cambia.

## Fuera de alcance

- Reorganizar la grid de campos (orden, grupos identity/catalog/dj/order, posición de
  artwork y rating). Se deja igual.
- Propuestas B (sugerencias bajo demanda) y C (panel lateral).
- Cualquier cambio en la lógica de datos (lectura de tags, borrado, export).

## Testing

- El header: test de que en `formOpen` aparecen las dos filas con las etiquetas
  "Archivo"/"Etiquetas" (por i18n key o data-testid), y de que el badge usa el texto corto.
- Los chips: test de que el contenedor de sugerencias no hace wrap (clase/estilo), o test
  visual de que N chips no cambian la altura del campo. Preferible un test de que la clase
  de wrap se sustituyó por la de scroll (data-testid en el contenedor de chips).
- Regresión: los tests existentes de `Field` (chips clicables, commit) y del header
  (badge yes/no/checking, botones clear/derive) siguen verdes.
- i18n: las claves nuevas/acortadas existen en los 5 locales (es/en/de/fr/pt-BR).
