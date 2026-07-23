# Chips adaptativos en una sola línea — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los chips de sugerencias de un campo (Genre, Grouping…) muestran tantos chips como quepan en el ancho real del contenedor — siempre en una sola línea — con el resto tras `+N`, en vez del corte fijo de 2.

**Architecture:** Una función pura `computeVisibleChips` (lib) decide el corte a partir de anchos medidos; un hook `useChipOverflow` mide con una fila oculta + `ResizeObserver`; `Field.tsx` consume el hook y pasa la fila colapsada a `flex-nowrap overflow-hidden`. Expandir con `+N` no cambia.

**Tech Stack:** React 19 + TS, Vitest (+jsdom en tests de componentes), Tailwind v4, Biome.

**Spec:** `docs/superpowers/specs/2026-07-23-chips-adaptativos-una-linea-design.md`

## Global Constraints

- Worktree: `/Users/vicent/code/surco/.claude/worktrees/chips-adaptativos` — todos los comandos desde `apps/desktop` dentro de él.
- Commits: título descriptivo en castellano, sin cuerpo, sin prefijos `feat:`/`fix:`.
- NO usar `npm run check` global (reformatea ~92 ficheros ajenos): verificar con `npx biome check <fichero>` por fichero y `npx tsc -p tsconfig.web.json --noEmit`.
- Los testids existentes (`chip-*`, `chip-more`, `field-suggestions`) y el aria-label `fields.suggestionsMore` se conservan; los chips de la fila de medición NO llevan testid (duplicaría los selectores).
- Comentarios: este repo documenta el PORQUÉ en comentarios densos (ver `Field.tsx`); seguir esa convención.
- Degradado sin medida fiable (jsdom / contenedor sin layout, ancho 0): todos los chips visibles, sin `+N`.
- Gap entre chips: `gap-1.5` = 6px. La constante del hook (`CHIP_GAP_PX = 6`) debe coincidir con la clase Tailwind de la fila.

---

### Task 1: Función pura `computeVisibleChips`

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/chipOverflow.ts`
- Test: `apps/desktop/src/renderer/src/lib/chipOverflow.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `computeVisibleChips(chipWidths: number[], moreChipWidth: number, containerWidth: number, gap: number): number` — nº de chips visibles. Task 2 la importa desde `../lib/chipOverflow`.

- [ ] **Step 1: Write the failing test**

Crear `apps/desktop/src/renderer/src/lib/chipOverflow.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeVisibleChips } from './chipOverflow'

// WHY: el corte de los chips de sugerencias dejó de ser fijo (SUGGESTION_PREVIEW=2) y pasó
// a medirse; toda la aritmética del corte vive aquí, sin DOM, para que el caso "+N salta
// a una segunda línea" no pueda volver por un error de cuentas.
describe('computeVisibleChips', () => {
  it('muestra todos los chips sin +N cuando caben', () => {
    // 50+6+50+6+50 = 162 ≤ 200
    expect(computeVisibleChips([50, 50, 50], 30, 200, 6)).toBe(3)
  })

  it('corta en el mayor prefijo que deja hueco al +N', () => {
    // total 338 > 260; k=2: 80+6+80+6+30 = 202 ≤ 260; k=3: 288 > 260
    expect(computeVisibleChips([80, 80, 80, 80], 30, 260, 6)).toBe(2)
  })

  it('cuenta el gap entre el último chip visible y el +N', () => {
    // k=2 necesita exactamente 80+6+80+6+30 = 202
    expect(computeVisibleChips([80, 80, 80], 30, 201, 6)).toBe(1)
    expect(computeVisibleChips([80, 80, 80], 30, 202, 6)).toBe(2)
  })

  it('nunca oculta todos: al menos 1 chip aunque desborde', () => {
    expect(computeVisibleChips([300, 100], 30, 100, 6)).toBe(1)
  })

  it('trata contenedor de ancho 0 como sin medida y muestra todo', () => {
    expect(computeVisibleChips([80, 80, 80], 30, 0, 6)).toBe(3)
  })

  it('devuelve 0 sin chips', () => {
    expect(computeVisibleChips([], 30, 200, 6)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vicent/code/surco/.claude/worktrees/chips-adaptativos/apps/desktop && npx vitest run src/renderer/src/lib/chipOverflow.test.ts`
Expected: FAIL — `Cannot find module './chipOverflow'` (o export inexistente).

- [ ] **Step 3: Write minimal implementation**

Crear `apps/desktop/src/renderer/src/lib/chipOverflow.ts`:

```ts
// El corte de la fila colapsada de chips de sugerencias: dados los anchos reales de cada
// chip, del chip "+N" y del contenedor, ¿cuántos chips caben en una sola línea dejando
// hueco para el "+N"? Pura para que la aritmética se testee sin layout; la medición DOM
// vive en useChipOverflow. Un contenedor de ancho 0 significa "sin medida fiable" (jsdom,
// aún sin layout), no un contenedor estrecho: ahí se muestra todo y no hay "+N".
export function computeVisibleChips(
  chipWidths: number[],
  moreChipWidth: number,
  containerWidth: number,
  gap: number,
): number {
  if (containerWidth <= 0) return chipWidths.length
  const total =
    chipWidths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, chipWidths.length - 1)
  if (total <= containerWidth) return chipWidths.length
  let sum = 0
  let fit = 0
  for (let i = 0; i < chipWidths.length; i++) {
    sum += chipWidths[i]
    if (sum + i * gap + gap + moreChipWidth <= containerWidth) fit = i + 1
  }
  return Math.max(1, fit)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/chipOverflow.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint + types**

Run: `npx biome check src/renderer/src/lib/chipOverflow.ts src/renderer/src/lib/chipOverflow.test.ts && npx tsc -p tsconfig.web.json --noEmit`
Expected: sin errores ni warnings.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/chipOverflow.ts src/renderer/src/lib/chipOverflow.test.ts
git commit -m "Calcular cuantos chips de sugerencias caben dejando hueco al +N"
```

---

### Task 2: Hook `useChipOverflow`

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/useChipOverflow.ts`
- Test: `apps/desktop/src/renderer/src/hooks/useChipOverflow.test.tsx`

**Interfaces:**
- Consumes: `computeVisibleChips` de `../lib/chipOverflow` (Task 1).
- Produces: `useChipOverflow(suggestions: string[], enabled: boolean): { containerRef: RefObject<HTMLSpanElement | null>; measureRef: RefObject<HTMLSpanElement | null>; visibleCount: number }`. Contrato para Task 3: `containerRef` va en la fila visible (de su `getBoundingClientRect().width` sale el ancho disponible); `measureRef` va en la fila oculta cuyos hijos son TODOS los chips y, como ÚLTIMO hijo, la sonda `+N`; con `enabled` false (expandido) devuelve `visibleCount = suggestions.length` y no mide.

- [ ] **Step 1: Write the failing test**

Crear `apps/desktop/src/renderer/src/hooks/useChipOverflow.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChipOverflow } from './useChipOverflow'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// jsdom no hace layout: todo getBoundingClientRect mide 0. Para ejercitar el corte real
// se inyectan medidas — el contenedor por su marca data-measure, cualquier otro elemento
// (los chips de la fila de medición) con un ancho fijo por chip.
function mockWidths(containerWidth: number, chipWidth: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.dataset.measure === 'container' ? containerWidth : chipWidth
    return {
      width,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    } as DOMRect
  })
}

function Harness({
  suggestions,
  enabled,
}: {
  suggestions: string[]
  enabled: boolean
}): React.JSX.Element {
  const { containerRef, measureRef, visibleCount } = useChipOverflow(suggestions, enabled)
  return (
    <span ref={containerRef} data-measure="container">
      <output data-testid="count">{visibleCount}</output>
      <span ref={measureRef}>
        {suggestions.map((s) => (
          <span key={s}>{s}</span>
        ))}
        <span>+{suggestions.length - 1}</span>
      </span>
    </span>
  )
}

