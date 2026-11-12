# Informes que bastan para diagnosticar: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada informe de comentarios traiga por qué murió un proceso, qué hacía el usuario antes, dónde en el código y con qué datos, y que el usuario sepa que hubo una caída.

**Architecture:** Un anillo de muestras de memoria en el principal (`memoryWatch.ts`) que se vuelca al log cuando un proceso muere, cuelga o cruza un umbral; la ventana manda cada 30 s su heap y sus recuentos. El informe deja de llevar solo líneas `[error]`: lleva el contexto previo con marcos de pila y una cabecera de entorno (`diagHeader.ts`). Un rastro de una línea por acción sale del principal (envoltorio de `ipcMain.handle`, como `logHandlerFailures`) y de la ventana (`window.api.logInfo`, que ya existe). Tras una recarga por caída, la ventana muestra un toast con el informe prellenado.

**Tech Stack:** Electron 45 (main + preload sandbox), React 19, electron-log, Vitest, Biome. Servidor del correo en `apps/web` (Vercel, Resend).

**Spec:** `docs/superpowers/specs/2026-11-12-diagnostico-informes-design.md`

## Global Constraints

- Todo en un worktree aislado, nunca directo en main; al acabar, merge a main local sin push.
- TDD: cada tarea ve su test en rojo antes del código. Cero comentarios en el código nuevo. Tests con `data-testid`.
- Nada sale del equipo hasta que el usuario pulsa enviar o abre el issue. Sin telemetría.
- Todo lo que viaja pasa por `stripPaths` (errorReport.ts). Nombres de fichero permitidos en las dos vías (decisión del usuario 12/11). Nunca tokens, contraseñas, correos ni rutas completas.
- Cuerpo del POST por debajo de `MAX_BODY_BYTES` = 64 KB del servidor; URL de GitHub ≤ `MAX_URL_LENGTH` = 7500; el recorte se come el log, nunca la cabecera.
- El muestreo no escribe en el log en cada muestra: solo al volcar (muerte de proceso) y una línea `[warn]` por cruce de umbral.
- Rastro: una línea `[info]` por acción con trabajo detrás, nunca por pista ni por clic.
- Textos visibles en es, en, de, fr, pt-BR, ja; sin guion largo ni dos puntos explicativos.
- Cada canal IPC nuevo se cablea en `src/renderer/src/test/api.ts` y `src/scenarios/harness.tsx`.
- Verificación por tarea, desde `apps/desktop`: `npx vitest run <ficheros>`; al cerrar cada tarea, los tres `npx tsc --noEmit -p tsconfig.web.json`, `-p tsconfig.node.json`, `-p tsconfig.scenarios.json` y `npx biome lint src` sin avisos.

## Review Focus

- Una ventana que muere en bucle (cuatro caídas en 22 min de epaulo1908): el toast sale una vez por caída y el volcado no repite muestras ya volcadas. Test en Task 2 y Task 8.
- Informe enviado justo tras la recarga: la cabecera dice «al caer» con los recuentos de antes de la caída, no los de la ventana vacía. Test en Task 5.
- Log enorme o con una pila de 200 marcos: el informe sigue por debajo de 64 KB y la URL por debajo de 7500. Test en Task 4 y Task 5.
- Una línea de contexto con ruta de Windows o de macOS con espacios: viaja solo el nombre. Test en Task 4.
- Sin ninguna muestra todavía (caída en los primeros 30 s): el volcado dice que no hay muestras y no lanza. Test en Task 1.

---

### Task 1: Anillo de memoria (`memoryWatch.ts`)

**Files:**
- Create: `apps/desktop/src/main/memoryWatch.ts`
- Test: `apps/desktop/src/main/memoryWatch.test.ts`
- Create: `apps/desktop/src/shared/diagnostics.ts`

**Interfaces:**
- Produces, en `shared/diagnostics.ts`:
  ```ts
  export interface WindowSnapshot { heapUsedMb: number; heapLimitMb: number; listTracks: number; source: string | null; sourceTracks: number | null }
  export interface ProcessSample { type: string; name?: string; pid: number; workingSetMb: number; peakMb: number }
  export interface MemorySample { at: number; processes: ProcessSample[]; window: WindowSnapshot | null }
  export interface LastCrash { reason: string; exitCode: number; at: number }
  ```
