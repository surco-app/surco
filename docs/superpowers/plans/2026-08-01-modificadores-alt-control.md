# Cualquier combinación de teclas como atajo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `⌥E`, `⌃E`, `⌥⇧E` y cualquier otra combinación se puedan grabar como atajo, para que un teclado de macros use teclas que no pisen nada de lo que ya existe.

**Architecture:** Dos tokens nuevos (`alt`, `ctrl`) sobre los dos que ya hay (`mod`, `shift`), en orden canónico fijo. Cuando el chord lleva Alt o Control, el token de tecla es la **posición física** (`e.code`) en vez del carácter: `⌥E` en teclado español produce `´`, y guardar ese carácter ataría el atajo al idioma del sistema. Sin Alt ni Control se conserva el comportamiento por carácter, así que los atajos ya guardados siguen resolviendo igual.

**Tech Stack:** TypeScript + Vitest. El código vive en `apps/desktop/src/shared/` (chord y acelerador) y `apps/desktop/src/renderer/src/` (símbolos y grabador).

## Global Constraints

- **Tests SIEMPRE desde `apps/desktop`**, nunca desde la raíz del repo (desde la raíz se salta el setup y da fallos falsos). Comando: `npx vitest run <ruta>`.
- **TDD estricto:** escribe el test, EJECÚTALO Y COMPRUEBA QUE FALLA (fase roja obligatoria, con el output real), luego implementa, luego verde.
- **CERO comentarios de código nuevos** salvo que expliquen un *por qué* no evidente. El repo comenta el porqué, nunca el qué. Los comentarios que este plan incluye van tal cual: cópialos, no añadas más.
- **Sin `--no-verify`**, sin deshabilitar tests, sin commitear código que no compile.
- **Commit con título descriptivo**, SIN cuerpo y SIN prefijos `feat:`/`fix:`.
- **Cambios quirúrgicos:** no mejores código adyacente ni reformatees. Cada línea debe trazar a este plan.
- **i18n:** el repo exige paridad ESTRICTA de claves entre los 5 locales (de, en, es, fr, pt-BR), verificada por `i18n/keys.test.ts`. Este plan no añade cadenas nuevas, pero tenlo presente si acabas necesitando alguna.
- **Verificación final:** `npx tsc --build` (no `--noEmit` a secas) y `npx biome lint src`, ambos desde `apps/desktop`.
- **Trabajo en worktree aislado**, nunca directo sobre `main`.

---

## File Structure

- `apps/desktop/src/shared/shortcuts.ts` — `KeyLike` gana `altKey` y `code`; `eventToChord` lee los modificadores nuevos y resuelve la tecla por posición cuando procede; `chordToAccelerator` traduce los tokens nuevos para el menú nativo.
- `apps/desktop/src/renderer/src/lib/shortcuts.ts` — `formatShortcut` muestra `⌥`/`Alt` y `⌃`/`Ctrl`.
- `apps/desktop/src/renderer/src/components/settings/ShortcutsTab.tsx` — el grabador deja de descartar la pulsación cuando el chord lleva modificadores nuevos.

No hace falta fichero nuevo: son cuatro puntos de cambio sobre módulos que ya existen y que ya están cubiertos por tests.

---

## Task 1: Los tokens `alt` y `ctrl` en el chord

El corazón del cambio. Sin esto, `⌥E` y `⌃E` siguen perdiendo su modificador.

**Files:**
- Modify: `apps/desktop/src/shared/shortcuts.ts`
- Test: `apps/desktop/src/shared/shortcuts.test.ts`

**Interfaces:**
- Produces:
  - `interface KeyLike { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey?: boolean; shiftKey: boolean }`
  - `eventToChord(e: KeyLike, isMac: boolean): Chord | null` — firma intacta, comportamiento ampliado.

