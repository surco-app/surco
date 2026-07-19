# "Other Metadata" como sección propia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir "Other Metadata" en una sección propia del editor, registrada en el sistema de secciones (plegado independiente, ocultable/reordenable en Settings → Editor), que solo se renderiza si el track tiene tags foráneos.

**Architecture:** Registrar `otherTags` en `shared/editorSections.ts` (ids, grupo, defaults). Renderizarla en el `switch (id)` del bucle de secciones de `Editor.tsx`, quitando el render actual atado al formulario. `ForeignTagsInspector` deja su `useState` local y recibe `open`/`onToggle` por props, como las demás secciones. Añadir el nombre en Settings (`settings.sections.otherTags`).

**Tech Stack:** React 19, TypeScript, Tailwind v4, Vitest + Testing Library, react-i18next.

## Global Constraints

- Tests con Vitest: `npm run test -w apps/desktop -- <patrón>`.
- data-testid obligatorio. Conservar los del inspector: `foreign-tags-toggle`, `foreign-tags-list`, `foreign-tag-remove`, `foreign-tag-row` (+ `data-removed`), `foreign-tags-summary`.
- Tokens de color existentes, no inventar. Comentarios densos en inglés (convención del repo).
- i18n en los 5 locales: es/en/de/fr/pt-BR.
- Commits: título descriptivo, sin body, sin `feat:`/`fix:`. Una funcionalidad por commit.
- Requisito clave: la sección SOLO se renderiza en el editor si `foreignTags.length > 0` (si no, `null`). En Settings SÍ aparece siempre (preferencia global).
- Fuera de alcance: el toggle de la X para desmarcar (cambio posterior), editar/añadir tags, cambiar el estilo del inspector.

---

### Task 1: Registrar `otherTags` en el sistema de secciones

**Files:**
- Modify: `apps/desktop/src/shared/editorSections.ts` (ids, grupo, defaults)
- Test: `apps/desktop/src/shared/editorSections.test.ts` (si existe; si no, crear o cubrir vía el test que ya prueba `normalizeEditorSections`)

**Interfaces:**
- Produces: `'otherTags'` como `EditorSectionId` válido, en grupo `'metadata'`, con default `{ id: 'otherTags', open: false }` tras `form`.

- [ ] **Step 1: Escribir el test que falla**

Buscar el test de `normalizeEditorSections` (`grep -rl normalizeEditorSections apps/desktop/src --include=*.test.*`). Añadir:

```ts
it('inserta otherTags tras el formulario en un store que no lo tenía', () => {
  const stored = [
    { id: 'form' as const, open: true },
    { id: 'properties' as const, open: false },
  ]
  const result = normalizeEditorSections(stored)
  const ids = result.map((s) => s.id)
  expect(ids).toContain('otherTags')
  // Va en el grupo metadata, tras form y antes o junto a properties (posición por defecto).
  expect(ids.indexOf('otherTags')).toBeGreaterThan(ids.indexOf('form'))
})
```

Si no hay fichero de test para `editorSections`, crear `apps/desktop/src/shared/editorSections.test.ts` con ese `it` y el import de `normalizeEditorSections`.

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm run test -w apps/desktop -- editorSections`
Expected: FAIL — `otherTags` no es un id conocido, se filtra.

- [ ] **Step 3: Registrar el id, el grupo y el default**

En `apps/desktop/src/shared/editorSections.ts`:

1. En `EDITOR_SECTION_IDS`, añadir `'otherTags'` tras `'form'`:
```ts
export const EDITOR_SECTION_IDS = [
  'form',
  'otherTags',
  'properties',
  'quality',
  'output',
  'trim',
  'declick',
  'normalize',
] as const
```

2. En `EDITOR_SECTION_GROUP`, añadir:
```ts
  form: 'metadata',
  otherTags: 'metadata',
  properties: 'metadata',
```

3. En `DEFAULT_EDITOR_SECTIONS`, añadir tras `{ id: 'form', open: true }`:
```ts
  { id: 'form', open: true },
  // The third-party tags the app doesn't manage — folded by default, and it renders
  // nothing when the track carries none, so it stays out of the way until it applies.
  { id: 'otherTags', open: false },
  { id: 'properties', open: false },
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npm run test -w apps/desktop -- editorSections`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/editorSections.ts apps/desktop/src/shared/editorSections.test.ts
git commit -m "Registrar Other Metadata como sección del editor"
```

---