- Produces, en `memoryWatch.ts`:
  ```ts
  export interface MemoryWatchDeps { metrics: () => ProcessSample[]; now: () => number; logger: { warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void }; highMb: number; size: number }
  export interface MemoryWatch { sample(): void; window(snapshot: WindowSnapshot): void; lastWindow(): WindowSnapshot | null; dump(why: string): void }
  export function createMemoryWatch(deps: MemoryWatchDeps): MemoryWatch
  export function processSamples(metrics: Electron.ProcessMetric[]): ProcessSample[]
  ```
  `processSamples` convierte `app.getAppMetrics()` (KB) a MB redondeados. `sample()` añade una muestra con la última `window()` recibida y descarta las más viejas por encima de `size`. `dump(why)` escribe una sola entrada `logger.error('memory before ' + why, ...)` con todas las muestras del anillo que no se hayan volcado ya. `highMb` = 3072 y `size` = 20 en el cableado (Task 2).

- [ ] **Step 1: Tests en rojo** (`memoryWatch.test.ts`)
  - `keeps only the last size samples, so a long session never grows the ring`: size 3, 5 × `sample()`, `dump('x')` → la entrada lleva 3 muestras y la más vieja es la 3ª.
  - `dumps nothing twice, so a renderer dying four times in a row reports each stretch once`: `sample()`, `dump('a')`, `sample()`, `dump('b')` → la segunda entrada lleva una muestra.
  - `says there were no samples instead of throwing when the window dies in its first 30 s`: `dump('x')` sin muestras → `logger.error` llamado una vez con un texto que contiene `no samples`.
  - `warns once per crossing, so a process sitting above the threshold does not flood the log`: proceso a 4000 MB en 3 muestras seguidas, luego 1000, luego 4000 → `logger.warn` llamado 2 veces.
  - `stamps every sample with the last window snapshot so a dump after a crash shows what the window held`: `window({listTracks: 8001, …})`, `sample()`, `dump()` → la muestra lleva `listTracks: 8001`; `lastWindow()` lo devuelve.
  - `converts Electron metrics from KB to MB`: `processSamples([{ type: 'Tab', pid: 1, memory: { workingSetSize: 2048, peakWorkingSetSize: 4096 } } as any])` → `[{ type: 'Tab', pid: 1, workingSetMb: 2, peakMb: 4 }]`.
- [ ] **Step 2:** `npx vitest run src/main/memoryWatch.test.ts` → FAIL (módulo no existe).
- [ ] **Step 3:** Implementar `shared/diagnostics.ts` y `memoryWatch.ts` con las firmas de arriba.
- [ ] **Step 4:** `npx vitest run src/main/memoryWatch.test.ts` → PASS.
- [ ] **Step 5:** Commit `Keep the last memory samples of every Surco process to log them when one dies`.

### Task 2: Procesos que mueren o se cuelgan, y el muestreo cableado

**Files:**
- Modify: `apps/desktop/src/main/crashGuards.ts` (`wireRendererRecovery` y dos funciones nuevas)
- Test: `apps/desktop/src/main/crashGuards.test.ts`
- Modify: `apps/desktop/src/main/index.ts` (zona de `installCrashGuards` ~l.313 y `wireRendererRecovery` ~l.972)

**Interfaces:**
- Consumes: `MemoryWatch`, `LastCrash` (Task 1).
- Produces:
  ```ts
  export function wireRendererRecovery(contents: RendererContents, logger: CrashLogger, onGone?: (crash: LastCrash) => void): void
  export function wireChildProcessGone(appEvents: ChildGoneEvents, logger: CrashLogger, onGone: (why: string) => void): void
  export function wireUnresponsive(contents: HangEvents, logger: CrashLogger & { warn: (...a: unknown[]) => void }, now: () => number, longMs: number): void
  ```
  `RendererContents` añade `{ exitCode: number }` a `GoneDetails`. `onGone` de `wireRendererRecovery` recibe `{ reason, exitCode, at }` ANTES de `reload()`. `ChildGoneEvents.on('child-process-gone', (e, d: { type, reason, exitCode, name? }) => …)` registra `[error] child process gone` con los cuatro campos salvo `clean-exit`/`killed`, y llama a `onGone(type)`. `wireUnresponsive` registra `[warn] window unresponsive` al colgarse y, al volver (`responsive`), `[warn]` o `[error]` si estuvo ≥ `longMs` (10 000) colgada, con los ms.
