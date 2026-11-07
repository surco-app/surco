# Árbol optimista y arrastre de playlists: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que crear, renombrar, borrar y mover nodos del árbol de playlists se pinten en el acto, y que las playlists y carpetas se puedan arrastrar entre hermanas y dentro de carpetas en rekordbox, Traktor y Serato.

**Architecture:** Un kind nuevo de `RekordboxPlaylistEdit`, `moveNode`, recorre el mismo camino que `rename`: IPC, cola, escritor por programa. En el renderer, una función pura `editedTree` calcula el árbol tal como quedará y `useRekordboxEdits` lo escribe en la caché de TanStack antes de esperar al programa, como ya hace con `move`. `SourceTree` gana arrastre nativo HTML5 con un tipo de `dataTransfer` propio.

**Tech Stack:** Electron, React 19, TypeScript, TanStack Query, Vitest + Testing Library (jsdom), better-sqlite3 (rekordbox), NML como texto (Traktor), ficheros `.crate` (Serato), Biome.

**Spec:** `docs/superpowers/specs/2026-11-07-arbol-optimista-y-arrastre-design.md`

## Global Constraints

- Cero comentarios de código nuevos. Lo que haya que explicar va en el nombre del test.
- Un test rojo antes de cada cambio de producción. Correr vitest desde `apps/desktop` (desde la raíz salta el setup).
- Los tests de UI seleccionan por `data-testid`; nunca por clase CSS.
- Sin librerías nuevas: el arrastre es `draggable` + `dataTransfer`.
- `beforeId: null` significa «la última del padre»; `parentId: 'root'` es el primer nivel.
- Seis locales (`de`, `en`, `es`, `fr`, `ja`, `pt-BR`) reciben cada clave nueva.
- Commits con título descriptivo, sin prefijos `feat:`/`fix:`, sin cuerpo. Cada tarea termina con la suite verde: `cd apps/desktop && npx vitest run` y `npm run lint`.
- Una fila `pending:` es inerte: no se selecciona, no abre menú, no recibe nada, no se arrastra.

## Review Focus

- Mover una carpeta de rekordbox a la raíz cuando ya era de la raíz (solo reorden) no debe tocar el XML espejo salvo el `Timestamp`. Test en la Tarea 3.
- Soltar la playlist seleccionada «dentro» de una carpeta de rekordbox conserva la selección y la lista abierta (mismo id). Test en la Tarea 8.
- Un `delete` optimista de la carpeta que contiene la playlist abierta la deselecciona sin el aviso «ya no está». Test en la Tarea 7.
- Un nodo `pending:` recién creado no responde a un clic ni a un arrastre encima durante los milisegundos que vive. Test en la Tarea 9.
- Arrastrar un nodo del árbol y soltarlo sobre la lista de pistas no abre el overlay de importación ni añade nada. Test en la Tarea 11.

---

### Task 1: El kind `moveNode` existe de punta a punta sin escribir nada todavía

**Files:**
- Modify: `apps/desktop/src/shared/types.ts:1244-1253`
- Modify: `apps/desktop/src/main/rekordboxQueueOps.ts:79-87`
- Modify: `apps/desktop/src/renderer/src/i18n/locales/{de,en,es,fr,ja,pt-BR}.json` (bloque `rekordboxQueue.part.tree`)
- Test: `apps/desktop/src/renderer/src/lib/rekordboxQueueText.test.ts`, `apps/desktop/src/main/rekordboxQueueOps.test.ts`

**Interfaces:**
- Produces: `RekordboxPlaylistEdit` gana `{ kind: 'moveNode'; playlistId: string; parentId: string; beforeId: string | null }`. `EDIT_RANK.moveNode === 3`. Clave `rekordboxQueue.part.tree.moveNode`.

- [ ] **Step 1: Test rojo del texto de la píldora**

En `rekordboxQueueText.test.ts`, junto a los tests de `part.kind === 'tree'` existentes:

```ts
it('names a node move in the queue pill', () => {
  expect(partText(tr, { kind: 'tree', edit: 'moveNode' })).toBe('move')
})
```

(Usar el helper que el fichero ya use para las partes `tree`; si no hay, llamar a la función exportada que `rekordboxQueueText.ts:187` implementa.)

- [ ] **Step 2: Test rojo del rango**

En `rekordboxQueueOps.test.ts`:

```ts
it('ranks a node move with renames, after creates and track edits and before deletes', () => {
  const rank = (edit: RekordboxPlaylistEdit) => opRank({ id: 'x', kind: 'edit', edit, stamps: {} })
  expect(rank({ kind: 'moveNode', playlistId: 'a', parentId: 'root', beforeId: null })).toBe(
    rank({ kind: 'rename', playlistId: 'a', name: 'b' }),
  )
})
```

- [ ] **Step 3: Correr los dos tests y ver que fallan**

Run: `cd apps/desktop && npx vitest run src/renderer/src/lib/rekordboxQueueText.test.ts src/main/rekordboxQueueOps.test.ts`
Expected: fallo de tipos en `moveNode` y clave `rekordboxQueue.part.tree.moveNode` ausente.

- [ ] **Step 4: Añadir el kind al tipo, el rango y las seis claves**

Textos: es «mover», en «move», de «verschieben», fr «déplacer», ja «移動», pt-BR «mover».

- [ ] **Step 5: Correr los tests y `keys.test.ts`**

Run: `cd apps/desktop && npx vitest run src/renderer/src/lib/rekordboxQueueText.test.ts src/main/rekordboxQueueOps.test.ts src/renderer/src/i18n`
Expected: PASS. El typecheck del renderer y de main pasa: `npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/rekordboxQueueOps.ts apps/desktop/src/renderer/src/i18n/locales apps/desktop/src/renderer/src/lib/rekordboxQueueText.test.ts apps/desktop/src/main/rekordboxQueueOps.test.ts
git commit -m "Name a playlist node move as an edit the queue can carry"
```

---

### Task 2: rekordbox mueve el nodo en `master.db`

**Files:**
- Modify: `apps/desktop/src/main/rekordboxPlaylistEdit.ts` (junto a `createNode`/`renameNode`/`deleteNode`, y `editProblem:293-320`)
- Test: `apps/desktop/src/main/rekordboxPlaylistEdit.test.ts` (usa el fixture `NESTED` ya definido en el test: COMBOS 1000 [Factory 2000, SUB 1100 [Deep 1110]], House 3000, Trial 4000)

**Interfaces:**
- Produces: `export function moveNode(db: Db, id: string, parentId: string, beforeId: string | null, ctx: EditContext): void`. Lanza `EditRefused('stale')` en los rechazos. `editProblem` devuelve `'stale'` para los mismos casos sin escribir.

- [ ] **Step 1: Tests rojos**

