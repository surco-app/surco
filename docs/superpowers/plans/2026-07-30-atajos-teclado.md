# Atajos de teclado (editor de silencios + huecos de auditoría) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el editor de silencios se maneje con teclas sueltas configurables, y cerrar los dos huecos donde hoy no hay ningún camino de teclado (abrir el menú contextual de pista, y colocar el playhead en click-repair).

**Architecture:** Se añade un campo opcional `scope?: string` a `ShortcutDef`. Los 35 comandos actuales no lo declaran y siguen siendo globales — cero migración. `matchChord` recibe el ámbito activo, derivado del **foco real del DOM** (`closest('[data-shortcut-scope]')`), nunca de estado en React. Los comandos del trim no se registran en `lib/commands.ts` (necesitan el lado activo, que solo conoce el componente): `TrimSection` compara las bindings en su propio `onKeyDown`, apoyándose en el patrón `defaultPrevented` que `useKeyboardShortcuts.ts:38` ya respeta.

**Tech Stack:** React 19 + TypeScript + Vitest + Testing Library, monorepo npm. App Electron; el código de esta feature es todo del renderer más `apps/desktop/src/shared/`.

## Global Constraints

- **Tests:** ejecutar SIEMPRE desde `apps/desktop`, nunca desde la raíz (desde la raíz se salta el setup y da fallos falsos). Comando: `cd apps/desktop && npx vitest run <ruta>`.
- **TDD obligatorio:** red-green-refactor, sin saltarse la fase roja.
- **CERO comentarios de código nuevos** salvo que expliquen un *por qué* no evidente, siguiendo la densidad del fichero que se toca. El repo comenta el porqué, nunca el qué.
- **Sin `--no-verify`**, sin deshabilitar tests, sin commitear código que no compile.
- **Un commit por funcionalidad**, título descriptivo, sin cuerpo y sin prefijos `feat:`/`fix:`.
- **Cambios quirúrgicos:** no mejorar código adyacente, comentarios ni formato. Cada línea cambiada debe trazar a este plan.
- **i18n:** toda cadena visible va a los ficheros de locale, en **es** y **en**. Nunca texto literal en JSX.
- **Selectores en tests:** `data-testid` primero. Nunca clases CSS.
- **Trabajo en worktree aislado**, nunca directo sobre `main` (ver `superpowers:using-git-worktrees`).

---

## File Structure

**Fase 1 — editor de silencios**

- `apps/desktop/src/shared/shortcutDefaults.ts` — añade `scope?` a `ShortcutDef`, las 5 definiciones del trim, y el parámetro de ámbito en `matchChord` y `findConflicts`.
- `apps/desktop/src/renderer/src/lib/keymap.ts` — `activeScope(el)` nuevo; `keyToCommandId` pasa el ámbito.
- `apps/desktop/src/renderer/src/components/TrimSection.tsx` — `data-shortcut-scope="trim"` en el contenedor, `onKeyDown` del handle leyendo bindings, foco real visible.
- `apps/desktop/src/renderer/src/components/settings/ShortcutsTab.tsx` — agrupación por ámbito.
- Locales `es`/`en` — títulos de los 5 comandos y el encabezado del grupo.

**Fase 2 — huecos de la auditoría**

- `apps/desktop/src/shared/shortcutDefaults.ts` — comando `track-menu` (global).
- `apps/desktop/src/renderer/src/components/TrackList.tsx` — abre el menú desde el teclado usando `rowRegistry`.
- `apps/desktop/src/renderer/src/components/DeclickSection.tsx` — `role="slider"` + `tabIndex` + `onKeyDown` en el scrub.

---

## Task 1: `scope` en el sistema de atajos

Es la base de todo lo demás y no cambia ningún comportamiento observable: los 35 comandos existentes no declaran `scope` y siguen siendo globales.

**Files:**
- Modify: `apps/desktop/src/shared/shortcutDefaults.ts`
- Test: `apps/desktop/src/shared/shortcutDefaults.test.ts`

**Interfaces:**
- Consumes: `Chord`, `chordEquals` de `./shortcuts`.
- Produces:
  - `interface ShortcutDef { id: string; chord: Chord; suppressWhileTyping?: boolean; scope?: string }`
  - `matchChord(bindings: Map<string, Chord>, chord: Chord, typing: boolean, scope?: string | null): string | null`
  - `findConflicts(bindings: Map<string, Chord>): string[][]` (firma intacta; cambia la lógica interna)

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `apps/desktop/src/shared/shortcutDefaults.test.ts`:

