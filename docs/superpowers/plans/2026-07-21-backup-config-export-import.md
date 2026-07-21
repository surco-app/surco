# Backup de configuración: export/import + token sincronizado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir export/import de la configuración completa a un fichero `.json` (backup restaurable) y hacer que el token de Discogs viaje por la carpeta sincronizada entre las dos Macs del usuario.

**Architecture:** El main process gana dos IPC (`dialog:exportSettings`, `dialog:importSettings`) en `exportIpc.ts`, apoyados en `getSettings`/`mergeSettings`/`saveSettings` ya existentes. El preload los expone en `window.api`. La tab General de Ajustes gana dos botones que aplican el resultado del import vía el mecanismo `onSettingsReplaced` ya usado por la relocalización de carpeta. Para la sincronización del token, se quitan `discogsToken` y `autoMatch` de `LOCAL_KEYS` en `settings.ts` — el split/merge existente hace el resto.

**Tech Stack:** Electron 43, TypeScript, Vitest, React 19, react-i18next, Biome.

## Global Constraints

- **CERO comentarios de código nuevos** salvo los que actualicen comentarios existentes que quedan obsoletos (regla del usuario: código autodocumentado).
- **TDD estricto:** red → green → refactor. Nunca saltar la fase roja.
- **No usar `npm run check`** (reformatea ~92 ficheros ajenos). Verificar por fichero con `npx biome check <fichero>` y `npx tsc`.
- **Commits:** título descriptivo, sin body, sin prefijos `feat:`/`fix:`. Una funcionalidad por commit.
- **Trabajar en un git worktree aislado**, nunca directo sobre main.
- Todos los tests de main corren con `npx vitest run` desde `apps/desktop`.
- Los tests de `settings.ts` mockean `electron` con un tempdir (ver `settings.test.ts:5-11`); seguir ese patrón exacto.
- Rutas relativas a la raíz del repo `/Users/vicent/code/surco`.

---

### Task 1: Sincronizar el token de Discogs (quitar de LOCAL_KEYS)

Sacar `discogsToken` y `autoMatch` de `LOCAL_KEYS` para que `split()` los mande al fichero sincronizado. Las demás claves locales permanecen.

**Files:**
- Modify: `apps/desktop/src/main/settings.ts:89-108` (el bloque `LOCAL_KEYS` y su comentario)
- Test: `apps/desktop/src/main/settings.test.ts`

**Interfaces:**
- Consumes: `getSettings`, `saveSettings`, `setConfigDir`, `getConfigDir` (ya exportados desde `settings.ts`).
- Produces: nada nuevo; cambia el comportamiento de `split()` (interno).

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `apps/desktop/src/main/settings.test.ts` un bloque nuevo. Este test verifica el POR QUÉ: con carpeta sincronizada activa, el token debe acabar en el fichero de la carpeta compartida (para viajar entre Macs), mientras que una ruta local (`outputDir`) NO.

```typescript
describe('token sync', () => {
  // El usuario usa dos Macs con la carpeta de config en iCloud. El token de Discogs
  // es idéntico en ambas, así que debe viajar en el fichero compartido — no quedarse
  // atrás en cada máquina. Las rutas locales sí se quedan: no existen en la otra Mac.
  it('writes the Discogs token to the synced folder but keeps outputDir local', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-sync-'))
    setConfigDir(dir)
    saveSettings({ discogsToken: 'abc123', outputDir: '/Users/me/Music' })

    const synced = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'))
    const local = JSON.parse(readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf-8'))

    expect(synced.discogsToken).toBe('abc123')
    expect(synced.outputDir).toBeUndefined()
    expect(local.outputDir).toBe('/Users/me/Music')
    expect(local.discogsToken).toBeUndefined()

    setConfigDir(null)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd apps/desktop && npx vitest run src/main/settings.test.ts -t "token sync"`
Expected: FAIL — hoy `discogsToken` está en `LOCAL_KEYS`, así que `synced.discogsToken` es `undefined` y `local.discogsToken` es `'abc123'` (al revés de lo esperado).

- [ ] **Step 3: Implementar el cambio mínimo**