```ts
describe('moveNode', () => {
  beforeEach(async () => {
    db.close()
    db = await openFixture(NESTED)
  })

  it('moves a playlist into a folder before the sibling it was dropped on, renumbering both parents', () => {
    moveNode(db, '3000', '1000', '2000', ctx)
    expect(live('3000')).toMatchObject({ Seq: 1, usn: 501, updated_at: STAMP })
    expect(db.prepare('SELECT ParentID FROM djmdPlaylist WHERE ID = ?').get('3000')).toEqual({ ParentID: '1000' })
    expect(live('2000')?.Seq).toBe(2)
    expect(live('1100')?.Seq).toBe(3)
    expect(live('4000')?.Seq).toBe(2)
  })

  it('moves a folder to the end of the root with everything inside it, closing the gap it left', () => {
    moveNode(db, '1000', 'root', null, ctx)
    expect(live('1000')?.Seq).toBe(3)
    expect(live('3000')?.Seq).toBe(1)
    expect(live('4000')?.Seq).toBe(2)
    expect(nodeSubtree(db, '1000').sort()).toEqual(['1000', '1100', '1110', '2000'])
  })

  it('reorders among the same siblings without touching other parents', () => {
    moveNode(db, '1100', '1000', '2000', ctx)
    expect(live('1100')?.Seq).toBe(1)
    expect(live('2000')?.Seq).toBe(2)
    expect(live('3000')?.Seq).toBe(2)
  })

  it('refuses a parent inside the moved folder, a playlist as parent, a target that is not a child of the parent, and a node that is gone', () => {
    expect(() => moveNode(db, '1000', '1100', null, ctx)).toThrow(EditRefused)
    expect(() => moveNode(db, '1000', '1000', null, ctx)).toThrow(EditRefused)
    expect(() => moveNode(db, '3000', '2000', null, ctx)).toThrow(EditRefused)
    expect(() => moveNode(db, '2000', '1000', '3000', ctx)).toThrow(EditRefused)
    expect(() => moveNode(db, '9999', 'root', null, ctx)).toThrow(EditRefused)
  })
})
```

Y en `describe('editProblem')`:

```ts
it('flags a node move whose parent is inside the node or whose target is not there, before rekordbox is closed', () => {
  expect(editProblem(db, { kind: 'moveNode', playlistId: '1000', parentId: '2000', beforeId: null })).toBe('stale')
  expect(editProblem(db, { kind: 'moveNode', playlistId: '3000', parentId: '1000', beforeId: '9999' })).toBe('stale')
  expect(editProblem(db, { kind: 'moveNode', playlistId: '3000', parentId: '1000', beforeId: '2000' })).toBeNull()
  expect(editProblem(db, { kind: 'moveNode', playlistId: '3000', parentId: 'root', beforeId: null })).toBeNull()
})
```

(El `editProblem` corre sobre `ORGANISE_FIXTURE`: 2000 es playlist, así que «padre dentro del nodo» se prueba con padre playlist; añadir el caso de subárbol con `NESTED` si se quiere.)

- [ ] **Step 2: Correr y ver el rojo**

Run: `cd apps/desktop && npx vitest run src/main/rekordboxPlaylistEdit.test.ts`
Expected: `moveNode is not a function` y los `editProblem` nuevos devuelven `null` donde se espera `'stale'`.

- [ ] **Step 3: Implementar `moveNode` y la rama de `editProblem`**

Reglas: nodo con `nodeAttribute` 0 o 1; padre `'root'` o `nodeAttribute === 1`; padre ∉ `nodeSubtree(db, id)`; `beforeId` (si no es null) es hija viva del padre y distinta de `id`. Renumerar las hermanas de origen posteriores con `Seq - 1` (como `deleteNode`), las de destino desde el `Seq` de `beforeId` con `+1`, y actualizar la fila movida con `ParentID`, `Seq`, `rb_local_usn = takeLocalUsn`, `updated_at = rekordboxStamp`. Toda fila renumerada recibe también `rb_local_usn` y `updated_at`, como en `deleteNode`.

- [ ] **Step 4: Verde**

Run: `cd apps/desktop && npx vitest run src/main/rekordboxPlaylistEdit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/rekordboxPlaylistEdit.ts apps/desktop/src/main/rekordboxPlaylistEdit.test.ts
git commit -m "Move a rekordbox playlist or folder to another parent or position in master.db"
```

---

### Task 3: rekordbox refleja el padre nuevo en `masterPlaylists6.xml` y escribe el edit

**Files:**
- Modify: `apps/desktop/src/main/rekordboxMasterXml.ts` (junto a `withNodeTimestamp`)
- Modify: `apps/desktop/src/main/rekordboxPlaylistWrite.ts:349-400` (`writeEdit`)
- Test: `apps/desktop/src/main/rekordboxMasterXml.test.ts`, `apps/desktop/src/main/rekordboxPlaylistWrite.test.ts`

**Interfaces:**
- Consumes: `moveNode` (Tarea 2).
- Produces: `export function withNodeParent(xml: string, id: string, parentId: string): string`, que cambia solo el atributo `ParentId` del `NODE` con ese `Id` (en hex, raíz `0`) y deja el texto igual si el nodo no está.

- [ ] **Step 1: Tests rojos del XML**

En `rekordboxMasterXml.test.ts` (fixture `THREE` del fichero):

```ts
it('moves only the one node ParentId, so the rest of the file stays byte for byte', () => {
  expect(withNodeParent(THREE, '2000', 'root')).toBe(THREE.replace(/(Id="7D0" ParentId=")[^"]+(")/, '$10$2'))
})

it('leaves the text alone when the node to reparent is missing', () => {
  expect(withNodeParent(THREE, '4000', 'root')).toBe(THREE)
})
```

(Ajustar el hex del `Id` al que `THREE` use para 2000: `7D0`.)

- [ ] **Step 2: Test rojo de la escritura**

En `rekordboxPlaylistWrite.test.ts`, junto a `'creates a playlist in the database and its node in the XML'`:

```ts
it('moves a playlist into a folder in the database and repoints its XML node, stamping it', async () => {
  const path = await collection()
  const xmlPath = join(path, '..', 'masterPlaylists6.xml')
  const result = await editRekordboxPlaylist(
    path,
    { kind: 'moveNode', playlistId: '3000', parentId: '1000', beforeId: '2000' },
    deps(),
  )
  expect(result).toEqual({ applied: true })
  const xml = await readFile(xmlPath, 'utf8')
  expect(xml).toMatch(/<NODE Id="BB8" ParentId="3E8" [^>]*Timestamp="1792087200000"/)
})

it('keeps the XML node where it was for a move that only reorders siblings, beyond its Timestamp', async () => {
  const path = await collection()
  const xmlPath = join(path, '..', 'masterPlaylists6.xml')
  const before = await readFile(xmlPath, 'utf8')
  await editRekordboxPlaylist(path, { kind: 'moveNode', playlistId: '3000', parentId: 'root', beforeId: '1000' }, deps())
  const after = await readFile(xmlPath, 'utf8')
  expect(after.replace(/Timestamp="\d+"/g, '')).toBe(before.replace(/Timestamp="\d+"/g, ''))
})
```

(`collection()` escribe el fixture con `xml: true`: un `NODE` por playlist con `ParentId` en hex; 3000 nace con `ParentId="0"`.)