- En `index.ts`: una `memoryWatch` única (`highMb: 3072`, `size: 20`, `metrics: () => processSamples(app.getAppMetrics())`), `setInterval(() => watch.sample(), 30_000)` tras `app.whenReady`; `onGone` del renderer hace `watch.dump('render process gone')` y guarda el `LastCrash` en una variable del módulo (la lee Task 8); `ipcMain.on('diag:snapshot', (_e, s) => watch.window(s))` validando que sea objeto con números; `wireChildProcessGone(app, log, (t) => watch.dump(t + ' gone'))`; `wireUnresponsive(win.webContents, log, Date.now, 10_000)`.

- [ ] **Step 1: Tests en rojo** (`crashGuards.test.ts`)
  - `hands the crash to onGone before reloading, so the dump and the notice see the dead window's state`: orden de llamadas `onGone` → `reload`, `onGone` recibe `{ reason: 'crashed', exitCode: 5 }` y un `at` numérico.
  - `logs a GPU or utility process that dies, which used to vanish without a line`: `child-process-gone` con `{ type: 'GPU', reason: 'crashed', exitCode: 11 }` → `logger.error` con esos campos y `onGone('GPU')`.
  - `ignores child processes that exit on purpose`: `reason: 'clean-exit'` → ni log ni `onGone`.
  - `logs how long the window hung, as an error past ten seconds`: `unresponsive` en t=0, `responsive` en t=12 000 → `logger.error` con `12000`; con t=3 000 → `logger.warn`.
- [ ] **Step 2:** `npx vitest run src/main/crashGuards.test.ts` → FAIL.
- [ ] **Step 3:** Implementar las tres funciones y el cableado de `index.ts` descrito arriba.
- [ ] **Step 4:** `npx vitest run src/main/crashGuards.test.ts src/main/memoryWatch.test.ts` → PASS; los tres `tsc` y `biome lint src` limpios.
- [ ] **Step 5:** Commit `Log processes that die or hang with the memory samples before it`.

### Task 3: La ventana manda su heap y sus recuentos cada 30 s

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`, `apps/desktop/src/preload/api.ts`
- Create: `apps/desktop/src/renderer/src/hooks/useWindowSnapshot.ts`
- Test: `apps/desktop/src/renderer/src/hooks/useWindowSnapshot.test.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx` (llamar al hook), `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx`

**Interfaces:**
- Consumes: `WindowSnapshot` (Task 1), canal `diag:snapshot` (Task 2).
- Produces: `window.api.reportSnapshot(counts: Omit<WindowSnapshot, 'heapUsedMb' | 'heapLimitMb'>): void`. El preload completa `heapUsedMb`/`heapLimitMb` con `process.getHeapStatistics()` (KB → MB; disponible en el preload con sandbox) y hace `ipcRenderer.send('diag:snapshot', …)`. Así se evita el redondeo de `performance.memory`.
- `useWindowSnapshot(read: () => { listTracks: number; source: string | null; sourceTracks: number | null }, everyMs = 30_000): void`: manda una al montar y luego cada `everyMs`; lee con la función en el momento de mandar (no re-renderiza App). En App, `read` sale de refs: `tracksRef.current.length`, `browser.source`, y las pistas de la playlist abierta.

- [ ] **Step 1: Tests en rojo** (`useWindowSnapshot.test.tsx`, timers falsos)
  - `reports once on mount and every 30 s, reading the counts at send time`: `read` devuelve 10 y luego 20 → `reportSnapshot` llamado con `listTracks: 10` al montar y `listTracks: 20` a los 30 s.
  - `stops reporting after unmount`: desmontar y avanzar 60 s → sin llamadas nuevas.
- [ ] **Step 2:** `npx vitest run src/renderer/src/hooks/useWindowSnapshot.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar el hook, el método del preload y su tipo, el `noop` en `test/api.ts` y en el arnés; llamar al hook desde App.
- [ ] **Step 4:** Tests del hook → PASS; la suite entera (`npx vitest run`) verde, porque App cambia; los tres `tsc` y `biome` limpios.
- [ ] **Step 5:** Commit `Send the window's heap and track counts to main every 30 seconds`.