```ts
describe('matchChord con ámbito', () => {
  it('no dispara un comando de ámbito cuando no hay ámbito activo', () => {
    const bindings = new Map([['trim-audition', ['a']]])
    expect(matchChord(bindings, ['a'], false, null)).toBeNull()
  })

  it('dispara un comando de ámbito cuando su ámbito está activo', () => {
    const bindings = new Map([['trim-audition', ['a']]])
    expect(matchChord(bindings, ['a'], false, 'trim')).toBe('trim-audition')
  })

  it('no dispara un comando de ámbito bajo un ámbito distinto', () => {
    const bindings = new Map([['trim-audition', ['a']]])
    expect(matchChord(bindings, ['a'], false, 'otro')).toBeNull()
  })

  it('sigue disparando los comandos globales dentro de un ámbito', () => {
    const bindings = new Map([['settings', ['mod', ',']]])
    expect(matchChord(bindings, ['mod', ','], false, 'trim')).toBe('settings')
  })
})

describe('findConflicts con ámbito', () => {
  it('no marca conflicto entre un comando de ámbito y uno global', () => {
    const bindings = new Map([
      ['trim-audition', ['a']],
      ['add', ['a']],
    ])
    expect(findConflicts(bindings)).toEqual([])
  })

  it('marca conflicto entre dos comandos del mismo ámbito', () => {
    const bindings = new Map([
      ['trim-audition', ['a']],
      ['trim-clear', ['a']],
    ])
    expect(findConflicts(bindings)).toEqual([['trim-audition', 'trim-clear']])
  })
})
```

> Los dos últimos tests dependen de que `trim-audition` y `trim-clear` existan en `SHORTCUT_DEFAULTS` con `scope: 'trim'`, y de que `add` sea global — se crean en el Step 3.

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `cd apps/desktop && npx vitest run src/shared/shortcutDefaults.test.ts`
Expected: FAIL. `matchChord` ignora el 4º argumento, así que "no dispara un comando de ámbito cuando no hay ámbito activo" devuelve `'trim-audition'` en vez de `null`.

- [ ] **Step 3: Implementar**

En `apps/desktop/src/shared/shortcutDefaults.ts`, añadir el campo a la interfaz:

```ts
interface ShortcutDef {
  id: string
  chord: Chord
  suppressWhileTyping?: boolean
  // Limita el comando al ámbito con ese nombre: solo dispara cuando el foco está dentro
  // de un `[data-shortcut-scope]` que coincide. Sin scope el comando es global.
  scope?: string
}
```

Añadir las 5 definiciones del trim al final del array `SHORTCUT_DEFAULTS`:

```ts
  // Editor de silencios. Teclas sueltas sin modificador: solo viven con el foco en un
  // handle de corte, así que no compiten con nada global — y un macropad manda teclas
  // limpias, no combos.
  { id: 'trim-nudge-back', chord: ['left'], scope: 'trim' },
  { id: 'trim-nudge-forward', chord: ['right'], scope: 'trim' },
  { id: 'trim-audition', chord: ['a'], scope: 'trim' },
  { id: 'trim-clear', chord: ['c'], scope: 'trim' },
  { id: 'trim-apply', chord: ['s'], scope: 'trim' },
```

Reemplazar `matchChord` por:

```ts
export function matchChord(
  bindings: Map<string, Chord>,
  chord: Chord,
  typing: boolean,
  scope: string | null = null,
): string | null {
  const hasMod = chord.includes('mod')
  for (const def of SHORTCUT_DEFAULTS) {
    const bound = bindings.get(def.id)
    if (!bound || bound.length === 0 || !chordEquals(bound, chord)) continue
    if ((def.scope ?? null) !== scope) continue
    if (typing && (!hasMod || def.suppressWhileTyping)) return null
    return def.id
  }
  return null
}
```

> `(def.scope ?? null) !== scope` es la regla entera: un comando global (`undefined` → `null`) solo casa con ámbito `null`, y uno de ámbito solo con el suyo. Nota el efecto deliberado: `['left']` del trim y `seek-back` (también `['left']`) coexisten porque nunca comparten ámbito.

Reemplazar `findConflicts` para que agrupe por ámbito además de por chord:

```ts
export function findConflicts(bindings: Map<string, Chord>): string[][] {
  const scopeOf = new Map(SHORTCUT_DEFAULTS.map((d) => [d.id, d.scope ?? '']))
  const byChord = new Map<string, string[]>()
  for (const [id, chord] of bindings) {
    if (chord.length === 0) continue
    const key = `${scopeOf.get(id) ?? ''} ${chord.join('+')}`
    const ids = byChord.get(key) ?? []
    ids.push(id)
    byChord.set(key, ids)
  }
  return [...byChord.values()].filter((ids) => ids.length > 1)
}
```

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `cd apps/desktop && npx vitest run src/shared/shortcutDefaults.test.ts`
Expected: PASS, incluidos los tests que ya existían (los globales no cambian de comportamiento porque el ámbito por defecto es `null`).

- [ ] **Step 5: Verificar que no se ha roto nada más**

Run: `cd apps/desktop && npx vitest run`
Expected: PASS. Si algún test llama a `matchChord` con 3 argumentos, sigue funcionando: el 4º tiene valor por defecto.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/shortcutDefaults.ts apps/desktop/src/shared/shortcutDefaults.test.ts
git commit -m "Add scope to shortcut definitions"
```

---

## Task 2: Resolver el ámbito activo desde el foco

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/keymap.ts`
- Test: `apps/desktop/src/renderer/src/lib/keymap.test.ts`