- [ ] **Step 3: Rojo**

Run: `cd apps/desktop && npx vitest run src/main/rekordboxMasterXml.test.ts src/main/rekordboxPlaylistWrite.test.ts`
Expected: `withNodeParent is not a function`; el write devuelve `applied: true` sin tocar nada o falla por el kind desconocido.

- [ ] **Step 4: Implementar**

`withNodeParent` como `withNodeTimestamp` con `ParentId`. En `writeEdit`, rama `moveNode`: `moveNode(db, …)`; si `draft.xml !== null` y el padre cambia, `draft.xml = withNodeParent(draft.xml, id, parentId)`; siempre `bumpNode(draft, edit.playlistId)`; `return done()`. La rama va antes del `delete` final, que hoy es el caso por defecto.

- [ ] **Step 5: Verde y suite de main**

Run: `cd apps/desktop && npx vitest run src/main`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/rekordboxMasterXml.ts apps/desktop/src/main/rekordboxMasterXml.test.ts apps/desktop/src/main/rekordboxPlaylistWrite.ts apps/desktop/src/main/rekordboxPlaylistWrite.test.ts
git commit -m "Write a node move to rekordbox, repointing its XML node when the parent changes"
```

---

### Task 4: Traktor mueve el nodo en el NML

**Files:**
- Modify: `apps/desktop/src/main/traktorPlaylistEdit.ts:103-145` (`apply`, antes de `if (!playlist)`)
- Test: `apps/desktop/src/main/traktorPlaylistEdit.test.ts` (fixture `DOC`: raíz [Preparation `prep`, Sets `folder:Sets` [Friday `fri`, Top smartlist], Sets `folder:Sets#2` [Old `folder:Sets#2/Old`], Drum & Bass `dnb`])

**Interfaces:**
- Consumes: kind `moveNode` (Tarea 1). Los sellos salen por la rama por defecto de `traktorPlaylistEditIpc.ts:31-41` sin cambios.

- [ ] **Step 1: Tests rojos**

```ts
describe('moving a node', () => {
  it('moves a playlist into a folder before the child it was dropped on, recounting both parents', () => {
    const { nml, outcomes } = run(op({ kind: 'moveNode', playlistId: 'dnb', parentId: 'folder:Sets', beforeId: 'fri' }, 'dnb'))
    expect([...outcomes.values()][0].applied).toBe(true)
    expect(readTraktorTree(nml).map((n) => n.name)).toEqual(['Preparation', 'Sets', 'Sets'])
    expect(nodeById(parsePlaylists(nml), 'folder:Sets')?.children.map((c) => c.name)).toEqual(['Drum & Bass', 'Friday', 'Top'])
    expect(nml).toContain('<NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="3">')
    expect(nml).toContain('<NODE TYPE="FOLDER" NAME="Sets"><SUBNODES COUNT="3">')
    expect(outsidePlaylists(nml)).toBe(outsidePlaylists(DOC))
  })

  it('moves a folder with everything inside it to the end of the root', () => {
    const { nml } = run(op({ kind: 'moveNode', playlistId: 'folder:Sets', parentId: 'root', beforeId: null }, 'folder:Sets'))
    expect(readTraktorTree(nml).map((n) => n.name)).toEqual(['Preparation', 'Sets', 'Drum & Bass', 'Sets'])
    expect(rows(nml, 'fri')).toEqual(['a.mp3', '|', 'a.mp3'])
  })

  it('lets a playlist land before one of Traktor’s own, which are ordinary root nodes', () => {
    const { nml } = run(op({ kind: 'moveNode', playlistId: 'dnb', parentId: 'root', beforeId: 'prep' }, 'dnb'))
    expect(readTraktorTree(nml).map((n) => n.name)).toEqual(['Drum & Bass', 'Preparation', 'Sets', 'Sets'])
  })

  it('refuses to move Traktor’s own playlists, a folder into itself or its children, and onto a target that is not there', () => {
    const refused = (edit: RekordboxPlaylistEdit) => [...run(op(edit)).outcomes.values()][0]
    expect(refused({ kind: 'moveNode', playlistId: 'prep', parentId: 'folder:Sets', beforeId: null })).toMatchObject({ applied: false, reason: 'stale' })
    expect(refused({ kind: 'moveNode', playlistId: 'folder:Sets#2', parentId: 'folder:Sets#2/Old', beforeId: null })).toMatchObject({ applied: false, reason: 'stale' })
    expect(refused({ kind: 'moveNode', playlistId: 'folder:Sets#2', parentId: 'folder:Sets#2', beforeId: null })).toMatchObject({ applied: false, reason: 'stale' })
    expect(refused({ kind: 'moveNode', playlistId: 'dnb', parentId: 'folder:Sets', beforeId: 'nope' })).toMatchObject({ applied: false, reason: 'stale' })
    expect(refused({ kind: 'moveNode', playlistId: 'dnb', parentId: 'fri', beforeId: null })).toMatchObject({ applied: false, reason: 'stale' })
  })

  it('refuses the move when the DJ changed the node since', () => {
    const changed = { ...op({ kind: 'moveNode', playlistId: 'dnb', parentId: 'root', beforeId: null }, 'dnb'), stamps: { dnb: 1 } }
    expect([...run(changed).outcomes.values()][0]).toMatchObject({ applied: false, reason: 'stale' })
  })
})
```

- [ ] **Step 2: Rojo**

Run: `cd apps/desktop && npx vitest run src/main/traktorPlaylistEdit.test.ts`
Expected: fallos de tipo o `stale` donde se espera `applied`.

- [ ] **Step 3: Implementar la rama en `apply`**

`resolve` ya encuentra `node` por `playlistId`. En la rama: `parent = parentId === 'root' ? model root : nodeById(model, parentId)` (el `model` hay que pasarlo o resolver el padre en `resolve`: añadir `parent: ModelNode | null` a `Resolved`, calculado solo para `moveNode`). Rechazar `stale` si `node.id === 'root'`, `builtIn(node)`, `node.kind === 'smartlist'`, `parent` nulo o no carpeta, `parent` es `node` o un descendiente de `node` (subir por `.parent`), o `beforeId` no nulo sin hija con ese id en `parent`. Quitar de `node.parent.children`, insertar en `parent.children` en el índice de `beforeId` o al final, `node.parent = parent`, `dirty = true` en los dos padres. `done()`.

- [ ] **Step 4: Verde**

Run: `cd apps/desktop && npx vitest run src/main/traktorPlaylistEdit.test.ts src/main/traktorPlaylistEditIpc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/traktorPlaylistEdit.ts apps/desktop/src/main/traktorPlaylistEdit.test.ts
git commit -m "Move a Traktor playlist or folder to another parent or position in the NML"
```

---

### Task 5: Serato cambia el padre de un crate renombrando su familia

