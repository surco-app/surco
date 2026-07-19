# Rediseño de la sección de metadatos (Propuesta A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el header de la sección de metadatos (dos filas con etiquetas y badge acortado) y arreglar los chips de sugerencia (fila con scroll en vez de apilarse), sin tocar la grid de campos.

**Architecture:** Cambios de presentación en tres puntos: el `SectionHeader` de la sección METADATA en `Editor.tsx` (dos filas), el contenedor de sugerencias en `Field.tsx` (scroll horizontal), y el texto del badge de biblioteca (i18n). Cero cambios en lógica de datos.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Vitest + Testing Library, react-i18next.

## Global Constraints

- Tests con Vitest: `npm run test -w apps/desktop -- <patrón>`.
- data-testid obligatorio para selectores de test.
- Comentarios densos como el resto del fichero; sin comentarios triviales; auto-documentado.
- Tokens de color existentes: `var(--color-line)`, `var(--color-line-strong)`, `text-fg-faint`, `text-fg-muted`, `var(--color-panel-2)`, `var(--color-accent)`. NO inventar tokens nuevos.
- i18n en los 5 locales: `es`, `en`, `de`, `fr`, `pt-BR` (rutas en `apps/desktop/src/renderer/src/i18n/locales/`).
- Fuera de alcance: reorganizar la grid de campos (orden/grupos/artwork/rating). NO tocar.
- Commits: título descriptivo, sin body, sin `feat:`/`fix:`. Una funcionalidad por commit.

---

### Task 1: Chips de sugerencia en fila con scroll horizontal

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Field.tsx:182-183`
- Test: `apps/desktop/src/renderer/src/components/Field.test.tsx`

**Interfaces:**
- Produces: el contenedor de chips gana `data-testid="field-suggestions"` y deja de hacer wrap.

- [ ] **Step 1: Escribir el test que falla**

En `apps/desktop/src/renderer/src/components/Field.test.tsx`, añadir:

```tsx
it('renderiza las sugerencias en una fila con scroll, sin wrap', () => {
  render(
    <Field
      name="genre"
      label="Genre"
      value=""
      onChange={() => {}}
      suggestions={['Electronic', 'asia records', 'eurobeat', 'happy music', 'italo dance']}
    />,
  )
  const container = screen.getByTestId('field-suggestions')
  expect(container.className).toContain('overflow-x-auto')
  expect(container.className).not.toContain('flex-wrap')
})
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm run test -w apps/desktop -- Field -t "scroll"`
Expected: FAIL — no existe `field-suggestions` / el contenedor aún tiene `flex-wrap`.

- [ ] **Step 3: Cambiar el contenedor de chips**

En `apps/desktop/src/renderer/src/components/Field.tsx`, la línea 183 pasa de:

```tsx
        <span className="mt-1.5 flex flex-wrap gap-1.5">
```

a (una sola fila con scroll horizontal, sin wrap, con testid; los chips no encogen para que el scroll funcione):

```tsx
        <span
          data-testid="field-suggestions"
          className="mt-1.5 flex gap-1.5 overflow-x-auto"
        >
