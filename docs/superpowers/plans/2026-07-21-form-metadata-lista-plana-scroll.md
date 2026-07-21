# Formulario de metadata: lista plana con scroll interno — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir las cuatro secciones plegables del formulario de metadata (Identity/Catalog/DJ/Order) por una lista plana que respeta el orden del usuario, acotada con un `max-height` fijo y scroll interno con fade inferior.

**Architecture:** `MetadataForm` deja de agrupar y plegar: renderiza los `fields` en el grid existente en el orden recibido, dentro de un contenedor con `max-height` fijo, `overflow-y-auto` y un fade inferior gobernado por el hook existente `useScrollAffordance`. El código muerto de agrupación (`groupFields`, `FieldGroupBucket`, `GROUP_ORDER`, `groupHeaderBefore`) se elimina; la agrupación conceptual (`FIELD_GROUPS`, `sortFieldsByGroup`, `groupOfField`, `FieldGroupId`) se conserva porque la usa el botón "Auto-organizar" de Settings → Fields.

**Tech Stack:** React 19 + TS, Tailwind v4, Vitest + Testing Library (jsdom). Runner: `node ../../node_modules/vitest/vitest.mjs run <file>` desde `apps/desktop`.

## Global Constraints

- Nunca añadir comentarios de código nuevos salvo los que ya existen en el estilo del archivo; este codebase documenta con comentarios densos y en inglés — al editar un archivo, respeta su densidad y idioma existentes.
- TDD estricto: red → green → refactor. Nunca saltar la fase roja.
- Selectores de test: `data-testid`.
- Un commit por funcionalidad, título descriptivo, sin cuerpo, sin prefijos `feat:`/`fix:`.
- Comandos de test (desde `apps/desktop/`):
  - Un archivo: `node ../../node_modules/vitest/vitest.mjs run <ruta>`
  - Build: `PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH" electron-vite build`
- Valor del `max-height`: **420px** (punto de partida; se afina al verlo en la app, ver Task 5).

---

### Task 1: Reescribir el test de `MetadataForm` a lista plana

Reemplaza las aserciones de grupos/plegado por las de una lista plana que muestra todos los fields en orden.

**Files:**
- Test: `apps/desktop/src/renderer/src/components/MetadataForm.test.tsx`

**Interfaces:**
- Consumes: `MetadataForm` (props ya existentes; sin cambios de firma).
- Produces: nada para tareas posteriores.

- [ ] **Step 1: Reescribir el bloque de tests**

Reemplazar `describe('MetadataForm groups', ...)` (líneas 48–66) por:

```tsx
describe('MetadataForm', () => {
  // The form is a flat list now: every shown field renders in the order it arrives
  // (the user's own field order), with no group headers or collapse toggles between
  // them. Grouping the fields into collapsible sections fought the user's manual
  // ordering — a field dragged across a group boundary snapped back — so it's gone.
  it('renders every field in the order received, with no group headers', () => {
    renderForm([spec('catalogNumber', 'C'), spec('title', 'X'), spec('bpm')])
    expect(screen.getByTestId('field-catalogNumber')).toBeInTheDocument()
    expect(screen.getByTestId('field-title')).toBeInTheDocument()
    expect(screen.getByTestId('field-bpm')).toBeInTheDocument()
    expect(screen.queryByTestId('field-group-catalog')).toBeNull()
    expect(screen.queryByTestId('field-group-body-identity')).toBeNull()
  })

  it('keeps the field order verbatim across group boundaries', () => {
    // catalogNumber (a Catalog field) placed between title and artist (Identity)
    // stays exactly where the user put it — no re-bucketing.
    renderForm([spec('title', 'X'), spec('catalogNumber', 'C'), spec('artist', 'A')])
    const nodes = screen.getAllByTestId(/^field-/)
    expect(nodes.map((n) => n.getAttribute('data-testid'))).toEqual([
      'field-title',
      'field-catalogNumber',
      'field-artist',
    ])
  })
})
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run (desde `apps/desktop/`): `node ../../node_modules/vitest/vitest.mjs run src/renderer/src/components/MetadataForm.test.tsx`
Expected: FAIL — el render actual produce `field-group-*` y no muestra los fields de grupos plegados (catalogNumber/bpm no están en el DOM).

- [ ] **Step 3: Commit del test rojo**

```bash
git add apps/desktop/src/renderer/src/components/MetadataForm.test.tsx
git commit -m "Test del formulario de metadata como lista plana en orden del usuario"
```

---

### Task 2: Implementar `MetadataForm` como lista plana con scroll acotado

Elimina `FieldGroup` y la agrupación; renderiza los fields en el grid dentro de un contenedor acotado con fade.

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/MetadataForm.tsx`