**Files:**
- Modify: `apps/desktop/src/main/seratoCrateEdits.ts` (`seratoNameTaken:73-92`, `seratoEditFiles:97-125`, `applySeratoEdit:306-368`)
- Modify: `apps/desktop/src/main/seratoPlaylistEditIpc.ts:13-16` (`badName`)
- Test: `apps/desktop/src/main/seratoCrateEdits.test.ts`

**Interfaces:**
- Consumes: `crateIdOf`, `crateFamily`, `crateFileOf` de `seratoCrateFile.ts`.
- Produces: `moveNode` aplicado en Serato: cada fichero `f` de la familia de `id` pasa a `crateIdOf(parentId, crateName(id)) + f.slice(id.length)`. `beforeId` se ignora.

- [ ] **Step 1: Tests rojos**

```ts
const moveNode = (playlistId: string, parentId: string): RekordboxPlaylistEdit => ({ kind: 'moveNode', playlistId, parentId, beforeId: null })

describe('moving a crate', () => {
  it('moves a crate and its subcrates under another crate in every root, keeping their bytes', async () => {
    const { roots, deps, bytes } = twoRoots({ internal: ['A', 'A%%B', 'A%%B%%C', 'D'], gig: ['A%%B'] })
    const outcome = await apply(roots, deps, moveNode('A%%B', 'D'))
    expect(outcome.applied).toBe(true)
    expect(readFileSync(crateFileOf(roots[0], 'D%%B%%C'))).toEqual(bytes.internal['A%%B%%C'])
    expect(existsSync(crateFileOf(roots[1], 'D%%B'))).toBe(true)
    expect(listCrates(roots[0])).toEqual(['A.crate', 'D%%B%%C.crate', 'D%%B.crate', 'D.crate'])
  })

  it('moves a subcrate to the root', async () => {
    const { roots, deps } = twoRoots({ internal: ['A', 'A%%B'] })
    await apply(roots, deps, moveNode('A%%B', 'root'))
    expect(listCrates(roots[0])).toEqual(['A.crate', 'B.crate'])
  })

  it('ignores the position asked for, since Serato lists crates by name', async () => {
    const { roots, deps } = twoRoots({ internal: ['A', 'B'] })
    const outcome = await apply(roots, deps, { kind: 'moveNode', playlistId: 'B', parentId: 'root', beforeId: 'A' })
    expect(outcome.applied).toBe(true)
    expect(listCrates(roots[0])).toEqual(['A.crate', 'B.crate'])
  })

  it('refuses a move into itself, into its own subcrate, onto a name the destination already has, or under a crate that is gone', async () => {
    const { roots, deps } = twoRoots({ internal: ['A', 'A%%B', 'D', 'D%%B'] })
    expect(await apply(roots, deps, moveNode('A', 'A'))).toMatchObject({ applied: false, reason: 'stale' })
    expect(await apply(roots, deps, moveNode('A', 'A%%B'))).toMatchObject({ applied: false, reason: 'stale' })
    expect(await apply(roots, deps, moveNode('A%%B', 'D'))).toMatchObject({ applied: false, reason: 'bad-name' })
    expect(await apply(roots, deps, moveNode('A%%B', 'Z'))).toMatchObject({ applied: false, reason: 'stale' })
  })

  it('stamps the family it will rename and claims the new paths, so a crate Serato touched meanwhile refuses it', () => {
    const { roots } = twoRoots({ internal: ['A', 'A%%B', 'D'] })
    const files = seratoEditFiles(moveNode('A%%B', 'D'), roots)
    expect(files[crateFileOf(roots[0], 'A%%B')]).toEqual({ tracks: [] })
    expect(files[crateFileOf(roots[0], 'D%%B')]).toBeNull()
  })
})
```

(Ajustar `tracks: []` a lo que `twoRoots` meta en los crates; mirar los tests de `seratoEditFiles` existentes.)

- [ ] **Step 2: Rojo**

Run: `cd apps/desktop && npx vitest run src/main/seratoCrateEdits.test.ts`
Expected: `moveNode` cae en `refused('write-failed')`.

- [ ] **Step 3: Implementar**

`seratoNameTaken` acepta `moveNode`: la familia es la del nodo y el id candidato `crateIdOf(parentId, crateName(playlistId))`. `seratoEditFiles` trata `moveNode` como `rename` con ese id nuevo. `applySeratoEdit`: rama `moveNode` antes del `if (edit.kind !== 'rename' && …)`: rechazar `stale` si `parentId === id` o `parentId.startsWith(`${id}%%`)`, o si `parentId !== 'root'` y ninguna raíz tiene el crate padre (`createRoots`); `bad-name` si `seratoNameTaken`; renombrar la familia con `draft.rename` + `recordRename` como `rename`. `badName` del IPC incluye `moveNode` en la llamada a `seratoNameTaken` (sin `validCrateName`, que el nombre no cambia).

- [ ] **Step 4: Verde**

Run: `cd apps/desktop && npx vitest run src/main/seratoCrateEdits.test.ts src/main/seratoPlaylistEditIpc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/seratoCrateEdits.ts apps/desktop/src/main/seratoCrateEdits.test.ts apps/desktop/src/main/seratoPlaylistEditIpc.ts
git commit -m "Move a Serato crate under another crate by renaming its family"
```

---