**Interfaces:**
- Consumes: `matchChord(bindings, chord, typing, scope)` de la Task 1.
- Produces:
  - `activeScope(el: Element | null): string | null`
  - `keyToCommandId(e: KeyLike, typing: boolean, bindings: Map<string, Chord>, isMac: boolean, scope?: string | null): string | null`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `apps/desktop/src/renderer/src/lib/keymap.test.ts`:

```ts
describe('activeScope', () => {
  it('devuelve null sin elemento enfocado', () => {
    expect(activeScope(null)).toBeNull()
  })

  it('devuelve null cuando el foco está fuera de cualquier ámbito', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(activeScope(el)).toBeNull()
    el.remove()
  })

  it('devuelve el ámbito del ancestro más cercano', () => {
    const box = document.createElement('div')
    box.setAttribute('data-shortcut-scope', 'trim')
    const inner = document.createElement('button')
    box.appendChild(inner)
    document.body.appendChild(box)
    expect(activeScope(inner)).toBe('trim')
    box.remove()
  })
})

describe('keyToCommandId con ámbito', () => {
  const bindings = resolveBindings()
  const press = (key: string): KeyLike => ({
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
  })

  it('no dispara el comando del trim fuera de su ámbito', () => {
    expect(keyToCommandId(press('a'), false, bindings, true, null)).toBeNull()
  })

  it('dispara el comando del trim dentro de su ámbito', () => {
    expect(keyToCommandId(press('a'), false, bindings, true, 'trim')).toBe('trim-audition')
  })

  it('las flechas siguen siendo seek fuera del trim', () => {
    expect(keyToCommandId(press('ArrowLeft'), false, bindings, true, null)).toBe('seek-back')
  })

  it('las flechas son nudge dentro del trim', () => {
    expect(keyToCommandId(press('ArrowLeft'), false, bindings, true, 'trim')).toBe(
      'trim-nudge-back',
    )
  })
})
```

Importar en la cabecera del fichero de test lo que falte: `activeScope`, `resolveBindings` (de `../../../shared/shortcutDefaults`) y el tipo `KeyLike` (de `../../../shared/shortcuts`).

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `cd apps/desktop && npx vitest run src/renderer/src/lib/keymap.test.ts`
Expected: FAIL con "activeScope is not a function" / "is not exported".

- [ ] **Step 3: Implementar**

En `apps/desktop/src/renderer/src/lib/keymap.ts`, añadir:

```ts
// El ámbito de atajos activo: el `data-shortcut-scope` del ancestro más cercano al
// elemento enfocado. Se lee del DOM y no de estado en React a propósito — así no puede
// desincronizarse de lo que el usuario ve enfocado.
export function activeScope(el: Element | null): string | null {
  return el?.closest?.('[data-shortcut-scope]')?.getAttribute('data-shortcut-scope') ?? null
}
```

Y cambiar la firma y el cuerpo de `keyToCommandId`:

```ts
export function keyToCommandId(
  e: KeyLike,
  typing: boolean,
  bindings: Map<string, Chord>,
  isMac: boolean,
  scope: string | null = null,
): string | null {
  const chord = eventToChord(e, isMac)
  if (!chord) return null
  const id = matchChord(bindings, chord, typing, scope)
  if (id) return id
```

El resto del cuerpo (los alias vim `j`/`k`, `home`/`end`/`pageup`/`pagedown`) se queda **exactamente igual**. Son alias globales de lista; no reciben ámbito.

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `cd apps/desktop && npx vitest run src/renderer/src/lib/keymap.test.ts`
Expected: PASS.

- [ ] **Step 5: Conectar el ámbito al listener global**

En `apps/desktop/src/renderer/src/hooks/useKeyboardShortcuts.ts`, línea ~58, cambiar:

```ts
      const typing = isTypingTarget(document.activeElement)
      const id = keyToCommandId(e, typing, p.bindings, p.isMac)
```

por:

```ts
      const typing = isTypingTarget(document.activeElement)
      const id = keyToCommandId(e, typing, p.bindings, p.isMac, activeScope(document.activeElement))
```

Añadir `activeScope` al import existente de `../lib/keymap`.

> El listener global resolverá ahora `trim-audition` cuando el foco esté en el trim, pero `runCommand` no encontrará ese id en el registro (los comandos del trim no se registran) y no hará nada. `TrimSection` los maneja antes en su propio `onKeyDown` con `preventDefault`, y el listener global sale en la línea 38 por `defaultPrevented`. Esto es correcto y deliberado; la Task 3 cierra el circuito.

- [ ] **Step 6: Ejecutar toda la suite**

Run: `cd apps/desktop && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/keymap.ts apps/desktop/src/renderer/src/lib/keymap.test.ts apps/desktop/src/renderer/src/hooks/useKeyboardShortcuts.ts
git commit -m "Resolve the active shortcut scope from DOM focus"
```

