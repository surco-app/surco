# Foco de teclado visible y salto relativo entre columnas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer visible el foco de teclado en la columna de resultados de Discogs, y añadir `⌘←`/`⌘→` para saltar a la columna anterior/siguiente.

**Architecture:** Tres cambios independientes y pequeños. (1) Una función pura `nextColumn` en `keymap.ts`, junto a `moveIndex`, que resuelve la columna destino con tope en los extremos. (2) Dos comandos nuevos en el registro existente (`shortcutDefaults.ts` + `commands.ts` + 5 locales), que reutilizan los `focusList`/`focusMatches`/`focusEditor` que ya existen. (3) Clases de foco en los botones de `DiscogsPanel.tsx`, sin estado nuevo en React — el cursor sigue siendo el foco del DOM.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Vitest + Testing Library (jsdom), Electron. Sin dependencias nuevas.

## Global Constraints

- **Ejecutar vitest SIEMPRE desde `apps/desktop`**, nunca desde la raíz del monorepo: desde la raíz se salta el fichero de setup y da fallos falsos. Comando: `node ../../node_modules/vitest/vitest.mjs run <ruta>`.
- **No usar `npm test` ni `pnpm test`**: el prehook de instalación falla en este repo por los build scripts ignorados. Llamar al binario directamente, como arriba.
- **El repo usa `npm`**, no pnpm (pese a lo que diga la skill `run-desktop`).
- **CERO comentarios de código nuevos** salvo que expliquen un *porqué* no evidente, siguiendo el estilo del fichero (los ficheros de este repo comentan decisiones, no mecánica). Los comentarios incluidos abajo son parte del entregable: cópialos tal cual.
- **Sin `--no-verify` en ningún commit.**
- Los mensajes de commit son título descriptivo en inglés, sin cuerpo y sin prefijos `feat:`/`fix:`.
- Idiomas a mantener en paridad: `en`, `es`, `de`, `fr`, `pt-BR` en `src/renderer/src/i18n/locales/`.
- Todas las rutas de este plan son relativas a `apps/desktop/`.

---

### Task 1: `nextColumn`, la resolución pura de la columna destino

**Files:**
- Modify: `src/renderer/src/lib/keymap.ts` (añadir al final, tras `activeScope`)
- Test: `src/renderer/src/lib/keymap.test.ts` (añadir un `describe` al final)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export type Column = 'list' | 'matches' | 'editor'`
  - `export function nextColumn(current: Column | null, delta: 1 | -1): Column`
  - `export function columnOf(el: Element | null): Column | null`

`columnOf` lee el DOM igual que `activeScope` (y por la misma razón: no puede desincronizarse de lo que el usuario ve enfocado). Los selectores son los contenedores que ya existen: `[data-testid="sidebar"]` (`App.tsx:1577`) y `[data-shortcut-scope="editor"]` (`Editor.tsx:923`). La columna de resultados **no tiene contenedor identificable hoy** — se le añade `data-testid="matches-column"` en la Task 3, así que `columnOf` se escribe ya contra ese selector y su test lo simula.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `src/renderer/src/lib/keymap.test.ts`:

```ts
describe('nextColumn', () => {
  it('avanza y retrocede por el orden visual de las tres columnas', () => {
    expect(nextColumn('list', 1)).toBe('matches')
    expect(nextColumn('matches', 1)).toBe('editor')
    expect(nextColumn('editor', -1)).toBe('matches')
    expect(nextColumn('matches', -1)).toBe('list')
  })

  // Tope y no ciclo: dar la vuelta desde un extremo desorienta, porque el usuario
  // pierde la referencia de en qué lado de la ventana está.
  it('hace tope en los extremos en vez de dar la vuelta', () => {
    expect(nextColumn('list', -1)).toBe('list')
    expect(nextColumn('editor', 1)).toBe('editor')
  })

  it('entra por la lista cuando el foco no está en ninguna columna', () => {
    expect(nextColumn(null, 1)).toBe('list')
    expect(nextColumn(null, -1)).toBe('list')
  })
})