### Task 6: `editedTree`, el árbol tal como quedará

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/playlistEdits.ts`
- Test: `apps/desktop/src/renderer/src/lib/playlistEdits.test.ts`

**Interfaces:**
- Produces:
  - `export const PENDING_NODE = 'pending:'` y `export const isPendingNode = (id: string): boolean`.
  - `export function editedTree(nodes: SourceNode[], edit: RekordboxPlaylistEdit, options?: { crates?: boolean }): SourceNode[] | null`.
  - `export function subtreeIds(nodes: SourceNode[], id: string): string[]` (el nodo y todo lo que cuelga; `[]` si no está).
  - `export function movedCrateId(id: string, parentId: string): string` (`parentId === 'root' ? name : parentId + '%%' + name`, con `name` el último segmento de `id`).

- [ ] **Step 1: Tests rojos**

Con un árbol `TREE`: `A` carpeta [`a1` playlist, `A2` carpeta [`a21` playlist]], `b` playlist, `c` playlist.

```ts
describe('editedTree', () => {
  it('draws a created playlist last in its parent with a pending id and no tracks', () => {
    const next = editedTree(TREE, { kind: 'create', parentId: 'A', name: 'New', folder: false })
    const created = next?.[0].children?.at(-1)
    expect(created).toMatchObject({ name: 'New', kind: 'playlist', count: 0 })
    expect(created?.id.startsWith(PENDING_NODE)).toBe(true)
  })
  it('draws a created folder with an empty children list, so it can open', () => {
    const next = editedTree(TREE, { kind: 'create', parentId: 'root', name: 'F', folder: true })
    expect(next?.at(-1)).toMatchObject({ name: 'F', kind: 'folder', count: 0, children: [] })
  })
  it('renames in place', () => {
    expect(editedTree(TREE, { kind: 'rename', playlistId: 'a21', name: 'X' })?.[0].children?.[1].children?.[0].name).toBe('X')
  })
  it('removes a deleted folder with everything inside', () => {
    expect(editedTree(TREE, { kind: 'delete', playlistId: 'A' })?.map((n) => n.id)).toEqual(['b', 'c'])
  })
  it('moves a node before the sibling named, into another parent', () => {
    const next = editedTree(TREE, { kind: 'moveNode', playlistId: 'c', parentId: 'A', beforeId: 'A2' })
    expect(next?.[0].children?.map((n) => n.id)).toEqual(['a1', 'c', 'A2'])
    expect(next?.map((n) => n.id)).toEqual(['A', 'b'])
  })
  it('moves a folder with its children to the end of the root', () => {
    const next = editedTree(TREE, { kind: 'moveNode', playlistId: 'A', parentId: 'root', beforeId: null })
    expect(next?.map((n) => n.id)).toEqual(['b', 'c', 'A'])
    expect(next?.[2].children?.map((n) => n.id)).toEqual(['a1', 'A2'])
  })
  it('has no answer for a move into the node itself or its children, or onto a target that is gone', () => {
    expect(editedTree(TREE, { kind: 'moveNode', playlistId: 'A', parentId: 'A2', beforeId: null })).toBeNull()
    expect(editedTree(TREE, { kind: 'moveNode', playlistId: 'A', parentId: 'A', beforeId: null })).toBeNull()
    expect(editedTree(TREE, { kind: 'moveNode', playlistId: 'c', parentId: 'A', beforeId: 'nope' })).toBeNull()
  })
  it('places a moved crate by name and renames it and its subcrates, as Serato will read them', () => {
    const crates: SourceNode[] = [
      { id: 'A', name: 'A', kind: 'playlist', count: 0, children: [{ id: 'A%%B', name: 'B', kind: 'playlist', count: 0, children: [{ id: 'A%%B%%C', name: 'C', kind: 'playlist', count: 0 }] }] },
      { id: 'D', name: 'D', kind: 'playlist', count: 0, children: [{ id: 'D%%E', name: 'E', kind: 'playlist', count: 0 }] },
    ]
    const next = editedTree(crates, { kind: 'moveNode', playlistId: 'A%%B', parentId: 'D', beforeId: 'D%%E' }, { crates: true })
    expect(next?.[1].children?.map((n) => n.id)).toEqual(['D%%B', 'D%%E'])
    expect(next?.[1].children?.[0].children?.[0].id).toBe('D%%B%%C')
  })
  it('leaves edits that do not change the tree alone', () => {
    expect(editedTree(TREE, { kind: 'add', playlistId: 'b', tracks: [] })).toBeNull()
  })
})

describe('subtreeIds', () => {
  it('lists the node and everything under it', () => {
    expect(subtreeIds(TREE, 'A')).toEqual(['A', 'a1', 'A2', 'a21'])
    expect(subtreeIds(TREE, 'nope')).toEqual([])
  })
})
```

- [ ] **Step 2: Rojo**

Run: `cd apps/desktop && npx vitest run src/renderer/src/lib/playlistEdits.test.ts`
Expected: funciones no exportadas.

- [ ] **Step 3: Implementar**

Sin mutar: cada función devuelve copias. Para `crates`, el nodo movido y su subárbol cambian de id con `movedCrateId` y se insertan ordenados por `name.toLowerCase().localeCompare` entre las hermanas (la regla de `seratoDatabase.sortNodes`).

- [ ] **Step 4: Verde**

Run: `cd apps/desktop && npx vitest run src/renderer/src/lib/playlistEdits.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/playlistEdits.ts apps/desktop/src/renderer/src/lib/playlistEdits.test.ts
git commit -m "Compute the playlist tree as it will read once a node edit is written"
```

---

### Task 7: Las desapariciones propias no avisan

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/ownRemovals.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/useSourceBrowser.ts:232-236`
- Test: `apps/desktop/src/renderer/src/lib/ownRemovals.test.ts`, `apps/desktop/src/renderer/src/hooks/useSourceBrowser.test.tsx`

**Interfaces:**
- Produces: `export function markOwnRemovals(ids: readonly string[]): void` y `export function takeOwnRemoval(id: string): boolean` (consume la marca; segunda llamada da `false`). Estado de módulo, como `lib/reorderDrag.ts`.

- [ ] **Step 1: Tests rojos**

`ownRemovals.test.ts`:

```ts
it('answers once for an id Surco itself removed, and never for another', () => {
  markOwnRemovals(['a', 'b'])
  expect(takeOwnRemoval('a')).toBe(true)
  expect(takeOwnRemoval('a')).toBe(false)
  expect(takeOwnRemoval('c')).toBe(false)
})
```

`useSourceBrowser.test.tsx`, junto a `'names the playlist that was deleted in rekordbox while it was open'`:

```ts
it('closes a playlist Surco itself deleted without saying it went away in rekordbox', async () => {
  const loadRekordboxTree = vi.fn().mockResolvedValueOnce([{ id: 'house', name: 'House', kind: 'playlist', count: 1 }]).mockResolvedValue([])
  const onPlaylistGone = vi.fn()
  const { result, focus } = setup({ loadRekordboxTree }, 'darwin', onPlaylistGone)
  act(() => result.current.selectSource('rekordbox'))
  await waitFor(() => expect(result.current.tree).toHaveLength(1))
  act(() => result.current.selectPlaylist({ id: 'house', name: 'House', kind: 'playlist', count: 1 }, []))
  markOwnRemovals(['house'])
  act(() => focus())
  await waitFor(() => expect(result.current.playlist).toBeNull())
  expect(onPlaylistGone).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Rojo**

Run: `cd apps/desktop && npx vitest run src/renderer/src/lib/ownRemovals.test.ts src/renderer/src/hooks/useSourceBrowser.test.tsx`
Expected: módulo inexistente; `onPlaylistGone` llamado una vez.

- [ ] **Step 3: Implementar**

En el efecto de `useSourceBrowser`: `if (!takeOwnRemoval(playlist.id)) onPlaylistGoneRef.current(playlist.name, source)`.

- [ ] **Step 4: Verde**

Run: `cd apps/desktop && npx vitest run src/renderer/src/lib/ownRemovals.test.ts src/renderer/src/hooks/useSourceBrowser.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/ownRemovals.ts apps/desktop/src/renderer/src/lib/ownRemovals.test.ts apps/desktop/src/renderer/src/hooks/useSourceBrowser.ts apps/desktop/src/renderer/src/hooks/useSourceBrowser.test.tsx
git commit -m "Close a playlist Surco itself removed without saying it went away in the program"
```

---

### Task 8: El hook pinta el árbol antes de escribir

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useRekordboxEdits.ts:22-36`
- Test: `apps/desktop/src/renderer/src/hooks/useRekordboxEdits.test.tsx`

**Interfaces:**
- Consumes: `editedTree`, `subtreeIds`, `isPendingNode` (Tarea 6), `markOwnRemovals` (Tarea 7), `SOURCE_PROGRAMS[source].crates`.