### Task 4: El informe lleva el contexto y los marcos de pila

**Files:**
- Modify: `apps/desktop/src/main/errorReport.ts`
- Test: `apps/desktop/src/main/errorReport.test.ts`
- Modify: `apps/desktop/src/main/feedback.ts` (`readRecentErrors` usa la función nueva)

**Interfaces:**
- Produces: `export function recentContextLines(log: string, opts: { errors: number; before: number; frames: number }): string[]`. Toma los últimos `errors` (40) errores; para cada uno, las `before` (40) entradas de cualquier nivel que lo preceden, sin repetir entradas compartidas entre ventanas; conserva los primeros `frames` (8) marcos `at …` de cada pila; todo por `stripPaths`; las ventanas que no se tocan se separan con una línea `…`. `recentErrorLines` desaparece si nada más la usa.

- [ ] **Step 1: Tests en rojo** (`errorReport.test.ts`)
  - `carries what happened before an error, not only the error`: log con 3 `[info]` y un `[error]` → salen las 4 entradas en orden.
  - `does not repeat lines shared by two close errors`: dos errores separados por 2 infos con `before: 5` → cada línea sale una vez.
  - `keeps the first stack frames so a minified renderer stack can be mapped back`: error con 20 marcos y `frames: 8` → 8 líneas `at …`, con rutas reducidas al nombre de fichero.
  - `reduces Windows and macOS paths with spaces in context lines to the file name`: `[info] read C:\Users\Ana\Música\DJ Sets\Pray (Mix).wav` y `/Users/ana/Music/DJ Sets/Pray (Mix).wav` → solo `Pray (Mix).wav`.
  - `bounds the output on a pathological log`: 5 000 errores con pilas de 200 marcos → como mucho `errors × (before + 1 + frames)` líneas.
- [ ] **Step 2:** `npx vitest run src/main/errorReport.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `recentContextLines` y usarla en `readRecentErrors` con `{ errors: 40, before: 40, frames: 8 }`.
- [ ] **Step 4:** `npx vitest run src/main/errorReport.test.ts src/main/feedback.test.ts` → PASS (ajustar los tests de feedback que fijaban solo líneas `[error]`).
- [ ] **Step 5:** Commit `Send the log lines before each error and its first stack frames in a report`.

### Task 5: Cabecera de entorno en las dos vías

**Files:**
- Create: `apps/desktop/src/main/diagHeader.ts`
- Test: `apps/desktop/src/main/diagHeader.test.ts`
- Modify: `apps/desktop/src/main/feedback.ts`, `apps/desktop/src/main/feedback.test.ts`
- Modify: `apps/web/src/lib/feedbackMail.ts`, `apps/web/src/lib/feedbackMail.test.ts`

**Interfaces:**
- Consumes: `WindowSnapshot`, `LastCrash` (Task 1); `watch.lastWindow()` y el `LastCrash` guardado (Task 2).
- Produces:
  ```ts
  export interface HeaderFacts { os: string; arch: string; totalMemMb: number; freeMemMb: number; uptimeMin: number; atCrash: WindowSnapshot | null; now: WindowSnapshot | null; lastCrash: LastCrash | null; programs: { program: string; configured: boolean; running: boolean }[]; settings: Settings }
  export function headerLines(facts: HeaderFacts): string[]
  ```
  Ajustes que salen, y ninguno más: `outputFormat`, `overwriteOriginal`, `convertBesideOriginal`, `keepMp3Sources`, `backupPolicy`, `normalize.mode`, `language`, `addToAppleMusic`, `addToRekordbox`, `addToTraktor`, `addToEngineDj`, `addToSerato`, `addToVirtualdj`, `syncRekordbox`, `syncTraktor`, `syncEngineDj`, `syncSerato`, `syncVirtualdj`. «Al caer» sale solo si hay `lastCrash`.
  `FeedbackContext` y el POST ganan `header: string[]`. En GitHub la cabecera va arriba y el recorte por delante (`MAX_URL_LENGTH`) corta solo la sección del log. En el servidor, `parse` acepta `header` (array de strings, filtrado como `logLines`) y `body` lo pinta después de la línea de versión.
- En `feedback.ts`, una función `gatherHeader(): Promise<string[]>` reúne los hechos: `os.release()`/`process.getSystemVersion()`, `os.totalmem()`/`os.freemem()`, `process.uptime()`, `isRunning()` de cada `DJ_PROCESSES` con `catch → false`, `configured` = su ruta de biblioteca o su `sync*`/`addTo*` activos, y los ajustes de `getSettings()`.

- [ ] **Step 1: Tests en rojo**
  - `diagHeader.test.ts` › `lists only the settings that change what Surco does to files, never tokens or paths`: `settings` con `discogsToken: 'secret'` y `outputDir: '/Users/ana/x'` → ninguna línea contiene `secret` ni `/Users`; contiene `outputFormat` y `syncRekordbox`.
  - `diagHeader.test.ts` › `describes the window as it was when it crashed, apart from the reloaded one`: `atCrash.listTracks = 8001`, `now.listTracks = 0`, `lastCrash` presente → una línea «al caer» con `8001` y otra «ahora» con `0`.
  - `diagHeader.test.ts` › `says which DJ programs were open`: rekordbox `running: true` → la línea lo marca abierto.
  - `feedback.test.ts` › `keeps the header whole when the GitHub URL has to be trimmed`: log de 20 000 caracteres → la URL ≤ 7500 y contiene todas las líneas de cabecera.
  - `feedback.test.ts` › `posts the header with the report`: el cuerpo del POST lleva `header`.
  - `feedback.test.ts` › `stays under the server's 64 KB with a huge log`: cuerpo serializado < 64 × 1024 bytes.
  - `feedbackMail.test.ts` › `prints the header in the mail under the version line`.