describe('columnOf', () => {
  function mount(html: string): HTMLElement {
    document.body.innerHTML = html
    return document.querySelector('[data-probe]') as HTMLElement
  }

  it('reconoce cada columna por su contenedor', () => {
    expect(columnOf(mount('<aside data-testid="sidebar"><b data-probe></b></aside>'))).toBe('list')
    expect(
      columnOf(mount('<div data-testid="matches-column"><b data-probe></b></div>')),
    ).toBe('matches')
    expect(
      columnOf(mount('<div data-shortcut-scope="editor"><b data-probe></b></div>')),
    ).toBe('editor')
  })

  it('devuelve null fuera de las tres columnas y sin elemento', () => {
    expect(columnOf(mount('<div><b data-probe></b></div>'))).toBeNull()
    expect(columnOf(null)).toBeNull()
  })
})
```

Añadir `columnOf` y `nextColumn` al import existente de `'./keymap'` en la cabecera del fichero (línea 5), que queda:

```ts
import {
  activeScope,
  columnOf,
  isTypingTarget,
  jumpIndex,
  keyToCommandId,
  moveIndex,
  nextColumn,
  pageSize,
} from './keymap'
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run src/renderer/src/lib/keymap.test.ts`
Expected: FAIL — `"columnOf" is not exported by ... keymap.ts`

- [ ] **Step 3: Implementar**

Añadir al final de `src/renderer/src/lib/keymap.ts`:

```ts
export type Column = 'list' | 'matches' | 'editor'

// El orden visual de las columnas en la ventana, que es el que recorren ⌘← y ⌘→.
const COLUMNS: Column[] = ['list', 'matches', 'editor']

// La columna que contiene un elemento, leída del DOM por la misma razón que `activeScope`:
// así no puede desincronizarse de lo que el usuario ve enfocado. Cada columna se reconoce
// por el contenedor que ya la delimita.
export function columnOf(el: Element | null): Column | null {
  if (!el?.closest) return null
  if (el.closest('[data-testid="sidebar"]')) return 'list'
  if (el.closest('[data-testid="matches-column"]')) return 'matches'
  if (el.closest('[data-shortcut-scope="editor"]')) return 'editor'
  return null
}

// Hace tope en los extremos en vez de dar la vuelta: saltar del editor a la lista de un
// golpe deja al usuario sin saber de qué lado de la ventana está. Sin columna de partida
// se entra por la lista, que es el principio del recorrido.
export function nextColumn(current: Column | null, delta: 1 | -1): Column {
  if (!current) return 'list'
  const i = COLUMNS.indexOf(current)
  return COLUMNS[Math.min(COLUMNS.length - 1, Math.max(0, i + delta))]
}
```

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run src/renderer/src/lib/keymap.test.ts`
Expected: PASS (todos los describes del fichero, no solo los nuevos)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/keymap.ts src/renderer/src/lib/keymap.test.ts
git commit -m "Add pure column resolution for relative keyboard jumps"
```

---

### Task 2: Los comandos `⌘←` / `⌘→`

**Files:**
- Modify: `src/shared/shortcutDefaults.ts:73-75` (añadir dos entradas tras `focus-editor`)
- Modify: `src/renderer/src/lib/commands.ts:533` (añadir dos comandos tras `focus-editor`)
- Modify: `src/renderer/src/App.tsx:1394` (añadir `focusColumn`, y pasarlo a `buildCommands`)
- Modify: `src/renderer/src/i18n/locales/{en,es,de,fr,pt-BR}.json:194` (dos claves nuevas)
- Test: `src/shared/shortcutDefaults.test.ts` (añadir un `describe` al final)

**Interfaces:**
- Consumes de Task 1: `nextColumn(current, delta)`, `columnOf(el)`, tipo `Column`.
- Produces: ids de comando `focus-column-prev` y `focus-column-next`. En `App.tsx`, la función local `focusColumn(delta: 1 | -1): void`.

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `src/shared/shortcutDefaults.test.ts`:

```ts
describe('saltos relativos de columna', () => {
  it('liga ⌘← y ⌘→ a los comandos de columna', () => {
    const b = resolveBindings()
    expect(b.get('focus-column-prev')).toEqual(['mod', 'left'])
    expect(b.get('focus-column-next')).toEqual(['mod', 'right'])
  })

  // Quedan mudos con un campo enfocado para no pisar inicio/fin de línea de macOS, que es
  // un reflejo muy arraigado y los campos del editor son de texto largo. La vía para salir
  // del editor escribiendo sigue siendo ⌘1/2/3, que sí siguen vivos a propósito.
  it('no dispara mientras se escribe', () => {
    const b = resolveBindings()
    expect(matchChord(b, ['mod', 'left'], false, null)).toBe('focus-column-prev')
    expect(matchChord(b, ['mod', 'left'], true, null)).toBeNull()
    expect(matchChord(b, ['mod', 'right'], true, null)).toBeNull()
  })

  it('no entra en conflicto con ningún otro atajo por defecto', () => {
    expect(findConflicts(resolveBindings())).toEqual([])
  })
})
```

Comprobar que la cabecera del fichero ya importa `resolveBindings`, `matchChord` y `findConflicts`; añadir los que falten al import existente de `'./shortcutDefaults'`.

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run src/shared/shortcutDefaults.test.ts`
Expected: FAIL — `expected undefined to deeply equal [ 'mod', 'left' ]`

