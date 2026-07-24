# Errores del updater: mensajes limpios y retry — diseño

Fecha: 2026-07-24
Estado: aprobado (conversación 2026-07-24)

## Problema

Cuando el check de actualizaciones falla (ej. un 504 de GitHub en
`releases.atom`), la app muestra un toast de peligro con el error crudo de
electron-updater: método, URL, el cuerpo HTML entero y todas las cabeceras.
Ilegible y alarmante para el usuario, que además no puede hacer nada — el fallo
es de GitHub y transitorio.

Agravantes del flujo actual (`main/index.ts:1168`):

- El toast salta también para los checks en segundo plano (arranque y ciclo de
  2 h), donde el usuario no ha pedido nada.
- En el check manual salen DOS avisos: un diálogo nativo genérico y el toast
  crudo.
- No hay reintento: un blip de minutos retrasa la actualización 2 h enteras.

## Objetivo

Que un fallo transitorio del feed sea invisible salvo que persista, que el
mensaje al usuario sea siempre corto y en su idioma, y que siempre haya un
camino de reintento (automático en fondo, botón en manual). El detalle crudo
del error queda solo en el log (`main.log`).

## Decisiones (conversación 2026-07-24)

- Fallo transitorio en segundo plano: silencio + reintentos con backoff.
  Avisar solo tras varios fallos seguidos.
- Cadencia: reintentos a 1, 5 y 15 min tras el fallo. Si el 4º intento también
  falla (~20 min), toast limpio con botón Reintentar y se vuelve al ciclo
  normal de 2 h.
- Check manual: un único toast limpio con botón Reintentar. Desaparecen el
  diálogo nativo de error y el toast crudo.

## Diseño

### Clasificación (`main/updateErrors.ts`)

Función pura `classifyUpdateError(err)` → `'transient' | 'offline' | 'fatal'`:

- `transient`: HTTP 5xx y 429 (el `HttpError` de electron-updater trae
  `statusCode`), timeouts, resets y DNS (`ETIMEDOUT`, `ECONNRESET`,
  `ECONNREFUSED`, `EAI_AGAIN`, `net::ERR_*` de red).
- `offline`: sin conexión (`ENOTFOUND`, `net::ERR_INTERNET_DISCONNECTED`).
  Entra en el bucle de reintentos pero NUNCA genera toast en segundo plano:
  trabajar sin red no es una incidencia que avisar.
- `fatal`: todo lo demás (firma inválida, binario corrupto, fallo de
  instalación…).

### Scheduler de reintentos (`main/updateRetry.ts`)

Módulo puro al estilo de `updateRecheck.ts` (timers inyectables, testeado con
fakes). Estado: contador de fallos seguidos + timer pendiente.

- `onFailure(kind)`: programa el siguiente reintento según el backoff
  (1, 5, 15 min). Agotado el backoff (4º fallo seguido), dispara `notify` una
  sola vez —salvo `offline`— y deja de programar; el ciclo de 2 h existente
  (`updateRecheck.ts`, que no cambia) sigue reintentando por su cuenta.
- `onSuccess()`: resetea contador, cancela el timer pendiente y rearma el
  aviso para la próxima incidencia.
- Un solo toast por incidencia: tras `notify`, los fallos posteriores del
  ciclo de 2 h no vuelven a avisar hasta que un check tenga éxito.

### Cableado en `main/index.ts`

- Los fallos de check/descarga se capturan en el rechazo de la promesa de
  `checkForUpdates()` (da contexto de fase), no en el evento global `'error'`.
  El listener `'error'` queda para el resto (instalación) con guarda para no
  reportar dos veces el mismo fallo.
- Fallo `fatal` (cualquier origen): toast inmediato con resumen corto (primera
  línea del mensaje, truncada), sin bucle de retry.
- Check manual fallido (cualquier tipo): toast limpio inmediato con Reintentar.
  Se elimina el `dialog.showMessageBox` de error del camino manual (el diálogo
  de «estás al día» del check manual con éxito no cambia). Un fallo manual no
  avanza el contador del scheduler (ya tiene su aviso); un éxito, venga de
  donde venga, sí lo resetea.
- IPC nuevo `update:check` + `checkForUpdates()` en preload: el botón
  Reintentar del toast relanza el mismo camino que la entrada del menú
  (incluido `manualUpdateCheck = true`).

### Renderer (`App.tsx`)

- Toast de fallo de check: clave nueva `update.checkFailed` (con el código
  HTTP si lo hay), acción `update.retry` → `window.api.checkForUpdates()`.
- Fallo `fatal`: se mantiene `update.failed`, pero el main ya solo envía un
  resumen corto, nunca el volcado.
- Misma key de toast `'update'` que hoy: un reintento o el «listo para
  reiniciar» sustituyen al error en vez de apilarse.

## Qué NO cambia

- El ciclo de re-check de 2 h (`updateRecheck.ts`).
- La entrega del update descargado (`updateDelivery.ts`) y su toast de
  reinicio.
- El diálogo de «estás al día» tras un check manual con éxito.

## Tests (TDD)

- `updateErrors.test.ts`: clasificación por statusCode y códigos de red;
  desconocidos → `fatal`.
- `updateRetry.test.ts`: backoff 1/5/15, `notify` una sola vez al 4º fallo,
  `offline` no notifica, reset y cancelación en `onSuccess`.
- `App.test.tsx`: el toast de `update.checkFailed` muestra la acción de
  reintento y llama a `checkForUpdates`.
- Paridad de locales cubierta por los tests existentes de i18n.
