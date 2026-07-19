# "Other Metadata" como sección propia del editor

Fecha: 2026-07-19

## Problema

Tras darle a "Other Metadata" el estilo visual de la sección Properties, ahora se lee
exactamente como una sección de pleno derecho (cabecera "OTHER METADATA · N tags" en
mayúsculas, como PROPERTIES/IDENTITY). Pero **se comporta** como parte de la sección
Metadata: se renderiza tras el `SectionBody` del formulario y se pliega/oculta con él
(`{formOpen && !isMulti && <ForeignTagsInspector/>}` en Editor.tsx). Esa incoherencia
—parece independiente pero está atada— es lo que el usuario percibe.

## Decisión

Convertir "Other Metadata" en una **sección propia del editor**, hermana de Properties,
integrada en el sistema de secciones configurables (`editorSections`): se puede plegar de
forma independiente, ocultar y reordenar desde **Settings → Editor**.

### 1. Registro en el sistema de secciones

En `apps/desktop/src/shared/editorSections.ts`:

- Añadir `'otherTags'` a `EDITOR_SECTION_IDS` (después de `'form'`, en el grupo metadata).
- Añadir `otherTags: 'metadata'` a `EDITOR_SECTION_GROUP`.
- Añadir a `DEFAULT_EDITOR_SECTIONS` la entrada `{ id: 'otherTags', open: false }`
  inmediatamente después de `{ id: 'form', open: true }` (posición: grupo metadata, tras el
  formulario; estado inicial: **plegada**).

`normalizeEditorSections` ya inserta automáticamente las secciones nuevas en su posición por
defecto para instalaciones existentes (su bucle de "inserción por ancla", líneas 82-93), así
que los usuarios actuales la reciben en el sitio correcto sin migración manual.

**Restricción respetada:** a diferencia de `form` (pinned first, no ocultable),
`otherTags` es una sección normal — ocultable y reordenable.

### 2. Render en el editor

En `Editor.tsx`, el bucle que recorre `editorSections` (línea ~975) con un `switch (id)`:

- Añadir `case 'otherTags':` que renderice `<ForeignTagsInspector>` con las mismas props que
  hoy (`foreignTags`, `foreignRemoved`, `onRemove`), pasando el estado de plegado de la
  sección (`open` / `onToggle`) desde el sistema de secciones — **ya no** un `useState` local
  del componente.
- **Eliminar** el render actual del inspector fuera del `SectionBody` (Editor.tsx:951-963).
- La cabecera de grupo "metadata" y las demás secciones no se ven afectadas — el heading de
  grupo lo emite el bucle según `EDITOR_SECTION_GROUP` cuando cambia de fase.

### 3. El inspector pasa a recibir open/onToggle por props

`ForeignTagsInspector` deja de tener su propio `useState('open')`. Recibe `open: boolean` y
`onToggle: () => void` como props (como hacen `PropertiesSection`, etc.), para que su plegado
lo gobierne el sistema de secciones (persistente, configurable). El `SectionHeader` usa esas
props. Interfaz nueva:

```ts
interface ForeignTagsInspectorProps {
  foreignTags: ForeignTag[]
  foreignRemoved: string[]
  onRemove: (name: string) => void
  open: boolean
  onToggle: () => void
}
```

### 4. Solo se renderiza si hay tags foráneos

**Requisito explícito del usuario:** la sección solo aparece en el editor si hay tags
foráneos que mostrar. Si `foreignTags.length === 0`, no se renderiza nada (el inspector ya
retorna `null` en ese caso — se conserva). Así un fichero sin foráneos no muestra una sección
vacía, aunque en Settings figure como visible.

**Matiz Settings vs. editor:** en **Settings → Editor** la sección "Other Metadata" aparece
en la lista (para ocultarla/reordenarla) **siempre** —es una preferencia global, no depende
del track—. Solo el **render en el editor** depende de que el track actual tenga foráneos.
Esto es coherente con cómo Settings ya lista secciones que pueden no aplicar a un track dado.

### 5. i18n

- Settings → Editor nombra cada sección con la clave `settings.sections.<id>`
  (`EditorTab.tsx:186`: `tr(\`settings.sections.${section.id}\`)`). Añadir
  `settings.sections.otherTags` en los 5 locales, en el bloque `settings.sections` junto a
  `form`/`properties`/etc.: en "Other metadata", es "Otros metadatos", de "Weitere Metadaten",
  fr "Autres métadonnées", pt-BR "Outros metadados".
- Las claves del inspector (`otherTagsTitle`, `otherTagsSummary`, `otherTagsRemove`) ya
  existen de cambios previos y no se tocan.

## Testing

- `editorSections.ts`: `otherTags` en los tres registros; `DEFAULT_EDITOR_SECTIONS` lo pone
  tras `form`; `normalizeEditorSections` lo inserta en su sitio para un store viejo que no lo
  tenía, y respeta `hidden`/reorden del usuario.
- `Editor.tsx`: con la sección visible y el track con foráneos, se renderiza el inspector
  como sección (su cabecera aparece); con el track SIN foráneos, no aparece; con la sección
  oculta en Settings, no aparece aunque haya foráneos; su plegado es independiente del de
  Metadata (plegar Metadata ya no la oculta).
- `ForeignTagsInspector`: recibe `open`/`onToggle` por props; los tests existentes se
  actualizan para pasar esas props (el `useState` local desaparece).
- Settings → Editor: la sección aparece en la lista (con el nombre de
  `settings.sections.otherTags`) y se puede ocultar/reordenar (si hay test de EditorTab,
  extenderlo).
- i18n: `settings.sections.otherTags` en los 5 locales.

## Fuera de alcance

- El toggle de la X para desmarcar un tag (cambio B, se hace DESPUÉS de este, sobre la nueva
  estructura).
- Editar valores o añadir tags foráneos.
- Cambiar el estilo visual del inspector (ya se hizo).