- [ ] **Step 3: Declarar los atajos**

En `src/shared/shortcutDefaults.ts`, justo **después** de la línea `{ id: 'focus-editor', chord: ['mod', '3'] },` (:75), añadir:

```ts
  // Salto relativo a la columna de al lado, como alternativa a los saltos absolutos ⌘1/2/3.
  // A diferencia de ellos SÍ llevan guardián de tecleo: ⌘← y ⌘→ son inicio y fin de línea en
  // macOS, y los campos del editor son de texto largo. Escribiendo, la salida sigue siendo ⌘1/2/3.
  { id: 'focus-column-prev', chord: ['mod', 'left'], suppressWhileTyping: true },
  { id: 'focus-column-next', chord: ['mod', 'right'], suppressWhileTyping: true },
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run src/shared/shortcutDefaults.test.ts`
Expected: PASS

- [ ] **Step 5: Añadir las traducciones**

En cada locale, tras la línea `"focusEditor": ...` (:194), añadir dos claves:

`en.json`:
```json
    "focusColumnPrev": "Focus the previous column",
    "focusColumnNext": "Focus the next column",
```
`es.json`:
```json
    "focusColumnPrev": "Ir a la columna anterior",
    "focusColumnNext": "Ir a la columna siguiente",
```
`de.json`:
```json
    "focusColumnPrev": "Vorherige Spalte fokussieren",
    "focusColumnNext": "Nächste Spalte fokussieren",
```
`fr.json`:
```json
    "focusColumnPrev": "Aller à la colonne précédente",
    "focusColumnNext": "Aller à la colonne suivante",
```
`pt-BR.json`:
```json
    "focusColumnPrev": "Focar a coluna anterior",
    "focusColumnNext": "Focar a próxima coluna",
```

- [ ] **Step 6: Cablear el salto en App.tsx**

En `src/renderer/src/App.tsx`, justo después de `focusEditor` (:1393-1394), añadir:

```ts
  // El salto relativo se apoya en los tres saltos absolutos de arriba: resuelve a qué
  // columna toca ir mirando dónde está el foco ahora, y llama al que corresponda.
  const focusColumn = (delta: 1 | -1): void => {
    const to = nextColumn(columnOf(document.activeElement), delta)
    if (to === 'list') focusList()
    else if (to === 'matches') focusMatches()
    else focusEditor()
  }
```

Añadir `columnOf` y `nextColumn` al import de `./lib/keymap` en la cabecera de `App.tsx` (si el fichero no importa aún de ahí, crear el import: `import { columnOf, nextColumn } from './lib/keymap'`).

Pasar `focusColumn` a `buildCommands({...})` en la llamada de `App.tsx:1403`, junto a `focusList`/`focusMatches`/`focusEditor`.

- [ ] **Step 7: Registrar los comandos**

En `src/renderer/src/lib/commands.ts`, justo después del comando `focus-editor` (cierre en :533), añadir:

```ts
    {
      // Jump focus one column to the left / right of wherever it is now.
      id: 'focus-column-prev',
      group: 'navigate',
      title: tr('commands.focusColumnPrev'),
      hint: hintFor('focus-column-prev'),
      enabled: !!selected,
      run: () => focusColumn(-1),
    },
    {
      id: 'focus-column-next',
      group: 'navigate',
      title: tr('commands.focusColumnNext'),
      hint: hintFor('focus-column-next'),
      enabled: !!selected,
      run: () => focusColumn(1),
    },
```

Añadir `focusColumn: (delta: 1 | -1) => void` a la interfaz de parámetros de `buildCommands` (junto a los `focusList`/`focusMatches`/`focusEditor` que ya declara) y desestructurarlo igual que ellos.

- [ ] **Step 8: Verificar que compila y que la suite sigue verde**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run`
Expected: PASS, sin fallos nuevos.
Run: `cd apps/desktop && PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH" electron-vite build`
Expected: build sin errores de TypeScript.

- [ ] **Step 9: Commit**

