# Inspector "Other metadata" con estilo Properties — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar `ForeignTagsInspector` para que use el lenguaje visual de la sección Properties (aire arriba, SectionHeader con título en mayúsculas + digest, filas en tarjeta), manteniendo su ubicación fija y su funcionalidad (ver + borrar).

**Architecture:** Reescritura del componente `ForeignTagsInspector.tsx` reutilizando `SectionHeader` y `SectionBody` (los mismos que Properties) y el estilo de tarjeta de `PropertiesReadout` (grid con `gap-px` sobre fondo `--color-line`, filas `bg-[var(--color-field)]`). El estado de plegado propio (`open`) se conserva. Cambios de i18n en 5 locales.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Vitest + Testing Library, react-i18next, lucide-react.

## Global Constraints

- Tests con Vitest: `npm run test -w apps/desktop -- <patrón>`.
- data-testid obligatorio. Conservar: `foreign-tags-toggle`, `foreign-tags-list`, `foreign-tag-remove`, `foreign-tag-row`, y el atributo `data-removed` en cada fila.
- Tokens de color existentes (`--color-line`, `--color-field`, `text-fg-dim`, `text-fg-muted`, `--color-panel-2`, `--color-accent`), no inventar.
- i18n en los 5 locales: es/en/de/fr/pt-BR (`apps/desktop/src/renderer/src/i18n/locales/`).
- Comportamiento sin cambios: solo pista única, atado a formOpen (ya en Editor.tsx), retorna null sin foráneos, ver + borrar individual. Sin editar/añadir.
- Comentarios densos como el fichero, en inglés (convención del repo). Commit: título descriptivo, sin body, sin prefijos.
- Fuera de alcance: sección configurable del sistema, editar valores, grid de 2 columnas.

---

### Task 1: Rediseñar ForeignTagsInspector con el estilo Properties

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ForeignTagsInspector.tsx` (reescritura del render)
- Modify: `apps/desktop/src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json`
- Test: `apps/desktop/src/renderer/src/components/ForeignTagsInspector.test.tsx`

**Interfaces:**
- Consumes: `SectionHeader` (`{ title, open, onToggle, summary?, summaryTestId? }`) y `SectionBody` (`{ open, children }`), ambos en `./`. Props del componente sin cambios (`foreignTags`, `foreignRemoved`, `onRemove`).
- Produces: mismo componente, nuevo DOM.

- [ ] **Step 1: Actualizar los tests al nuevo DOM (fase roja)**

Los 3 tests existentes en `ForeignTagsInspector.test.tsx` clican `foreign-tags-toggle` y afirman la lista. El nuevo DOM sigue teniendo esos testids (el `foreign-tags-toggle` pasa a ser el botón del SectionHeader). Añade además un test del nuevo digest/título. Reemplaza el `describe` por:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ForeignTagsInspector } from './ForeignTagsInspector'

describe('ForeignTagsInspector', () => {
  it('no se muestra cuando no hay tags foráneos', () => {
    render(<ForeignTagsInspector foreignTags={[]} foreignRemoved={[]} onRemove={vi.fn()} />)
    expect(screen.queryByTestId('foreign-tags-toggle')).toBeNull()
  })

  it('muestra el conteo en el summary de la cabecera', () => {
    render(
      <ForeignTagsInspector
        foreignTags={[
          { name: 'SERATO_MARKERS_V2', value: 'x' },
          { name: 'TRAKTOR4', value: 'y' },
        ]}
        foreignRemoved={[]}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.getByTestId('foreign-tags-summary')).toHaveTextContent('2')
  })

  it('lista los foráneos al abrir el toggle y permite borrar uno', () => {
    const onRemove = vi.fn()
    render(
      <ForeignTagsInspector
        foreignTags={[{ name: 'SERATO_MARKERS_V2', value: 'x' }]}
        foreignRemoved={[]}
        onRemove={onRemove}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Other metadata' }))
    expect(screen.getByTestId('foreign-tags-list')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('foreign-tag-remove'))
    expect(onRemove).toHaveBeenCalledWith('SERATO_MARKERS_V2')
  })

  it('muestra tachado un tag ya en foreignRemoved', () => {
    render(
      <ForeignTagsInspector
        foreignTags={[{ name: 'TRAKTOR4', value: 'y' }]}
        foreignRemoved={['TRAKTOR4']}
        onRemove={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Other metadata' }))
    expect(screen.getByTestId('foreign-tag-row')).toHaveAttribute('data-removed', 'true')
  })
})
```