- [ ] **Step 1: Tests rojos**

El `setup` del test gana `loadRekordboxTree: vi.fn().mockResolvedValue(TREE)` en `window.api` y una query `['source-tree', 'rekordbox']` en el `renderHook`, expuesta como `tree`. `TREE`: `[{ id: 'A', name: 'A', kind: 'folder', count: 1, children: [{ id: 'a1', …playlist }] }, { id: 'b', …playlist }]`.

```ts
it('draws a created playlist in the tree at once, pending, and re-reads the tree after the write', async () => {
  let answer: (r: RekordboxEditResult) => void = () => {}
  const { result, loadRekordboxTree } = setup(new Promise((resolve) => { answer = resolve }))
  await waitFor(() => expect(result.current.tree).toHaveLength(2))
  let done: Promise<RekordboxEditResult> = Promise.resolve({ applied: true })
  act(() => { done = result.current.edit({ kind: 'create', parentId: 'A', name: 'New', folder: false }, 'New') })
  await waitFor(() => expect(result.current.tree?.[0].children?.map((n) => n.name)).toEqual(['a1', 'New']))
  expect(result.current.tree?.[0].children?.[1].id.startsWith('pending:')).toBe(true)
  await act(async () => { answer({ applied: true, createdId: '777' }); await done })
  expect(loadRekordboxTree).toHaveBeenCalledTimes(2)
})

it('draws a rename, a delete and a node move before the program answers', async () => {
  const { result } = setup(new Promise(() => {}))
  await waitFor(() => expect(result.current.tree).toHaveLength(2))
  act(() => { void result.current.edit({ kind: 'rename', playlistId: 'b', name: 'B2' }, 'b') })
  await waitFor(() => expect(result.current.tree?.[1].name).toBe('B2'))
  act(() => { void result.current.edit({ kind: 'moveNode', playlistId: 'b', parentId: 'A', beforeId: 'a1' }, 'b') })
  await waitFor(() => expect(result.current.tree?.[0].children?.map((n) => n.id)).toEqual(['b', 'a1']))
  act(() => { void result.current.edit({ kind: 'delete', playlistId: 'A' }, 'A') })
  await waitFor(() => expect(result.current.tree).toEqual([]))
})

it('returns to the real tree when the write is refused', async () => {
  let refuse: (r: RekordboxEditResult) => void = () => {}
  const { result } = setup(new Promise((resolve) => { refuse = resolve }))
  await waitFor(() => expect(result.current.tree).toHaveLength(2))
  let done: Promise<RekordboxEditResult> = Promise.resolve({ applied: true })
  act(() => { done = result.current.edit({ kind: 'delete', playlistId: 'b' }, 'b') })
  await waitFor(() => expect(result.current.tree).toHaveLength(1))
  await act(async () => { refuse({ applied: false, reason: 'cancelled' }); await done })
  await waitFor(() => expect(result.current.tree).toHaveLength(2))
})

it('marks what a delete takes as Surco’s own removal, so the open playlist closes quietly', async () => {
  const { result } = setup(new Promise(() => {}))
  await waitFor(() => expect(result.current.tree).toHaveLength(2))
  act(() => { void result.current.edit({ kind: 'delete', playlistId: 'A' }, 'A') })
  expect(takeOwnRemoval('a1')).toBe(true)
})

it('marks nothing for a move in rekordbox, whose ids survive it, so the moved open playlist stays open', async () => {
  const { result } = setup(new Promise(() => {}))
  await waitFor(() => expect(result.current.tree).toHaveLength(2))
  act(() => { void result.current.edit({ kind: 'moveNode', playlistId: 'b', parentId: 'A', beforeId: null }, 'b') })
  await waitFor(() => expect(result.current.tree?.[0].children?.map((n) => n.id)).toEqual(['a1', 'b']))
  expect(takeOwnRemoval('b')).toBe(false)
})

it('keeps the drawn tree over a re-read that started before the edit', …)
```

(El último sigue el patrón de `'keeps the drawn move over a re-read that started before it'` con `loadRekordboxTree` en vez de `loadRekordboxPlaylist`.)

- [ ] **Step 2: Rojo**

Run: `cd apps/desktop && npx vitest run src/renderer/src/hooks/useRekordboxEdits.test.tsx`
Expected: el árbol no cambia hasta la relectura.

- [ ] **Step 3: Implementar**

Antes del `save`, además del bloque `move`: `const treeKey = ['source-tree', source]`; `cancelQueries(treeKey)`; `setQueryData<SourceNode[]>(treeKey, (prev) => prev ? (editedTree(prev, edit, { crates }) ?? prev) : prev)`; si `edit.kind === 'delete'`, o `moveNode` con `crates`, `markOwnRemovals(subtreeIds(prev, edit.playlistId))` (calculado sobre el `prev` que recibe el updater). Las invalidaciones de después quedan como están.

- [ ] **Step 4: Verde**

Run: `cd apps/desktop && npx vitest run src/renderer/src/hooks/useRekordboxEdits.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/useRekordboxEdits.ts apps/desktop/src/renderer/src/hooks/useRekordboxEdits.test.tsx
git commit -m "Draw a created, renamed, deleted or moved node in the tree before the program writes it"
```

---

### Task 9: Filas inertes y filas arrastrables

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/reorderDrag.ts`
- Modify: `apps/desktop/src/renderer/src/components/SourceTree.tsx` (`row`, props `edit`)
- Test: `apps/desktop/src/renderer/src/lib/reorderDrag.test.ts`, `apps/desktop/src/renderer/src/components/SourceTree.test.tsx`

**Interfaces:**
- Produces:
  - `export const TREE_NODE_TYPE = 'application/x-surco-tree-node'` y `export function isTreeNodeDrag(e: { dataTransfer?: DataTransfer | null }): boolean` en `reorderDrag.ts`.
  - `edit.onMove: (node: SourceNode, parentId: string, beforeId: string | null, folders: string[]) => void` (obligatorio en `edit`; el `setup` del test lo añade como `vi.fn()`).
  - La fila arrastrable lleva `draggable="true"`; mientras se arrastra, `data-dragging`.

- [ ] **Step 1: Tests rojos**

`reorderDrag.test.ts`:

```ts
it('knows a tree node drag by its own type and never confuses it with a separator reorder', () => {
  expect(isTreeNodeDrag({ dataTransfer: { types: [TREE_NODE_TYPE] } as unknown as DataTransfer })).toBe(true)
  expect(isReorderDrag({ dataTransfer: { types: [TREE_NODE_TYPE] } as unknown as DataTransfer })).toBe(false)
  expect(isTreeNodeDrag({ dataTransfer: { types: ['Files'] } as unknown as DataTransfer })).toBe(false)
})
```

`SourceTree.test.tsx`, nuevo `describe('SourceTree dragging nodes')`:

```ts
it('lets playlists and folders be dragged where the tree can be edited, and nothing where it cannot', () => {
  setup(null, true)
  expect(screen.getByTestId('source-node-house')).toHaveAttribute('draggable', 'true')
  expect(screen.getByTestId('source-node-bases')).toHaveAttribute('draggable', 'true')
  cleanup()
  setup(null, false)
  expect(screen.getByTestId('source-node-house')).not.toHaveAttribute('draggable', 'true')
})