---

## Task 3: Las cinco teclas del editor de silencios

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/TrimSection.tsx` (contenedor ~línea 901; `onKeyDown` del handle líneas 404-411; `Lane` recibe props nuevas)
- Test: `apps/desktop/src/renderer/src/components/TrimSection.test.tsx`

**Interfaces:**
- Consumes: `activeScope` (Task 2), `resolveBindings`/`matchChord` (Task 1), `eventToChord` de `../../../shared/shortcuts`.
- Produces: nada que consuman otras tareas.

**Contexto del componente (leer antes de tocar):**
- `FINE_STEP_SEC = 0.001` (línea 63), `COARSE_STEP_SEC = 0.1` (línea 64).
- El handle es `role="slider"` con `tabIndex={0}` en las líneas 388-394.
- Su `onKeyDown` (404-411) ya maneja `←`/`→` con Shift para el paso grueso.
- Las acciones por lado ya existen como props de `Lane`: `onKeyStep(delta)`, `onAudition()`, `onClear()`, `onApplySuggestion(sec)`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `apps/desktop/src/renderer/src/components/TrimSection.test.tsx`, siguiendo el patrón de render que ya use el fichero:

```ts
it('audiciona el lado cuyo handle tiene el foco', async () => {
  // (render con corte puesto en ambos lados, según el helper del fichero)
  const handle = screen.getByTestId('trim-handle-end')
  handle.focus()
  fireEvent.keyDown(handle, { key: 'a' })
  expect(onAuditionEnd).toHaveBeenCalled()
  expect(onAuditionStart).not.toHaveBeenCalled()
})

it('limpia el lado cuyo handle tiene el foco', async () => {
  const handle = screen.getByTestId('trim-handle-start')
  handle.focus()
  fireEvent.keyDown(handle, { key: 'c' })
  expect(onClearStart).toHaveBeenCalled()
  expect(onClearEnd).not.toHaveBeenCalled()
})

it('no dispara las teclas del trim con el foco fuera del editor', () => {
  const outside = document.createElement('button')
  document.body.appendChild(outside)
  outside.focus()
  fireEvent.keyDown(outside, { key: 'a' })
  expect(onAuditionStart).not.toHaveBeenCalled()
  outside.remove()
})
```

> Es la prueba que encierra el *porqué* de la feature: la tecla actúa sobre el lado enfocado y solo sobre ese. Adapta los nombres de los espías a como el fichero de test ya monta el componente.

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/TrimSection.test.tsx`
Expected: FAIL — `onAuditionEnd` no se llama, porque `a` no está manejada.

- [ ] **Step 3: Marcar el ámbito en el contenedor**

En la línea ~901, añadir el atributo al div raíz de la sección:

```tsx
<div
  data-testid="editor-trim"
  data-shortcut-scope="trim"
  className="mt-5 border-t border-[var(--color-line)] pt-5"
>
```

- [ ] **Step 4: Manejar las cinco teclas en el handle**

`Lane` necesita las bindings resueltas, y **`TrimSection` no las recibe hoy**. `App` ya tiene el `Map` memoizado como fuente única (`App.tsx:983`), así que se pasa por props — no se reconstruye con `resolveBindings` en el componente, o habría dos fuentes que pueden divergir.

Cadena a cablear: `App.tsx:1170` (donde renderiza `<Editor>`) → `Editor.tsx:1170` (donde renderiza `<TrimSection>`) → cada `<Lane>`. Prop nueva en los tres, del mismo tipo:

```ts
bindings: Map<string, Chord>
```

`Chord` se importa de `../../../shared/shortcuts`.

Reemplazar el `onKeyDown` del handle (líneas 404-411) por:

```tsx
onKeyDown={(e) => {
  const chord = eventToChord(e, isMac)
  if (!chord) return
  const id = matchChord(bindings, chord, false, 'trim')
  if (!id) return
  e.preventDefault()
  // Shift es el paso grueso; la tecla sin él, el fino — igual que los botones a cada
  // lado del contador.
  const step = e.shiftKey ? COARSE_STEP_SEC : fineStepSec
  if (id === 'trim-nudge-back') onKeyStep(-step)
  else if (id === 'trim-nudge-forward') onKeyStep(step)
  else if (id === 'trim-audition' && cutSec !== undefined) onAudition()
  else if (id === 'trim-clear' && cutSec !== undefined) onClear()
  else if (id === 'trim-apply' && cutSec === undefined && suggestionSec !== undefined) {
    onApplySuggestion(suggestionSec)
  }
}}
```

> Las guardas de `cutSec`/`suggestionSec` replican exactamente el `disabled` de cada botón (líneas 299, 314) y la condición de render del botón de aplicar (línea 445): la tecla no puede hacer lo que el botón no deja hacer.

`isMac` sale de `isMacOS()` de `../lib/platform`, como en `ShortcutsTab.tsx:12`.

