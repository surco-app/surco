# Preguntar antes de dejar en cola: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando una acción del DJ va a escribir en la biblioteca de un programa de DJ abierto, Surco pregunta «Cerrar <programa> y aplicar» o «Aplicar al cerrarlo», en los cinco programas.

**Architecture:** Se pregunta en el renderer, en el momento de la acción, con una sola llamada nueva `window.api.dj.askToApply(programs)`. El proceso principal muestra un aviso por programa abierto, cierra el programa (o espera a que el DJ lo cierre) si se elige aplicar, y devuelve qué programas quedaron cerrados. Después la acción sigue por el camino silencioso que ya existe (`applyQuietly`, modo `queue` de las playlists): con el programa cerrado escribe al momento y, si sigue abierto, lo deja en cola. Así se pregunta una vez por programa y acción, aunque la acción haga varias llamadas.

**Tech Stack:** Electron (main + preload + renderer), React 19, TypeScript, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-11-12-preguntar-cerrar-programa-design.md`

## Global Constraints

- Trabajo en un worktree (`../surco-wt/preguntar-cerrar`), rama `preguntar-cerrar`, que sale de `main` local (lleva el arreglo del parpadeo `76f555d1d`). Merge a main local al final, sin push.
- Copia en seis idiomas (es, en, de, fr, pt-BR, ja). Main: `apps/desktop/src/main/i18n.ts` (es/en/de/fr/pt-BR en línea, ja en `apps/desktop/src/main/locales/ja.json`). Sin guion largo ni dos puntos explicativos.
- Cero comentarios de código. `data-testid` para selectores.
- Enter y Escape = «Aplicar al cerrarlo». Nunca se cierra un programa por defecto.
- Pregunta siempre. Nada se recuerda.
- Las escrituras que salen solas (`librarySizeFollow.ts`, `rekordboxCompleteOnClose.ts`, `rekordboxProvisional.ts`, `rekordboxQueueWatch.ts`) no cambian.
- La revisión de metadatos y sustituir duplicados de rekordbox, Engine y Traktor siguen con «Cerrar» / «Cancelar» (`createEnsureClosed`), salvo la Tarea 6.
- `tsc --build` desde `apps/desktop`, `npm run lint -w apps/desktop` y la suite completa (`npx vitest run` desde `apps/desktop`, nunca filtrando por ruta desde la raíz) en verde antes de cada commit.

## Review Focus

- El programa se reabre a mitad de una conversión larga tras «Cerrar y aplicar». Lo que queda debe ir a la cola sin volver a preguntar. Lo cubre la Tarea 2 (el flush final usa `applyQuietly`, que mira si está abierto en ese momento).
- Dos acciones a la vez sobre el mismo programa (guardar cues mientras termina una conversión). Debe salir un solo aviso. Lo cubre el test de aviso compartido de la Tarea 1.
- `quit()` falla o la espera de Serato o VirtualDJ se agota (unos 15 s). El cambio va a la cola, nunca se pierde. Lo cubre la Tarea 1.
- La comprobación de si el programa está abierto falla (pgrep sin respuesta). Debe tratarse como abierto y preguntar, como `closedWithoutAsking` (`libraryFlushes.ts:116-118`). Lo cubre la Tarea 1.
- Una acción que escribe en dos programas abiertos (rekordbox y Traktor en una conversión). Debe salir un aviso por programa, uno detrás de otro, no a la vez. Lo cubre la Tarea 1.

---

### Task 1: El aviso «Cerrar y aplicar» / «Aplicar al cerrarlo» y su IPC

**Files:**
- Modify: `apps/desktop/src/main/djProcesses.ts`
- Modify: `apps/desktop/src/main/seratoProcess.ts` (añadir la espera de salida)
- Modify: `apps/desktop/src/main/i18n.ts`, `apps/desktop/src/main/locales/ja.json`
- Modify: `apps/desktop/src/main/index.ts` (crear el preguntador junto a `ensureClosed`, `index.ts:843-848`, y registrar el IPC)
- Modify: `apps/desktop/src/shared/djApi.ts` (canal), `apps/desktop/src/preload/index.ts`, el tipo de `window.api.dj` y `apps/desktop/src/renderer/src/test/api.ts` (mock)
- Test: `apps/desktop/src/main/djProcesses.test.ts`, `apps/desktop/src/main/seratoProcess.test.ts`

**Interfaces:**
- Produces:
  - `type ApplyAnswer = 'now' | 'later'` en `djProcesses.ts`.
  - `createAskToApply(deps: { processes: Record<CueProgram, ProgramProcess>; ask: (win: BrowserWindow | null, opts: MessageBoxOptions) => Promise<number>; t: (key: MenuKey) => string }): (program: CueProgram, win: BrowserWindow | null) => Promise<ApplyAnswer>`.
  - `DJ_PROCESSES.serato` pasa a tener `quit: waitForSeratoExit`.
  - `waitForSeratoExit(): Promise<boolean>` en `seratoProcess.ts`, con el mismo contrato que `waitForVirtualdjExit`.
  - IPC `dj:ask-to-apply`, expuesto como `window.api.dj.askToApply(programs: CueProgram[]): Promise<Partial<Record<CueProgram, ApplyAnswer>>>`. Pregunta los programas en serie, en el orden recibido, y devuelve la respuesta de cada uno.

- [ ] **Step 1: Write the failing tests in `djProcesses.test.ts`**

```ts
describe('createAskToApply', () => {
  it('answers now without asking when the program is closed, so a closed program never shows a prompt', async () => {
    const ask = vi.fn()
    const answer = await askToApplyWith({ running: false, ask })('traktor', null)
    expect(answer).toBe('now')
    expect(ask).not.toHaveBeenCalled()
  })
  it('puts Apply when it closes first and as both Enter and Escape, so a habitual Enter never closes Traktor mid-set', async () => {
    const ask = vi.fn().mockResolvedValue(0)
    expect(await askToApplyWith({ running: true, ask })('traktor', null)).toBe('later')
    expect(ask.mock.calls[0][1]).toMatchObject({
      buttons: ['Aplicar al cerrarlo', 'Cerrar Traktor y aplicar'],
      defaultId: 0,
      cancelId: 0,
    })
  })
  it('closes the program and answers now when the DJ picks Close and apply', async () => {
    const quit = vi.fn().mockResolvedValue(true)
    expect(await askToApplyWith({ running: true, ask: async () => 1, quit })('rekordbox', null)).toBe('now')
    expect(quit).toHaveBeenCalledOnce()
  })
  it('answers later when the program would not close, so the change waits instead of being lost', async () => {
    expect(await askToApplyWith({ running: true, ask: async () => 1, quit: async () => false })('virtualdj', null)).toBe('later')
  })
  it('asks when the running check fails, as the quiet path counts it as open', async () => {
    const ask = vi.fn().mockResolvedValue(0)
    await askToApplyWith({ running: 'throws', ask })('engine', null)
    expect(ask).toHaveBeenCalledOnce()
  })
  it('shares one prompt between two asks for the same program at once', async () => {
    const ask = vi.fn().mockResolvedValue(0)
    const asker = askToApplyWith({ running: true, ask })
    await Promise.all([asker('traktor', null), asker('traktor', null)])
    expect(ask).toHaveBeenCalledOnce()
  })
  it('offers I closed it, apply for Serato and VirtualDJ, which Surco cannot close itself', async () => {
    const ask = vi.fn().mockResolvedValue(0)
    await askToApplyWith({ running: true, ask })('serato', null)
    expect(ask.mock.calls[0][1].buttons).toEqual(['Aplicar al cerrarlo', 'Lo he cerrado, aplicar'])
  })
})
```

`askToApplyWith` es un helper del test que monta `createAskToApply` con procesos falsos y `t` en español (`createMenuT('es')`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/djProcesses.test.ts`
Expected: FAIL, `createAskToApply` is not exported.

