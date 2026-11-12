# Informes que bastan para diagnosticar

## Por qué

epaulo1908 (usuario real, macOS) nos ha escrito dos veces desde el diálogo de comentarios y las dos
veces no hemos sabido qué le pasaba sin pedirle más:

- 11/11, Surco 1.33.0: «No me permite actualizar metadatos, ni reproduce ni da información de audio».
  El log traía el error de ffprobe del WAV, nada de lo que había hecho antes.
- 12/11, Surco 1.34.1: «cuando tratas de grabar datos como que se reinicia y debes volver a clickar en
  Rekordbox y vuelve a iniciar cada vez la lectura de los tracks». El log traía cuatro
  `render process gone { reason: 'crashed', exitCode: 5 }` y nada más.

Lo del 12/11 se investigó el mismo día (biblioteca rekordbox falsa de 401 y de 8001 pistas, WAV con el
mismo `too short LIST tag`, rekordbox «abierto» con un proceso falso y las dos respuestas del aviso de
cerrar) y no se reprodujo. Con el informe tal como llega hoy no se puede saber:

1. **Por qué murió el renderer.** El exitCode 5 es SIGTRAP en macOS: lo da un V8 sin memoria y también
   cualquier CHECK de Chromium. No hay ninguna medida de memoria en el log.
2. **Qué estaba haciendo.** El informe solo lleva líneas `[error]` (`recentErrorLines`, errorReport.ts),
   y casi nada se registra a nivel info (17 `log.info` en todo `src/main`).
3. **Dónde en el código.** `recentErrorLines` quita todas las líneas `at …` de las pilas. Desde 1.34.1
   el renderer se publica minificado con source maps ocultos (fbf7eb5ff), así que una pila con sus
   marcos se puede traducir; sin marcos, no.
4. **Con qué datos.** Ni el tamaño de la biblioteca, ni qué programas DJ había, ni los ajustes que
   cambian lo que hace la app, ni la memoria del equipo.
5. **Que hubo una caída.** `wireRendererRecovery` (crashGuards.ts) recarga la ventana en silencio. El
   usuario ve un «reinicio» y no sabe que hay algo que reportar.

Petición del usuario (12/11): «deberíamos tener instrumentadas todas las partes para que se vuelque en
los logs en caso de errores y los podamos recibir». Qué hace falta registrar lo decide el diseño (el
usuario: «eso lo tienes que responder tú»).

## Qué ya existe (no se toca, se aprovecha)

- `installCrashGuards`: `uncaughtException` y `unhandledRejection` del proceso principal ya van al log.
- `logHandlerFailures`: todo `ipcMain.handle` que lanza deja `ipc <canal> failed` en el log.
- `installGlobalErrorLogging` (renderer): `error` y `unhandledrejection` de la ventana van al log por
  `window.api.logError`. `ErrorBoundary` también.
- `wireRendererRecovery`: registra `render process gone` con `reason` y `exitCode` y recarga.
- El informe sale por dos vías: `sendFeedback` (POST a `getsurco.app/api/feedback`, límite del
  servidor `MAX_BODY_BYTES` = 64 KB, llega por correo vía Resend) y `openFeedbackReport` (issue
  PÚBLICO de GitHub, URL ≤ 7500 caracteres, se recorta por delante).
- `stripPaths`: reduce cada ruta a su último segmento. Todo lo que viaja pasa por ahí.

## Objetivos

1. **Memoria antes de cada caída.** El proceso principal toma cada 30 s una muestra de memoria de cada
   proceso de la app (`app.getAppMetrics()`: tipo, `workingSetSize`, `peakWorkingSetSize`) y guarda las
   últimas en memoria (anillo). Además, la ventana manda en cada muestra su heap de JS
   (`process.getHeapStatistics()` o `performance.memory` con la opción de Chromium que da valores
   precisos; ver «Lo que decide quien construye»). No se escribe en el log cada 30 s: el anillo se
   vuelca al log **cuando algo muere** y cuando la memoria de un proceso cruza un umbral alto (una línea
   `[warn]` por cruce, no por muestra).
2. **Todos los procesos que mueren o se cuelgan.** Además del renderer (ya registrado):
   `app.on('child-process-gone')` (GPU, utility, etc., con `type`, `reason`, `exitCode`, `name`) y
   `webContents.on('unresponsive')` / `'responsive'` con el tiempo que estuvo colgado. Cada uno a
   `[error]` (colgado a `[warn]`, y a `[error]` si supera un umbral).
3. **Rastro de acciones.** Una línea `[info]` corta por acción del DJ que lance trabajo, no por clic de
   UI ni por pista. Sale de donde nace la acción: las que viven en el principal (abrir fuente,
   escrituras en bibliotecas DJ, aviso de cerrar, USB) desde su IPC; las que se deciden en la ventana
   (convertir y actualizar en lote, emparejar, sesión) desde la ventana, con una línea al empezar el
   lote y otra al acabar, por un canal `log:info` gemelo de `logError` (decisión de Claude: el
   principal ve una llamada `process:track` por pista y no conoce el lote). Como mínimo:
   - abrir una fuente (programa, nº de pistas, cuánto tardó la lectura y cuántas leyó de caché);
   - convertir / actualizar etiquetas (nº de pistas, formato, destino, en sitio o no);
   - escrituras en bibliotecas DJ (programa, tipo, nº) y la respuesta al aviso de cerrar
     («ahora» / «al cerrarlo»);
   - exportar USB, revisar, emparejar, sesión;
   - arranque (versión, plataforma, memoria total del equipo) y cierre.
   Sin títulos ni rutas en esas líneas: recuentos, programas y decisiones. Si una línea necesita un
   fichero, solo su nombre (pasa por `stripPaths` igualmente al viajar).
   Las líneas de contexto que ya existen (warn/info con nombres de fichero, que suelen ser
   «Artista - Título») viajan tal cual tras `stripPaths`, **en las dos vías**, correo y GitHub
   (decisión del usuario, 12/11). No hace falta otro saneado.