- [ ] **Step 5: Ejecutar los tests y verificar que pasan**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/TrimSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/TrimSection.tsx apps/desktop/src/renderer/src/components/TrimSection.test.tsx
git commit -m "Bind the silence editor actions to keys"
```

---

## Task 4: El lado activo, siempre visible

Hoy el handle enfocado se marca con `focus-visible`, que **solo pinta cuando el foco llegó por teclado**. Si el usuario arrastra el handle con el ratón y luego pulsa una tecla, el handle tiene el foco y las teclas actúan sobre él, pero no se ve resaltado — actúa sobre un lado que no se distingue del otro.

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/TrimSection.tsx` (líneas 429-437)
- Test: `apps/desktop/src/renderer/src/components/TrimSection.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

```ts
it('marca el handle enfocado aunque el foco haya llegado con el ratón', () => {
  const handle = screen.getByTestId('trim-handle-start')
  handle.focus()
  expect(handle).toHaveAttribute('data-focused', 'true')
})

it('no marca el handle sin foco', () => {
  const handle = screen.getByTestId('trim-handle-start')
  expect(handle).not.toHaveAttribute('data-focused', 'true')
})
```

> Se comprueba con un `data-focused` explícito en vez de leer clases: el CLAUDE.md prohíbe clases CSS como selector de test, y `:focus` no es inspeccionable de forma fiable en jsdom.

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/TrimSection.test.tsx`
Expected: FAIL — el atributo no existe.

- [ ] **Step 3: Implementar**

En `Lane`, añadir estado de foco del handle:

```tsx
const [focused, setFocused] = useState(false)
```

En el elemento del handle (línea ~388) añadir `data-focused={focused || undefined}`, `onFocus={() => setFocused(true)}` y `onBlur={() => setFocused(false)}`.

En los dos `<span>` internos (líneas 429-437) sustituir cada `group-focus-visible:` por `group-data-[focused]:`, conservando **exactamente** los mismos valores visuales:

```tsx
// línea ~431
className={`absolute inset-y-0 left-1/2 w-px bg-accent group-data-[focused]:shadow-[0_0_4px_var(--color-accent)] ${...}`}
// línea ~437
className={`absolute top-1/2 left-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-accent group-data-[focused]:scale-125 group-data-[focused]:shadow-[0_0_4px_var(--color-accent)] ${...}`}
```

> El tratamiento visual no cambia: sigue siendo la línea afinada con glow ceñido que los comentarios de las líneas 425-428 justifican. Lo único que cambia es *cuándo* se aplica — con el foco real, porque aquí el foco no es un detalle de accesibilidad sino el estado que decide sobre qué lado actúan las teclas.

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/TrimSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Comprobación visual en la app real**

