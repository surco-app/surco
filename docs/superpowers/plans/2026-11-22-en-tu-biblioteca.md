# Sección «En tu biblioteca» (fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Juntar en una sección propia del editor, la primera, lo que hoy está repartido en cuatro sitios: si la pista ya está en la biblioteca de destino (Apple Music o Engine DJ) y qué copia es mejor.

**Architecture:** Una sección nueva `library` en `shared/editorSections.ts`, fija arriba como el formulario (no se puede mover, sí ocultar y plegar). Un componente de presentación `LibrarySection.tsx` que recibe el veredicto ya calculado en `Editor.tsx` y pinta cabecera + fila(s). `Editor.tsx` deja de pintar la pastilla de Metadatos, el aviso ámbar de encima de las etiquetas y la línea de copia de Calidad, y mete `CopyComparison` dentro de la fila. No cambia ningún cálculo: `useLibraryVerdict`, `compareCopies`, `replaceWarning` y `librarySourceOf` se quedan igual.

**Tech Stack:** React 19 + TS, Tailwind v4, i18next (8 idiomas), Vitest + Testing Library.

**Spec:** boceto aprobado https://claude.ai/artifact/7CdLo1sHpPDGLkDn4zHUKb (láminas «Propuesta: hay una copia mejor» y «Propuesta: esta es la mejor»). La lámina de dos programas es la fase 2; en esta fase hay siempre una sola fila.

## Global Constraints

- Todo dentro de `apps/desktop/src`. Trabajo en un worktree (`superpowers:using-git-worktrees`), nunca en main directamente.
- Cero comentarios nuevos en el código. Commits con título descriptivo, sin cuerpo ni prefijo `feat:`.
- Selectores de test por `data-testid`. TestIDs nuevos: `library-section`, `library-verdict`, `library-row`, `library-row-better`.
- Textos: sin guion largo, sin dos puntos explicativos, tuteo en todos los idiomas. Copia exacta en la Tarea 1.
- Sin cambios de tamaño: el texto del veredicto vive en un `SectionPill` (ya reserva su sitio en la cabecera); la fila mide 30 px de alto con o sin formato y con o sin punto (el punto ocupa un hueco fijo de 6 px aunque no se pinte).
- La sección no se pinta si `isMulti`, si `librarySource === null` o si `inLibrary !== 'yes'` (norma «no mostrar lo que no tenemos»).
- Tonos: `here` → `good`, `library` → `warn`, `same` y `measuring` → `neutral` (mismo mapa que `copyStateTone` en `Editor.tsx:1503`).
- El veredicto ámbar sale también con el chequeo rápido (`libraryCopyBetter` sin `copyVerdict`), igual que hoy la pastilla ámbar y el aviso.
- Ejecutar vitest SIEMPRE desde `apps/desktop` (`npx vitest run <ruta>`); desde la raíz se salta el setup.
- Antes de dar una tarea por cerrada: `npm run lint` (entero, no por fichero) y `npx tsc --build`, ambos desde `apps/desktop`.

## Review Focus

1. Coincidencia que llega tarde (Discogs): la sección aparece con la pista ya abierta. Esperado: aparece sin mover el foco ni el scroll del usuario. Test en Tarea 3 (`appears once a confident suggestion matches the library` reescribiendo el de `Editor.test.tsx:5536`).
2. Pista abierta desde la propia carpeta de Music (`musicHoldsFile`): no hay nada que comparar. Esperado: sección con la fila, sin veredicto y sin flecha. Test en Tarea 3 (`shows no verdict when the file in hand is the library copy itself`).
3. Varias coincidencias en Music (`isAmbiguousCandidate`): no hay ruta única. Esperado: fila con el nombre, sin formato ni flecha. Test en Tarea 2 (`renders a plain row without format or chevron`).
4. Engine DJ como destino: la pastilla funcionaba pero no hay comparación. Esperado: sección con la fila «Engine DJ», sin veredicto. Test en Tarea 3.
5. Usuario que ya tenía `editorSections` guardado sin `library`: esperado que aparezca arriba, abierta. Test en Tarea 1.

---

### Task 1: Sección `library` fija arriba, en Ajustes y con sus textos

**Files:**
- Modify: `shared/editorSections.ts` (ids, grupo, defaults, `normalizeEditorSections`)
- Modify: `renderer/src/components/settings/LayoutTab.tsx:103-105` (no se mueve, como `form`)
- Modify: `renderer/src/i18n/locales/{es,en,ca,de,fr,it,pt-BR,ja}.json`
- Test: `shared/editorSections.test.ts`, `renderer/src/components/settings/LayoutTab.test.tsx`