- [ ] **Step 3: Implement `createAskToApply` and the copy**

Usa `sharedPrompt` por programa, como `closer`. Opciones del aviso: `{ type: 'warning', message: t(<p>QuitMessage), detail: t(<p>ApplyDetail), buttons: [t('applyLater'), t(<p>ApplyNow)], defaultId: 0, cancelId: 0 }`. Respuesta `1` → `processes[program].quit()` → `true` da `'now'`, `false` da `'later'`. Una comprobación que lanza cuenta como abierto.

Claves nuevas (es / en; de, fr, pt-BR y ja traducidas de en):

| Clave | es | en |
|---|---|---|
| `applyLater` | Aplicar al cerrarlo | Apply when it closes |
| `rekordboxApplyNow` | Cerrar rekordbox y aplicar | Close rekordbox and apply |
| `traktorApplyNow` | Cerrar Traktor y aplicar | Close Traktor and apply |
| `engineApplyNow` | Cerrar Engine DJ y aplicar | Close Engine DJ and apply |
| `seratoApplyNow`, `virtualdjApplyNow` | Lo he cerrado, aplicar | I closed it, apply |
| `seratoQuitMessage` | Serato está abierto | Serato is open |
| `rekordboxApplyDetail`, `traktorApplyDetail`, `engineApplyDetail` | Surco puede cerrarlo y aplicar el cambio ahora, o guardarlo y aplicarlo cuando lo cierres tú. | Surco can close it and apply the change now, or keep it and apply it when you close it. |
| `seratoApplyDetail`, `virtualdjApplyDetail` | Ciérralo y pulsa «Lo he cerrado, aplicar», o Surco guarda el cambio y lo aplica cuando lo cierres. | Close it and press “I closed it, apply”, or Surco keeps the change and applies it when you close it. |

