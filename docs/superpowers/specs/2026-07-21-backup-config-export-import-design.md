# Backup de configuración: export/import a fichero + token en carpeta sincronizada

Fecha: 2026-07-21

## Problema

El usuario quiere un **backup completo** de la configuración de Surco, incluido el token de Discogs. Usa la app desde **dos Macs** con la carpeta de configuración apuntada a iCloud.

Hoy existen dos limitaciones:

1. **No hay export/import de configuración a un fichero.** Solo se puede relocalizar la carpeta de `settings.json` (feature ya existente), lo que sincroniza pero no es un backup restaurable de una sola máquina.
2. **El token de Discogs nunca sale de la máquina.** `LOCAL_KEYS` (`apps/desktop/src/main/settings.ts:93`) mantiene `discogsToken` y `autoMatch` fuera de la carpeta sincronizada por seguridad, así que no viajan entre las dos Macs.

El usuario acepta conscientemente el riesgo de que el token viaje por su iCloud en texto plano ("es mi cloud").

## Restricción física del caso "dos Macs"

Con la carpeta compartida entre dos máquinas, **no todo puede sincronizarse**, no por diseño sino porque el dato no significa lo mismo en la otra Mac:

- `outputDir`, `engineLibraryDir` — rutas locales; la carpeta del Mac A no existe en el Mac B.
- `stats`, `conversionCount`, `commandUsage` — contadores por-máquina; si las dos Macs escriben en el mismo fichero se pisan y corrompen (NaN → null).
- `hasSeenOnboarding`, `lastSeenChangelogVersion`, `activityPanel`, `resultsWidth` — estado por-pantalla/máquina.

Por eso el "backup de todo" literal se resuelve con el **export a fichero** (foto de una máquina), no con la carpeta compartida. Son dos features complementarias.

## Alcance

Dos partes, ambas dentro de la app desktop (`apps/desktop`).

---

## Parte 1 — Export / Import de configuración a fichero

Backup completo y restaurable de una máquina. Sin filtrar ninguna clave: token, rutas y stats incluidos.

### Export

- **UI:** botón "Exportar configuración" en la tab General de Ajustes (`settings/GeneralTab.tsx`), junto a los controles de carpeta de config existentes.
- **Flujo:** `dialog.showSaveDialog` con nombre por defecto `surco-config.json` → escribe el objeto `Settings` **completo** que devuelve `getSettings()` (ya fusionado local+synced, con token/rutas/stats) → reporta al activity feed como los demás export.
- **IPC:** nuevo handler en `apps/desktop/src/main/exportIpc.ts`, siguiendo el patrón exacto de `dialog:exportRekordbox` (dialog → `activity.track('export', ...)` → devuelve path o `null` si se cancela). Nombre: `dialog:exportSettings`.
- **Sin filtrado:** el fichero contiene el `Settings` entero, tal cual. Es el punto clave que lo hace un backup completo real.

### Import

- **UI:** botón "Importar configuración" al lado del de exportar.
- **Flujo:**
  1. `dialog.showOpenDialog` (filtro `.json`).
  2. **Validar:** parsear JSON; comprobar que es un objeto con al menos una clave conocida de `Settings`. Si no parsea o no tiene pinta de settings de Surco → devolver error claro (la UI muestra un mensaje, no aplica nada).
  3. **Confirmar:** `dialog.showMessageBox` de confirmación — *"Esto reemplazará toda tu configuración actual. ¿Continuar?"*. Reemplazar-todo es destructivo, así que la confirmación es obligatoria.
  4. **Aplicar:** reemplazo real. El objeto importado pasa por `mergeSettings(defaults, importado)` para rellenar **solo** claves ausentes (backup de una versión antigua de Surco), pero **no conserva nada de la config actual**. Importante: NO se usa `saveSettings` para esto, porque `saveSettings` hace `{ ...getSettings(), ...patch }` (fusiona con lo actual, no reemplaza). Se añade una función nueva `replaceSettings(imported)` en `settings.ts` que parte de `defaults` (no del estado actual) y persiste con el mismo split local/synced que `saveSettings`. Puede apagar `autoMatch` si sus prerrequisitos no se cumplen en esta máquina, lo cual es correcto.
  5. Devolver el `Settings` resultante.
- **IPC:** nuevo handler `dialog:importSettings` en `exportIpc.ts` (o su seam natural; el nombre `dialog:` mantiene la convención del fichero).
- **Recarga de UI:** el renderer aplica el resultado vía `onSettingsReplaced(next)` — el mismo mecanismo que ya usa `moveConfigDir` en `SettingsModal.tsx:118-127` para refrescar la app tras reemplazar settings de golpe (incluye `setSynced(pickSynced(next))` y `onPreviewTheme(next.theme)`).

### Reutilización

- La serialización completa ya existe: `getSettings()` devuelve el objeto fusionado.
- La migración/relleno de defaults ya existe: `mergeSettings(defaults, patch)` (`settings.ts:164`).
- El patrón IPC dialog+activity ya existe: `exportIpc.ts`.
- El refresco de UI tras reemplazo ya existe: `onSettingsReplaced` + `pickSynced`.

---

## Parte 2 — El token de Discogs viaja por la carpeta sincronizada

Que `discogsToken` (y su dependiente `autoMatch`) se escriban en el `settings.json` de la carpeta sincronizada y viajen entre las dos Macs.

### Cambio

- **Quitar `discogsToken` y `autoMatch` de `LOCAL_KEYS`** (`apps/desktop/src/main/settings.ts:93-108`). El resto de claves locales permanecen — son por-máquina y sincronizarlas rompería la otra Mac.
- `autoMatch` acompaña al token porque depende de él (`autoMatchAvailable`, `settings.ts:215`, ya lo apaga solo si falta el token).
- El `split`/merge existente (`settings.ts:145-153`, `210-225`) hace el resto automáticamente: al salir de `LOCAL_KEYS`, esas claves pasan al lado `synced` sin más código.

### Comentario a actualizar (obligatorio)

`settings.ts:89-92` afirma explícitamente que el token *"es un secreto que no debe acabar en iCloud/Dropbox en texto plano"*. Al hacer este cambio ese comentario deja de ser cierto. Se reescribe para reflejar la nueva decisión consciente del usuario (backup completo, incluido el token, en su cloud propio). No se deja un comentario que contradice el código.

### Texto de la UI a actualizar (i18n)

El hint de la carpeta de config (`settings.configDirHint`, en los 5 locales) dice literalmente que *"el token de Discogs... nunca sale de esta máquina"*. Tras este cambio es falso, así que se actualiza en `en`, `es`, `de`, `fr`, `pt-BR` para mencionar solo las estadísticas/rutas como locales.

---

## Fuera de alcance

- No se cambia la feature de relocalización de carpeta (sigue igual, solo cambia qué claves incluye vía Parte 2).
- No se añade cifrado del token ni gestión de secretos — el usuario aceptó texto plano en su cloud.
- No se toca la web (`apps/web`).
- No se sincronizan rutas ni contadores entre Macs (imposible sin corromper; ver "Restricción física").

## Tests

- `settings.ts` (main): export produce un objeto con todas las claves incluido el token; import con JSON válido reemplaza todo y rellena defaults ausentes; import con JSON inválido o ajeno se rechaza sin aplicar; tras quitar el token de `LOCAL_KEYS`, `split()` lo coloca en el lado `synced`.
- Confirmar que las claves de rutas/stats siguen en `LOCAL_KEYS` (no regresión de la Parte 2).