**Interfaces:**
- Produces: `EditorSectionId` incluye `'library'`; `EDITOR_SECTION_GROUP.library = 'metadata'`; `DEFAULT_EDITOR_SECTIONS[0] = { id: 'library', open: true }`, `[1] = { id: 'form', open: true }`; `normalizeEditorSections` devuelve siempre `library` y después `form` al principio, en ese orden; `library` sí puede llevar `hidden: true`.
- Produces (i18n, rama `editor`): `librarySectionTitle`, `libraryVerdictHere`, `libraryVerdictLibrary`, `libraryVerdictSame`, `libraryVerdictMeasuring`, `libraryRowBetter`; rama `settings.sections`: `library`.

- [ ] **Step 1: Tests que fallan**

En `editorSections.test.ts`:
```ts
it('pins the library section above the form, whatever order was stored', () => {
  const out = normalizeEditorSections([{ id: 'quality', open: true }, { id: 'library', open: false }, { id: 'form', open: true }])
  expect(out.slice(0, 2).map((s) => s.id)).toEqual(['library', 'form'])
  expect(out[0].open).toBe(false)
})
it('adds the library section, open, to a list saved before it existed', () => {
  const out = normalizeEditorSections([{ id: 'form', open: true }, { id: 'quality', open: false }])
  expect(out[0]).toEqual({ id: 'library', open: true })
})
it('lets the library section be hidden, unlike the form', () => {
  const out = normalizeEditorSections([{ id: 'library', open: true, hidden: true }])
  expect(out[0]).toEqual({ id: 'library', open: true, hidden: true })
})
```
En `LayoutTab.test.tsx`: la fila `settings-section-row-library` no tiene botones de subir/bajar habilitados, la fila en índice 2 no puede subir, y el conmutador de visible de `library` sí está habilitado. Seguir el estilo de los tests existentes de `form` en ese fichero.

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `cd apps/desktop && npx vitest run src/shared/editorSections.test.ts src/renderer/src/components/settings/LayoutTab.test.tsx`
Expected: FAIL (`'library'` no es un id válido).

- [ ] **Step 3: Implementar**

`normalizeEditorSections`: el orden final es `[library, form, ...resto]`; la regla de `hidden` sigue prohibiéndolo solo a `form`. `LayoutTab`: `movable = section.id !== 'form' && section.id !== 'library'`, y la primera fila movible es el índice 2 (`canUp = movable && i > 2`). `onboarding.ts` y `sectionRect.ts` usan los ids: comprobar que no rompen con el nuevo.

Textos (exactos):

| clave | es | en | ca | de | fr | it | pt-BR | ja |
|---|---|---|---|---|---|---|---|---|
| `editor.librarySectionTitle` y `settings.sections.library` | En tu biblioteca | In your library | A la teva biblioteca | In deiner Bibliothek | Dans ta bibliothèque | Nella tua libreria | Na sua biblioteca | ライブラリ内 |
| `editor.libraryVerdictHere` | Esta es la mejor | This one is better | Aquesta és la millor | Diese ist besser | Celle-ci est meilleure | Questa è migliore | Esta é a melhor | こちらの方が良い |
| `editor.libraryVerdictLibrary` | Hay una copia mejor | There's a better copy | Hi ha una còpia millor | Es gibt eine bessere Kopie | Il y a une meilleure copie | C'è una copia migliore | Há uma cópia melhor | より良いコピーがあります |
| `editor.libraryVerdictSame` | Misma copia | Same copy | Mateixa còpia | Gleiche Kopie | Même copie | Stessa copia | Mesma cópia | 同じコピー |
| `editor.libraryVerdictMeasuring` | Comparando… | Comparing… | Comparant… | Wird verglichen… | Comparaison… | Confronto… | Comparando… | 比較中… |
| `editor.libraryRowBetter` | Mejor que este archivo | Better than this file | Millor que aquest fitxer | Besser als diese Datei | Meilleure que ce fichier | Migliore di questo file | Melhor que este arquivo | このファイルより良い |

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: el mismo comando del Step 2, más `npx vitest run src/renderer/src/i18n` (paridad de claves).
Expected: PASS. `usedKeys.test.ts` puede quejarse de claves aún sin usar: si es así, la Tarea 2 las usa; anotarlo y no tocar el test.