it('never drags Recently added, All tracks, Traktor’s own playlists, a pending node or a search hit', () => {
  // Recently added / All tracks: nodos con RECENTLY_ADDED_ID y ALL_TRACKS_ID, como en los describe existentes
  // Traktor: fixed={(n) => n.id === 'house' ? 'tracks-only' : null}
  // pending: { id: 'pending:x', name: 'New', kind: 'playlist', count: 0 }
  // búsqueda: escribir 'House' en source-tree-search y comprobar el hit
  // cada uno: expect(row).not.toHaveAttribute('draggable', 'true')
})

it('carries the node id under its own type and marks the row while it is dragged', () => {
  setup(null, true)
  const house = screen.getByTestId('source-node-house')
  const dt = fakeDataTransfer()
  fireEvent.dragStart(house, { dataTransfer: dt })
  expect(dt.getData(TREE_NODE_TYPE)).toBe('house')
  expect(dt.effectAllowed).toBe('move')
  expect(house).toHaveAttribute('data-dragging')
  fireEvent.dragEnd(house, { dataTransfer: dt })
  expect(house).not.toHaveAttribute('data-dragging')
})

it('keeps a pending node inert: no selection, no menu, no track drop', () => {
  const pending: SourceNode = { id: 'pending:x', name: 'New', kind: 'playlist', count: 0 }
  const onSelect = setup(null, true, [...NODES, pending])
  const row = screen.getByTestId('source-node-pending:x')
  fireEvent.click(row)
  expect(onSelect).not.toHaveBeenCalled()
  fireEvent.contextMenu(row)
  expect(screen.queryByTestId('source-tree-menu')).toBeNull()
  fireEvent.dragOver(row, { dataTransfer: files('a.wav') })
  expect(row).not.toHaveAttribute('data-drop-target')
})
```

- [ ] **Step 2: Rojo**

Run: `cd apps/desktop && npx vitest run src/renderer/src/lib/reorderDrag.test.ts src/renderer/src/components/SourceTree.test.tsx`
Expected: `TREE_NODE_TYPE` no exportado; filas sin `draggable`; el nodo pending responde.

- [ ] **Step 3: Implementar**

En `row`: `const pendingNode = isPendingNode(node.id)`; `nodeEdit` pasa a `undefined` también para `pendingNode`; `onClick` no hace nada para `pendingNode`. `canDrag = Boolean(edit) && !hits && !recent && !all && fixedAs === null && !pendingNode && renaming !== node.id`. En el botón: `draggable={canDrag || undefined}`, `onDragStart` (`effectAllowed = 'move'`, `setData(TREE_NODE_TYPE, node.id)`, `setDragging(node.id)`), `onDragEnd` (`setDragging(null)`), `data-dragging={dragging === node.id || undefined}` y la clase `opacity-50` con ese estado. Estado nuevo: `const [dragging, setDragging] = useState<string | null>(null)`.

- [ ] **Step 4: Verde**

Run: `cd apps/desktop && npx vitest run src/renderer/src/lib/reorderDrag.test.ts src/renderer/src/components/SourceTree.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/reorderDrag.ts apps/desktop/src/renderer/src/lib/reorderDrag.test.ts apps/desktop/src/renderer/src/components/SourceTree.tsx apps/desktop/src/renderer/src/components/SourceTree.test.tsx
git commit -m "Let playlists and folders be picked up in the tree, and keep a pending node inert"
```

---

### Task 10: Dónde cae el nodo

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/SourceTree.tsx` (`row`, `body`, contenedor de scroll)
- Test: `apps/desktop/src/renderer/src/components/SourceTree.test.tsx`

**Interfaces:**
- Consumes: `dragging`, `TREE_NODE_TYPE`, `isTreeNodeDrag`, `edit.onMove` (Tarea 9).
- Produces: `data-testid="source-tree-drop-line"` (línea de inserción, con `style.paddingLeft = 10 + depth * 18` del padre de destino), `data-drop-target` en la carpeta receptora de «dentro», `data-testid="source-tree-drop-end"` (zona bajo la última fila, destino raíz al final).

Estado: `const [dropAt, setDropAt] = useState<{ parentId: string; beforeId: string | null; inside: boolean; folders: string[] } | null>(null)`. `row` recibe además `parentId: string` y `siblings: SourceNode[]`.

Regla de posición en `dragOver` de una fila (solo si `isTreeNodeDrag(e)` y `dragging`): `box = currentTarget.getBoundingClientRect()`, `y = (e.clientY - box.top) / box.height`. Playlist: `y < 0.5` delante, si no detrás. Carpeta: `y < 0.25` delante, `y > 0.75` detrás, si no dentro. Con `edit.crates`: toda la fila es dentro. «Delante» = `{ parentId, beforeId: node.id, folders }`; «detrás» = `{ parentId, beforeId: siguiente hermana o null, folders }`; «dentro» = `{ parentId: node.id, beforeId: null, inside: true, folders: [...folders, node.name] }`. Se rechaza (sin `preventDefault`, `dropAt = null`) cuando el nodo es Recientes, Todas, `pending:`, el propio `dragging` o está dentro de su subárbol (`subtreeIds(nodes, dragging)` memoizado).

Regla de «mismo sitio» en el `drop`: el padre actual de `dragging` es `dropAt.parentId` y (`dropAt.beforeId` es `dragging` o es la hermana siguiente de `dragging`) → no se llama a `onMove`.

- [ ] **Step 1: Tests rojos**

Helper del test: `const dragNode = (id: string) => { const dt = fakeDataTransfer(); fireEvent.dragStart(screen.getByTestId(`source-node-${id}`), { dataTransfer: dt }); return dt }` y `const over = (el: HTMLElement, y: number, dt) => { vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 28 } as DOMRect); fireEvent.dragOver(el, { dataTransfer: dt, clientY: y }) }`.