```

Y a cada `<button>` de chip (línea ~192, en el `className`) añadir `shrink-0` para que los chips no se compriman y el scroll lateral funcione:

```tsx
                className={`press shrink-0 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npm run test -w apps/desktop -- Field`
Expected: PASS (incluidos los tests existentes de chips: `chip-128` sigue clicable).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/Field.tsx apps/desktop/src/renderer/src/components/Field.test.tsx
git commit -m "Chips de sugerencia en fila con scroll en vez de apilarse"
```

---

### Task 2: Acortar el texto del badge de biblioteca

**Files:**
- Modify: `apps/desktop/src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json` (claves `editor.inLibrary`, `editor.inLibraryEngine`, `editor.notInLibrary`, `editor.notInLibraryEngine`)
- Modify: `apps/desktop/src/renderer/src/components/Editor.test.tsx:2312` (aserción del texto)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: el `SectionPill` con testid `apple-music-status` muestra el texto corto.

**NOTA:** El badge usa las claves del bloque `editor.*` (es.json:427-431), NO el bloque
`filters.*` (es.json:66-73, que ya es corto y no se toca). Se mantienen las claves y solo se
acorta su valor. El icono `Disc3` + el tooltip conservan el matiz de qué biblioteca.

- [ ] **Step 1: Actualizar el test que afirma el texto largo (fase roja)**

En `apps/desktop/src/renderer/src/components/Editor.test.tsx:2312`, cambiar la aserción:

```tsx
    expect(screen.getByTestId('apple-music-status')).toHaveTextContent(
      'In library',
    )
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm run test -w apps/desktop -- Editor -t "apple-music-status"` (o el nombre del `it` que contiene esa aserción)
Expected: FAIL — el badge aún dice "Already in your Apple Music library".

- [ ] **Step 3: Acortar el valor en los 5 locales**

En cada locale, bajo `editor`, cambiar SOLO el valor (no la clave):

`en.json`:
```json
    "inLibrary": "In library",
    "inLibraryEngine": "In library",
    "notInLibrary": "Not in library",
    "notInLibraryEngine": "Not in library",
```
`es.json`:
```json
    "inLibrary": "En biblioteca",
    "inLibraryEngine": "En biblioteca",
    "notInLibrary": "No en biblioteca",
    "notInLibraryEngine": "No en biblioteca",
```
`de.json`:
```json
    "inLibrary": "In Mediathek",
    "inLibraryEngine": "In Mediathek",
    "notInLibrary": "Nicht in Mediathek",
    "notInLibraryEngine": "Nicht in Mediathek",
```
`fr.json`:
```json
    "inLibrary": "Dans la bibliothèque",
    "inLibraryEngine": "Dans la bibliothèque",
    "notInLibrary": "Absent de la bibliothèque",
    "notInLibraryEngine": "Absent de la bibliothèque",
```
`pt-BR.json`:
```json
    "inLibrary": "Na biblioteca",
    "inLibraryEngine": "Na biblioteca",
    "notInLibrary": "Fora da biblioteca",
    "notInLibraryEngine": "Fora da biblioteca",
```

NOTA: `checkingLibrary` NO se toca (ya es corto: "Comprobando…").

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npm run test -w apps/desktop -- Editor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/i18n/locales/ apps/desktop/src/renderer/src/components/Editor.test.tsx
git commit -m "Acortar el texto del badge de biblioteca"
```

---

### Task 3: Header de la sección en dos filas con etiquetas

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx:847-915` (el `right` del SectionHeader)
- Modify: `apps/desktop/src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json` (claves nuevas `editor.actionsFile`, `editor.actionsTags`)
- Test: `apps/desktop/src/renderer/src/components/Editor.test.tsx`

**Interfaces:**
- Consumes: los botones ya definidos en Editor.tsx (`copyFilenameButton`, `searchWebButton`, `clearButton`, `deriveButton`, `titleFormatButton`) y el badge (SectionPill).
- Produces: el header renderiza dos filas cuando `formOpen`; las etiquetas llevan `data-testid="actions-file-label"` y `data-testid="actions-tags-label"`.

**NOTA de contexto:** Hoy el `right` (Editor.tsx:847) es un `<div className="flex items-center gap-3">` con: el badge (SectionPill, condicional yes/no/checking), luego el grupo copiar/buscar, el divisor, y el grupo clear/derive/titleFormat — todos en UNA fila. El rediseño separa: fila 1 = badge; fila 2 = los dos grupos de acciones con etiquetas. Como `right` es un único nodo dentro del SectionHeader, ambas filas van dentro de ese nodo apiladas con `flex-col`.

- [ ] **Step 1: Escribir el test que falla**

En `Editor.test.tsx`, añadir (junto a los tests del header que usan `clear-meta-btn`):

```tsx
it('muestra las etiquetas de los grupos de acciones en el header', () => {
  renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav')
  expect(screen.getByTestId('actions-file-label')).toBeInTheDocument()
  expect(screen.getByTestId('actions-tags-label')).toBeInTheDocument()
})
```

(Ajustar `renderEditor` a la firma que usan los otros tests del fichero; los tests existentes de `clear-meta-btn` muestran el patrón.)

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm run test -w apps/desktop -- Editor -t "etiquetas de los grupos"`
Expected: FAIL — no existen esos testid.

- [ ] **Step 3: Añadir las claves i18n de las etiquetas**

En cada locale, bajo `editor`, añadir:

- en: `"actionsFile": "File"`, `"actionsTags": "Tags"`
- es: `"actionsFile": "Archivo"`, `"actionsTags": "Etiquetas"`
- de: `"actionsFile": "Datei"`, `"actionsTags": "Tags"`
- fr: `"actionsFile": "Fichier"`, `"actionsTags": "Tags"`
- pt-BR: `"actionsFile": "Arquivo"`, `"actionsTags": "Tags"`

- [ ] **Step 4: Reescribir el `right` del SectionHeader en dos filas**

En `apps/desktop/src/renderer/src/components/Editor.tsx`, reemplazar el contenido de `right={...}` (líneas 847-915). La estructura nueva: un contenedor `flex-col`; fila 1 con el badge; fila 2 (solo `formOpen`) con los dos grupos etiquetados. Mantener EXACTAMENTE las condiciones actuales de cada badge (yes/no/checking, `!isMulti`) y de cada grupo (`formOpen`, `!isMulti` para el grupo de fichero). Código:

```tsx
            right={
              <div className="flex flex-col items-end gap-2">
                {/* Fila 1 — estado: el badge de biblioteca (state, no acción), que sigue
                    visible con la sección plegada. Misma lógica yes/no/checking de antes. */}
                {!isMulti && inLibrary === 'yes' && (
                  <SectionPill
                    tone="neutral"
                    testid="apple-music-status"
                    icon={<Disc3 className="h-3.5 w-3.5" aria-hidden="true" />}
                  >
                    {tr(
                      librarySource === 'engineDj' ? 'editor.inLibraryEngine' : 'editor.inLibrary',
                    )}
                  </SectionPill>
                )}
                {!isMulti && inLibrary === 'no' && (
                  <SectionPill
                    tone="neutral"
                    testid="apple-music-status"
                    icon={<Disc3 className="h-3.5 w-3.5" aria-hidden="true" />}
                  >
                    {tr(
                      librarySource === 'engineDj'
                        ? 'editor.notInLibraryEngine'
                        : 'editor.notInLibrary',
                    )}
                  </SectionPill>
                )}
                {!isMulti && inLibrary === 'checking' && (
                  <SectionPill
                    tone="neutral"
                    testid="apple-music-status"
                    icon={<Disc3 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  >
                    {tr('editor.checkingLibrary')}
                  </SectionPill>
                )}
                {/* Fila 2 — acciones: dos grupos etiquetados. "Archivo" actúa sobre el
                    nombre del fichero (copiar/buscar), "Etiquetas" sobre los metadatos
                    (borrar/rellenar). Solo con la sección abierta; el grupo de fichero solo
                    en single (igual que antes). */}
                {formOpen && (
                  <div className="flex items-center gap-3">
                    {!isMulti && (
                      <div className="flex items-center gap-1.5">
                        <span
                          data-testid="actions-file-label"
                          className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint"
                        >
                          {tr('editor.actionsFile')}
                        </span>
                        {copyFilenameButton}
                        {searchWebButton}
                      </div>
                    )}
                    {!isMulti && (
                      <div
                        aria-hidden="true"
                        className="h-5 w-px self-center bg-[var(--color-line)]"
                      />
                    )}
                    <div className="flex items-center gap-1.5">
                      <span
                        data-testid="actions-tags-label"
                        className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint"
                      >
                        {tr('editor.actionsTags')}
                      </span>
                      {clearButton}
                      {deriveButton}
                      {titleFormatButton}
                    </div>
                  </div>
                )}
              </div>
            }
```

- [ ] **Step 5: Ejecutar los tests y verificar que pasan**

Run: `npm run test -w apps/desktop -- Editor`
Expected: PASS (los tests existentes del header — `clear-meta-btn` visible/oculto según plegado y multi, badge yes/no/checking — siguen verdes; el nuevo de etiquetas pasa).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/Editor.tsx apps/desktop/src/renderer/src/i18n/locales/ apps/desktop/src/renderer/src/components/Editor.test.tsx
git commit -m "Header de metadatos en dos filas con grupos de acciones etiquetados"
```

---

### Task 4: Integrar el inspector "Otros metadatos" con el formulario

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ForeignTagsInspector.tsx` (estilo del contenedor raíz)
- Test: `apps/desktop/src/renderer/src/components/ForeignTagsInspector.test.tsx` (sin cambios funcionales; solo confirmar que sigue verde)

**Interfaces:**
- Consumes: nada nuevo. Solo ajuste visual.
- Produces: el inspector comparte el borde superior con el cuerpo del formulario, sin quedar como bloque flotante.

**NOTA:** El inspector se renderiza en Editor.tsx:945-954 justo tras `</SectionBody>`. El
cambio es mínimo: que su contenedor raíz tenga un borde superior (`border-t
border-[var(--color-line)]`) y el mismo padding horizontal que el cuerpo, para leerse como un
cierre del formulario. NO cambia la funcionalidad (ver + borrar). Es puramente estético.

- [ ] **Step 1: Leer el contenedor raíz actual del inspector**

Leer `apps/desktop/src/renderer/src/components/ForeignTagsInspector.tsx` completo para ver la clase del `<div>`/`<section>` raíz (el que envuelve el toggle y la lista).

- [ ] **Step 2: Ajustar el estilo del contenedor raíz**

Al contenedor raíz del inspector, asegurar `border-t border-[var(--color-line)]` (que separa del formulario de arriba) y el padding horizontal coherente con el cuerpo de la sección. Si ya tiene el borde, alinear solo el padding. Mantener el `data-testid` y la estructura existentes. Mostrar el diff exacto que apliques en el informe.

- [ ] **Step 3: Verificar que el test del inspector sigue verde**

Run: `npm run test -w apps/desktop -- ForeignTagsInspector`
Expected: PASS (3 tests; sin cambios funcionales).

- [ ] **Step 4: Verificación visual en la app (skill run-desktop)**

Arrancar la app (skill `run-desktop`), cargar el WAV de prueba
`/Volumes/Public/Downloads/DJ_Carlos_TEST_tags.wav` (que tiene 7-8 tags foráneos y muchos
chips de género), y confirmar visualmente: (a) el header en dos filas con etiquetas y badge
corto; (b) los chips de género en una fila con scroll, sin desalinear; (c) el inspector
integrado bajo el formulario. Tomar screenshot y documentarlo.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/ForeignTagsInspector.tsx
git commit -m "Integrar el inspector de otros metadatos con el formulario"
```

---

## Self-Review

**Cobertura del spec:**
- §1 Header en dos filas + etiquetas Archivo/Etiquetas → Task 3 ✓
- §1 Badge acortado a "En biblioteca"/"In library", mismas claves i18n → Task 2 ✓
- §2 Chips en fila con scroll horizontal → Task 1 ✓
- §3 Integración del inspector → Task 4 ✓
- Fuera de alcance (grid de campos, B/C, lógica de datos) → sin tasks ✓

**Placeholders:** ninguno — cada step tiene código o comando concreto. Task 4 step 2 pide
leer el contenedor actual antes de editar (su clase exacta depende del código de la Task 9
del rediseño previo), lo cual es correcto: el implementador lee y aplica el borde/padding.

**Consistencia de tipos/nombres:** testids nuevos: `field-suggestions` (Task 1),
`actions-file-label`/`actions-tags-label` (Task 3). Claves i18n: `editor.actionsFile`/
`editor.actionsTags` (Task 3); valores acortados de `editor.inLibrary` etc. (Task 2). El
badge conserva testid `apple-music-status`. Sin colisiones.