- [ ] **Step 5: Commit**

`git commit -m "Add the pinned In your library section to the editor section list"`

---

### Task 2: Componente `LibrarySection`

**Files:**
- Create: `renderer/src/components/LibrarySection.tsx`
- Test: `renderer/src/components/LibrarySection.test.tsx`

**Interfaces:**
- Consumes: `SectionHeader`, `SectionBody` (como las demás secciones, ver `QualitySection.tsx`), `SectionPill`; claves i18n de la Tarea 1.
- Produces:
```ts
export type LibraryVerdict = 'here' | 'library' | 'same' | 'measuring'
export function LibrarySection(props: {
  open: boolean
  onToggle: () => void
  libraryName: string
  verdict: LibraryVerdict | null
  copyFormat: string
  libraryBetter: boolean
  comparison?: React.ReactNode
  comparisonOpen: boolean
  onToggleComparison: () => void
}): React.JSX.Element
```

Dibujo (boceto): cabecera `SectionHeader` con título `librarySectionTitle`, `sectionId="library"` y `status` = `SectionPill` `testid="library-verdict"` con el tono de Global Constraints y el texto `libraryVerdict*` (sin pill si `verdict === null`). Cuerpo: una fila `library-row` de 30 px, `pl-3` respecto a la cabecera: hueco de punto 6 px (punto ámbar `library-row-better` con `aria-label={libraryRowBetter}` solo si `libraryBetter`), nombre en `text-fg`, formato a la derecha en `text-fg-dim tabular-nums`, flecha `ChevronRight` que gira 90° abierta. La fila es `<button aria-expanded aria-controls>` solo si hay `comparison`; si no, un `<div>` sin flecha. Debajo, `comparison` cuando `comparisonOpen`.

- [ ] **Step 1: Tests que fallan**