En `apps/desktop/src/main/settings.ts`, quitar `discogsToken` y `autoMatch` del array `LOCAL_KEYS` (líneas 94-95) y reescribir el comentario de cabecera (líneas 89-92) que ahora miente. Dejar el bloque así:

```typescript
// Settings that never leave this machine, even when the user points the settings
// folder at a cloud-synced location: a local output path and Engine library path
// don't exist on another Mac, per-machine tallies would corrupt if two Macs wrote
// the same file, and onboarding/changelog/pixel state is meaningful only locally.
// (The Discogs token DOES sync now — it's identical across the user's Macs, and the
// user accepts it living in their own cloud in plain text.)
const LOCAL_KEYS = [
  'outputDir',
  'engineLibraryDir',
  'hasSeenOnboarding',
  'conversionCount',
  'stats',
  'commandUsage',
  // Each machine updates on its own schedule, so "which changelog did I already
  // see" only means something locally.
  'lastSeenChangelogVersion',
  // A pixel position only means something on the screen it was saved on.
  'activityPanel',
  'resultsWidth',
] as const satisfies readonly (keyof Settings)[]
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd apps/desktop && npx vitest run src/main/settings.test.ts`
Expected: PASS — el nuevo test y TODOS los existentes de settings pasan (asegura no regresión: `outputDir`/`stats` siguen locales).

- [ ] **Step 5: Verificar tipos y lint del fichero tocado**