**Contexto (leer antes de tocar):**
- `eventToChord` está en la línea ~46 y hoy solo mira `metaKey`/`ctrlKey` (como `mod`) y `shiftKey`.
- `keyToken(key)` (línea ~32) traduce `event.key` a token: los de `NAMED` (`Enter`→`enter`, `F10`→`f10`…) y los caracteres sueltos en minúscula.
- El orden canónico actual es `mod`, `shift`, tecla. El nuevo es `mod`, `alt`, `ctrl`, `shift`, tecla.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `apps/desktop/src/shared/shortcuts.test.ts`:

```ts
describe('modificadores alt y ctrl', () => {
  // ⌥E en un teclado español produce `´` (carácter muerto), no `e`. Guardar ese carácter
  // ataría el atajo al idioma del sistema, y un teclado de macros manda posiciones, no
  // letras: el mismo hardware se comportaría distinto en otra máquina.
  it('guarda la posición física de la tecla cuando hay alt', () => {
    const chord = eventToChord(
      { key: '´', code: 'KeyE', metaKey: false, ctrlKey: false, altKey: true, shiftKey: false },
      true,
    )
    expect(chord).toEqual(['alt', 'e'])
  })

  // En macOS Control es un modificador libre. Sin leerlo, ⌃E se guardaba como ['e'] y
  // pisaba la tecla suelta de otro comando, en silencio.
  it('reconoce Control en macOS como modificador propio', () => {
    const chord = eventToChord(
      { key: 'e', code: 'KeyE', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
      true,
    )
    expect(chord).toEqual(['ctrl', 'e'])
  })

  // Fuera de macOS Ctrl ES `mod`, así que no puede ser además un modificador aparte.
  it('trata Control como mod fuera de macOS', () => {
    const chord = eventToChord(
      { key: 'e', code: 'KeyE', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
      false,
    )
    expect(chord).toEqual(['mod', 'e'])
  })

  // Orden canónico: sin él, ⌥⇧E y ⇧⌥E serían chords distintos para la misma pulsación y
  // el guardado nunca casaría con lo pulsado.
  it('ordena los modificadores igual sea cual sea el orden de pulsación', () => {
    const chord = eventToChord(
      { key: 'E', code: 'KeyE', metaKey: true, ctrlKey: true, altKey: true, shiftKey: true },
      true,
    )
    expect(chord).toEqual(['mod', 'alt', 'ctrl', 'shift', 'e'])
  })

  // Sin alt ni ctrl nada cambia: los atajos ya guardados están en forma de carácter y
  // tienen que seguir resolviendo igual.
  it('mantiene la forma por carácter cuando no hay alt ni ctrl', () => {
    expect(
      eventToChord(
        { key: 'r', code: 'KeyR', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        true,
      ),
    ).toEqual(['mod', 'r'])
  })

  // Las teclas con nombre (flechas, Enter…) no dependen de la distribución, así que
  // conservan su token aunque el chord lleve alt.
  it('conserva el token con nombre de las teclas especiales', () => {
    const chord = eventToChord(
      {
        key: 'ArrowLeft',
        code: 'ArrowLeft',
        metaKey: false,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      },
      true,
    )
    expect(chord).toEqual(['alt', 'left'])
  })
})
```

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `npx vitest run src/shared/shortcuts.test.ts` (desde `apps/desktop`)
Expected: FAIL. El primero devuelve `['´']` en vez de `['alt','e']`, porque `altKey` se ignora y el carácter muerto pasa tal cual.

- [ ] **Step 3: Ampliar `KeyLike`**

```ts
export interface KeyLike {
  key: string
  // La posición física de la tecla (`KeyE`, `Comma`…). Opcional porque los tests y los
  // llamantes antiguos pasan objetos planos; los eventos reales del navegador siempre
  // la traen.
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey?: boolean
  shiftKey: boolean
}
```

- [ ] **Step 4: Traducir la posición física a token**

Añadir junto a `keyToken`:

```ts
// El token de una POSICIÓN de teclado, para los chords que llevan alt o ctrl. En macOS
// ⌥E no produce `e` sino `´`, así que guardar el carácter ataría el atajo a la
// distribución; un teclado de macros manda posiciones y su firmware se configura por
// posición, que es justo lo que hace falta que sobreviva al cambio de máquina.
function codeToken(code: string | undefined): string | null {
  if (!code) return null
  if (code.startsWith('Key')) return code.slice(3).toLowerCase()
  if (code.startsWith('Digit')) return code.slice(5)
  const PUNCT: Record<string, string> = {
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  }
  return PUNCT[code] ?? null
}
```

- [ ] **Step 5: Leer los modificadores nuevos en `eventToChord`**

Reemplazar el cuerpo por:

```ts
export function eventToChord(e: KeyLike, isMac: boolean): Chord | null {
  const named = e.key in NAMED
  // Con alt o ctrl la tecla se identifica por posición (ver codeToken); las teclas con
  // nombre (flechas, Enter…) no dependen de la distribución y conservan su token.
  const physical = (e.altKey === true || (isMac && e.ctrlKey)) && !named
  const token = physical ? (codeToken(e.code) ?? keyToken(e.key)) : keyToken(e.key)
  if (token === null) return null
  const chord: Chord = []
  if (isMac ? e.metaKey : e.ctrlKey) chord.push('mod')
  if (e.altKey === true) chord.push('alt')
  if (isMac && e.ctrlKey) chord.push('ctrl')
  const shiftIsModifier = physical || token.length > 1 || /^[a-z]$/.test(token)
  if (e.shiftKey && shiftIsModifier) chord.push('shift')
  chord.push(token)
  return chord
}
```

> El orden de los `push` ES el orden canónico (`mod`, `alt`, `ctrl`, `shift`, tecla). Con `physical` el shift siempre cuenta como modificador: leyendo la posición, `⌥⇧E` y `⌥E` son la misma tecla y solo el token `shift` los distingue.

- [ ] **Step 6: Actualizar el comentario de cabecera del módulo**

En las líneas 1-5, sustituir la descripción del orden por:

```ts
// A keyboard chord, shared by the renderer keymap, the command-palette hints and the
// native menu accelerators so the three never drift. It is an ordered token array in
// canonical form: the `mod`, `alt`, `ctrl` and `shift` modifier tokens in that order,
// then exactly one key token, lowercased for letters (`r`, not `R`). `mod` means ⌘ on
// macOS and Ctrl elsewhere, matching formatShortcut and the menu's `CmdOrCtrl`; `ctrl`
// is macOS-only, since Ctrl is already `mod` on the other platforms.
```

- [ ] **Step 7: Ejecutar los tests y verificar que pasan**

Run: `npx vitest run src/shared/shortcuts.test.ts`
Expected: PASS, incluidos los que ya existían (los chords sin alt/ctrl no cambian).

- [ ] **Step 8: Ejecutar la suite completa**

Run: `npx vitest run`
Expected: PASS. Si algo falla, NO lo arregles cambiando el test: analiza si el cambio rompió comportamiento real y repórtalo.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/shared/shortcuts.ts apps/desktop/src/shared/shortcuts.test.ts
git commit -m "Read alt and control as chord modifiers"
```

---

## Task 2: Mostrar los modificadores nuevos

Sin esto, Ajustes pinta `E` donde el usuario grabó `⌥E` — o sea, miente sobre lo guardado.

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/shortcuts.ts`
- Test: `apps/desktop/src/renderer/src/lib/shortcuts.test.ts`

