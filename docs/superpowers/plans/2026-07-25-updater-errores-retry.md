# Errores del updater: mensajes limpios y retry — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un fallo transitorio del check de actualizaciones sea silencioso (con reintentos 1/5/15 min y aviso solo al 4º fallo seguido), que todo mensaje al usuario sea corto y localizado (nunca el volcado crudo), y que siempre haya botón Reintentar.

**Architecture:** Dos módulos puros nuevos en el main process (`updateErrors.ts` clasifica y resume errores; `updateRetry.ts` es el scheduler de backoff con timers inyectables), cableados en `main/index.ts` capturando el rechazo de la promesa de `checkForUpdates()`. El renderer recibe dos canales: `update:check-failed` (toast limpio con Reintentar, vía IPC nuevo `update:check`) y el existente `update:error` (solo fallos fatales, ya resumidos).

**Tech Stack:** Electron + electron-updater, TypeScript, Vitest (fake timers), React 19, i18next.

**Spec:** `docs/superpowers/specs/2026-07-24-updater-errores-retry-design.md`

## Global Constraints

- Repo usa **npm** (no pnpm). Tests del desktop: desde `apps/desktop`, `npx vitest run <fichero>`.
- Type-check: desde `apps/desktop`, `npx tsc --build` (el `tsc --noEmit` pelado desde la raíz no comprueba nada).
- NO ejecutar `npm run check` (reformatea ~92 ficheros ajenos). Lint por fichero: `npx biome check <fichero>` desde `apps/desktop`.
- Los 5 locales del renderer (`de.json`, `en.json`, `es.json`, `fr.json`, `pt-BR.json` en `apps/desktop/src/renderer/src/i18n/locales/`) van en lockstep: un test de paridad exige las mismas claves en todos, y `usedKeys.test.ts` exige que cada clave de `en.json` aparezca en el código fuente.
- Estilo de comentarios del repo: comentarios de "por qué" encima de cada bloque no obvio (ver `updateRecheck.ts`). Los tests llevan un comentario explicando por qué importa el comportamiento.
- Commits: título descriptivo solo, sin body, sin prefijos `feat:`/`fix:`.
- TDD estricto: test en rojo antes de implementar, verde después, commit por tarea.
- Trabajar en el worktree `/Users/vicent/code/surco/.claude/worktrees/updater-error-retry` (rama `worktree-updater-error-retry`). Rutas abajo relativas a la raíz del worktree.

---

### Task 1: Clasificación y resumen de errores del updater

**Files:**
- Create: `apps/desktop/src/main/updateErrors.ts`
- Test: `apps/desktop/src/main/updateErrors.test.ts`

**Interfaces:**
- Consumes: nada (módulo hoja, sin dependencias).
- Produces:
  - `type UpdateErrorKind = 'transient' | 'offline' | 'fatal'`
  - `classifyUpdateError(err: unknown): { kind: UpdateErrorKind; status: number | null }`
  - `summarizeUpdateError(err: unknown): string`

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/main/updateErrors.test.ts
import { describe, expect, it } from 'vitest'
import { classifyUpdateError, summarizeUpdateError } from './updateErrors'

// electron-updater's HttpError carries the response status as `statusCode`.
function httpError(statusCode: number): Error {
  return Object.assign(new Error(`HttpError: ${statusCode}`), { statusCode })
}

function codeError(code: string): Error {
  return Object.assign(new Error(`request failed: ${code}`), { code })
}