### Task 2: El inspector recibe open/onToggle por props

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ForeignTagsInspector.tsx` (quitar useState, añadir props)
- Test: `apps/desktop/src/renderer/src/components/ForeignTagsInspector.test.tsx`

**Interfaces:**
- Produces: `ForeignTagsInspector` con props `{ foreignTags, foreignRemoved, onRemove, open, onToggle }`.

- [ ] **Step 1: Actualizar los tests a las props nuevas (fase roja)**

En `ForeignTagsInspector.test.tsx`, cada `render(<ForeignTagsInspector ... />)` debe pasar `open` y `onToggle`. Los tests que abren la lista clicando el header ahora controlan `open` por prop. Reescribe los tests para el nuevo contrato:

```tsx
it('no se muestra cuando no hay tags foráneos', () => {
  render(
    <ForeignTagsInspector foreignTags={[]} foreignRemoved={[]} onRemove={vi.fn()} open={false} onToggle={vi.fn()} />,
  )
  expect(screen.queryByTestId('foreign-tags-toggle')).toBeNull()
})

it('muestra el conteo en el summary de la cabecera', () => {
  render(
    <ForeignTagsInspector
      foreignTags={[{ name: 'SERATO_MARKERS_V2', value: 'x' }, { name: 'TRAKTOR4', value: 'y' }]}
      foreignRemoved={[]}
      onRemove={vi.fn()}
      open={false}
      onToggle={vi.fn()}
    />,
  )
  expect(screen.getByTestId('foreign-tags-summary')).toHaveTextContent('2')
})