// WHY: el hook es el puente entre el DOM medido y computeVisibleChips; estos tests fijan
// que mide lo que debe (hijos de la fila oculta, sonda +N aparte, ancho del contenedor)
// y que reacciona a los cambios que el ResizeObserver no cubre en jsdom.
describe('useChipOverflow', () => {
  it('corta según las medidas reales del contenedor y los chips', () => {
    // chips de 80, sonda +N de 80, contenedor 260: k=2 → 80+6+80+6+80 = 252 ≤ 260; k=3 → 338
    mockWidths(260, 80)
    render(<Harness suggestions={['a', 'b', 'c', 'd']} enabled />)
    expect(screen.getByTestId('count')).toHaveTextContent('2')
  })

  it('re-mide cuando cambian las sugerencias bajo un campo montado', () => {
    mockWidths(260, 80)
    const { rerender } = render(<Harness suggestions={['a', 'b', 'c', 'd']} enabled />)
    expect(screen.getByTestId('count')).toHaveTextContent('2')
    // Con 3 chips de 80 caben todos (80*3 + 6*2 = 252 ≤ 260): el corte desaparece.
    rerender(<Harness suggestions={['a', 'b', 'c']} enabled />)
    expect(screen.getByTestId('count')).toHaveTextContent('3')
  })

  it('sin medida fiable (ancho 0) muestra todos', () => {
    render(<Harness suggestions={['a', 'b', 'c', 'd']} enabled />)
    expect(screen.getByTestId('count')).toHaveTextContent('4')
  })

  it('deshabilitado (expandido) devuelve todos sin medir', () => {
    mockWidths(260, 80)
    render(<Harness suggestions={['a', 'b', 'c', 'd']} enabled={false} />)
    expect(screen.getByTestId('count')).toHaveTextContent('4')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/hooks/useChipOverflow.test.tsx`
Expected: FAIL — `Cannot find module './useChipOverflow'`.

- [ ] **Step 3: Write minimal implementation**

Crear `apps/desktop/src/renderer/src/hooks/useChipOverflow.ts`:

```ts
import { type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { computeVisibleChips } from '../lib/chipOverflow'

// gap-1.5 de la fila de chips, en px. Si la clase Tailwind cambia, esto debe cambiar con ella.
const CHIP_GAP_PX = 6

interface ChipOverflow {
  containerRef: RefObject<HTMLSpanElement | null>
  measureRef: RefObject<HTMLSpanElement | null>
  visibleCount: number
}

// Cuántos chips de sugerencias caben en la fila colapsada sin salirse de su línea. Una
// fila gemela oculta (measureRef) renderiza todos los chips más una sonda "+N" como último
// hijo; de ahí salen los anchos reales — exactos con cualquier fuente, padding o idioma —
// y computeVisibleChips decide el corte. Se re-mide antes del paint cuando cambian las
// sugerencias (un match de Discogs que llega tarde) y vía ResizeObserver cuando el
// contenedor cambia de ancho (redimensionar la ventana, plegar un panel). El observer va
// con guarda porque jsdom no lo implementa; ahí el contenedor mide 0 y el corte degrada a
// "todos visibles" — ningún chip desaparece por una medida que no existe. Con enabled
// false (fila expandida) no hay nada que cortar ni que medir.
export function useChipOverflow(suggestions: string[], enabled: boolean): ChipOverflow {
  const containerRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [visibleCount, setVisibleCount] = useState(suggestions.length)
  const key = suggestions.join(' ')
  useLayoutEffect(() => {
    if (!enabled) return
    function measure(): void {
      const container = containerRef.current
      const row = measureRef.current
      if (!container || !row) return
      const children = Array.from(row.children) as HTMLElement[]
      const probe = children.pop()
      setVisibleCount(
        computeVisibleChips(
          children.map((c) => c.getBoundingClientRect().width),
          probe?.getBoundingClientRect().width ?? 0,
          container.getBoundingClientRect().width,
          CHIP_GAP_PX,
        ),
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined' || !containerRef.current) return
    const ro = new ResizeObserver(measure)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [key, enabled])
  return { containerRef, measureRef, visibleCount: enabled ? visibleCount : suggestions.length }
}
```

Nota (biome): si `key` sin usar dentro del efecto dispara `useExhaustiveDependencies`, mantener la forma que biome acepte en este repo sin desactivar la regla — p. ej. dependencia `[suggestions.join(' '), enabled]` inline. No añadir `biome-ignore`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/hooks/useChipOverflow.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint + types**

Run: `npx biome check src/renderer/src/hooks/useChipOverflow.ts src/renderer/src/hooks/useChipOverflow.test.tsx && npx tsc -p tsconfig.web.json --noEmit`
Expected: sin errores ni warnings.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useChipOverflow.ts src/renderer/src/hooks/useChipOverflow.test.tsx
git commit -m "Medir con una fila oculta y ResizeObserver cuantos chips caben en la fila colapsada"
```

---

### Task 3: Integración en `Field.tsx`

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Field.tsx` (const línea 15-16, hook tras línea 59, bloque de chips líneas 190-229)
- Modify: `apps/desktop/src/renderer/src/components/Field.test.tsx` (describe `Field suggestion chips layout`, líneas 155-218)

**Interfaces:**
- Consumes: `useChipOverflow(suggestions, enabled)` de `../hooks/useChipOverflow` (Task 2).
- Produces: comportamiento visible final; sin API nueva.

- [ ] **Step 1: Write the failing tests**

En `Field.test.tsx`, sustituir el describe completo `Field suggestion chips layout` (líneas 155-218) por:

```tsx
// jsdom no hace layout: para ejercitar el corte medido se inyectan anchos — el contenedor
// de chips por su testid, cualquier otro elemento (chips reales y fila de medición) con un
// ancho fijo por chip.
function mockChipWidths(containerWidth: number, chipWidth: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.dataset.testid === 'field-suggestions' ? containerWidth : chipWidth
    return {
      width,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    } as DOMRect
  })
}

const FIVE = ['Electronic', 'asia records', 'eurobeat', 'happy music', 'italo dance']

// WHY: el corte fijo en 2 chips saltaba a una segunda línea en columnas estrechas y
// desperdiciaba hueco en las anchas; ahora el corte se mide. Colapsada, la fila es UNA
// línea siempre; cuántos chips enseña depende del ancho real.
describe('Field suggestion chips layout', () => {
  afterEach(() => vi.restoreAllMocks())

  it('la fila colapsada es una sola línea sin scroll horizontal', () => {
    render(<Field name="genre" label="Genre" value="" onChange={() => {}} suggestions={FIVE} />)
    const container = screen.getByTestId('field-suggestions')
    expect(container.className).toContain('flex-nowrap')
    expect(container.className).toContain('overflow-hidden')
    expect(container.className).not.toContain('overflow-x-auto')
  })

  it('corta donde el ancho manda y agrupa el resto en +N', () => {
    // chips de 80, contenedor 260: caben 2 + "+N" (80+6+80+6+80 = 252 ≤ 260)
    mockChipWidths(260, 80)
    render(<Field name="genre" label="Genre" value="" onChange={() => {}} suggestions={FIVE} />)
    expect(screen.getByTestId('chip-Electronic')).toBeInTheDocument()
    expect(screen.getByTestId('chip-asia records')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-eurobeat')).not.toBeInTheDocument()
    expect(screen.getByTestId('chip-more')).toHaveTextContent('+3')
  })

  it('con más ancho enseña más chips antes del +N', () => {
    // contenedor 400: k=3 → 240+12+6+80 = 338 ≤ 400; k=4 → 424 > 400
    mockChipWidths(400, 80)
    render(<Field name="genre" label="Genre" value="" onChange={() => {}} suggestions={FIVE} />)
    expect(screen.getByTestId('chip-eurobeat')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-happy music')).not.toBeInTheDocument()
    expect(screen.getByTestId('chip-more')).toHaveTextContent('+2')
  })

  it('despliega el resto en varias líneas al pulsar +N', () => {
    mockChipWidths(260, 80)
    render(<Field name="genre" label="Genre" value="" onChange={() => {}} suggestions={FIVE} />)
    fireEvent.click(screen.getByTestId('chip-more'))
    expect(screen.getByTestId('chip-happy music')).toBeInTheDocument()
    expect(screen.getByTestId('chip-italo dance')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-more')).not.toBeInTheDocument()
    expect(screen.getByTestId('field-suggestions').className).toContain('flex-wrap')
  })

  it('no muestra +N cuando todos caben', () => {
    mockChipWidths(1000, 80)
    render(<Field name="genre" label="Genre" value="" onChange={() => {}} suggestions={FIVE} />)
    expect(screen.getByTestId('chip-italo dance')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-more')).not.toBeInTheDocument()
  })

  it('sin medida fiable (jsdom sin mock) muestra todos y ningún +N', () => {
    render(<Field name="genre" label="Genre" value="" onChange={() => {}} suggestions={FIVE} />)
    expect(screen.getByTestId('chip-italo dance')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-more')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/renderer/src/components/Field.test.tsx`
Expected: FAIL — los 6 tests nuevos del describe de layout fallan (la fila sigue con `flex-wrap` y corte fijo en 2); el resto del fichero pasa.

- [ ] **Step 3: Implement in Field.tsx**

3a. Borrar la constante y su comentario (líneas 15-16):

```ts
// How many suggestion chips show before the rest collapse behind a "+N" chip.
const SUGGESTION_PREVIEW = 2
```

3b. Añadir el import:

```ts
import { useChipOverflow } from '../hooks/useChipOverflow'
```

3c. Tras el estado `chipsExpanded` (línea 59), llamar al hook:

```ts
const { containerRef, measureRef, visibleCount } = useChipOverflow(
  suggestions ?? [],
  !chipsExpanded && (suggestions?.length ?? 0) > 0,
)
```

3d. Sustituir el bloque de chips (líneas 190-229) por:

```tsx
{suggestions && suggestions.length > 0 && (
  <span
    ref={containerRef}
    data-testid="field-suggestions"
    // Colapsada, la fila es UNA línea pase lo que pase: nowrap + overflow-hidden, y el
    // corte medido (useChipOverflow) decide cuántos chips entran dejando hueco al "+N" —
    // el corte fijo de antes saltaba a una segunda línea en columnas estrechas y
    // desperdiciaba hueco en las anchas. Expandida vuelve al wrap multilínea.
    className={`relative mt-1.5 flex items-center gap-1.5 ${
      chipsExpanded ? 'flex-wrap' : 'flex-nowrap overflow-hidden'
    }`}
  >
    {(chipsExpanded ? suggestions : suggestions.slice(0, visibleCount)).map((s) => {
      const on = multiSuggestions ? csvHas(draft, s) : draft === s
      return (
        <button
          key={s}
          type="button"
          data-testid={`chip-${s}`}
          onClick={() => commit(multiSuggestions ? toggleCsv(draft, s) : on ? '' : s)}
          // Colapsado, el chip puede encoger y truncar con elipsis — solo pasa en el caso
          // mínimo-1 (ni un chip cabe entero); si el corte dice que cabe, no encoge nada.
          className={`press rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
            chipsExpanded ? 'shrink-0' : 'min-w-0 truncate'
          } ${
            on
              ? 'border-transparent bg-[var(--color-accent)] text-[var(--color-on-accent)]'
              : 'border-[var(--color-line-strong)] text-fg-muted hover:bg-[var(--color-panel-2)]'
          }`}
        >
          {s}
        </button>
      )
    })}
    {!chipsExpanded && suggestions.length > visibleCount && (
      <button
        type="button"
        data-testid="chip-more"
        onClick={() => setChipsExpanded(true)}
        aria-label={tr('fields.suggestionsMore', {
          count: suggestions.length - visibleCount,
        })}
        className="press shrink-0 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] px-2 py-0.5 text-[10px] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-panel-2)]"
      >
        +{suggestions.length - visibleCount}
      </button>
    )}
    {!chipsExpanded && (
      // Fila gemela de medición: todos los chips más la sonda "+N" (con el mayor resto
      // posible, el caso más ancho), invisible y fuera del flujo. Debe replicar las clases
      // de tamaño de los chips reales (borde, padding, fuente) o las medidas mienten.
      // Sin testids: duplicaría los selectores chip-* de los chips reales.
      <span
        ref={measureRef}
        aria-hidden="true"
        className="invisible absolute top-0 left-0 flex items-center gap-1.5 whitespace-nowrap"
      >
        {suggestions.map((s) => (
          <span key={s} className="rounded-full border px-2 py-0.5 text-[10px]">
            {s}
          </span>
        ))}
        <span className="rounded-full border px-2 py-0.5 text-[10px]">
          +{suggestions.length - 1}
        </span>
      </span>
    )}
  </span>
)}
```

- [ ] **Step 4: Run the Field tests**

Run: `npx vitest run src/renderer/src/components/Field.test.tsx`
Expected: PASS completo (committing, Enter, loading chip y los 6 de layout).

- [ ] **Step 5: Run the suites that consumen chips**

Run: `npx vitest run src/renderer/src/components/Editor.test.tsx src/renderer/src/components/MetadataForm.test.tsx`
Expected: PASS sin cambios — en jsdom el degradado muestra todos los chips, y esos tests clican chips por testid directo.

- [ ] **Step 6: Lint + types**

Run: `npx biome check src/renderer/src/components/Field.tsx src/renderer/src/components/Field.test.tsx && npx tsc -p tsconfig.web.json --noEmit`
Expected: sin errores ni warnings.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/Field.tsx src/renderer/src/components/Field.test.tsx
git commit -m "Adaptar los chips de sugerencias al ancho disponible en una sola linea"
```

---

### Task 4: Verificación final

**Files:** ninguno nuevo.

- [ ] **Step 1: Suite completa**

Run: `cd /Users/vicent/code/surco/.claude/worktrees/chips-adaptativos/apps/desktop && npx vitest run`
Expected: PASS — baseline era 3053 tests / 256 ficheros; ahora 256+2 ficheros y todos verdes.

- [ ] **Step 2: Verificación visual en la app real**

Usar la skill `run-desktop` para arrancar la app, cargar una pista con varias sugerencias en Genre/Grouping y capturar el formulario a dos anchos de ventana distintos: estrecho (los chips cortan antes, `+N` mayor, una sola línea) y ancho (entran más chips). Ojo: el smoke de run-desktop está roto en main desde 2026-07-23 (memoria del proyecto) — si el REPL no arranca, reportarlo y dejar la verificación visual como pendiente explícito, no silencioso.

- [ ] **Step 3: Cierre de la rama**

Usar la skill `superpowers:finishing-a-development-branch`. Preferencia conocida del usuario: merge local a main + limpieza del worktree, sin push (el push lo decide él).