`waitForSeratoExit` en `seratoProcess.ts`, igual que `waitForVirtualdjExit`: sondea `isSeratoRunning` hasta que dé `false` o se agote el mismo plazo, y devuelve si llegó a cerrarse. Con su test en `seratoProcess.test.ts`, gemelo del de VirtualDJ.

Registra `dj:ask-to-apply` en `index.ts`: para cada programa recibido, en serie, `await askToApply(program, BrowserWindow.fromWebContents(e.sender))`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/djProcesses.test.ts src/main/seratoProcess.test.ts src/main/i18n.test.ts`
Expected: PASS. Si hay un test de paridad de claves entre idiomas, también.

- [ ] **Step 5: Commit**

`git commit -m "Ask whether to close a DJ program and apply now or apply when it closes"`

### Task 2: Convertir y actualizar preguntan al pulsar el botón

**Files:**
- Modify: `apps/desktop/src/main/libraryFlushes.ts` (función nueva que dice qué programas tocará una conversión)
- Modify: `apps/desktop/src/main/index.ts` (IPC)
- Modify: `apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts:585`, `:735`
- Test: `apps/desktop/src/main/libraryFlushes.test.ts`, `apps/desktop/src/renderer/src/hooks/useTrackProcessing.test.tsx`

**Interfaces:**
- Consumes: `window.api.dj.askToApply` (Task 1).
- Produces:
  - `conversionPrograms(paths: string[], deps: { traktorRead: () => string; rootLibraries: () => RootLibraries }): Promise<CueProgram[]>` en `libraryFlushes.ts`. Son los programas con su «Actualizar» o «Añadir» encendido y su biblioteca encontrada. Los que solo tienen «Actualizar» cuentan si guardan alguno de los `paths` (`djLibraryFileUse`). Los que tienen «Añadir» cuentan siempre.
  - IPC `process:programs-for`, expuesto como `window.api.conversionPrograms(paths: string[]): Promise<CueProgram[]>`.

- [ ] **Step 1: Write the failing tests**

En `libraryFlushes.test.ts`:
- `it('counts a program whose Update is on only when it holds one of the tracks, so converting files it does not know never asks to close it')`
- `it('counts a program whose Add is on for any track, since the conversion adds to it')`

En `useTrackProcessing.test.tsx`:
- `it('asks to close the open programs before converting, once for the whole batch')`: asserta que `window.api.dj.askToApply` se llama una vez, con los programas que devuelve `conversionPrograms`, antes del primer `processTrack`.
- `it('converts the same whatever the DJ answers, because the library write itself waits or applies')`: con `askToApply` resolviendo `{ traktor: 'later' }`, todas las pistas se convierten.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/libraryFlushes.test.ts src/renderer/src/hooks/useTrackProcessing.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

En `processAll` y `processOne`, antes de `beginConversionBatch()`: `const programs = await window.api.conversionPrograms(paths)`, y si hay alguno, `await window.api.dj.askToApply(programs)`. Las escrituras de fin de lote no cambian. Ya escriben si el programa está cerrado (`closedWithoutAsking`, `applyQuietly`) y, si se ha reabierto a mitad, lo dejan en cola.

- [ ] **Step 4: Run the tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "Ask to close the DJ programs a conversion reaches before it starts"`