- [ ] **Step 2:** `npx vitest run src/main/diagHeader.test.ts src/main/feedback.test.ts` en `apps/desktop` y el test del correo en `apps/web` (`npx vitest run src/lib/feedbackMail.test.ts`) → FAIL.
- [ ] **Step 3:** Implementar `diagHeader.ts`, `gatherHeader`, el recorte que respeta la cabecera, el tope de bytes del POST (recortar el log por delante hasta caber) y el campo en el servidor.
- [ ] **Step 4:** Los mismos tests → PASS; `tsc`/`biome` de desktop limpios y los checks de `apps/web` (los que use su `package.json`).
- [ ] **Step 5:** Commit `Head every report with the system, the DJ programs and the settings that shape what Surco does`.

### Task 6: Rastro de acciones del principal

**Files:**
- Create: `apps/desktop/src/main/actionTrail.ts`
- Test: `apps/desktop/src/main/actionTrail.test.ts`
- Modify: `apps/desktop/src/main/index.ts` (instalar justo después de `logHandlerFailures(ipcMain, log)`, ~l.314)

**Interfaces:**
- Produces:
  ```ts
  export type Describe = (args: unknown[], result: unknown, ms: number) => string | null
  export function logActions<E, A extends unknown[]>(ipc: HandlerRegistry<E, A>, logger: { info: (...a: unknown[]) => void }, describers: Record<string, Describe>, now?: () => number): void
  export const ACTION_DESCRIBERS: Record<string, Describe>
  ```
  Envuelve `ipc.handle` como `logHandlerFailures` (reutilizar su `HandlerRegistry`, exportándolo). Solo los canales de la tabla escriben, una línea `[info] action <texto> (<ms> ms)` al resolver; si el handler lanza, no escribe (ya lo hace `logHandlerFailures`). Tabla mínima, con recuentos y nunca títulos:
  - `dj:playlist` → `open <program> playlist: <n> tracks`
  - `dj:collection` → `read <program> collection: <n> tracks`
  - `dj:ask-to-apply` → `asked to close <programs>: <answers>`
  - `dj:applyCueQueue` → `apply <program> queue`
  - `dj:editPlaylist` → `<program> playlist <edit.kind>`
  - `usb:export` → `usb export: <ok|failed>`
  Además, `export function startLine(facts: { version: string; os: string; arch: string; totalMemMb: number }): string` y una línea `[info] quit after <min> min` en `before-quit`, ambas cableadas en `index.ts`.