describe('classifyUpdateError', () => {
  // A 504 from GitHub's feed is GitHub's problem, not the user's: it must route to
  // the silent retry loop, never to an immediate toast.
  it('classifies server errors and rate limits as transient', () => {
    expect(classifyUpdateError(httpError(504))).toEqual({ kind: 'transient', status: 504 })
    expect(classifyUpdateError(httpError(500))).toEqual({ kind: 'transient', status: 500 })
    expect(classifyUpdateError(httpError(429))).toEqual({ kind: 'transient', status: 429 })
  })

  // A 404 means the feed itself is wrong (bad repo, unpublished release) — retrying
  // won't fix it, so the user must hear about it.
  it('classifies other HTTP statuses as fatal but keeps the status', () => {
    expect(classifyUpdateError(httpError(404))).toEqual({ kind: 'fatal', status: 404 })
    expect(classifyUpdateError(httpError(403))).toEqual({ kind: 'fatal', status: 403 })
  })

  // Checking for updates on a train without wifi is normal life, not an incident:
  // offline gets its own kind so the scheduler can retry without ever toasting.
  it('classifies no-connectivity failures as offline', () => {
    expect(classifyUpdateError(codeError('ENOTFOUND')).kind).toBe('offline')
    expect(classifyUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED')).kind).toBe('offline')
    expect(classifyUpdateError(new Error('net::ERR_NAME_NOT_RESOLVED')).kind).toBe('offline')
  })

  it('classifies flaky-network failures as transient', () => {
    expect(classifyUpdateError(codeError('ETIMEDOUT')).kind).toBe('transient')
    expect(classifyUpdateError(codeError('ECONNRESET')).kind).toBe('transient')
    expect(classifyUpdateError(new Error('net::ERR_CONNECTION_TIMED_OUT')).kind).toBe('transient')
  })

  // Anything unrecognized (signature mismatch, corrupt download…) must surface
  // immediately rather than being retried forever in silence.
  it('classifies unknown errors as fatal', () => {
    expect(classifyUpdateError(new Error('code signature did not match'))).toEqual({
      kind: 'fatal',
      status: null,
    })
    expect(classifyUpdateError('boom')).toEqual({ kind: 'fatal', status: null })
  })
})

describe('summarizeUpdateError', () => {
  // The whole point of the change: the 504 toast used to dump the request method,
  // URL, HTML body and headers on the user. Only a short first line may survive.
  it('keeps only the first line, truncated', () => {
    const dump = `method: GET url: https://github.com/surco-app/surco-releases/releases.atom\n\nData:\n<html><body><h1>504 Gateway Time-out</h1></body></html>`
    const summary = summarizeUpdateError(new Error(dump))
    expect(summary).not.toContain('<html>')
    expect(summary).not.toContain('\n')
    expect(summary.length).toBeLessThanOrEqual(120)
  })

  it('stringifies non-Error values', () => {
    expect(summarizeUpdateError('boom')).toBe('boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (desde `apps/desktop`): `npx vitest run src/main/updateErrors.test.ts`
Expected: FAIL — `Cannot find module './updateErrors'` (o equivalente).

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/desktop/src/main/updateErrors.ts
export type UpdateErrorKind = 'transient' | 'offline' | 'fatal'

export interface UpdateErrorInfo {
  kind: UpdateErrorKind
  status: number | null
}

// No network at all: expected life on a train, never worth a toast. Checked before
// the transient list so an offline DNS failure never lands in the "GitHub is down"
// bucket.
const OFFLINE_CODES = [
  'ENOTFOUND',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_NETWORK_CHANGED',
]

// The connection exists but hiccuped: worth silent retries, worth telling the user
// only if it keeps failing.
const TRANSIENT_CODES = [
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_TIMED_OUT',
]

// Sorts an updater failure into the retry loop (transient/offline) or the
// tell-the-user-now path (fatal). electron-updater's HttpError exposes the response
// as `statusCode`; Node and Chromium network failures only leave a code, either in
// `err.code` or embedded in the message as `net::ERR_*`.
export function classifyUpdateError(err: unknown): UpdateErrorInfo {
  const statusCode = (err as { statusCode?: unknown } | null)?.statusCode
  if (typeof statusCode === 'number') {
    const retryable = statusCode >= 500 || statusCode === 429
    return { kind: retryable ? 'transient' : 'fatal', status: statusCode }
  }
  const code = (err as { code?: unknown } | null)?.code
  const text = `${typeof code === 'string' ? code : ''} ${err instanceof Error ? err.message : String(err)}`
  if (OFFLINE_CODES.some((c) => text.includes(c))) return { kind: 'offline', status: null }
  if (TRANSIENT_CODES.some((c) => text.includes(c))) return { kind: 'transient', status: null }
  return { kind: 'fatal', status: null }
}

// electron-updater's HttpError message is a multi-line dump (method, URL, HTML body,
// headers). The user only ever sees this first line; the full error goes to main.log.
export function summarizeUpdateError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const line = message.split('\n', 1)[0].trim()
  return line.length > 120 ? `${line.slice(0, 119)}…` : line
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (desde `apps/desktop`): `npx vitest run src/main/updateErrors.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint + type-check**

Run (desde `apps/desktop`): `npx biome check src/main/updateErrors.ts src/main/updateErrors.test.ts && npx tsc --build`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/updateErrors.ts apps/desktop/src/main/updateErrors.test.ts
git commit -m "Classify updater failures by recoverability"
```

---

### Task 2: Scheduler de reintentos con backoff

**Files:**
- Create: `apps/desktop/src/main/updateRetry.ts`
- Test: `apps/desktop/src/main/updateRetry.test.ts`

**Interfaces:**
- Consumes: `UpdateErrorKind` no — recibe solo `'transient' | 'offline'` (los `fatal` nunca llegan al scheduler).
- Produces:
  - `UPDATE_RETRY_DELAYS_MS: number[]` (= `[60_000, 300_000, 900_000]`)
  - `createUpdateRetry(retry: () => void, notify: (status: number | null) => void, delaysMs?: number[]): UpdateRetry`
  - `interface UpdateRetry { onFailure(kind: 'transient' | 'offline', status: number | null): void; onSuccess(): void }`

Semántica exacta (del spec): el fallo nº1 programa un reintento a 1 min, el nº2 a 5 min, el nº3 a 15 min. El fallo nº4 (y siguientes) ya no programa nada — el ciclo de 2 h de `updateRecheck.ts` sigue por su cuenta — y dispara `notify(status)` UNA sola vez por incidencia, salvo que ese fallo sea `offline`. `onSuccess()` resetea contador, cancela el timer pendiente y rearma el aviso.

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/main/updateRetry.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUpdateRetry, UPDATE_RETRY_DELAYS_MS } from './updateRetry'

describe('createUpdateRetry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // A minutes-long GitHub blip used to cost a full 2h recheck cycle: the fast
  // backoff exists so the update lands minutes after the feed recovers.
  it('retries with the 1/5/15 minute backoff', () => {
    const retry = vi.fn()
    const scheduler = createUpdateRetry(retry, vi.fn())
    scheduler.onFailure('transient', 504)
    vi.advanceTimersByTime(UPDATE_RETRY_DELAYS_MS[0])
    expect(retry).toHaveBeenCalledTimes(1)
    scheduler.onFailure('transient', 504)
    vi.advanceTimersByTime(UPDATE_RETRY_DELAYS_MS[1])
    expect(retry).toHaveBeenCalledTimes(2)
    scheduler.onFailure('transient', 504)
    vi.advanceTimersByTime(UPDATE_RETRY_DELAYS_MS[2])
    expect(retry).toHaveBeenCalledTimes(3)
  })

  // The user agreed to hear about an outage only once it survives the whole backoff
  // (4 consecutive failures, ~20 min) — and only once per incident, so an
  // afternoon-long GitHub outage doesn't re-toast on every 2h recheck.
  it('notifies once on the 4th consecutive failure and stays quiet after', () => {
    const notify = vi.fn()
    const scheduler = createUpdateRetry(vi.fn(), notify)
    scheduler.onFailure('transient', 504)
    scheduler.onFailure('transient', 504)
    scheduler.onFailure('transient', 504)
    expect(notify).not.toHaveBeenCalled()
    scheduler.onFailure('transient', 502)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(502)
    scheduler.onFailure('transient', 502)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  // Working offline is not an incident: the retry loop keeps trying but the user
  // is never told their (absent) connection failed to reach GitHub.
  it('never notifies for offline failures', () => {
    const notify = vi.fn()
    const scheduler = createUpdateRetry(vi.fn(), notify)
    for (let i = 0; i < 6; i++) scheduler.onFailure('offline', null)
    expect(notify).not.toHaveBeenCalled()
  })

  // Mixed outage: the backoff burnt out while offline, then the network comes back
  // to a real GitHub error — that first non-offline failure must still notify.
  it('notifies the first transient failure past the backoff even after offline ones', () => {
    const notify = vi.fn()
    const scheduler = createUpdateRetry(vi.fn(), notify)
    for (let i = 0; i < 4; i++) scheduler.onFailure('offline', null)
    expect(notify).not.toHaveBeenCalled()
    scheduler.onFailure('transient', 504)
    expect(notify).toHaveBeenCalledWith(504)
  })

  // A success must fully re-arm the machinery: counter back to zero (next incident
  // gets the fast backoff again), pending retry cancelled (no stray double-check),
  // notify re-armed (next incident toasts again).
  it('resets the counter, cancels the pending retry and re-arms notify on success', () => {
    const retry = vi.fn()
    const notify = vi.fn()
    const scheduler = createUpdateRetry(retry, notify)
    scheduler.onFailure('transient', 504)
    scheduler.onSuccess()
    vi.advanceTimersByTime(UPDATE_RETRY_DELAYS_MS[2] * 10)
    expect(retry).not.toHaveBeenCalled()

    for (let i = 0; i < 4; i++) scheduler.onFailure('transient', 504)
    expect(notify).toHaveBeenCalledTimes(1)
    scheduler.onSuccess()
    for (let i = 0; i < 4; i++) scheduler.onFailure('transient', 500)
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenLastCalledWith(500)
  })

  // The 2h recheck can fail while a backoff retry is already pending; stacking a
  // second timer would double the check traffic and skew the failure count.
  it('replaces a pending retry instead of stacking timers', () => {
    const retry = vi.fn()
    const scheduler = createUpdateRetry(retry, vi.fn())
    scheduler.onFailure('transient', 504)
    scheduler.onFailure('transient', 504)
    vi.advanceTimersByTime(UPDATE_RETRY_DELAYS_MS[0] + UPDATE_RETRY_DELAYS_MS[1])
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (desde `apps/desktop`): `npx vitest run src/main/updateRetry.test.ts`
Expected: FAIL — `Cannot find module './updateRetry'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/desktop/src/main/updateRetry.ts
// Backoff for failed update checks: quick retries so a GitHub blip costs minutes
// instead of a whole 2h recheck cycle, then a single user-facing notice once the
// outage has survived the entire ladder (agreed in the 2026-07-24 spec).
export const UPDATE_RETRY_DELAYS_MS = [60_000, 300_000, 900_000]

export interface UpdateRetry {
  onFailure(kind: 'transient' | 'offline', status: number | null): void
  onSuccess(): void
}

export function createUpdateRetry(
  retry: () => void,
  notify: (status: number | null) => void,
  delaysMs: number[] = UPDATE_RETRY_DELAYS_MS,
): UpdateRetry {
  let failures = 0
  let notified = false
  let pending: ReturnType<typeof setTimeout> | null = null
  const cancel = (): void => {
    if (pending) clearTimeout(pending)
    pending = null
  }
  return {
    onFailure(kind, status) {
      cancel()
      if (failures < delaysMs.length) {
        const delay = delaysMs[failures]
        failures += 1
        pending = setTimeout(() => {
          pending = null
          retry()
        }, delay)
        return
      }
      // Past the ladder the 2h recheck owns the cadence. One notice per incident,
      // and never for offline: no wifi is normal life, not an outage.
      if (!notified && kind !== 'offline') {
        notified = true
        notify(status)
      }
    },
    onSuccess() {
      cancel()
      failures = 0
      notified = false
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (desde `apps/desktop`): `npx vitest run src/main/updateRetry.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint + type-check**

Run (desde `apps/desktop`): `npx biome check src/main/updateRetry.ts src/main/updateRetry.test.ts && npx tsc --build`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/updateRetry.ts apps/desktop/src/main/updateRetry.test.ts
git commit -m "Add a backoff scheduler for failed update checks"
```

---

### Task 3: Toast limpio con Reintentar en el renderer

**Files:**
- Modify: `apps/desktop/src/preload/index.ts` (bloque de update, líneas ~167-177)
- Modify: `apps/desktop/src/preload/api.ts` (líneas ~203-205)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (efectos de update, líneas ~490-518)
- Modify: `apps/desktop/src/renderer/src/i18n/locales/{de,en,es,fr,pt-BR}.json` (bloque `"update"`)
- Test: `apps/desktop/src/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: nada de Tasks 1-2 (el renderer solo ve IPC).
- Produces (lo que Task 4 cablea desde main):
  - Canal IPC entrante `update:check-failed` con payload `number | null` (status HTTP o null).
  - Invoke IPC saliente `update:check` (sin payload) — main debe registrar el handler en Task 4.
  - `window.api.onUpdateCheckFailed(cb: (status: number | null) => void): () => void`
  - `window.api.checkForUpdates(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Añadir a los mocks de `setApi` en `apps/desktop/src/renderer/src/App.test.tsx` (junto a `onUpdateError: () => () => {},` en la línea ~200):

```ts
    onUpdateCheckFailed: () => () => {},
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
```

Añadir el test (junto a los demás `it` de nivel superior; buscar los tests de update cerca de la línea 2080):

```ts
  // The 504 screenshot that motivated this: a failed check used to dump the raw
  // HTTP error (HTML body, headers) into a toast. The user must instead get a short
  // localized line and a Retry button that actually re-runs the check.
  it('shows a clean retry toast when the update check fails', async () => {
    let fail: ((status: number | null) => void) | undefined
    const checkForUpdates = vi.fn().mockResolvedValue(undefined)
    setApi({
      onUpdateCheckFailed: (cb: (status: number | null) => void) => {
        fail = cb
        return () => {}
      },
      checkForUpdates,
    })
    await renderApp()
    act(() => fail?.(504))
    const toast = await screen.findByTestId('update-check-failed')
    expect(toast.textContent).toContain('Could not check for updates')
    expect(toast.textContent).toContain('504')
    expect(toast.textContent).not.toContain('<html>')
    fireEvent.click(screen.getByText('Retry'))
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
  })
```

Nota: `renderApp`, `fireEvent`, `screen` y `setApi` ya existen en el fichero — reutilizarlos, no redefinirlos. Si `act` no está ya importado, añadirlo al import existente de `@testing-library/react`.

- [ ] **Step 2: Run test to verify it fails**

Run (desde `apps/desktop`): `npx vitest run src/renderer/src/App.test.tsx -t "clean retry toast"`
Expected: FAIL — `fail` nunca se asigna (el efecto no existe), timeout en `findByTestId('update-check-failed')`.

- [ ] **Step 3: Write minimal implementation**

3a. `apps/desktop/src/preload/index.ts` — añadir tras `onUpdateError` (línea ~177):

```ts
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  onUpdateCheckFailed: (cb: (status: number | null) => void) => {
    const listener = (_e: unknown, status: number | null): void => cb(status)
    ipcRenderer.on('update:check-failed', listener)
    return () => ipcRenderer.removeListener('update:check-failed', listener)
  },
```

3b. `apps/desktop/src/preload/api.ts` — añadir tras `onUpdateError` (línea ~205):

```ts
  checkForUpdates: () => Promise<void>
  onUpdateCheckFailed: (cb: (status: number | null) => void) => () => void
```

3c. `apps/desktop/src/renderer/src/App.tsx` — añadir un tercer efecto tras el de `onUpdateError` (línea ~518), mismo patrón que los dos existentes:

```tsx
  useEffect(
    () =>
      window.api.onUpdateCheckFailed((status) =>
        pushToast(store, {
          key: 'update',
          tone: 'danger',
          testid: 'update-check-failed',
          message: status
            ? tr('update.checkFailedStatus', { status })
            : tr('update.checkFailed'),
          action: { label: tr('update.retry'), onAction: () => window.api.checkForUpdates() },
        }),
      ),
    [store, tr],
  )
```

3d. Locales — añadir dentro del bloque `"update"` de cada fichero, tras `"failed"`. Los textos base reutilizan la traducción del `updateError` del menú (main/i18n.ts) que Task 4 elimina:

`es.json`:
```json
    "checkFailed": "No se pudo comprobar si hay actualizaciones",
    "checkFailedStatus": "No se pudo comprobar si hay actualizaciones (GitHub respondió {{status}})",
    "retry": "Reintentar"
```

`en.json`:
```json
    "checkFailed": "Could not check for updates",
    "checkFailedStatus": "Could not check for updates (GitHub responded {{status}})",
    "retry": "Retry"
```

`de.json`:
```json
    "checkFailed": "Nach Updates konnte nicht gesucht werden",
    "checkFailedStatus": "Nach Updates konnte nicht gesucht werden (GitHub antwortete {{status}})",
    "retry": "Erneut versuchen"
```

`fr.json`:
```json
    "checkFailed": "Impossible de vérifier les mises à jour",
    "checkFailedStatus": "Impossible de vérifier les mises à jour (GitHub a répondu {{status}})",
    "retry": "Réessayer"
```

`pt-BR.json`:
```json
    "checkFailed": "Não foi possível verificar se há atualizações",
    "checkFailedStatus": "Não foi possível verificar se há atualizações (GitHub respondeu {{status}})",
    "retry": "Tentar novamente"
```

- [ ] **Step 4: Run tests to verify they pass**

Run (desde `apps/desktop`): `npx vitest run src/renderer/src/App.test.tsx src/renderer/src/i18n`
Expected: PASS — el test nuevo, la paridad de locales y `usedKeys` (las tres claves nuevas aparecen en `App.tsx`).

- [ ] **Step 5: Lint + type-check**

Run (desde `apps/desktop`): `npx biome check src/preload/index.ts src/preload/api.ts src/renderer/src/App.tsx && npx tsc --build`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/preload/api.ts apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.test.tsx apps/desktop/src/renderer/src/i18n/locales
git commit -m "Show a clean retry toast when the update check fails"
```

---

### Task 4: Cableado en el main process

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (imports ~línea 77; `checkForUpdates` líneas 192-207; handler `update:install` líneas 1031-1043; bloque updater líneas 1144-1191)
- Modify: `apps/desktop/src/main/i18n.ts` (eliminar `updateError`: interfaz línea 39 y las 5 traducciones, líneas 84/128/172/216/260)

**Interfaces:**
- Consumes:
  - `classifyUpdateError`, `summarizeUpdateError` de `./updateErrors` (Task 1)
  - `createUpdateRetry` de `./updateRetry` (Task 2)
  - Canales del renderer (Task 3): envía `update:check-failed` (payload `number | null`) y `update:error` (string corto); registra `ipcMain.handle('update:check')`.
- Produces: comportamiento final integrado; nada nuevo para otras tareas.

`main/index.ts` no tiene fichero de test propio (proceso main integrado); la verificación es la suite completa + type-check + lint.

- [ ] **Step 1: Imports**

Añadir junto a los imports de update existentes (línea ~77):

```ts
import { classifyUpdateError, summarizeUpdateError } from './updateErrors'
import { createUpdateRetry } from './updateRetry'
```

- [ ] **Step 2: El check manual delega en el runner del bloque updater**

Reemplazar la función `checkForUpdates` (líneas 192-207) y añadir el puntero al runner. El runner vive dentro del bloque `app.isPackaged` (Step 4), así que la función del menú lo alcanza vía variable de módulo:

```ts
// Set while a user-triggered update check is in flight so the updater's result
// events surface a dialog or toast; the silent startup check leaves it false and
// stays quiet.
let manualUpdateCheck = false

// Assigned inside the packaged-only updater block; the menu item and the toast's
// Retry button both funnel through it so every check shares the same failure path.
let requestUpdateCheck: (() => void) | null = null

function checkForUpdates(win: BrowserWindow): void {
  if (!app.isPackaged) {
    const t = createMenuT(menuLocale())
    dialog.showMessageBox(win, { type: 'info', message: t('updatesDevOnly') })
    return
  }
  manualUpdateCheck = true
  requestUpdateCheck?.()
}
```

- [ ] **Step 3: IPC para el botón Reintentar y resumen en update:install**

Junto al handler `update:install` (líneas 1031-1043), cambiar el mensaje crudo por el resumen y registrar el invoke nuevo:

```ts
  ipcMain.handle('update:install', (e) => {
    try {
      electronUpdater.autoUpdater.quitAndInstall()
    } catch (err) {
      log.error('update:install failed', err)
      e.sender.send('update:error', summarizeUpdateError(err))
    }
  })

  // The Retry button on the failed-check toast re-runs the exact manual-check path
  // the menu item uses, dev dialog included.
  ipcMain.handle('update:check', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) checkForUpdates(win)
  })
```

(Los comentarios existentes encima de `update:install` se conservan tal cual.)

- [ ] **Step 4: Reescribir el bloque updater**

Reemplazar el bloque `if (app.isPackaged) { … }` (líneas 1144-1191) por:

```ts
  if (app.isPackaged) {
    const updater = electronUpdater.autoUpdater
    // Route the updater's own logs to a file (~/Library/Logs/Surco/main.log on
    // macOS) so a failed install — which Squirrel.Mac otherwise swallows — leaves
    // a trace we can read.
    updater.logger = log
    // Never capture `win` here: on macOS ⌘W destroys the window while the app and
    // the updater keep running, so anything bound to the launch window would send
    // its events into a destroyed webContents after a Dock reopen.
    const liveWindow = (): BrowserWindow | undefined =>
      BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    wireUpdateDelivery(updater, liveWindow, (cb) =>
      app.on('browser-window-created', (_e, newWin) =>
        newWin.webContents.once('did-finish-load', () => cb(newWin)),
      ),
    )
    updater.on('update-not-available', () => {
      if (!manualUpdateCheck) return
      manualUpdateCheck = false
      const target = liveWindow()
      const opts = { type: 'info' as const, message: createMenuT(menuLocale())('upToDate') }
      if (target) dialog.showMessageBox(target, opts)
      else dialog.showMessageBox(opts)
    })
    // One failure path for every source (check rejection, download/install 'error'
    // event): manual checks toast immediately with Retry, background transient
    // failures feed the silent backoff, and only fatal errors toast on their own.
    // The raw dump (HTML body, headers) never leaves main.log.
    const reportFailure = (err: unknown): void => {
      const { kind, status } = classifyUpdateError(err)
      if (manualUpdateCheck) {
        manualUpdateCheck = false
        liveWindow()?.webContents.send('update:check-failed', status)
      } else if (kind === 'fatal') {
        liveWindow()?.webContents.send('update:error', summarizeUpdateError(err))
      } else {
        updateRetry.onFailure(kind, status)
      }
    }
    const updateRetry = createUpdateRetry(
      () => runUpdateCheck(),
      (status) => liveWindow()?.webContents.send('update:check-failed', status),
    )
    // The check owns its failures through the promise; the guard keeps the global
    // 'error' listener (which fires for the same rejection) from reporting twice.
    let checkInFlight = false
    const runUpdateCheck = (): void => {
      if (checkInFlight) return
      checkInFlight = true
      updater
        .checkForUpdates()
        .then(() => updateRetry.onSuccess())
        .catch((err) => {
          log.error('update check failed', err)
          reportFailure(err)
        })
        .finally(() => {
          checkInFlight = false
        })
    }
    requestUpdateCheck = runUpdateCheck
    // Errors outside a check (Squirrel install failures, background download drops)
    // still land here; without this the restart-to-update button would fail with no
    // sign it did anything.
    updater.on('error', (err) => {
      log.error('autoUpdater error', err)
      if (checkInFlight) return
      reportFailure(err)
    })
    runUpdateCheck()
    // The launch probe alone missed every patch: they ship within the hour of their
    // minor, after users have already relaunched, and a running instance never asked
    // again. Re-checking on an interval keeps a long-lived session in the loop.
    armUpdateRecheck(runUpdateCheck)
  }
```

Nota TS: `reportFailure` referencia `updateRetry` (declarada después) — es legal porque solo se ejecuta tras la asignación, pero si `tsc` protesta por "used before its declaration", mover la declaración `const updateRetry` encima de `reportFailure` y pasar `runUpdateCheck` por referencia diferida: `createUpdateRetry(() => requestUpdateCheck?.(), …)`. Preferir el orden que compile sin desactivar nada.

- [ ] **Step 5: Eliminar la clave muerta del menú**

En `apps/desktop/src/main/i18n.ts`, eliminar la línea `updateError: string` de la interfaz (línea 39) y la línea `updateError: '…',` de cada uno de los 5 locales (líneas 84, 128, 172, 216, 260). Es la clave del diálogo nativo de error que este cambio elimina; `upToDate` y `updatesDevOnly` se quedan.

- [ ] **Step 6: Suite completa + type-check + lint**

Run (desde `apps/desktop`): `npx tsc --build && npx biome check src/main/index.ts src/main/i18n.ts && npx vitest run`
Expected: type-check limpio, lint limpio, suite del desktop entera en verde (266+ ficheros). Si `i18n.test.ts` referencia `updateError` (no debería — verificado por grep), actualizarlo en el mismo sentido.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/main/i18n.ts
git commit -m "Route updater failures through the retry scheduler"
```

---

### Verificación final (tras Task 4)

- [ ] Desde la raíz del worktree: `npm test` — TODO en verde (desktop + web).
- [ ] Desde `apps/desktop`: `npx tsc --build` limpio.
- [ ] Revisión del diff completo contra el spec: sin volcado crudo hacia el renderer en ningún camino (`grep -n "err.message\|String(err)" apps/desktop/src/main/index.ts` no debe mostrar ningún envío por IPC sin pasar por `summarizeUpdateError`).