```bash
git add src/shared/shortcutDefaults.ts src/shared/shortcutDefaults.test.ts \
        src/renderer/src/lib/commands.ts src/renderer/src/App.tsx \
        src/renderer/src/i18n/locales
git commit -m "Add relative column jumps on mod+left and mod+right"
```

---

### Task 3: El cursor de teclado visible en la columna de resultados

**Files:**
- Modify: `src/renderer/src/components/DiscogsPanel.tsx:175-178` (contenedor: añadir `data-testid="matches-column"`)
- Modify: `src/renderer/src/components/DiscogsPanel.tsx:330-334` (clases del botón de resultado)
- Modify: `src/renderer/src/components/DiscogsPanel.tsx` (clases del botón de pista, `discogs-track`, ~:425-481)
- Test: `src/renderer/src/components/DiscogsPanel.test.tsx` (añadir un `describe` al final)

**Interfaces:**
- Consumes de Task 1: el selector `[data-testid="matches-column"]` que `columnOf` espera encontrar. **Esta task es la que lo crea** — sin ella, `⌘←`/`⌘→` no reconocen la columna central.
- Produces: nada para tasks posteriores.

**Nota de implementación:** el botón NO usa `border` para su contorno, sino `shadow-[inset_0_0_0_1px_var(--color-line)]`. El cursor de foco debe sustituir esa sombra, no añadir un borde (que descuadraría la caja). Y se pinta con `focus:`, **no** `focus-visible:`: el `.focus()` programático de `⌘2` no dispara `:focus-visible` de forma fiable en Chromium, que es exactamente el bug que se está arreglando. Consecuencia aceptada y documentada en el spec: la tarjeta también queda marcada al llegar con el ratón.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `src/renderer/src/components/DiscogsPanel.test.tsx`, reutilizando el helper `browser()` que el fichero ya define. Usa dos resultados con `previewRelease` espiado:

```ts
describe('cursor de teclado', () => {
  const results = [
    { provider: 'discogs', id: 1, title: 'Uno', thumb: '' },
    { provider: 'discogs', id: 2, title: 'Dos', thumb: '' },
  ] as unknown as DiscogsBrowser['results']

  it('marca la columna para que los saltos ⌘←/⌘→ la reconozcan', () => {
    render(<DiscogsPanel {...props(browser({ results }))} />)
    expect(screen.getByTestId('matches-column')).toBeInTheDocument()
  })

  it('marca visiblemente la tarjeta enfocada', () => {
    render(<DiscogsPanel {...props(browser({ results }))} />)
    const first = screen.getAllByTestId('discogs-result')[0]
    first.focus()
    expect(first).toHaveFocus()
    expect(first.className).toContain('focus:bg-[var(--color-accent-soft)]')
  })

  // La garantía de la decisión "foco ≠ despliegue": moverse por los resultados no puede
  // abrir ninguno, porque cada despliegue dispara una query de release a Discogs y el
  // contenido saltaría bajo el cursor mientras navegas. Solo Enter despliega.
  it('mover el foco no despliega ninguna tarjeta', () => {
    const previewRelease = vi.fn()
    render(<DiscogsPanel {...props(browser({ results, previewRelease }))} />)
    const cards = screen.getAllByTestId('discogs-result')
    cards[0].focus()
    fireEvent.keyDown(cards[0], { key: 'ArrowDown' })
    expect(previewRelease).not.toHaveBeenCalled()
    for (const c of cards) expect(c).toHaveAttribute('aria-expanded', 'false')
  })
})
```

Notas para quien implemente el test:
- Añadir `fireEvent` al import de `@testing-library/react` de la cabecera.
- `props(...)` es el helper de props que el fichero ya usa en sus tests previos; si el fichero construye las props inline en cada test, seguir ese estilo en lugar de inventar un helper.
- El `keyDown` va sobre la tarjeta porque el handler está en el contenedor y el evento burbujea (`DiscogsPanel.tsx:269-273`).

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run src/renderer/src/components/DiscogsPanel.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="matches-column"]`

- [ ] **Step 3: Marcar el contenedor de la columna**

En `DiscogsPanel.tsx:175-178`, añadir el testid al div exterior:

```tsx
      <div
        data-testid="matches-column"
        style={{ width: discogs.width }}
        className="flex shrink-0 flex-col border-r border-[var(--color-line)]"
      >