```ts
it('draws the line before a playlist on its upper half and after it on the lower half, and moves there on drop', () => {
  const { edit } = setup(null, true)
  const dt = dragNode('house')
  const bases = screen.getByTestId('source-node-bases')
  over(bases, 3, dt)
  expect(screen.getByTestId('source-tree-drop-line')).toBeInTheDocument()
  fireEvent.drop(bases, { dataTransfer: dt })
  expect(edit.onMove).toHaveBeenCalledWith(NODES[2], 'root', 'bases', [])
})

it('drops inside a folder from its middle, opens it, and shows no line', () => {
  const { edit } = setup(null, true)
  const dt = dragNode('house')
  const bases = screen.getByTestId('source-node-bases')
  over(bases, 14, dt)
  expect(bases).toHaveAttribute('data-drop-target')
  expect(screen.queryByTestId('source-tree-drop-line')).toBeNull()
  fireEvent.drop(bases, { dataTransfer: dt })
  expect(edit.onMove).toHaveBeenCalledWith(NODES[2], 'bases', null, ['BASES'])
  expect(bases).toHaveAttribute('aria-expanded', 'true')
})

it('indents the line to the depth of the parent it lands in', () => {
  setup('ct', true)
  const dt = dragNode('house')
  over(screen.getByTestId('source-node-c90'), 3, dt)
  expect(screen.getByTestId('source-tree-drop-line')).toHaveStyle({ paddingLeft: '28px' })
})

it('lands last at the root when dropped under the last row', () => {
  const { edit } = setup(null, true)
  const dt = dragNode('cant')
  const end = screen.getByTestId('source-tree-drop-end')
  fireEvent.dragOver(end, { dataTransfer: dt })
  fireEvent.drop(end, { dataTransfer: dt })
  expect(edit.onMove).toHaveBeenCalledWith(NODES[0], 'root', null, [])
})

it('refuses a folder as a target inside itself or its children', () => {
  const { edit } = setup('ct', true)
  const dt = dragNode('cant')
  const c90 = screen.getByTestId('source-node-c90')
  over(c90, 14, dt)
  expect(c90).not.toHaveAttribute('data-drop-target')
  fireEvent.drop(c90, { dataTransfer: dt })
  expect(edit.onMove).not.toHaveBeenCalled()
})

it('sends nothing for a drop on the place the node already has', () => {
  const { edit } = setup(null, true)
  const dt = dragNode('bases')
  over(screen.getByTestId('source-node-house'), 3, dt)
  fireEvent.drop(screen.getByTestId('source-node-house'), { dataTransfer: dt })
  over(screen.getByTestId('source-node-cant'), 24, dt)
  fireEvent.drop(screen.getByTestId('source-node-cant'), { dataTransfer: dt })
  expect(edit.onMove).not.toHaveBeenCalled()
})

it('takes no node drop on Recently added or All tracks', …)  // como los tests de drop existentes de esos describe

it('keeps a node drop from reaching the window import', () => {
  const { onOuterDrop } = setup(null, true)
  const dt = dragNode('house')
  fireEvent.drop(screen.getByTestId('source-node-bases'), { dataTransfer: dt })
  expect(onOuterDrop).not.toHaveBeenCalled()
})

it('treats the whole crate row as inside and draws no line on Serato', () => {
  // setup del describe 'SourceTree on Serato crates' con edit.crates; arrastrar un crate sobre otro en y=3
  // expect(target).toHaveAttribute('data-drop-target'); expect(queryByTestId('source-tree-drop-line')).toBeNull()
  // drop → onMove(node, targetId, null, [...folders, target.name])
})
```

- [ ] **Step 2: Rojo**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/SourceTree.test.tsx`
Expected: nada de `source-tree-drop-line`, `onMove` nunca llamado.

- [ ] **Step 3: Implementar**

La línea se dibuja en el `ul` del padre: antes de cada hija `c` cuando `dropAt.parentId === parentId && dropAt.beforeId === c.id && !dropAt.inside`, y tras la última cuando `beforeId === null && !inside`. `data-drop-target` en la carpeta cuando `dropAt.inside && dropAt.parentId === node.id`. `drop` en fila: si `isTreeNodeDrag(e)` → `preventDefault`, `stopPropagation`, aplicar la regla de mismo sitio, `edit.onMove(...)`, abrir la carpeta si `inside`, `setDropAt(null)`, `setDragging(null)`. `dragLeave` limpia `dropAt` con la misma guarda de `relatedTarget` que el drop de pistas. La zona `source-tree-drop-end` es un `div` al final del contenedor de scroll con `flex-1 min-h-[28px]`, solo cuando hay `edit` y no hay `hits`.

- [ ] **Step 4: Verde**

Run: `cd apps/desktop && npx vitest run src/renderer/src/components/SourceTree.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/SourceTree.tsx apps/desktop/src/renderer/src/components/SourceTree.test.tsx
git commit -m "Drop a dragged playlist or folder between its siblings or inside a folder"
```

---

### Task 11: Cableado en `App`, ventana y verificación

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx:189,1311,2739-2800,3407,3415`
- Test: `apps/desktop/src/renderer/src/App.test.tsx` (`describe('drop target')`, hacia la línea 7915: `renderApp`, `addTwoTracks`, la raíz es `screen.getByTestId('sidebar').closest('.flex.h-screen')`)

**Interfaces:**
- Consumes: `edit.onMove` (Tarea 9), `isTreeNodeDrag` (Tarea 9), `movedCrateId` (Tarea 6), `editRekordbox`, `browser.selectPlaylist`, `browser.playlist`.

- [ ] **Step 1: Test rojo del overlay**

En `describe('drop target')`:

```ts
it('lights no column for a playlist dragged in the tree, which is not files arriving', async () => {
  await renderApp()
  await addTwoTracks()
  const root = screen.getByTestId('sidebar').closest('.flex.h-screen') as HTMLElement
  const dt = fakeDataTransfer()
  dt.setData(TREE_NODE_TYPE, 'house')
  fireEvent.dragEnter(root, { dataTransfer: dt })
  await new Promise((r) => setTimeout(r, 0))
  expect(screen.getByTestId('sidebar')).not.toHaveAttribute('data-drop-over', 'true')
})
```

- [ ] **Step 2: Rojo**

Run: `cd apps/desktop && npx vitest run src/renderer/src/App.test.tsx`
Expected: `sidebar` recibe `data-drop-over`.

- [ ] **Step 3: Implementar**

- `App.tsx:1311`: `if (own || isReorderDrag(e) || isTreeNodeDrag(e)) return`.
- `App.tsx:3407,3415`: `if (!isReorderDrag(e) && !isTreeNodeDrag(e) && draggedRows() === null)`.
- `moveInTree = useStableCallback((node, parentId, beforeId, folders) => { void editRekordbox({ kind: 'moveNode', playlistId: node.id, parentId, beforeId }, node.name); if (treeEdit.crates && browser.playlist?.id === node.id) browser.selectPlaylist({ ...node, id: movedCrateId(node.id, parentId) }, folders) })`. Añadir `onMove: moveInTree` a `treeEdit` y a sus dependencias.

- [ ] **Step 4: Verde, suite entera, lint y tipos**

Run: `cd apps/desktop && npx vitest run && npm run lint && npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: todo PASS, sin avisos.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.test.tsx
git commit -m "Wire the tree's node drag to the program's write and keep it off the import overlay"
```

- [ ] **Step 6: Comprobación en la app real**

Con rekordbox cerrado, `npm run dev` desde el worktree (ojo: el driver abre el `out/` del árbol desde el que se lanza). A mano: crear una playlist y ver que la fila no parpadea; renombrar y borrar; arrastrar una playlist entre dos, dentro de una carpeta, y una carpeta a la raíz; abrir rekordbox y confirmar que el árbol coincide. Lo mismo con Traktor cerrado si hay colección confirmada. Lo que no se pudo probar se dice tal cual en el informe final.