**Interfaces:**
- Consumes: los tokens `alt` y `ctrl` de la Task 1.
- Produces: `formatShortcut(keys: string[], mac: boolean): string` — firma intacta.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe('modificadores alt y ctrl', () => {
  it('usa los glifos de macOS', () => {
    expect(formatShortcut(['alt', 'e'], true)).toBe('⌥E')
    expect(formatShortcut(['ctrl', 'e'], true)).toBe('⌃E')
    expect(formatShortcut(['mod', 'alt', 'shift', 'e'], true)).toBe('⌘⌥⇧E')
  })

  it('los deletrea fuera de macOS', () => {
    expect(formatShortcut(['alt', 'e'], false)).toBe('Alt+E')
    expect(formatShortcut(['mod', 'alt', 'e'], false)).toBe('Ctrl+Alt+E')
  })
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npx vitest run src/renderer/src/lib/shortcuts.test.ts`
Expected: FAIL — sale `altE` en vez de `⌥E`, porque el token no está en el mapa y cae al `k.toUpperCase()`.

- [ ] **Step 3: Añadir los símbolos**

En `MAC`, tras `mod: '⌘',`:

```ts
  alt: '⌥',
  ctrl: '⌃',
```

En `OTHER`, tras `mod: 'Ctrl',`:

```ts
  alt: 'Alt',
  ctrl: 'Ctrl',
```

> `ctrl: 'Ctrl'` en `OTHER` es defensivo: ese token no se genera fuera de macOS, pero un ajuste sincronizado desde un Mac puede traerlo y tiene que pintarse en vez de salir como `CTRL`.

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npx vitest run src/renderer/src/lib/shortcuts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/shortcuts.ts apps/desktop/src/renderer/src/lib/shortcuts.test.ts
git commit -m "Show alt and control in a formatted shortcut"
```

---

## Task 3: El acelerador del menú nativo

El menú de macOS muestra el atajo junto a cada entrada. Sin esto, una entrada con `⌥` mostraría un acelerador inválido que Electron rechaza.

**Files:**
- Modify: `apps/desktop/src/shared/shortcuts.ts` (mapa `ACCEL`, línea ~64)
- Test: `apps/desktop/src/shared/shortcuts.test.ts`

**Interfaces:**
- Consumes: los tokens de la Task 1.
- Produces: `chordToAccelerator(chord: Chord): string` — firma intacta.

- [ ] **Step 1: Escribir el test que falla**

```ts
// Electron acepta 'Alt' y 'Control' en un acelerador; sin traducirlos, el token crudo
// llegaría en mayúsculas ('ALT+E') y Electron rechazaría la entrada del menú.
it('traduce alt y ctrl al acelerador de Electron', () => {
  expect(chordToAccelerator(['alt', 'e'])).toBe('Alt+E')
  expect(chordToAccelerator(['ctrl', 'e'])).toBe('Control+E')
  expect(chordToAccelerator(['mod', 'alt', 'shift', 'e'])).toBe('CmdOrCtrl+Alt+Shift+E')
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npx vitest run src/shared/shortcuts.test.ts`
Expected: FAIL — devuelve `ALT+E`.

- [ ] **Step 3: Añadir las entradas al mapa `ACCEL`**

Tras `mod: 'CmdOrCtrl',`:

```ts
  alt: 'Alt',
  ctrl: 'Control',
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npx vitest run src/shared/shortcuts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/shortcuts.ts apps/desktop/src/shared/shortcuts.test.ts
git commit -m "Translate alt and control for the native menu accelerator"
```

---

## Task 4: Grabar la combinación en Ajustes

Es donde el usuario nota el cambio: hoy pulsa `⌥E` y no pasa nada.

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/settings/ShortcutsTab.tsx` (`captureChord`, línea ~60)
- Test: `apps/desktop/src/renderer/src/components/settings/ShortcutsTab.test.tsx`

**Interfaces:**
- Consumes: `eventToChord` de la Task 1, `formatShortcut` de la Task 2.

**Contexto:** `captureChord` ya ignora la pulsación de un modificador suelto (`Shift`, `Meta`, `Control`, `Alt`) para esperar al chord completo, y reserva `⌘K` para la paleta. Eso se conserva; lo que cambia es que ahora el chord SÍ se forma con los modificadores nuevos, así que llega a guardarse.

- [ ] **Step 1: Escribir el test que falla**

El helper `renderTab()` del fichero **no acepta argumentos** y crea su propio `patch` con
`vi.fn()` (línea 26-32), así que no se puede espiar desde fuera. Amplíalo para que acepte
un `patch` opcional, conservando el comportamiento actual cuando no se pasa:

```ts
function renderTab(patch: PatchSynced = vi.fn()): void {
  const bindings = resolveBindings(synced.shortcutOverrides)
  const conflictIds = new Set(findConflicts(bindings).flat())
  render(
    <ShortcutsTab synced={synced} patch={patch} bindings={bindings} conflictIds={conflictIds} />,
  )
}
```

`PatchSynced` ya se importa en `ShortcutsTab.tsx` desde `../../lib/settingsTabs`; impórtalo
igual aquí. Con eso, el test:

```ts
// El reporte que originó esto: "option+E control+E o option+E no funciona, no hace
// nada". El chord no se formaba, así que el grabador descartaba la pulsación en
// silencio y el usuario no tenía forma de saber por qué.
it('graba una combinación con option', () => {
  const patch = vi.fn()
  renderTab(patch)
  const boton = screen.getByTestId('shortcut-record-play')
  fireEvent.click(boton)
  fireEvent.keyDown(boton, { key: '´', code: 'KeyE', altKey: true })
  expect(patch).toHaveBeenCalledWith(
    'shortcutOverrides',
    expect.objectContaining({ play: ['alt', 'e'] }),
  )
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npx vitest run src/renderer/src/components/settings/ShortcutsTab.test.tsx`
Expected: FAIL — `patch` no se llama, porque el chord llega como `['´']` o el guardado se descarta.

- [ ] **Step 3: Comprobar si hace falta tocar `captureChord`**

Con la Task 1 hecha, `eventToChord` ya devuelve `['alt','e']` y la función existente lo guardaría sin cambios. **Ejecuta el test antes de editar nada**: si pasa, la tarea es solo el test y saltas al Step 5.

Si falla, la causa será la guarda de modificador suelto: `e.key === 'Alt'` corta antes de tiempo cuando el evento sintético del test no distingue la pulsación del modificador de la de la tecla. En ese caso, ajusta la guarda para que solo corte cuando NO hay otra tecla:

```ts
    if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return
```

se convierte en:

```ts
    // Una pulsación de modificador SUELTO no es un chord: se espera a la tecla que lo
    // acompaña. Con la tecla ya presente, el modificador es parte del chord y no debe
    // cortar la grabación.
    const loneModifier =
      e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt'
    if (loneModifier) return
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npx vitest run src/renderer/src/components/settings/ShortcutsTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/settings/ShortcutsTab.tsx apps/desktop/src/renderer/src/components/settings/ShortcutsTab.test.tsx
git commit -m "Record a shortcut that carries option or control"
```

---

## Task 5: Que el conflicto distinga `⌥E` de `E`

`findConflicts` avisa en Ajustes cuando dos comandos comparten tecla. Si tratara `⌥E` y `E` como la misma, marcaría un choque falso y el usuario no podría guardar.

**Files:**
- Test: `apps/desktop/src/shared/shortcutDefaults.test.ts`

**Interfaces:**
- Consumes: `findConflicts(bindings: Map<string, Chord>): string[][]`.

- [ ] **Step 1: Escribir el test**

```ts
// La clave del conflicto es el chord completo, así que ⌥E y E no chocan. Es lo que
// permite que un teclado de macros use combinaciones sin desplazar los atajos de siempre.
it('no marca conflicto entre una tecla y la misma con un modificador', () => {
  const bindings = new Map([
    ['add', ['alt', 'e']],
    ['reveal', ['e']],
  ])
  expect(findConflicts(bindings)).toEqual([])
})
```

- [ ] **Step 2: Ejecutar el test**

Run: `npx vitest run src/shared/shortcutDefaults.test.ts`
Expected: PASS a la primera. **Verificado antes de escribir este plan**: `findConflicts` keyea por `chord.join('+')`, así que `alt+e` y `e` son claves distintas.

> Este test NO pasa por fase roja: fija una garantía que ya se cumple, para que un cambio futuro en la clave del conflicto no la rompa en silencio. Si falla, hay un problema real en `findConflicts` — repórtalo antes de tocarlo.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/shared/shortcutDefaults.test.ts
git commit -m "Pin that a modifier makes a distinct shortcut"
```

---

## Task 6: Verificación final

- [ ] **Step 1: Suite completa**

Run: `npx vitest run` (desde `apps/desktop`)
Expected: PASS, sin tests saltados que antes pasaran.

- [ ] **Step 2: Tipos y lint**

Run: `npx tsc --build` y `npx biome lint src`
Expected: `tsc` sin salida y exit 0. En lint, los 2 avisos preexistentes (`ConversionTab.tsx`, `index.css`) siguen; ninguno nuevo.

- [ ] **Step 3: Comprobación en la app real**

Construye (`PATH="<repo>/node_modules/.bin:$PATH" electron-vite build`) y abre Surco:

1. Ajustes → Atajos, pulsa sobre cualquier atajo para grabarlo.
2. Pulsa **⌥E** con el teclado físico. El recuadro debe mostrar **⌥E**.
3. Pulsa sobre otro y haz **⌃E**. Debe mostrar **⌃E**.
4. Guarda, cierra Ajustes y comprueba que la tecla asignada ejecuta el comando.
5. Comprueba que un atajo de siempre (⌘R, "mostrar en Finder") sigue funcionando.

> El paso 2 es el que reprodujo el usuario como "no hace nada": es la verificación que decide si esto está resuelto. Los tests unitarios usan eventos sintéticos y NO reproducen el carácter muerto de un teclado físico español.

- [ ] **Step 4: Merge local a main y limpieza del worktree**

Sin push: eso lo decide el usuario.

---

## Self-Review

**Cobertura del spec:**
- Tokens `alt` y `ctrl` con orden canónico → Task 1 ✓
- `ctrl` no se genera fuera de macOS → Task 1, Step 5 (`isMac && e.ctrlKey`) ✓
- Tecla por posición física con alt/ctrl → Task 1, Steps 4-5 ✓
- Los atajos existentes siguen por carácter → Task 1, Step 1 (test "mantiene la forma por carácter") ✓
- `formatShortcut` con los símbolos nuevos → Task 2 ✓
- `chordToAccelerator` → Task 3 ✓
- `captureChord` deja de descartar → Task 4 ✓
- `findConflicts` distingue `⌥E` de `E` → Task 5 ✓
- Verificación en la app real → Task 6, Step 3 ✓

**Verificado contra el código antes de cerrar el plan:** `findConflicts` ya distingue
`['alt','e']` de `['e']` (ejecutado, pasa); `renderTab()` en `ShortcutsTab.test.tsx` no
acepta argumentos y crea su propio `patch`, de ahí la ampliación que pide la Task 4;
`KeyLike` tiene tres llamantes (`keymap.ts`, `TrackList.tsx`, `ShortcutsTab.tsx`), todos
con eventos reales que ya traen `altKey` y `code`, así que los campos opcionales no
rompen a nadie.

**Riesgos anotados, no ocultos:**
- La Task 4 puede resultar innecesaria si `captureChord` funciona sin cambios una vez hecha la Task 1. El Step 3 lo dice: ejecutar el test antes de editar.
- El mapa `PUNCT` de `codeToken` cubre la puntuación habitual de un teclado; una tecla fuera de esa lista cae a `keyToken(e.key)`, que es el comportamiento de hoy. Es una degradación deliberada, no un olvido.
- Los tests usan eventos sintéticos, que **no** reproducen el carácter muerto de `⌥E` en un teclado físico. Por eso la Task 6 exige la comprobación manual: es el único punto donde se verifica el caso que originó el trabajo.