```

- [ ] **Step 4: Pintar el cursor en la tarjeta de resultado**

En `DiscogsPanel.tsx:330-334`, sustituir el `className` del botón `discogs-result` por:

```tsx
                    className={`press result-in group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors focus:bg-[var(--color-accent-soft)] focus:shadow-[inset_0_0_0_1px_var(--color-accent)] focus:outline-none ${
                      expanded
                        ? 'bg-[var(--color-accent-soft)]/85'
                        : 'bg-[var(--color-panel)]/50 hover:bg-[var(--color-panel-2)]/85'
                    }`}
```

El cursor va con `focus:` (no `focus-visible:`) porque el `.focus()` programático de los saltos de columna no dispara `:focus-visible` de forma fiable. `focus:outline-none` sustituye el anillo genérico de `index.css` por esta marca, que es más legible sobre la tarjeta.

- [ ] **Step 5: Pintar el cursor en la pista desplegada**

Localizar el botón `data-testid="discogs-track"` (~:425-481) y añadir a su `className` los mismos tres utilitarios de foco, respetando lo que ya tenga:

```
focus:bg-[var(--color-accent-soft)] focus:shadow-[inset_0_0_0_1px_var(--color-accent)] focus:outline-none
```

- [ ] **Step 6: Ejecutar los tests y verificar que pasan**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run src/renderer/src/components/DiscogsPanel.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/DiscogsPanel.tsx src/renderer/src/components/DiscogsPanel.test.tsx
git commit -m "Show the keyboard cursor in the matches column"
```

---

### Task 4: Verificación en la app real

Los tests de jsdom no prueban lo que motivó esta feature: **que se vea**. Esta task lo comprueba sobre la app compilada, con captura.

**Files:**
- Ninguno que modificar. Si algo falla aquí, se corrige en la task correspondiente y se re-verifica.

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: una captura en `/tmp/surco-foco.png` para inspección visual.

- [ ] **Step 1: Compilar la app con los tres cambios**

Run: `cd apps/desktop && PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH" electron-vite build`
Expected: build sin errores.

- [ ] **Step 2: Comprobar que ⌘→ mueve el foco a la columna de resultados**

Run:
```bash
cd apps/desktop/.claude/skills/run-desktop && printf 'launch\ntone 5\nclick [data-testid="track-row"]\neval (()=>{const e=new KeyboardEvent("keydown",{key:"ArrowRight",code:"ArrowRight",metaKey:true,bubbles:true});window.dispatchEvent(e);return document.activeElement.getAttribute("data-testid")})()\nss foco\nquit\n' | node driver.mjs repl
```
Expected: la línea del `eval` imprime `"discogs-query"` (sin resultados de Discogs cargados, el salto cae en la caja de búsqueda, que es el comportamiento correcto de `focusMatches`).

- [ ] **Step 3: Comprobar que ⌘← vuelve a la lista y que hace tope**

Run:
```bash
cd apps/desktop/.claude/skills/run-desktop && printf 'launch\ntone 5\nclick [data-testid="track-row"]\neval (()=>{const k=(key)=>window.dispatchEvent(new KeyboardEvent("keydown",{key,code:key,metaKey:true,bubbles:true}));const t=()=>document.activeElement.getAttribute("data-testid");k("ArrowRight");const a=t();k("ArrowLeft");const b=t();k("ArrowLeft");return JSON.stringify({tras_derecha:a,tras_izquierda:b,tope:t()})})()\nquit\n' | node driver.mjs repl
```
Expected: `tras_izquierda` y `tope` son ambos `"track-row"` — el segundo ⌘← no se sale de la lista.

- [ ] **Step 4: Mirar la captura**

Abrir `/tmp/surco-foco.png` con la herramienta Read y confirmar a ojo que el elemento enfocado en la columna central se distingue. **Este paso es el criterio de aceptación de la feature**; si el foco no se distingue en la captura, volver a la Task 3.

- [ ] **Step 5: Ejecutar la suite completa**

Run: `cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run`
Expected: PASS, sin regresiones.

---

## Notas de verificación manual (para el usuario, no automatizables)

Con resultados reales de Discogs en pantalla (el tono sintético no los trae):

1. `⌘→` desde la lista → la **primera tarjeta** queda marcada, no la caja de búsqueda.
2. `↓`/`↑` mueven la marca **sin desplegar** ninguna tarjeta.
3. `Enter` despliega la tarjeta marcada.
4. Con el cursor dentro del campo *Title*, `⌘←` mueve el cursor de texto al inicio de la línea (comportamiento nativo de macOS conservado) y **no** cambia de columna.
5. Settings → Atajos lista las dos entradas nuevas bajo *Navegación*, y son reasignables.