**Interfaces:**
- Consumes: `useScrollAffordance` de `../hooks/useScrollAffordance` → `{ ref: RefObject<HTMLDivElement|null>, moreBelow: boolean }`, acepta un array de dependencias.
- Produces: `MetadataForm` (misma firma de props).

- [ ] **Step 1: Sustituir imports y eliminar `FieldGroup`**

En `MetadataForm.tsx`:

Cambiar los imports superiores. Quitar `ChevronRight` (línea 1), `useState` (línea 3), `groupFields`/`FieldGroupBucket` (línea 7) y `SECTION_SUBHEAD` (línea 11). Añadir el hook. El bloque de imports queda:

```tsx
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { Release } from '../../../shared/types'
import { buildFieldSpecs, type FieldSpec } from '../lib/fieldSpecs'
import type { TrackItem } from '../types'
import { useScrollAffordance } from '../hooks/useScrollAffordance'
import { CoverPicker } from './CoverPicker'
import { Field } from './Field'
import { StarRating } from './StarRating'
```

(Mantener las re-exportaciones `export type { FieldSpec }` / `export { buildFieldSpecs }` y `renderField` tal cual.)

Eliminar por completo el componente `FieldGroup` (el comentario de las líneas 57–62 y la función 63–114).

- [ ] **Step 2: Reescribir el cuerpo del formulario**

Reemplazar el `return` de `MetadataForm` (la parte que mapea `groupFields`) por una lista plana acotada. Se clona el patrón de scroll+fade del modal de Settings (`SettingsModal.tsx:181-241`): un contenedor `relative` que envuelve el div con scroll (donde va el `ref` y `overflow-y-auto`) y, como hermano, el fade `absolute inset-x-0 bottom-0`. El bloque de la columna de fields (líneas 165–169) pasa a:

```tsx
        <div className="relative min-w-0 flex-1">
          <div
            ref={scrollRef}
            data-testid="metadata-fields"
            className="max-h-[420px] overflow-y-auto"
          >
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 @[26rem]:grid-cols-2">
              {fields.map((f) => (
                <div
                  key={f.key}
                  className={f.wide || f.key === 'compilation' ? '@[26rem]:col-span-2' : ''}
                >
                  {renderField(f)}
                </div>
              ))}
            </div>
          </div>
          {/* Fades the cut-off field into the panel while more sit below the fold,
              then clears at the very bottom — the same cue Settings' tabs use. */}
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--color-panel)] to-transparent transition-opacity duration-200 ${
              moreBelow ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </div>
```

Y al inicio del cuerpo de `MetadataForm` (justo después de `const { t: tr } = useTranslation()`), añadir:

```tsx
  const { ref: scrollRef, moreBelow } = useScrollAffordance([fields])
```

- [ ] **Step 3: Ejecutar los tests de `MetadataForm`**

Run: `node ../../node_modules/vitest/vitest.mjs run src/renderer/src/components/MetadataForm.test.tsx`
Expected: PASS (los dos tests de Task 1).

- [ ] **Step 4: Verificar tipos/compilación**

Run: `PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH" electron-vite build`
Expected: build OK, sin errores de TypeScript por imports no usados.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/MetadataForm.tsx
git commit -m "Renderizar el formulario de metadata como lista plana acotada con scroll y fade"
```

---

### Task 3: Adaptar `Editor.test.tsx` (quitar clics a cabeceras de grupo)

Dos tests abren grupos plegados con clics `field-group-*`; en la lista plana los fields ya están presentes.

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Editor.test.tsx:1105-1108`, `:2729-2730`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: nada.