```ts
it('says this copy is the better one in green', ...)        // verdict 'here' → library-verdict data-tone="good", texto «Esta es la mejor»
it('warns there is a better copy in amber', ...)            // verdict 'library' → data-tone="warn", «Hay una copia mejor»
it('shows no verdict until there is one', ...)              // verdict null → no library-verdict
it('marks the row only when the library copy is better', ...) // libraryBetter true → library-row-better con aria-label «Mejor que este archivo»; false → ausente
it('opens the comparison from the row', ...)                // click en library-row → onToggleComparison; con comparisonOpen muestra el nodo y aria-expanded="true"
it('renders a plain row without format or chevron', ...)    // copyFormat '' y sin comparison → library-row no es button, sin svg de flecha, nombre visible
```
Renderizar con el wrapper i18n que usan los demás tests de componentes (copiar de `QualitySection.test.tsx`).

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/LibrarySection.test.tsx`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `LibrarySection` en `LibrarySection.tsx`**

- [ ] **Step 4: Ejecutar y ver que pasan**

Mismo comando. Expected: PASS. Mutar a mano una vez (quitar el `if libraryBetter`) y ver que el test del punto cae.

- [ ] **Step 5: Commit**

`git commit -m "Add the LibrarySection component with verdict and copy row"`

---

### Task 3: Montar la sección en el editor y quitar las tres piezas sueltas

**Files:**
- Modify: `renderer/src/components/Editor.tsx` (≈1486-1648 piezas, 1729-1760 cabecera del formulario, 1939 `copyComparison`)
- Modify: `renderer/src/components/QualitySection.tsx` (quitar la prop `copyComparison` y su render en :486)
- Modify: `renderer/src/i18n/locales/*.json` (borrar claves que queden sin uso)
- Test: `renderer/src/components/Editor.test.tsx` (≈4918-5610), `scenarios/bestCopy.test.tsx`

**Interfaces:**
- Consumes: `LibrarySection`, `LibraryVerdict` de la Tarea 2; `copyState`, `libraryCopyBetter`, `replacedCopyFormat`, `libraryName`, `copyOpen`, `setCopyOpenFor` ya existentes en `Editor.tsx`.

Montaje: entre `SectionGroupHeading` (Archivo) y el `SectionHeader` del formulario, si `!isMulti && inLibrary === 'yes'` y la sección `library` no está oculta. `verdict` = `copyState` (que ya es `'here' | 'library' | 'same' | 'measuring' | null`), salvo que si es `null` y `libraryCopyBetter` es `true` pasa a `'library'`. `comparison` = el bloque `CopyComparison` con su `glimpse` que hoy está dentro de `copyLine`, solo cuando hay `copyVerdict` con `winner !== 'tie'`. Fold con `setSectionOpen('library', …)`.

Quitar: `libraryMarks`, `hasLibraryMarks` y el `status` del formulario; `libraryCopyBetterNote` y `canCompareCopies` con su `revealCopy`; el envoltorio `copy-line`/`copy-verdict` de `copyLine` (el `CopyComparison` pasa a la sección). Quitar imports y claves i18n que queden sin uso (`libraryCopyBetterNote`, `libraryCopyBetterNoteBare`, `libraryCopyCompare`, `copyHereBetter`, `copyLibraryBetter`, `copyComparing`, `editor.copySame`, `editor.inLibrary`, `editor.inLibraryEngine`; ¡ojo! `filter.*` y `copySame` de duplicados se quedan: confirmar con grep cada una antes de borrarla). «Sustituir igualmente» del pie no se toca.

**Aviso al usuario antes de este commit (norma «test cambiado: avisar antes»):** estos tests dejan de comprobar la pastilla junto a Metadatos, el aviso ámbar sobre las etiquetas con su botón Comparar y la línea de copia en Calidad, porque esas piezas desaparecen (aprobado en el boceto). La conducta que vigilaban pasa a `library-section`.

- [ ] **Step 1: Reescribir los tests contra la sección (rojo)**

Por cada test de `Editor.test.tsx:4918-5610` que usa `apple-music-status`, `library-copy-better-note`, `library-copy-compare`, `copy-line` o `copy-verdict`, mantener lo que protege y cambiar el selector:
- «en la biblioteca» (`apple-music-status` presente) → `library-section` presente y `library-row` con «Apple Music» o «Engine DJ».
- «sin insignia» → `library-section` ausente.
- tono ámbar / aviso de copia mejor → `library-verdict` con `data-tone="warn"` y `library-row-better` presente.
- `copy-verdict` con `data-state` → `library-verdict` con el texto `libraryVerdict*` correspondiente; abrir los números = click en `library-row`.
- Formato de la copia → texto en `library-row` (antes en el aviso).
- Los de cabecera/plegado (`4973`, `4988`, `5203`, `5223`) → la sección plegada sigue mostrando `library-verdict`; la fila se alcanza con Tab como botón.
- `5265` («opens the comparison in Audio quality from the warning») → borrar; avisar al usuario (lo sustituye el de abrir desde la fila).
- Nuevo: `shows the library section above the metadata form` (orden en el DOM: `library-section` antes de `form-summary`/título Metadatos).
- Nuevo: `shows no copy line in Audio quality anymore` (no hay `copy-comparison` dentro de la sección de Calidad).
- Engine: `shows Engine DJ with no verdict` (fila «Engine DJ», sin `library-verdict`).
`scenarios/bestCopy.test.tsx`: cambiar el único selector igual.

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/Editor.test.tsx src/scenarios/bestCopy.test.tsx`
Expected: FAIL en los reescritos; el resto en verde.

- [ ] **Step 3: Montar `LibrarySection` y quitar las piezas en `Editor.tsx` y `QualitySection.tsx`**

- [ ] **Step 4: Ejecutar y ver que pasan**

Mismo comando, y después la suite entera: `cd apps/desktop && npm test; echo exit=$?`. Expected: todo PASS y `exit=0` (Unhandled Errors deja exit 1 aunque pasen).

- [ ] **Step 5: Lint, tipos y commit**

Run: `cd apps/desktop && npm run lint && npx tsc --build`. Expected: sin errores ni avisos.
`git commit -m "Gather the library verdict and copy comparison into the In your library section"`

---

### Task 4: Prueba en la app

- [ ] Arrancar la app empaquetada con quietLaunch (skill `run`; nunca activar la ventana, norma del Escritorio 2).
- [ ] Abrir una pista que está en Apple Music con una copia peor y otra con una copia mejor: comprobar el veredicto, el punto, abrir y cerrar la comparación con ratón y con teclado.
- [ ] Plegar la sección y comprobar que el veredicto sigue en la cabecera; ocultarla en Ajustes › Secciones del editor y comprobar que desaparece y que no se puede mover.
- [ ] Medir la cabecera y la fila en los 8 idiomas al ancho real del editor (norma «errores visuales no»): ningún texto se corta ni salta de línea.
- [ ] Informar de lo probado y de lo que no se pudo probar (Engine DJ real, coincidencia por Discogs tardía).