NOTA: el `SectionHeader`'s toggle button lleva `aria-label={title}`, así que se localiza por rol con el nombre = título ("Other metadata" en inglés, el idioma por defecto de los tests). Esto evita depender de un testid en un elemento que no lo expone.

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `npm run test -w apps/desktop -- ForeignTagsInspector`
Expected: FAIL — no existe `foreign-tags-summary` (el resto puede pasar aún).

- [ ] **Step 3: Añadir las claves i18n**

En cada locale, bajo `editor`: **eliminar** `otherTags` y **añadir** `otherTagsTitle` y `otherTagsSummary`.

`en.json`:
```json
    "otherTagsTitle": "Other metadata",
    "otherTagsSummary": "{{count}} tags",
```
`es.json`:
```json
    "otherTagsTitle": "Otros metadatos",
    "otherTagsSummary": "{{count}} etiquetas",
```
`de.json`:
```json
    "otherTagsTitle": "Weitere Metadaten",
    "otherTagsSummary": "{{count}} Tags",
```
`fr.json`:
```json
    "otherTagsTitle": "Autres métadonnées",
    "otherTagsSummary": "{{count}} tags",
```
`pt-BR.json`:
```json
    "otherTagsTitle": "Outros metadados",
    "otherTagsSummary": "{{count}} tags",
```

Verifica con `grep -rn '"otherTags"' apps/desktop/src` que `otherTags` (el viejo, con count) ya no tiene referencias antes de darlo por eliminado.

- [ ] **Step 4: Reescribir el componente**

Reemplaza el `return` de `ForeignTagsInspector.tsx` (líneas 24-71) por la versión con SectionHeader + SectionBody + filas en tarjeta. El contenedor gana `mt-5 border-t pt-5` (el aire de Properties). El SectionHeader lleva `title` = `otherTagsTitle`, `summary` = `otherTagsSummary` con count, `summaryTestId="foreign-tags-summary"`, y su `data-testid="foreign-tags-toggle"` debe seguir existiendo — como `SectionHeader` no acepta un testid en su botón, se envuelve o se le da vía un wrapper. Usa este código:

```tsx
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ForeignTag } from '../../../shared/types'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { X } from 'lucide-react'

interface ForeignTagsInspectorProps {
  foreignTags: ForeignTag[]
  foreignRemoved: string[]
  onRemove: (name: string) => void
}

// Renders nowhere when there's nothing foreign to show — most files carry no third-party
// tags, so this stays out of the way until it does. Adopts the Properties section's look
// (spacing, header, carded rows) so the two read as one system; kept fixed under the
// metadata form (folds with it) rather than being a configurable section of its own.
export function ForeignTagsInspector({
  foreignTags,
  foreignRemoved,
  onRemove,
}: ForeignTagsInspectorProps): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  if (foreignTags.length === 0) return null

  return (
    <div
      data-testid="foreign-tags-toggle"
      className="mt-5 border-t border-[var(--color-line)] pt-5"
    >
      <SectionHeader
        title={tr('editor.otherTagsTitle')}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        summary={tr('editor.otherTagsSummary', { count: foreignTags.length })}
        summaryTestId="foreign-tags-summary"
      />
      <SectionBody open={open}>
        {/* Carded rows like PropertiesReadout: 1px gaps over the line-coloured backing draw
            the separators without per-row borders. One column (not two): a foreign value can
            be a long base64 blob that a half-width cell would clip. */}
        <ul
          data-testid="foreign-tags-list"
          className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-lg bg-[var(--color-line)]"
        >
          {foreignTags.map((tag) => {
            const removed = foreignRemoved.includes(tag.name)
            return (
              <li
                key={tag.name}
                data-testid="foreign-tag-row"
                data-removed={removed}
                className="group flex items-center gap-3 bg-[var(--color-field)] px-3 py-2"
              >
                <span
                  className={`shrink-0 font-mono text-[11px] ${removed ? 'text-fg-muted line-through opacity-60' : 'text-fg-dim'}`}
                >
                  {tag.name}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-right font-mono text-[11px] ${removed ? 'text-fg-muted line-through opacity-60' : 'text-fg'}`}
                >
                  {tag.value}
                </span>
                {/* X appears on hover — always-on would put an X on every row and clutter the
                    card. The row is a group so hover on any part reveals it. */}
                <button
                  type="button"
                  data-testid="foreign-tag-remove"
                  aria-label={tag.name}
                  onClick={() => onRemove(tag.name)}
                  className="press flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-muted opacity-0 transition-opacity hover:bg-[var(--color-panel-2)] hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      </SectionBody>
    </div>
  )
}
```

NOTA sobre testids: el wrapper `<div data-testid="foreign-tags-toggle">` NO lleva `onClick`
(evita el doble-toggle) — es solo el ancla del testid para el test "no se muestra"
(`queryByTestId('foreign-tags-toggle')` es null sin foráneos). El plegado lo hace el botón
del SectionHeader (`onToggle`), que los tests clican por rol (`getByRole('button', { name:
'Other metadata' })`). Así hay un único toggle y ningún click duplicado.

- [ ] **Step 5: Ejecutar los tests y verificar que pasan**

Run: `npm run test -w apps/desktop -- ForeignTagsInspector`
Expected: PASS los 4 tests. Si el doble-toggle rompe el test de abrir, aplica la resolución de la nota del Step 4.

- [ ] **Step 6: Typecheck y suite**

Run: `cd apps/desktop && npx tsc --build` (sin errores) y `npm run test -w apps/desktop` (suite completa verde — confirma que ningún test del Editor que dependa del inspector se rompe).

- [ ] **Step 7: Verificación visual (coordinador)**

El coordinador arranca la app (skill run-desktop), carga el WAV de prueba y confirma: (a) aire arriba correcto; (b) cabecera "OTHER METADATA" con conteo; (c) filas en tarjeta con la X al hover; (d) tachado al marcar. (El implementador NO arranca Electron — lo deja al coordinador.)

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/components/ForeignTagsInspector.tsx apps/desktop/src/renderer/src/components/ForeignTagsInspector.test.tsx apps/desktop/src/renderer/src/i18n/locales/
git commit -m "Rediseñar el inspector de otros metadatos con el estilo de Properties"
```

---

## Self-Review

**Cobertura del spec:**
- Aire arriba (mt-5 border-t pt-5) → Task 1 Step 4 ✓
- SectionHeader con título mayúsculas + digest de conteo → Step 4 (título) + Step 3 (i18n) ✓
- Filas en tarjeta estilo Properties, 1 columna → Step 4 ✓
- X al hover + tachado → Step 4 ✓
- Testids conservados + data-removed → Step 4, Step 1 (tests) ✓
- i18n: otherTagsTitle + otherTagsSummary, eliminar otherTags → Step 3 ✓
- Comportamiento sin cambios (null, plegado propio) → Step 4 ✓

**Placeholders:** ninguno — código completo. La única decisión abierta (doble-toggle del wrapper) tiene resolución explícita y criterio de aceptación en el Step 4.

**Consistencia:** testids `foreign-tags-toggle`, `foreign-tags-list`, `foreign-tag-remove`, `foreign-tag-row`, `foreign-tags-summary`, `data-removed`. Claves i18n `otherTagsTitle`/`otherTagsSummary`. SectionHeader/SectionBody con sus firmas verificadas.