Run: `cd apps/desktop && npx tsc --noEmit -p tsconfig.node.json 2>&1 | head; npx biome check src/main/settings.ts`
Expected: sin errores. (`autoMatch` sigue existiendo en el tipo `Settings`; solo dejó de ser local. `autoMatchAvailable` en `saveSettings:215` lo sigue apagando si falta el token.)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/settings.ts apps/desktop/src/main/settings.test.ts
git commit -m "Sincronizar el token de Discogs por la carpeta compartida entre Macs"
```

---

### Task 2: Actualizar el hint de la carpeta de config (i18n)

El texto `settings.configDirHint` afirma en los 5 idiomas que *"el token de Discogs nunca sale de esta máquina"*. Tras la Task 1 eso es falso. Actualizarlo.

**Files:**
- Modify: `apps/desktop/src/renderer/src/i18n/locales/en.json:641`
- Modify: `apps/desktop/src/renderer/src/i18n/locales/es.json:641`
- Modify: `apps/desktop/src/renderer/src/i18n/locales/de.json` (clave `settings.configDirHint`)
- Modify: `apps/desktop/src/renderer/src/i18n/locales/fr.json` (clave `settings.configDirHint`)
- Modify: `apps/desktop/src/renderer/src/i18n/locales/pt-BR.json` (clave `settings.configDirHint`)

**Interfaces:**
- Consumes: nada.
- Produces: nada (solo texto).

- [ ] **Step 1: Localizar la clave en los 5 ficheros**

Run: `cd apps/desktop && grep -n '"configDirHint"' src/renderer/src/i18n/locales/*.json`
Expected: una línea por cada uno de los 5 idiomas.

- [ ] **Step 2: Reescribir el valor en cada idioma**

En cada fichero, sustituir el valor de `configDirHint` para que ya NO diga que el token se queda local. La parte que debe cambiar es el final ("...el token de Discogs y las estadísticas... nunca salen de esta máquina" → "...las estadísticas y rutas de este Mac nunca salen de esta máquina").

`en.json`:
```json
    "configDirHint": "Pick a folder in iCloud Drive or Dropbox to share these preferences across your Macs. Applies immediately; this Mac's stats and paths stay local.",
```

`es.json`:
```json
    "configDirHint": "Elige una carpeta en iCloud Drive o Dropbox para compartir estas preferencias entre tus Macs. Se aplica al momento; las estadísticas y rutas de este Mac se quedan en local.",
```

Para `de.json`, `fr.json` y `pt-BR.json`: leer el valor actual de `configDirHint`, y quitar la cláusula que menciona el token de Discogs quedándose local, dejando solo la mención a las estadísticas/rutas locales, en el idioma correspondiente. Mantener el mismo tono y estructura que la traducción existente.

- [ ] **Step 3: Verificar que los JSON siguen siendo válidos**

Run: `cd apps/desktop && for f in en es de fr pt-BR; do node -e "JSON.parse(require('fs').readFileSync('src/renderer/src/i18n/locales/$f.json','utf8'))" && echo "$f ok"; done`
Expected: `en ok`, `es ok`, `de ok`, `fr ok`, `pt-BR ok` — ningún error de parseo.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/i18n/locales/
git commit -m "Actualizar el aviso de la carpeta de config: el token ya se sincroniza"
```

---

### Task 3: IPC de export de configuración (main + preload)

Handler `dialog:exportSettings` que vuelca el `Settings` completo a un `.json` elegido por el usuario, y su exposición en `window.api`.

**Files:**
- Modify: `apps/desktop/src/main/exportIpc.ts` (añadir handler; ya importa `dialog`, `ipcMain`, `writeFile`, `activity`)
- Modify: `apps/desktop/src/preload/index.ts:61` (zona de los `export*`)
- Modify: `apps/desktop/src/preload/api.ts` (tipo de la API, zona de los `export*`)
- Test: `apps/desktop/src/main/exportSettings.test.ts` (nuevo)

**Interfaces:**
- Consumes: `getSettings()` de `./settings` (devuelve `Settings` completo, fusionado, con token/rutas/stats).
- Produces:
  - IPC `dialog:exportSettings` → `Promise<string | null>` (path guardado, o `null` si se cancela).
  - `window.api.exportSettings: () => Promise<string | null>`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/desktop/src/main/exportSettings.test.ts`. El test verifica el POR QUÉ: el fichero exportado debe contener el `Settings` COMPLETO incluido el token — es lo que lo hace un backup real, no una copia filtrada.

```typescript
import { afterAll, describe, expect, it, vi } from 'vitest'

const dir = (() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return mkdtempSync(join(tmpdir(), 'surco-export-'))
})()

vi.mock('electron', () => ({ app: { getPath: () => dir } }))

import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { serializeSettingsForExport } from './exportIpc'
import { saveSettings } from './settings'

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('serializeSettingsForExport', () => {
  // Un backup solo sirve si lo lleva TODO. El token es el caso frontera: está fuera
  // del fichero sincronizado a propósito, así que el export tiene que incluirlo
  // explícitamente o el "backup completo" no restauraría el acceso a Discogs.
  it('includes the full settings object, token included', () => {
    saveSettings({ discogsToken: 'secret-token', theme: 'dark' })
    const json = serializeSettingsForExport()
    const parsed = JSON.parse(json)
    expect(parsed.discogsToken).toBe('secret-token')
    expect(parsed.theme).toBe('dark')
    expect(parsed.stats).toBeDefined()
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd apps/desktop && npx vitest run src/main/exportSettings.test.ts`
Expected: FAIL — `serializeSettingsForExport` no existe todavía.

- [ ] **Step 3: Implementar el helper y el handler**

En `apps/desktop/src/main/exportIpc.ts`, añadir el import de `getSettings` y un helper exportado (testeable sin dialog), más el handler dentro de `registerExportIpc()`. Colocar el handler junto a los demás `dialog:export*`.

Al principio del fichero, añadir a los imports existentes:
```typescript
import { getSettings } from './settings'
```

Fuera de `registerExportIpc`, añadir el helper:
```typescript
export function serializeSettingsForExport(): string {
  return JSON.stringify(getSettings(), null, 2)
}
```

Dentro de `registerExportIpc()`, junto a los otros handlers:
```typescript
  ipcMain.handle('dialog:exportSettings', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Exporta la configuración',
      defaultPath: 'surco-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePath) return null
    const json = serializeSettingsForExport()
    await activity.track('export', 'activity.exportSettings', () => writeFile(filePath, json, 'utf8'), {
      detail: filePath,
    })
    return filePath
  })
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd apps/desktop && npx vitest run src/main/exportSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Exponer en el preload**

En `apps/desktop/src/preload/index.ts`, junto a `exportM3u` (línea ~61), añadir:
```typescript
  exportSettings: (): Promise<string | null> => ipcRenderer.invoke('dialog:exportSettings'),
```

En `apps/desktop/src/preload/api.ts`, en la zona de los `export*`, añadir el tipo:
```typescript
  exportSettings: () => Promise<string | null>
```

- [ ] **Step 6: Añadir la clave de activity feed en i18n**

El handler usa `'activity.exportSettings'`. Añadir esa clave en los 5 locales imitando la existente `activity.exportRekordbox`.

Run: `cd apps/desktop && grep -n '"exportRekordbox"' src/renderer/src/i18n/locales/*.json`
Expected: 5 líneas. Añadir junto a cada una una entrada `"exportSettings"` con el texto equivalente en ese idioma (p. ej. es: `"Configuración exportada"`, en: `"Settings exported"`; para de/fr/pt-BR seguir el patrón del vecino `exportRekordbox`).

- [ ] **Step 7: Verificar tipos, lint y JSON**

Run: `cd apps/desktop && npx tsc --noEmit -p tsconfig.node.json 2>&1 | head; npx biome check src/main/exportIpc.ts src/preload/index.ts src/preload/api.ts; for f in en es de fr pt-BR; do node -e "JSON.parse(require('fs').readFileSync('src/renderer/src/i18n/locales/$f.json','utf8'))"; done && echo jsonok`
Expected: sin errores; `jsonok`.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/exportIpc.ts apps/desktop/src/main/exportSettings.test.ts apps/desktop/src/preload/ apps/desktop/src/renderer/src/i18n/locales/
git commit -m "Exportar la configuración completa a un fichero JSON"
```

---

### Task 4: IPC de import de configuración (main + preload)

Handler `dialog:importSettings` que lee un `.json`, valida que es config de Surco, y reemplaza toda la config vía `saveSettings`. La confirmación destructiva vive en el renderer (Task 5); este handler solo lee/valida/aplica.

**Files:**
- Modify: `apps/desktop/src/main/exportIpc.ts` (añadir helper `applyImportedSettings` + handler)
- Modify: `apps/desktop/src/preload/index.ts` (zona export*)
- Modify: `apps/desktop/src/preload/api.ts` (tipo)
- Test: `apps/desktop/src/main/importSettings.test.ts` (nuevo)

**Interfaces:**
- Consumes: `defaults`, `mergeSettings`, `replaceSettings` (nuevo, ver Step 3b). ATENCIÓN: `saveSettings` NO sirve para reemplazar — hace `{ ...getSettings(), ...patch }` (settings.ts:211), que fusiona con lo actual en vez de reemplazar. Para "reemplazar todo" real hay que partir de `defaults`, no del estado actual, de modo que las claves ausentes en el backup vuelvan a su default y no conserven el valor previo.
- Produces:
  - Helper exportado `applyImportedSettings(raw: unknown): Settings` — valida `raw` y aplica; lanza `Error` si no es config válida.
  - IPC `dialog:importSettings` → `Promise<{ ok: true; settings: Settings } | { ok: false; error: string } | null>` (`null` = cancelado en el file dialog).
  - `window.api.importSettings: () => Promise<{ ok: true; settings: Settings } | { ok: false; error: string } | null>`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/desktop/src/main/importSettings.test.ts`. Verifica DOS porqués: (a) reemplazar-todo con relleno de defaults para claves ausentes (backup de versión vieja no debe romper); (b) rechazar basura para que un fichero ajeno no destruya la config.

```typescript
import { afterAll, describe, expect, it, vi } from 'vitest'

const dir = (() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return mkdtempSync(join(tmpdir(), 'surco-import-'))
})()

vi.mock('electron', () => ({ app: { getPath: () => dir } }))

import { rmSync } from 'node:fs'
import { applyImportedSettings } from './exportIpc'
import { getSettings, saveSettings } from './settings'

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('applyImportedSettings', () => {
  // Restaurar un backup debe dejar la config EXACTAMENTE como el backup, no fusionada
  // con lo que había — es "reemplazar todo". Pero un backup de una versión vieja de
  // Surco no tendrá campos nuevos: esos se rellenan con defaults, no se rompen.
  it('replaces current settings and fills missing keys from defaults', () => {
    saveSettings({ theme: 'light', discogsToken: 'old' })
    const restored = applyImportedSettings({ theme: 'dark' })
    expect(restored.theme).toBe('dark')
    expect(restored.discogsToken).toBe('')
    expect(restored.mp3Quality).toBeDefined()
    expect(getSettings().theme).toBe('dark')
  })

  // Un JSON ajeno (o corrupto) elegido por error NO debe aplicarse: reemplazar-todo
  // es destructivo, así que sin al menos una clave conocida de Surco, se rechaza.
  it('throws on an object with no known Surco settings keys', () => {
    expect(() => applyImportedSettings({ foo: 1, bar: 2 })).toThrow()
    expect(() => applyImportedSettings('not an object')).toThrow()
    expect(() => applyImportedSettings(null)).toThrow()
  })
})
```

Nota sobre el test: `discogsToken` por defecto es `''` (ver `defaults` en `settings.ts:14-87`); confirmar ese valor al implementar y ajustar el `expect` si difiere.

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd apps/desktop && npx vitest run src/main/importSettings.test.ts`
Expected: FAIL — `applyImportedSettings` no existe.

- [ ] **Step 3: Implementar el helper y el handler**

En `apps/desktop/src/main/exportIpc.ts`, añadir imports y el helper. Añadir `readFile` al import de `node:fs/promises` y `saveSettings`/`defaults` de `./settings`:
```typescript
import { readFile, writeFile } from 'node:fs/promises'
import { defaults, getSettings, replaceSettings } from './settings'
import type { Settings } from '../shared/types'
```
(`defaults` y `replaceSettings` deben existir/exportarse desde `settings.ts` — ver Step 3b.)

Helper, fuera de `registerExportIpc`:
```typescript
export function applyImportedSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('El fichero no contiene una configuración de Surco.')
  }
  const known = Object.keys(defaults) as (keyof Settings)[]
  const hasKnownKey = known.some((k) => k in (raw as object))
  if (!hasKnownKey) {
    throw new Error('El fichero no contiene una configuración de Surco.')
  }
  return replaceSettings(raw as Partial<Settings>)
}
```

Handler dentro de `registerExportIpc()`:
```typescript
  ipcMain.handle('dialog:importSettings', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Importa la configuración',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (canceled || filePaths.length === 0) return null
    try {
      const raw = JSON.parse(await readFile(filePaths[0], 'utf8'))
      const settings = applyImportedSettings(raw)
      return { ok: true as const, settings }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })
```

- [ ] **Step 3b: Exportar `defaults` y añadir `replaceSettings` en settings.ts**

`saveSettings` fusiona con el estado actual (`{ ...getSettings(), ...patch }`, settings.ts:211), así que NO reemplaza. Para "reemplazar todo" hace falta partir de `defaults`. Añadir a `settings.ts` una función que reutiliza `mergeSettings` (relleno de claves ausentes) partiendo de `defaults`, y luego persiste con el split existente igual que `saveSettings`.

Primero, exportar `defaults`:
Run: `cd apps/desktop && grep -n "^const defaults\|^export const defaults" src/main/settings.ts`
Si es `const defaults`, cambiarlo a `export const defaults`.

Luego añadir, junto a `saveSettings` (después de la línea 225):
```typescript
// Backup restore: unlike saveSettings (which merges the patch over the current
// settings), this rebuilds from defaults so keys absent in the imported file fall
// back to their default instead of keeping the value being replaced. Persistence
// (and the local/synced split) is otherwise identical to saveSettings.
export function replaceSettings(imported: Partial<Settings>): Settings {
  const next = mergeSettings(defaults, imported)
  if (!autoMatchAvailable(next)) next.autoMatch = false
  const sf = syncedFile()
  if (!sf) {
    writeAtomic(localFile(), next)
    return next
  }
  const { synced, local } = split(next)
  writeAtomic(sf, synced)
  writeAtomic(localFile(), local)
  return next
}
```
Verificar tras añadirlo que no queda duplicación evitable: si el bloque de persistencia (los 8 renglones desde `const sf = syncedFile()`) es idéntico al de `saveSettings`, extraerlo a un helper privado `persist(next: Settings): Settings` y llamarlo desde ambos. DRY.

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd apps/desktop && npx vitest run src/main/importSettings.test.ts src/main/settings.test.ts`
Expected: PASS (ambos ficheros — asegura que exportar `defaults` no rompió nada de settings).

- [ ] **Step 5: Exponer en el preload**

En `apps/desktop/src/preload/index.ts`, junto a `exportSettings`:
```typescript
  importSettings: () => ipcRenderer.invoke('dialog:importSettings'),
```

En `apps/desktop/src/preload/api.ts`, junto a `exportSettings`:
```typescript
  importSettings: () => Promise<
    { ok: true; settings: Settings } | { ok: false; error: string } | null
  >
```

- [ ] **Step 6: Verificar tipos y lint**

Run: `cd apps/desktop && npx tsc --noEmit -p tsconfig.node.json 2>&1 | head; npx biome check src/main/exportIpc.ts src/main/settings.ts src/preload/index.ts src/preload/api.ts`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/exportIpc.ts apps/desktop/src/main/importSettings.test.ts apps/desktop/src/main/settings.ts apps/desktop/src/preload/
git commit -m "Importar configuración desde un fichero JSON reemplazando la actual"
```

---

### Task 5: UI de export/import en la tab General

Dos botones en `GeneralTab` bajo el control de carpeta de config. Import muestra confirmación destructiva y, al aplicar, refresca la app vía `onSettingsReplaced`.

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/settings/GeneralTab.tsx` (añadir Props + un `SettingsField` con dos botones)
- Modify: `apps/desktop/src/renderer/src/components/SettingsModal.tsx` (funciones `exportSettings`/`importSettings`, pasar props a `GeneralTab`)
- Modify: `apps/desktop/src/renderer/src/i18n/locales/*.json` (5 idiomas: labels de botones + texto de confirmación + error)

**Interfaces:**
- Consumes: `window.api.exportSettings()`, `window.api.importSettings()` (Task 3, 4); `onSettingsReplaced(next)` (existe en `SettingsModal.tsx:43`); `setSynced(pickSynced(next))`, `onPreviewTheme(next.theme)` (patrón de `moveConfigDir`, `SettingsModal.tsx:118-127`).
- Produces: nada consumido por tareas posteriores.

- [ ] **Step 1: Añadir las funciones en SettingsModal**

En `apps/desktop/src/renderer/src/components/SettingsModal.tsx`, junto a `moveConfigDir` (línea ~118), añadir:
```typescript
  async function exportSettings(): Promise<void> {
    await window.api.exportSettings()
  }

  async function importSettings(): Promise<void> {
    const result = await window.api.importSettings()
    if (!result) return
    if (!result.ok) {
      window.alert(result.error)
      return
    }
    onSettingsReplaced(result.settings)
    setSynced(pickSynced(result.settings))
    onPreviewTheme(result.settings.theme)
  }
```

Verificar que `pickSynced` ya está importado (lo usa `moveConfigDir`); si sí, no re-importar.

- [ ] **Step 2: Pasar las props a GeneralTab**

En el JSX de `SettingsModal.tsx` donde se renderiza `<GeneralTab ... />` (cerca de línea 219), añadir:
```typescript
            onExportSettings={exportSettings}
            onImportSettings={importSettings}
```

- [ ] **Step 3: Añadir Props y UI en GeneralTab**

En `apps/desktop/src/renderer/src/components/settings/GeneralTab.tsx`, ampliar la interfaz `Props`:
```typescript
  onExportSettings: () => void
  onImportSettings: () => void
```
Añadirlos a la desestructuración de parámetros de la función. Y tras el `SettingsField` de `configDir` (cierra en línea ~102), añadir:
```tsx
        <SettingsField label={tr('settings.backup')} hint={tr('settings.backupHint')}>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="settings-export"
              onClick={onExportSettings}
              className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
            >
              {tr('settings.exportConfig')}
            </button>
            <button
              type="button"
              data-testid="settings-import"
              onClick={() => {
                if (window.confirm(tr('settings.importConfirm'))) onImportSettings()
              }}
              className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
            >
              {tr('settings.importConfig')}
            </button>
          </div>
        </SettingsField>
```

- [ ] **Step 4: Añadir las claves i18n en los 5 idiomas**

En la sección `settings` de cada locale (junto a `configDirHint`), añadir 5 claves. Ejemplo `es.json`:
```json
    "backup": "Copia de seguridad",
    "backupHint": "Exporta toda tu configuración a un fichero (incluido el token de Discogs) o restáurala desde uno.",
    "exportConfig": "Exportar…",
    "importConfig": "Importar…",
    "importConfirm": "Esto reemplazará toda tu configuración actual. ¿Continuar?",
```
Ejemplo `en.json`:
```json
    "backup": "Backup",
    "backupHint": "Export all your settings to a file (Discogs token included) or restore from one.",
    "exportConfig": "Export…",
    "importConfig": "Import…",
    "importConfirm": "This will replace all your current settings. Continue?",
```
Para `de`, `fr`, `pt-BR`: añadir las mismas 5 claves traducidas siguiendo el tono de las vecinas.

- [ ] **Step 5: Verificar tipos, lint y JSON**

Run: `cd apps/desktop && npx tsc --noEmit -p tsconfig.web.json 2>&1 | head; npx biome check src/renderer/src/components/settings/GeneralTab.tsx src/renderer/src/components/SettingsModal.tsx; for f in en es de fr pt-BR; do node -e "JSON.parse(require('fs').readFileSync('src/renderer/src/i18n/locales/$f.json','utf8'))"; done && echo jsonok`
Expected: sin errores; `jsonok`. (Si `tsconfig.web.json` no existe, usar el tsconfig del renderer; verificar con `ls apps/desktop/tsconfig*.json`.)

- [ ] **Step 6: Verificación manual en la app real**

Usar el skill `run-desktop` para arrancar Surco. Abrir Ajustes › General, comprobar que aparecen los botones Exportar/Importar. Exportar a un fichero, cambiar el tema, Importar ese fichero, confirmar el diálogo, y verificar que el tema vuelve al exportado y la app se refresca sin reiniciar.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/components/settings/GeneralTab.tsx apps/desktop/src/renderer/src/components/SettingsModal.tsx apps/desktop/src/renderer/src/i18n/locales/
git commit -m "Añadir botones de exportar e importar configuración en Ajustes"
```

---

### Task 6: Suite completa y cierre

- [ ] **Step 1: Correr toda la suite de tests de desktop**

Run: `cd apps/desktop && npx vitest run`
Expected: PASS — toda la suite, sin regresiones.

- [ ] **Step 2: Verificar build de tipos completo**

Run: `cd apps/desktop && npx tsc --build`
Expected: sin errores.

- [ ] **Step 3: Lint de todos los ficheros tocados**

Run: `cd apps/desktop && npx biome check src/main/settings.ts src/main/exportIpc.ts src/main/exportSettings.test.ts src/main/importSettings.test.ts src/preload/index.ts src/preload/api.ts src/renderer/src/components/settings/GeneralTab.tsx src/renderer/src/components/SettingsModal.tsx`
Expected: sin warnings ni errores.

---

## Notas de verificación del plan (self-review)

**Cobertura del spec:**
- Parte 1 Export → Task 3. Parte 1 Import (validar + confirmar + reemplazar + recargar) → Task 4 (validar/aplicar) + Task 5 (confirmar + recargar UI). ✓
- Parte 2 (token en carpeta sync + comentario) → Task 1. ✓
- Efecto colateral del hint i18n que menciona el token → Task 2 (no estaba explícito en el spec pero es consecuencia directa de la Parte 2; se documenta aquí). ✓

**Consistencia de tipos:** `exportSettings` / `importSettings` / `serializeSettingsForExport` / `applyImportedSettings` usados con los mismos nombres y firmas en main, preload y renderer. El retorno discriminado `{ ok: true; settings } | { ok: false; error } | null` de `importSettings` es idéntico en `api.ts`, `index.ts` y su consumo en `SettingsModal`. ✓

**Sin placeholders:** todos los pasos con código muestran el código. Las traducciones de/fr/pt-BR se describen con la clave de referencia vecina en lugar de inventar el idioma. ✓

**Dependencia entre tareas:** Task 3b (exportar `defaults`) es prerequisito de Task 4; está dentro de Task 4. Task 1 no depende de nada. Task 2 depende conceptualmente de Task 1 (el hint deja de ser cierto tras Task 1) pero puede ir después sin bloqueo técnico.