### Task 3: Guardar cues y rejilla pregunta en los cinco programas

**Files:**
- Modify: el renderer que llama a `window.api.cues.save` (el Guardar del editor de cues y el Guardar del bloque «Rejilla» en lote)
- Modify: `apps/desktop/src/main/index.ts:1646-1686` (Traktor pasa a `applyQuietly` como el resto; se quita `applyTraktorCueQueueAsking`, `index.ts:714-726`, si queda sin uso)
- Test: el test del componente o hook que guarda y `apps/desktop/src/main/cuesIpc.test.ts`

**Interfaces:**
- Consumes: `window.api.dj.askToApply` (Task 1).

- [ ] **Step 1: Write the failing tests**

- `it('asks to close each program a save reaches before saving, once per Save')`, con una guardada que toca rekordbox y Traktor.
- `it('saves Traktor cues the quiet way, since the DJ already answered before saving')` en `cuesIpc.test.ts` o en su equivalente de `index`.

- [ ] **Step 2: Run them to verify they fail**
- [ ] **Step 3: Implement.** Antes de `cues.save`, `await window.api.dj.askToApply(<programas de la guardada>)`. En main, Traktor usa `programQueues.traktor.applyQuietly()`.
- [ ] **Step 4: Run them to verify they pass**
- [ ] **Step 5: Commit** `git commit -m "Ask to close the program before saving cues, in every DJ program"`