- [ ] **Step 1: Quitar los clics en el test multi-track (líneas 1105–1108)**

Eliminar estas cuatro líneas (el comentario y los tres clics):

```tsx
    // Catalog/DJ/Order groups start collapsed — open them to reach their fields.
    fireEvent.click(screen.getByTestId('field-group-catalog'))
    fireEvent.click(screen.getByTestId('field-group-dj'))
    fireEvent.click(screen.getByTestId('field-group-order'))
```

El test queda saltando directo de `renderMulti({...})` a `expect(screen.getByTestId('field-composer'))...`.

- [ ] **Step 2: Quitar el clic en el test del menú de inserción (líneas 2729–2730)**

Eliminar estas dos líneas:

```tsx
    // publisher sits in the Catalog group, which starts collapsed — open it first.
    fireEvent.click(screen.getByTestId('field-group-catalog'))
```

El test queda saltando de `renderEditor({...})` a `expect(screen.getByTestId('field-insert-title'))...`.

- [ ] **Step 3: Ejecutar `Editor.test.tsx`**

Run: `node ../../node_modules/vitest/vitest.mjs run src/renderer/src/components/Editor.test.tsx`
Expected: PASS. (Si `fireEvent` queda sin usar en el archivo, cosa improbable dado su tamaño, quitar su import; solo si el runner lo marca.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/components/Editor.test.tsx
git commit -m "Ajustar los tests del Editor a la lista plana del formulario de metadata"
```

---

### Task 4: Eliminar el código muerto de agrupación en `fields.ts`

Quitar `groupFields`, `FieldGroupBucket`, `GROUP_ORDER` (ya sin consumidores fuera de tests) y `groupHeaderBefore` (muerto). Conservar `FIELD_GROUPS`, `groupOfField`, `sortFieldsByGroup`, `FieldGroupId`.

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/fields.ts`
- Modify: `apps/desktop/src/renderer/src/lib/fields.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `fields.ts` sin `groupFields`/`FieldGroupBucket`/`GROUP_ORDER`/`groupHeaderBefore`; el resto de exports intactos.

- [ ] **Step 1: Borrar los bloques de test de lo eliminado**

En `fields.test.ts`:
- Quitar `groupHeaderBefore` y `groupFields` del import superior (líneas 8–9).
- Eliminar el `describe('groupHeaderBefore', ...)` (líneas 146–168).
- Eliminar el `describe('groupFields', ...)` (líneas 179–199).

- [ ] **Step 2: Ejecutar el test para verificar que falla al compilar**

Run: `node ../../node_modules/vitest/vitest.mjs run src/renderer/src/lib/fields.test.ts`
Expected: FAIL o error de import — los símbolos aún se exportan pero los tests borrados ya no los referencian; el fallo real llega al borrar los exports en Step 3. (Este step deja el test verde tras borrar sus bloques; sirve de red para el paso siguiente.)

Nota: como aquí eliminamos código en vez de añadir comportamiento, la "fase roja" es la garantía de que ningún test superviviente dependía de los símbolos. Si el test pasa en verde tras el Step 1, es la señal correcta para proceder.

- [ ] **Step 3: Eliminar los símbolos muertos en `fields.ts`**

En `fields.ts`:
- Eliminar `GROUP_ORDER` (línea 65) y su comentario asociado (líneas 61–64).
- Eliminar `FieldGroupBucket` (líneas 67–70).
- Eliminar `groupFields` (comentario 72–75 y función 76–82).
- Eliminar `groupHeaderBefore` (comentario 100–103 y función 104–109).

Conservar intactos: `FieldGroupId` (39), `FieldGroup`/`FIELD_GROUPS` (41–54), `groupOfField` (56–59), `sortFieldsByGroup` (88–98).

- [ ] **Step 4: Ejecutar los tests de `fields.ts`**

Run: `node ../../node_modules/vitest/vitest.mjs run src/renderer/src/lib/fields.test.ts`
Expected: PASS.

- [ ] **Step 5: Build para confirmar que no quedan referencias**

Run: `PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH" electron-vite build`
Expected: build OK.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/fields.ts apps/desktop/src/renderer/src/lib/fields.test.ts
git commit -m "Eliminar la agrupación plegable muerta del formulario de metadata"
```

---

### Task 5: Retirar las claves i18n `fieldGroups.*` y afinar el alto en la app

Las etiquetas de sección ya no se renderizan; retirarlas de los seis locales. Verificar el resultado real y ajustar el `max-height` si hace falta.

**Files:**
- Modify: `apps/desktop/src/renderer/src/i18n/locales/{en,es,fr,de,pt-BR}.json` (y cualquier otro locale con la clave `fieldGroups`)
- Modify (posible): `apps/desktop/src/renderer/src/components/MetadataForm.tsx` (valor de `max-h-[420px]`)

**Interfaces:**
- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Localizar las claves**

Run: `grep -rln '"fieldGroups"' apps/desktop/src/renderer/src/i18n/locales`
Expected: lista de locales que contienen el bloque `fieldGroups`.

- [ ] **Step 2: Eliminar el bloque `fieldGroups` en cada locale listado**

En cada archivo, borrar el objeto `"fieldGroups": { ... }` completo (con su coma correspondiente para dejar JSON válido). No tocar `settings.autoOrganize*`.

- [ ] **Step 3: Verificar que ningún código referencia `fieldGroups.`**

Run: `grep -rn "fieldGroups\." apps/desktop/src --include='*.ts' --include='*.tsx'`
Expected: sin resultados (0 líneas).

- [ ] **Step 4: Build y suite completa**

Run: `PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH" electron-vite build`
Run: `node ../../node_modules/vitest/vitest.mjs run`
Expected: build OK y toda la suite en verde.

- [ ] **Step 5: Verificación visual en la app**

Levantar la app con la skill `run-desktop` (build + inyectar un track). Con los fields por defecto el formulario no debería mostrar scroll interno (cabe en 420px). Activar más fields en Settings → Fields hasta superar el alto y confirmar:
- aparece scroll interno dentro del formulario,
- el fade inferior se muestra cuando hay más abajo y desaparece al llegar al fondo,
- Audio Quality/Properties quedan visibles debajo sin recorrer todo el formulario.

Si 420px deja demasiado poco o demasiado formulario en pantallas normales, ajustar el `max-h-[Npx]` en `MetadataForm.tsx` y repetir.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/i18n/locales apps/desktop/src/renderer/src/components/MetadataForm.tsx
git commit -m "Retirar las etiquetas de sección del formulario y fijar el alto de la lista de metadata"
```

---

## Self-Review

**Cobertura del spec:**
- Lista plana que respeta el orden → Task 1 (test) + Task 2 (impl).
- `max-height` fijo + scroll interno + fade con `useScrollAffordance` → Task 2, afinado en Task 5.
- Eliminar `groupHeaderBefore` (muerto) → Task 4.
- Eliminar `groupFields`/`FieldGroupBucket`/`GROUP_ORDER` (sin consumidores) → Task 4.
- Conservar auto-organizar / `sortFieldsByGroup`/`FIELD_GROUPS` → verificado en Task 4 (no se tocan).
- Retirar i18n `fieldGroups.*` → Task 5.
- No persistir plegado, no UI de grupos en Settings, no subtítulos (opción C) → no aparecen en ninguna tarea (correcto, descartados por YAGNI).
- Consumidores de `Editor.test.tsx` que clicaban cabeceras → Task 3.

**Placeholder scan:** sin TBD/TODO. El único valor a validar (420px) está fijado con instrucción explícita de ajuste en Task 5, con código real en Task 2.

**Consistencia de tipos:** `useScrollAffordance([fields])` → `{ ref: scrollRef, moreBelow }`, atado a `ref={scrollRef}` y a la opacidad del fade. `data-testid="metadata-fields"` es nuevo; ningún test previo lo esperaba. Los `field-<name>` que asserta el test los produce el mock de `Field` (`data-testid={field-${name}}`), coherente con Task 1.