Abrir el editor de silencios con una pista, arrastrar un handle con el ratón y confirmar que **queda marcado** al soltar. Tabular al otro y confirmar que la marca se mueve. Usar la skill `run` para lanzar la app.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/TrimSection.tsx apps/desktop/src/renderer/src/components/TrimSection.test.tsx
git commit -m "Mark the focused trim handle on real focus"
```

---

## Task 5: Los cinco comandos en Settings

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/settings/ShortcutsTab.tsx`
- Modify: locales `es` y `en` (buscar dónde vive `commands.*` y `settings.shortcuts.*`)
- Test: `apps/desktop/src/renderer/src/components/settings/ShortcutsTab.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

```ts
it('lista los comandos del editor de silencios bajo su propio grupo', () => {
  // render del tab como ya hace el fichero
  expect(screen.getByTestId('shortcut-group-trim')).toBeInTheDocument()
  expect(screen.getByTestId('shortcut-row-trim-audition')).toBeInTheDocument()
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/settings/ShortcutsTab.test.tsx`
Expected: FAIL — no existe `shortcut-group-trim`.

- [ ] **Step 3: Añadir las cadenas a los locales**

En **es**:
```
"commands.trimNudgeBack": "Mover el corte atrás",
"commands.trimNudgeForward": "Mover el corte adelante",
"commands.trimAudition": "Escuchar el corte",
"commands.trimClear": "Quitar el corte",
"commands.trimApply": "Aplicar el silencio detectado",
"settings.shortcuts.groupTrim": "Editor de silencios",
"settings.shortcuts.groupTrimHint": "Solo con el foco en un corte",
```

En **en**:
```
"commands.trimNudgeBack": "Nudge the cut back",
"commands.trimNudgeForward": "Nudge the cut forward",
"commands.trimAudition": "Hear the cut",
"commands.trimClear": "Clear the cut",
"commands.trimApply": "Apply the detected silence",
"settings.shortcuts.groupTrim": "Silence editor",
"settings.shortcuts.groupTrimHint": "Only while a cut has focus",
```

> `commandTitle` (línea 28) convierte el id kebab-case a camelCase, así que `trim-audition` busca `commands.trimAudition`. Respeta el formato exacto del fichero de locales (JSON anidado o plano, según sea).

- [ ] **Step 4: Agrupar las filas por ámbito**

Extraer el cuerpo del `.map` actual (líneas 67-114) a una función local `renderRow(def)` **sin cambiar su contenido**, y sustituir el bloque por dos listas:

```tsx
<div>{SHORTCUT_DEFAULTS.filter((d) => !d.scope).map(renderRow)}</div>
<div data-testid="shortcut-group-trim" className="mt-4">
  <div className="mb-1 flex items-baseline gap-2">
    <h3 className="text-xs font-medium text-fg">{tr('settings.shortcuts.groupTrim')}</h3>
    <span className="text-xs text-fg-dim">{tr('settings.shortcuts.groupTrimHint')}</span>
  </div>
  {SHORTCUT_DEFAULTS.filter((d) => d.scope === 'trim').map(renderRow)}
</div>
```

Para que `renderRow` compile, `ShortcutDef` debe exportarse desde `shortcutDefaults.ts` (`export interface ShortcutDef`) — hoy es privada.

> El encabezado y su pista existen para que se lea que estos atajos son de ámbito, no globales. Sin eso, un usuario que rebindea `a` aquí esperaría que funcionara en toda la app.

- [ ] **Step 5: Permitir grabar teclas sueltas en las filas del trim**

`captureChord` (líneas 33-45) sirve tal cual: `eventToChord` ya produce `['a']` para una tecla suelta. Verificar que no hay ninguna guarda que exija modificador. La reserva de ⌘K (línea 42) se mantiene.

- [ ] **Step 6: Ejecutar y verificar que pasa**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/settings/ShortcutsTab.test.tsx`
Expected: PASS.

- [ ] **Step 7: Ejecutar toda la suite**

Run: `cd apps/desktop && npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/components/settings/ShortcutsTab.tsx apps/desktop/src/shared/shortcutDefaults.ts apps/desktop/src/renderer/src/components/settings/ShortcutsTab.test.tsx
git add <ficheros de locale>
git commit -m "List the silence editor shortcuts in Settings"
```

---

## Task 6: Abrir el menú contextual de pista con el teclado

El hueco más grave de la auditoría: `TrackList.tsx:292-298` solo abre el menú con `onContextMenu`. Detrás hay 10 acciones y **cuatro no tienen ningún otro camino** — *Copiar metadatos*, *Pegar metadatos*, *Empezar de cero*, *Copiar ruta*. `TrackContextMenu` ya está preparado para abrirse por teclado (su comentario en la línea 88 lo dice, y devuelve el foco al abridor en las líneas 89-93). Falta solo la puerta.

**Files:**
- Modify: `apps/desktop/src/shared/shortcutDefaults.ts`
- Modify: `apps/desktop/src/renderer/src/components/TrackList.tsx` (el `onKeyDown` de la fila, líneas 283-290)
- Modify: locales `es` y `en`
- Test: `apps/desktop/src/renderer/src/components/TrackList.test.tsx`

**Interfaces:**
- Consumes: `MenuState = { track: TrackItem; x: number; y: number }` (línea 48), `openMenu(track, x, y)` (línea 557), `rowRegistry: RefObject<Map<string, HTMLButtonElement>>` (línea 45).

- [ ] **Step 1: Escribir el test que falla**

```ts
it('abre el menú contextual de la fila enfocada con el teclado', () => {
  // render de la lista con al menos una pista
  const row = screen.getAllByTestId('track-row')[0]
  row.focus()
  fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
  expect(screen.getByTestId('track-menu')).toBeInTheDocument()
})
```

> `track-menu` es el `data-testid` real del contenedor (`TrackContextMenu.tsx:149`), verificado.

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/TrackList.test.tsx`
Expected: FAIL — el menú no se abre.

- [ ] **Step 3: Declarar el comando**

En `SHORTCUT_DEFAULTS`, junto a los comandos de lista (después de `select-all`):

```ts
  // Shift+F10 es el estándar de Windows/Linux para el menú contextual; macOS no tiene
  // convención propia, así que lo compartimos. Sin él, cuatro acciones del menú (copiar
  // y pegar metadatos, empezar de cero, copiar ruta) no tienen ningún camino de teclado.
  { id: 'track-menu', chord: ['shift', 'f10'] },
```

**Antes de esto**, comprobar `keyToken` en `apps/desktop/src/shared/shortcuts.ts` (líneas ~30-34): devuelve `null` para las F-keys, así que `['shift','f10']` nunca casaría. Añadir `F10: 'f10'` al mapa `NAMED` y un test en `shortcuts.test.ts`:

```ts
it('reconoce F10 como tecla ligable', () => {
  expect(eventToChord({ key: 'F10', metaKey: false, ctrlKey: false, shiftKey: true }, true)).toEqual([
    'shift',
    'f10',
  ])
})
```

- [ ] **Step 4: Abrir el menú desde el `onKeyDown` de la fila**

El chord se lee de las **bindings**, nunca con una comparación literal de `F10`: `track-menu` sale en el tab de Shortcuts y debe seguir funcionando cuando el usuario lo rebindea (el macropad de djotas probablemente no emite F10). Es el mismo mecanismo que la Task 3.

`TrackList` no recibe hoy las bindings: se cablean por props desde `App.tsx:983` (el `Map` ya memoizado) igual que en la Task 3, atravesando `TrackList` hasta la fila. Prop nueva `bindings: Map<string, Chord>` en el componente de lista y en el de fila.

En `TrackList.tsx`, ampliar el `onKeyDown` de la fila (líneas 283-290). El manejo actual de ⌫/Supr se conserva intacto; se añade antes:

```tsx
onKeyDown={(e) => {
  const chord = eventToChord(e, isMac)
  if (chord && matchChord(bindings, chord, false, null) === 'track-menu') {
    e.preventDefault()
    // El menú se posiciona en píxeles porque nace de un clic derecho; desde el teclado
    // lo anclamos a la esquina inferior izquierda de la propia fila.
    const r = e.currentTarget.getBoundingClientRect()
    if (!selected) onSelect(t.id, {})
    onOpenMenu(t, r.left, r.bottom)
    return
  }
  // Bare key only: ⌘⌫ belongs to the global remove command, and the list is a
  // no-typing surface so plain ⌫/Supr is unambiguous here.
  if (e.key !== 'Backspace' && e.key !== 'Delete') return
  ...
}}
```

Importar `eventToChord` de `../../../shared/shortcuts`, `matchChord` de `../../../shared/shortcutDefaults` e `isMacOS` de `../lib/platform`.

> El `preventDefault` hace que el listener global se aparte (`useKeyboardShortcuts.ts:38`), así que la fila gana. Se replica la regla del clic derecho (líneas 294-296): si la fila no está en la selección, se selecciona antes de abrir, para que las acciones de una sola pista no sean ambiguas.
>
> El ámbito es `null` (global) a propósito: `track-menu` no declara `scope`, y la fila solo lo ejecuta porque es quien conoce sus propias coordenadas.

- [ ] **Step 5: Añadir el título a los locales**

es: `"commands.trackMenu": "Abrir el menú de la pista"`
en: `"commands.trackMenu": "Open the track menu"`

- [ ] **Step 6: Ejecutar y verificar que pasa**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/TrackList.test.tsx src/shared/shortcuts.test.ts`
Expected: PASS.

- [ ] **Step 7: Comprobación en la app real**

Seleccionar una pista, pulsar Shift+F10, comprobar que el menú abre junto a la fila, que las flechas lo recorren, que Enter activa y que Escape devuelve el foco a la fila.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/shared/shortcutDefaults.ts apps/desktop/src/shared/shortcuts.ts apps/desktop/src/shared/shortcuts.test.ts apps/desktop/src/renderer/src/components/TrackList.tsx apps/desktop/src/renderer/src/components/TrackList.test.tsx
git add <ficheros de locale>
git commit -m "Open the track context menu from the keyboard"
```

---

## Task 7: Scrub del playhead en click-repair por teclado

`DeclickSection.tsx:263-271` es un `<div>` con `onPointerDown`/`onPointerMove`, sin `tabIndex`, sin rol y sin `onKeyDown`. El comentario del propio código admite que sin scrub "los únicos puntos alcanzables son las marcas de click": son `<button>` tabulables, pero **el terreno entre marcas es inalcanzable**. Se replica el patrón que `TrimSection.tsx:389-411` ya resuelve en este mismo repo.

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/DeclickSection.tsx` (líneas 263-271)
- Test: `apps/desktop/src/renderer/src/components/DeclickSection.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

```ts
it('mueve el playhead con las flechas', () => {
  const strip = screen.getByTestId('declick-marks')
  strip.focus()
  const before = Number(strip.getAttribute('aria-valuenow'))
  fireEvent.keyDown(strip, { key: 'ArrowRight' })
  expect(Number(strip.getAttribute('aria-valuenow'))).toBeGreaterThan(before)
})

it('expone el playhead como slider accesible', () => {
  const strip = screen.getByTestId('declick-marks')
  expect(strip).toHaveAttribute('role', 'slider')
  expect(strip).toHaveAttribute('tabindex', '0')
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/DeclickSection.test.tsx`
Expected: FAIL — no hay `role` ni `aria-valuenow`.

- [ ] **Step 3: Implementar**

Los nombres reales del componente (verificados): la duración es `durationSec` (línea 71), la posición actual del playhead es **`ab.at`** (línea 300) y el seek es **`ab.seek(segundos)`** (línea 175, ya usado por el scrub de ratón).

Añadir al `<div data-testid="declick-marks">` (línea 261):

```tsx
role="slider"
tabIndex={0}
aria-label={tr('declick.playheadLabel')}
aria-valuemin={0}
aria-valuemax={Number(durationSec.toFixed(2))}
aria-valuenow={Number(ab.at.toFixed(2))}
onKeyDown={(e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  if (durationSec <= 0) return
  e.preventDefault()
  const step = e.shiftKey ? PLAYHEAD_COARSE_STEP_SEC : PLAYHEAD_FINE_STEP_SEC
  const next = ab.at + (e.key === 'ArrowLeft' ? -step : step)
  ab.seek(Math.min(durationSec, Math.max(0, next)))
}}
```

Definir las constantes junto a las demás del fichero:

```ts
const PLAYHEAD_FINE_STEP_SEC = 0.01
const PLAYHEAD_COARSE_STEP_SEC = 0.25
```

> Estos dos valores son un punto de partida, no una medida verificada: la tira de click-repair abarca más contexto que el trim (que usa 1 ms / 100 ms), así que se ajustan probándolos en el Step 5.

Añadir a los locales:
es: `"declick.playheadLabel": "Posición de reproducción"`
en: `"declick.playheadLabel": "Playhead position"`

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/DeclickSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Comprobación en la app real**

Abrir click-repair con una pista con clicks, tabular a la tira, mover con ←/→ y con Shift, comprobar que el playhead se mueve y que la audición suena desde donde toca.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/DeclickSection.tsx apps/desktop/src/renderer/src/components/DeclickSection.test.tsx
git add <ficheros de locale>
git commit -m "Make the click repair playhead keyboard reachable"
```

---

## Task 8: Verificación final

- [ ] **Step 1: Suite completa**

Run: `cd apps/desktop && npx vitest run`
Expected: PASS, sin tests saltados.

- [ ] **Step 2: Tipos y lint**

Run: `npm run check`
Expected: sin errores ni warnings. (Si `tsc` se ejecuta pelado, no comprueba nada: usar los tsconfig explícitos `tsconfig.web.json` / `tsconfig.node.json`.)

- [ ] **Step 3: Repaso manual del recorrido completo**

Con la app abierta:
1. Tab hasta un handle de corte → se marca visiblemente.
2. `←`/`→` mueven el corte; con Shift, más.
3. `a` audiciona, `c` limpia, `s` aplica la sugerencia — siempre sobre el lado marcado.
4. Con el foco fuera del trim, `a`/`c`/`s` no hacen nada y `←`/`→` vuelven a ser seek.
5. Settings → Shortcuts: los cinco salen bajo "Editor de silencios", se rebindean y el rebind funciona.
6. Shift+F10 sobre una fila abre el menú; Escape devuelve el foco.
7. Tab a la tira de click-repair y ←/→ mueven el playhead.

- [ ] **Step 4: Merge local a main y limpieza del worktree**

Sin push: el push lo decide el usuario.

---

## Self-Review

**Cobertura del spec:**
- `scope` en `ShortcutDef` + `matchChord` → Task 1 ✓
- Ámbito desde el foco real del DOM → Task 2 ✓
- Los 5 comandos con sus teclas por defecto → Tasks 1 (declaración) y 3 (comportamiento) ✓
- `trim-apply` no hace nada con el corte puesto → Task 3, Step 4 (guarda `cutSec === undefined`) ✓
- Sin repetición acelerada → no se implementa nada; la repetición es la del SO ✓
- Foco real visible en la onda → Task 4 ✓
- Encabezado propio en Settings → Task 5 ✓
- `findConflicts` sin falsos positivos entre ámbitos → Task 1 ✓
- Las 3 pruebas que pide el spec → Tasks 1 y 3 ✓
- Fase 2.1 menú contextual → Task 6 ✓
- Fase 2.2 scrub de declick → Task 7 ✓

**Riesgos anotados, no ocultos:**
- Task 6 depende de que `keyToken` acepte F10; hoy devuelve `null` para las F-keys, así que el Step 3 añade `F10: 'f10'` a `NAMED` **antes** de declarar el comando. Sin eso el chord nunca casaría.
- Tasks 3 y 6 cablean ambas `bindings` por props desde `App.tsx:983`, a ramas distintas del árbol (`Editor`→`TrimSection`→`Lane` y `TrackList`→fila). La 3 va primero; la 6 no puede dar por hecho que su rama ya esté hecha.
- Task 3 requiere cablear `bindings` por props desde `App` hasta `Lane`: `TrimSection` no recibe hoy ni los ajustes ni las bindings. Verificado, y resuelto en el Step 4 reutilizando el `Map` memoizado de `App.tsx:983` en vez de reconstruirlo.
- Los valores de paso de la Task 7 (10 ms / 250 ms) son un punto de partida a ajustar probando, no una medida verificada.

**Verificado contra el código antes de cerrar el plan:** `ab.at` / `ab.seek()` / `durationSec` en `DeclickSection`; `track-menu` como testid del menú; `rowRegistry` y `openMenu` en `TrackList`; `FINE_STEP_SEC` / `COARSE_STEP_SEC` y el `role="slider"` del handle en `TrimSection`.