### Task 4: Playlists, pegar tracklist y sesión automática preguntan una vez por acción

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx:3000-3016` (ediciones del árbol), el flujo de «Pegar tracklist…» y `apps/desktop/src/renderer/src/hooks/useSessionWrite.ts:40-61`
- Modify: `apps/desktop/src/main/rekordboxPlaylistsIpc.ts:164-178`, `enginePlaylistEditIpc.ts:39-42`, `traktorPlaylistEditIpc.ts:59-62`: el modo «ask» desaparece y se queda solo el silencioso.
- Test: los tests de esos IPC y de `useSessionWrite`

**Interfaces:**
- Consumes: `window.api.dj.askToApply` (Task 1).
- Produces: las llamadas de edición de playlists ya no llevan `mode`. Todas escriben si el programa está cerrado y, si no, lo dejan en cola y devuelven `{ queued: true }`.

- [ ] **Step 1: Write the failing tests**

- `it('asks once for a session that creates, fills and deletes playlists, not once per write')` en `useSessionWrite`.
- `it('asks before a tree edit in Serato and VirtualDJ too, as in the other programs')`.
- `it('reports a queued edit as waiting, never as refused')` en `rekordboxPlaylistsIpc.test.ts`. Hoy, «Cancelar» devuelve que se rechazó y aun así lo deja en cola (`:174-178`).

- [ ] **Step 2: Run them to verify they fail**
- [ ] **Step 3: Implement.** En cada acción del renderer, `await window.api.dj.askToApply([program])` y después las llamadas de siempre. En main se quita la rama del modo «ask» de los tres IPC. Si `createEnsureClosed` pierde su razón `playlists`, se quita de `QUIT_REASONS` y `QUIT_TEXT`, junto con sus claves de copia.
- [ ] **Step 4: Run them to verify they pass**
- [ ] **Step 5: Commit** `git commit -m "Ask once per playlist action to close the program, in every DJ program"`

### Task 5: «Aplicar ahora», «Reintentar» y reparar daños preguntan

**Files:**
- Modify: el renderer que llama a «Aplicar ahora» del panel de cola (`rekordboxQueueIpc.ts:44-47`, `engineCueQueueIpc.ts:28-29`, `traktorCueQueueIpc.ts:28-29`, `waitingCueQueueIpc.ts:17-22`), a `verify:retry` y a `damage:repair`
- Modify: esos IPC en main pasan al camino silencioso
- Test: sus tests

**Interfaces:**
- Consumes: `window.api.dj.askToApply` (Task 1).

- [ ] **Step 1: Write the failing tests**

- `it('asks before Apply now in Serato and VirtualDJ, which today only check silently')`.
- `it('asks to close the programs a Retry writes to')`.
- `it('asks to close Traktor or Engine DJ before repairing their damage')`.

- [ ] **Step 2: Run them to verify they fail**
- [ ] **Step 3: Implement.** Igual que en las tareas 3 y 4. Si `cues` deja de usarse en `QUIT_REASONS`, se quita.
- [ ] **Step 4: Run them to verify they pass**
- [ ] **Step 5: Commit** `git commit -m "Ask to close the program before Apply now, Retry and damage repairs"`

### Task 6: La revisión de metadatos de Traktor deja de perder los cambios al cancelar

**Files:**
- Modify: `apps/desktop/src/main/libraryFlushes.ts:813-817` (`traktorWriteDeps` del sync de la revisión)
- Test: `apps/desktop/src/main/libraryFlushes.test.ts`

- [ ] **Step 1: Write the failing test.** `it('keeps a review rename for Traktor in its queue when the DJ cancels closing it, instead of dropping it')`. Con Traktor abierto y «Cancelar», los parches quedan en la cola de Traktor (`holdInQueue`) y se aplican al cerrarlo.
- [ ] **Step 2: Run it to verify it fails.** Hoy no se pasa cola y los parches se pierden.
- [ ] **Step 3: Implement.** Pasa al `flushTraktorSync` de la revisión la misma `queue` de `holdInQueue(traktorQueue, bootVolumeName)` que usa la conversión (`libraryFlushes.ts:492`), y deja el aviso `createEnsureClosed` como está.
- [ ] **Step 4: Run it to verify it passes**
- [ ] **Step 5: Commit** `git commit -m "Keep a Traktor review rename queued when the DJ will not close Traktor"`

### Task 7: Batería con el programa abierto, prueba en la app e inventario

**Files:**
- Modify: `apps/desktop/src/scenarios/djPrograms/battery.test.tsx` y su `door.ts`
- Modify: `docs/funcionalidades.md`

- [ ] **Step 1: Write the battery cases**

Para cada programa de `DJ_PROGRAMS`, con el programa «abierto» en la puerta de pruebas:
- `it('writes at once when the DJ picks Close and apply')`: el aviso devuelve `1`, el proceso falso se cierra y la biblioteca cambia antes de que termine la acción.
- `it('leaves the change waiting when the DJ picks Apply when it closes, and writes it once the program closes')`.
- `it('never asks for a write that follows on its own')`: el seguidor de tamaño, con el programa abierto, no muestra aviso.

- [ ] **Step 2: Run the battery**

Run: `cd apps/desktop && npx vitest run src/scenarios`
Expected: PASS.

- [ ] **Step 3: Prueba en la app.** `electron-vite build`. Proceso falso compilado con `cc` y llamado `Traktor Pro 4`, como el 12/11. Con la copia de la colección: Actualizar etiquetas, «Cerrar Traktor y aplicar» (el proceso falso termina y el caché de carátulas se reescribe), y otra vez con «Aplicar al cerrarlo» (no se reescribe hasta matar el proceso). Comprobar también que la lista de cada programa se queda quieta (contar mutaciones del DOM 3 s: menos de 50).

- [ ] **Step 4: Inventario.** En `docs/funcionalidades.md`, el texto de «programa abierto» pasa de «espera en la cola sin preguntar» a «pregunta, y espera solo si lo eliges». Actualizar la fecha de revisión.

- [ ] **Step 5: Commit**

`git commit -m "Check every DJ program with the program open in both answers"`

Después, merge a main local (`git merge --no-ff preguntar-cerrar`), sin push. La release la hace `/release` cuando el usuario lo pida: antes, pushear main y esperar el CI en verde.