- [ ] **Step 1: Tests en rojo** (`actionTrail.test.ts`, registry falso)
  - `startLine names the version, system and memory so every log opens with the machine it ran on`.
  - `writes one line per listed action with its count and time`: handler de `dj:playlist` que devuelve 3 pistas, `now` 0→120 → `logger.info` con `open rekordbox playlist: 3 tracks (120 ms)`.
  - `stays silent for channels not in the table, so per-track calls never flood the log`: `process:track` → sin llamadas.
  - `writes nothing when the handler throws, leaving the failure to logHandlerFailures`.
  - `never carries a track title`: `dj:playlist` con pistas `{ title: 'Pray' }` → la línea no contiene `Pray`.
- [ ] **Step 2:** `npx vitest run src/main/actionTrail.test.ts` → FAIL.
- [ ] **Step 3:** Implementar y cablear en `index.ts`. Cada describer lee la forma real del resultado de su canal (comprobar los tipos en `shared/djApi.ts` y `usbExportIpc.ts`).
- [ ] **Step 4:** Tests → PASS; los tres `tsc` y `biome` limpios.
- [ ] **Step 5:** Commit `Log one line per DJ library action with its count and how long it took`.

### Task 7: Rastro de los lotes que decide la ventana

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts` (`processAll` ~l.702 y `processOne` ~l.578)
- Modify: `apps/desktop/src/renderer/src/hooks/useAutoMatch.ts`, `apps/desktop/src/renderer/src/hooks/useSessionRun.ts`, `apps/desktop/src/renderer/src/hooks/useMusicReview.ts` (revisar), y el hook de la colección donde vive `addPaths` (lectura con `audio:metaCached`)
- Test: los `.test.tsx` de esos hooks

**Interfaces:**
- Consumes: `window.api.logInfo(message: string): void` (ya existe, canal `log:info`).
- Produces: líneas `batch <kind> start: <n> tracks, <format>, <destination>` y `batch <kind> end: <ok>/<failed>/<skipped> in <s> s`, con `kind` ∈ `convert` | `update` | `match` | `session` | `review`. La lectura de una importación deja `read <n> files: <cached> from cache, <read> read in <s> s` al vaciarse su cola (una línea por importación, no por fichero). `update` cuando el lote no cambia de formato (misma decisión que ya toma el botón «Actualizar etiquetas»).

- [ ] **Step 1: Tests en rojo**
  - `useTrackProcessing.test.tsx` › `logs a batch once at start and once at the end, not per track`: `processAll` de 3 ids → `logInfo` llamado 2 veces; la primera contiene `3 tracks`.
  - `useTrackProcessing.test.tsx` › `logs a single-track update as a batch of one`: `processOne` → `start: 1 tracks` y `end`.
  - `useAutoMatch.test.tsx` › `logs the match run with how many tracks it queued`.
  - `useSessionRun.test.tsx` › `logs a session run with its track count`.
  - `useMusicReview.test.tsx` › `logs a review run with what it found and what it applied`.
  - test del hook de la colección › `logs one read line per import with how many came from the cache`: 3 ficheros, 2 en caché → una sola línea con `2 from cache, 1 read`.
- [ ] **Step 2:** `npx vitest run` de esos tres ficheros → FAIL.
- [ ] **Step 3:** Añadir las llamadas a `window.api.logInfo` en los puntos de inicio y fin (el fin en `finally`).
- [ ] **Step 4:** Esos tests y la suite entera → PASS; `tsc`/`biome` limpios.
- [ ] **Step 5:** Commit `Log conversions, updates, matches and sessions once per batch`.

### Task 8: Aviso de caída con el informe prellenado

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (handler `diag:lastCrash`)
- Modify: `apps/desktop/src/preload/index.ts`, `apps/desktop/src/preload/api.ts`
- Create: `apps/desktop/src/renderer/src/hooks/useCrashNotice.ts`
- Test: `apps/desktop/src/renderer/src/hooks/useCrashNotice.test.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx`, `src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR,ja}.json`

**Interfaces:**
- Consumes: `LastCrash` guardado por `onGone` (Task 2); `pushToast` (`lib/toastQueue.ts`); `openFeedback(error?, stack?)` (`lib/feedback.ts`).
- Produces: `window.api.lastCrash(): Promise<LastCrash | null>`, canal `diag:lastCrash` que devuelve el último y lo borra (una vez por caída). `useCrashNotice(store, tr)`: al montar pide `lastCrash()`; si hay, `pushToast(store, { key: 'crash-notice', tone: 'danger', message: tr('notices.crashed'), testid: 'crash-notice', action: { label: { key: 'notices.crashedReport' }, onAction: () => openFeedback('render process gone (' + reason + ', ' + exitCode + ')') } })`.
- Textos (`notices.crashed`, `notices.crashedReport`), es: «Surco se cerró de forma inesperada y se ha vuelto a abrir» / «Enviar informe». Los otros cinco idiomas, traducción equivalente.

- [ ] **Step 1: Tests en rojo** (`useCrashNotice.test.tsx`)
  - `shows a notice after a crash so the user knows there is something to report`: `lastCrash` resuelve `{ reason: 'crashed', exitCode: 5, at: 1 }` → aparece `[data-testid="crash-notice"]`.
  - `opens the report with the crash already named`: pulsar la acción → `openFeedback` llamado con un texto que contiene `crashed` y `5`.
  - `shows nothing on a normal start`: `lastCrash` resuelve `null` → no hay `crash-notice`.
  - En `src/main` (test del handler, junto a crashGuards o en un fichero propio): `hands the last crash once, so four crashes give four notices and not one notice four times`.
- [ ] **Step 2:** Esos tests → FAIL.
- [ ] **Step 3:** Implementar el handler, el preload, el hook, los textos en seis idiomas y la llamada en App. Revisar el toast con `/apple-design` antes de dar la tarea por cerrada (regla del usuario para toda UI).
- [ ] **Step 4:** Tests → PASS; `src/renderer/src/i18n` keys test verde; suite entera, `tsc` y `biome` limpios.
- [ ] **Step 5:** Commit `Tell the user Surco closed unexpectedly and offer the report already filled in`.

### Task 9: Traducir pilas minificadas del renderer

**Files:**
- Create: `apps/desktop/scripts/map-stack.mjs`
- Test: `apps/desktop/scripts/map-stack.test.mjs` (o `.test.ts` si `scripts/` ya tiene un patrón; mirar antes)

**Interfaces:**
- Produces: `node scripts/map-stack.mjs <dir-con-.map> < pila.txt` imprime la pila con cada `index-XXXX.js:L:C` sustituido por `fichero.tsx:L:C (función)`. Usa `source-map-js` si ya está en el árbol de dependencias (vite lo trae); si no, preguntar antes de añadir una dependencia.
- Comprobar primero que los `.map` viajan en la release: abrir el `app.asar` de la v1.34.1 publicada (`npx @electron/asar list`) y buscar `out/renderer/assets/*.map`. Si están, el script documenta en su `--help` cómo sacarlos de la release; si no, añadir en el flujo de release que se guarden como artefacto.

- [ ] **Step 1: Test en rojo**: con un build pequeño de prueba (fixture de un `.js` minificado y su `.map` generados en el test), la línea `at a (index-abc.js:1:120)` sale como `at <nombre> (src/x.ts:3:5)`.
- [ ] **Step 2:** Ejecutar el test → FAIL.
- [ ] **Step 3:** Implementar el script.
- [ ] **Step 4:** Test → PASS; probarlo a mano con una pila real de un build local (`electron-vite build`, forzar un `throw` en un `eval` del driver y traducir la línea del log).
- [ ] **Step 5:** Commit `Add a script that maps a minified renderer stack back to the source`.

### Cierre

- [ ] Prueba real con el driver: abrir rekordbox con la biblioteca falsa del scratchpad, forzar una caída del renderer (`app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())`), comprobar en `~/Library/Logs/Surco/main.log` el volcado de memoria con `listTracks`, ver el toast tras la recarga y que el informe del diálogo trae cabecera «al caer», contexto y marcos. Restaurar después el `settings.json` del perfil del driver.
- [ ] Merge a main local sin push.