it('llama onToggle al pulsar la cabecera', () => {
  const onToggle = vi.fn()
  render(
    <ForeignTagsInspector
      foreignTags={[{ name: 'SERATO_MARKERS_V2', value: 'x' }]}
      foreignRemoved={[]}
      onRemove={vi.fn()}
      open={false}
      onToggle={onToggle}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Other metadata' }))
  expect(onToggle).toHaveBeenCalled()
})

it('lista los foráneos cuando open y permite borrar uno', () => {
  const onRemove = vi.fn()
  render(
    <ForeignTagsInspector
      foreignTags={[{ name: 'SERATO_MARKERS_V2', value: 'x' }]}
      foreignRemoved={[]}
      onRemove={onRemove}
      open={true}
      onToggle={vi.fn()}
    />,
  )
  expect(screen.getByTestId('foreign-tags-list')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('foreign-tag-remove'))
  expect(onRemove).toHaveBeenCalledWith('SERATO_MARKERS_V2')
})

it('da al botón de borrar un nombre accesible con acción y tag', () => {
  render(
    <ForeignTagsInspector
      foreignTags={[{ name: 'SERATO_MARKERS_V2', value: 'x' }]}
      foreignRemoved={[]}
      onRemove={vi.fn()}
      open={true}
      onToggle={vi.fn()}
    />,
  )
  expect(screen.getByTestId('foreign-tag-remove')).toHaveAccessibleName('Remove SERATO_MARKERS_V2')
})

it('muestra tachado un tag ya en foreignRemoved', () => {
  render(
    <ForeignTagsInspector
      foreignTags={[{ name: 'TRAKTOR4', value: 'y' }]}
      foreignRemoved={['TRAKTOR4']}
      onRemove={vi.fn()}
      open={true}
      onToggle={vi.fn()}
    />,
  )
  expect(screen.getByTestId('foreign-tag-row')).toHaveAttribute('data-removed', 'true')
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/desktop -- ForeignTagsInspector`
Expected: FAIL — el componente aún usa `useState` y no acepta `open`/`onToggle` (TS o el test de onToggle fallan).

- [ ] **Step 3: Cambiar el componente a props**

En `ForeignTagsInspector.tsx`: quitar `import { useState }` y `const [open, setOpen] = useState(false)`. Añadir `open` y `onToggle` a la interfaz y a los parámetros. El `SectionHeader` usa `open={open}` y `onToggle={onToggle}`:

```tsx
interface ForeignTagsInspectorProps {
  foreignTags: ForeignTag[]
  foreignRemoved: string[]
  onRemove: (name: string) => void
  open: boolean
  onToggle: () => void
}

export function ForeignTagsInspector({
  foreignTags,
  foreignRemoved,
  onRemove,
  open,
  onToggle,
}: ForeignTagsInspectorProps): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  if (foreignTags.length === 0) return null

  return (
    <div
      data-testid="foreign-tags-toggle"
      className="mt-5 border-t border-[var(--color-line)] pt-5"
    >
      <SectionHeader
        title={tr('editor.otherTagsTitle')}
        open={open}
        onToggle={onToggle}
        summary={tr('editor.otherTagsSummary', { count: foreignTags.length })}
        summaryTestId="foreign-tags-summary"
      />
      {/* ...resto igual (SectionBody + lista de tarjetas), sin cambios... */}
```

(El resto del cuerpo — SectionBody, la lista de tarjetas, la X — queda idéntico.)

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm run test -w apps/desktop -- ForeignTagsInspector`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/ForeignTagsInspector.tsx apps/desktop/src/renderer/src/components/ForeignTagsInspector.test.tsx
git commit -m "El inspector de otros metadatos recibe su plegado por props"
```

---

### Task 3: Renderizar la sección en el editor

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx` (nuevo `case 'otherTags'`; quitar el render atado al formulario, líneas ~951-963)
- Test: `apps/desktop/src/renderer/src/components/Editor.test.tsx`

**Interfaces:**
- Consumes: `ForeignTagsInspector` con `open`/`onToggle` (Task 2), el registro (Task 1).

**NOTA de contexto:** El bucle de secciones (Editor.tsx ~975) filtra `s.id !== 'form' && s.hidden !== true` y hace `switch (id)`. Cada case devuelve un elemento condicional con `key={id}`, `open`, `onToggle` = `setSectionOpen('<id>', !<x>Open)`. El estado por sección viene de `useEditorSections` (`sectionOpen.otherTags` existe automáticamente porque el id está en el registro).

- [ ] **Step 1: Escribir los tests que fallan**

En `Editor.test.tsx`, añadir (junto a los tests de secciones):

```tsx
it('renderiza Other Metadata como sección cuando el track tiene foráneos', () => {
  renderEditor(
    { id: 'a', foreignTags: [{ name: 'SERATO_MARKERS_V2', value: 'x' }] },
    'wav',
    {
      editorSections: [
        { id: 'form', open: true },
        { id: 'otherTags', open: false },
        { id: 'properties', open: false },
        { id: 'quality', open: false },
        { id: 'normalize', open: false },
        { id: 'output', open: false },
      ],
    },
  )
  expect(screen.getByTestId('foreign-tags-toggle')).toBeInTheDocument()
})

it('no renderiza Other Metadata cuando el track no tiene foráneos', () => {
  renderEditor({ id: 'a', foreignTags: [] }, 'wav', {
    editorSections: [
      { id: 'form', open: true },
      { id: 'otherTags', open: false },
      { id: 'properties', open: false },
      { id: 'quality', open: false },
      { id: 'normalize', open: false },
      { id: 'output', open: false },
    ],
  })
  expect(screen.queryByTestId('foreign-tags-toggle')).not.toBeInTheDocument()
})

it('no renderiza Other Metadata cuando la sección está oculta', () => {
  renderEditor(
    { id: 'a', foreignTags: [{ name: 'SERATO_MARKERS_V2', value: 'x' }] },
    'wav',
    {
      editorSections: [
        { id: 'form', open: true },
        { id: 'otherTags', open: false, hidden: true },
        { id: 'properties', open: false },
        { id: 'quality', open: false },
        { id: 'normalize', open: false },
        { id: 'output', open: false },
      ],
    },
  )
  expect(screen.queryByTestId('foreign-tags-toggle')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `npm run test -w apps/desktop -- Editor -t "Other Metadata"`
Expected: FAIL — no hay `case 'otherTags'`; el inspector se renderiza en su sitio viejo (dentro de la sección form), así que el primer test podría pasar por el motivo equivocado y el de "oculto" falla. Verificar que el de "oculto" falla.

- [ ] **Step 3: Añadir el `case 'otherTags'` y quitar el render viejo**

En `Editor.tsx`, dentro del `switch (id)` (junto a `case 'properties'`), añadir:

```tsx
                    case 'otherTags':
                      // Only single-track, and only when the track actually carries foreign
                      // tags — the inspector returns null otherwise, so an empty section never
                      // shows. Its fold state lives in the section store like the others.
                      return (
                        !isMulti && (
                          <ForeignTagsInspector
                            key={id}
                            foreignTags={item.foreignTags ?? []}
                            foreignRemoved={item.foreignRemoved ?? []}
                            onRemove={(name) => {
                              const current = item.foreignRemoved ?? []
                              if (!current.includes(name))
                                onChange({ foreignRemoved: [...current, name] })
                            }}
                            open={sectionOpen.otherTags}
                            onToggle={() => setSectionOpen('otherTags', !sectionOpen.otherTags)}
                          />
                        )
                      )
```

Y **eliminar** el bloque viejo (Editor.tsx:951-963), el `{formOpen && !isMulti && <ForeignTagsInspector .../>}` que iba tras `</SectionBody>`. Ajustar el import de `ForeignTagsInspector` si queda sin usar en el sitio viejo (sigue usándose en el case, así que el import se mantiene).

NOTA: `sectionOpen` y `setSectionOpen` ya están en scope (se usan por las otras secciones, p.ej. `propertiesOpen = sectionOpen.properties`). Usa `sectionOpen.otherTags` directamente.

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `npm run test -w apps/desktop -- Editor`
Expected: PASS (los 3 nuevos + los existentes). DOS tests previos contradicen ahora el nuevo comportamiento y deben ELIMINARSE (el comportamiento cambió a propósito: el plegado de otherTags es independiente del de `form`):
- `Editor.test.tsx:1331` `'hides the other-metadata inspector while the form is folded'` — ya no es cierto: plegar `form` NO oculta otherTags. Eliminar.
- `Editor.test.tsx:1350` `'shows the other-metadata inspector while the form is open'` — afirmaba el acoplamiento inverso; su intención (el inspector aparece con foráneos) la cubre el test nuevo `'renderiza Other Metadata como sección cuando el track tiene foráneos'`. Eliminar.
Documentar la eliminación en el informe (no son tests que rompemos gratis: codificaban el acoplamiento viejo que este cambio deshace a propósito).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/Editor.tsx apps/desktop/src/renderer/src/components/Editor.test.tsx
git commit -m "Renderizar Other Metadata como sección propia del editor"
```

---

### Task 4: Nombre en Settings → Editor

**Files:**
- Modify: `apps/desktop/src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json` (clave `settings.sections.otherTags`)
- Test: `apps/desktop/src/renderer/src/components/settings/EditorTab.test.tsx` (si existe)

**Interfaces:**
- Consumes: `settings.sections.<id>` es cómo EditorTab nombra cada sección (EditorTab.tsx:186).

- [ ] **Step 1: Escribir el test que falla (si hay test de EditorTab)**

Si existe `EditorTab.test.tsx`, añadir un test de que la lista de secciones incluye "Other metadata". Si no existe test del componente, saltar al Step 3 (el nombre es puramente i18n y se verifica visualmente + por el render de la lista, que ya itera `editorSections`).

```tsx
it('lista Other Metadata entre las secciones', () => {
  // render EditorTab con las settings por defecto (que ya incluyen otherTags tras Task 1)
  expect(screen.getByText('Other metadata')).toBeInTheDocument()
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/desktop -- EditorTab`
Expected: FAIL — falta la clave, `tr('settings.sections.otherTags')` devuelve la clave cruda.

- [ ] **Step 3: Añadir la clave i18n en los 5 locales**

En cada locale, en el bloque `settings.sections` (junto a `form`, `properties`…), añadir `otherTags`:
- en: `"otherTags": "Other metadata"`
- es: `"otherTags": "Otros metadatos"`
- de: `"otherTags": "Weitere Metadaten"`
- fr: `"otherTags": "Autres métadonnées"`
- pt-BR: `"otherTags": "Outros metadados"`

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm run test -w apps/desktop -- EditorTab` (o la suite completa si no hay test del componente)
Expected: PASS.

- [ ] **Step 5: Verificación visual (coordinador)**

El coordinador arranca la app (skill run-desktop), y confirma: (a) con el WAV de prueba, "OTHER METADATA" aparece como sección propia en el grupo metadata; (b) plegar la sección Metadata NO oculta Other Metadata (plegado independiente); (c) en Settings → Editor, "Other metadata" aparece en la lista y se puede ocultar; (d) al ocultarla, desaparece del editor; (e) con un track sin foráneos, no aparece.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/i18n/locales/
git commit -m "Nombrar la sección Other Metadata en Settings"
```

---

## Self-Review

**Cobertura del spec:**
- §1 Registro (ids, grupo, defaults) → Task 1 ✓
- §2 Render en el switch + quitar el viejo → Task 3 ✓
- §3 open/onToggle por props → Task 2 ✓
- §4 Solo si hay foráneos → Task 3 (el `!isMulti &&` + el `null` del inspector) ✓
- §5 i18n Settings (`settings.sections.otherTags`) → Task 4 ✓
- Testing (normalize, render condicional, oculta, props, Settings) → repartido ✓

**Placeholders:** ninguno — código completo. Task 4 Step 1 condiciona el test a que exista EditorTab.test; si no, el i18n se cubre por el render de la lista. Task 3 Step 4 avisa de actualizar el test de plegado previo (comportamiento cambiado a propósito).

**Consistencia:** id `otherTags` en los 3 registros de editorSections. `ForeignTagsInspectorProps` gana `open`/`onToggle`. `case 'otherTags'` usa `sectionOpen.otherTags`/`setSectionOpen('otherTags', ...)`. Clave `settings.sections.otherTags`. Testids del inspector sin cambios.