4. **El informe lleva el contexto, no solo los errores.** `recentErrorLines` pasa a devolver, para los
   errores más recientes, las líneas de cualquier nivel que los preceden (ventana de ~40 líneas de
   log antes de cada error, sin duplicar las que se solapan), con los marcos de pila conservados
   (los primeros ~8 `at …` de cada pila, con rutas reducidas). Sigue siendo el log, no telemetría.
5. **Cabecera de entorno en cada informe.** Un bloque fijo arriba del informe:
   - SO y versión (`os.release()` / versión de macOS), arquitectura, memoria total y libre;
   - tiempo que llevaba abierta la app;
   - pistas cargadas en la lista y por fuente abierta (solo números);
   - programas DJ: cuáles están configurados y cuáles abiertos ahora;
   - los ajustes que cambian lo que la app hace con los ficheros: formato de salida, sobrescribir,
     convertir junto al original, `sync*` y `addTo*` por programa, normalizar, idioma. Nada de
     tokens, contraseñas, rutas ni correos.
   Sale en las dos vías (correo y GitHub). En GitHub el recorte por delante se come primero el log,
   nunca la cabecera.
   Lo que solo sabe la ventana (pistas en la lista, fuente abierta y sus pistas) viaja junto a la
   muestra de heap de cada 30 s; el principal guarda la última. Así un informe enviado después de una
   caída describe el momento de la caída y no la ventana recién recargada (decisión de Claude). La
   cabecera marca qué datos son «al caer» y cuáles «ahora». El volcado del anillo al log cuando algo
   muere incluye también esa última instantánea.
6. **Decirle al usuario que hubo una caída.** Cuando `wireRendererRecovery` recarga, la ventana nueva
   lo sabe (el principal se lo da por IPC al cargar) y enseña un aviso: «Surco se cerró de forma
   inesperada», con el botón que abre el diálogo de comentarios ya con el error
   (`render process gone …`) y el informe adjunto. El aviso sigue el patrón de avisos que ya existe en
   la app (toast de Sonner u otro existente; ver los avisos actuales antes de elegir). Se enseña una
   vez por caída.
7. **Pilas legibles para nosotros.** Un script de desarrollo (`scripts/`, no va en la app) que recibe
   una pila minificada del renderer y la versión, y la traduce con los source maps de ese build. Si los
   `.map` de una release no se pueden recuperar (hoy viajan dentro de `out/**` del asar; comprobarlo),
   el diseño se cumple guardándolos como artefacto de la release.

## No objetivos

- Telemetría o envío automático. Nada sale del equipo hasta que el usuario pulsa enviar (o abre el
  issue). Sigue siendo «no telemetry by design».
- Minidumps / `crashReporter`. Pesan, son binarios y leerlos exige los símbolos de Electron. Si con la
  memoria y el contexto seguimos sin causa, es el siguiente paso, en otro diseño.
- Registrar cada clic o cada render. El rastro es por acción con trabajo detrás.
- Cambiar el diálogo de comentarios más allá de abrirlo prellenado desde el aviso de caída.

## Antiobjetivos (fallaría aunque funcione)

- Que el log crezca sin control: el muestreo no escribe en cada muestra; el rastro es de una línea por
  acción. El log tiene que seguir siendo legible a mano.
- Que viaje algo que identifique a la persona: rutas completas, títulos de su biblioteca en la
  cabecera, ajustes con credenciales. El issue de GitHub es público.
- Que la instrumentación cueste rendimiento visible: el muestreo cada 30 s y el IPC del heap tienen
  que ser despreciables; nada de esto en el camino caliente de lectura de metadatos.
- Que el informe supere los límites y deje de llegar: el cuerpo del POST por debajo de 64 KB con
  margen, y la URL de GitHub por debajo de 7500 caracteres recortando el log, no la cabecera.

## Restricciones

- Trabajo en worktree, TDD, sin comentarios en el código nuevo, tests con `data-testid` (reglas del
  repo y del usuario).
- Los ficheros del principal se testean con fakes de los slices de Electron, como `crashGuards.ts`
  (interfaces estrechas `ProcessEvents`, `RendererContents`).
- Textos visibles (aviso de caída) en los seis idiomas, sin guion largo ni dos puntos explicativos.
- El arnés de scenarios necesita cada canal IPC nuevo cableado (`harness.tsx`, `test/api.ts`).
- El servidor (`apps/web/src/lib/feedbackMail.ts`) tiene que aceptar y pintar la cabecera nueva en el
  correo.

## Lo que decide quien construye

- Cómo medir el heap de la ventana sin el redondeo de `performance.memory`
  (`--enable-precise-memory-info`, `process.getHeapStatistics()` vía preload, o
  `webContents` + `getProcessMemoryInfo`). Elegir uno que funcione en macOS y Windows.
- El umbral de memoria alta (relativo a la memoria del equipo o fijo) y el tamaño del anillo
  (sugerencia: 20 muestras = 10 min).
- El formato exacto de las líneas del rastro y de la cabecera, siempre que sean una línea por hecho y
  sin datos personales.
- Si el rastro se emite desde los handlers IPC existentes o desde un envoltorio común como
  `logHandlerFailures`.
- El orden de entrega. Propuesta: 1 memoria + procesos muertos/colgados, 2 informe con contexto y
  pilas, 3 cabecera, 4 rastro de acciones, 5 aviso de caída, 6 script de pilas. Cada uno se puede
  publicar solo.
