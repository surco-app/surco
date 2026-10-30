# Copias: historial y restaurar de las bibliotecas de DJ

Fecha: 29/10/2026. Bocetos: `.superpowers/brainstorm/94961-1793309731/content/copias-boceto-v3.html` (el aprobado) y v2.

## Por qué

Lo que más preocupa a un DJ profesional es que Surco le rompa rekordbox, Traktor o Engine. Surco ya escribe con cuidado: copia antes de cada escritura, no escribe con el programa abierto, cambia el archivo de forma atómica y solo toca lo que cambia. Pero el DJ no lo ve, y si algo sale mal no puede volver atrás por su cuenta:

- Solo hay dos copias por biblioteca y las dos se pisan solas. `.surco-backup` se sobrescribe en cada escritura y `.surco-session` al empezar cada tanda (`main/index.ts:1383-1389`). Quien descubre un fallo dos tandas después ya no tiene el estado bueno.
- No hay botón de restaurar. Solo "Mostrar carpeta" en Ajustes → Avanzado, y los mensajes de error piden reemplazar el archivo a mano.

La confianza llega cuando el DJ puede **ver** las copias y **volver atrás con un clic**.

## Objetivos

1. Guardar un historial corto de copias de cada biblioteca de DJ.
2. Una pantalla "Copias", fija abajo del todo en la barra lateral, donde se ven todas las copias de Surco (bibliotecas y archivos de música) y se restauran.
3. Restaurar una biblioteca a una copia concreta con la misma seguridad con la que Surco escribe.

## Fuera de alcance

- Forzar el guardado en disco (fsync) o verificar el archivo después de escribirlo. Es una mejora aparte.
- Copia de las miniaturas de carátula de Traktor (`main/traktorCoverCache.ts`) y de la base de datos del USB al exportar a Engine.
- Cambiar la retención de los archivos de música (7 días, 2 GB): se muestran tal como funcionan hoy.
- Textos de la web. Habrá que revisarlos cuando esto salga ("con copia de seguridad y Deshacer").

## Anti-objetivos (sería un fracaso aunque funcione)

- Que la pantalla prometa más de lo que hace: que muestre una copia que no se puede restaurar o diga "a salvo" cuando la última copia falló.
- Que restaurar pueda dejar una biblioteca peor que antes: a medias, mezclada con su `-wal`, o con el programa abierto.
- Que un punto de color encendido siempre enseñe al DJ a ignorarlo.

## Lo que decidió Vicent

- **Cinco copias por programa.** Cuando entra la sexta, se borra la más vieja. Sin caducidad por días ni ajustes. (Vicent dudó si bastaba con una y me dejó decidir. Me quedo con cinco: una sola copia se pisa en el siguiente momento, así que un fallo que el DJ descubre días después ya no tiene arreglo. Tres pueden quedarse cortas en un día con tanda, cues y revisión.)
- **Icono en la barra lateral, abajo del todo**, que abre una **pantalla entera** (no una ventana pequeña).
- **Una sección por programa**, todas con la misma forma: estado, última copia, cuántas hay guardadas ("3 de 5"), "Ver copias" (la lista se despliega debajo, en la misma pantalla) y "Restaurar…" (vuelve a la última copia, con confirmación). Cada copia de la lista tiene su "Restaurar esta".
- **Los archivos de música van en la misma pantalla**, como una sección más al final, con la misma forma. Es lo que hoy muestra la ventana "Copias de seguridad" (`components/TrashPanel.tsx`). Al desplegarla salen los archivos, cada uno con su Restaurar. No tiene "Restaurar…" general.
- Pie de pantalla: "De cada programa guardamos las últimas 5 copias. Los archivos de música, 7 días." y "Mostrar en Finder".

- **Los cambios pequeños se agrupan en una sola copia por sesión de Surco.** Son las ediciones de playlists hechas desde Surco con el programa cerrado (`rekordbox:edit` en `main/rekordboxPlaylistsIpc.ts`, `main/traktorPlaylistEditIpc.ts`) Las escrituras que Surco hace solo (`adjustProvisionalCuesOnLaunch`, `rekordboxCompleteOnClose`) solo encolan; se escriben al aplicar la cola, que ya es un momento con su copia. Se toma una copia antes del primer cambio pequeño de cada colección desde que se abrió Surco ("Antes de tus cambios de playlists de hoy") y los siguientes cambios de esa sesión no toman otra. Una sesión empieza al abrir Surco y termina al cerrarlo.

## Decisiones mías (revisables)

- **Cuándo se guarda una copia del historial: una por "momento"**, no una por escritura. Un momento es cualquiera de estas cosas: una tanda de conversión, un guardado del editor de cues, aplicar una revisión de metadatos, aplicar la cola al cerrar el programa, reemplazar duplicados o reapuntar archivos. Es decir, cualquier operación que el usuario lanza una vez y que puede escribir muchas veces. La copia se toma antes de la primera escritura del momento, como hace hoy `createSessionBackup.ensure`. Un momento que no llega a escribir nada no deja copia.
- **La copia por escritura (`.surco-backup`) se queda como está.** Sirve para recuperar una escritura que se cortó a medias, que es otro trabajo distinto. No se muestra en la pantalla ni cuenta entre las cinco.
- **Cada copia lleva una frase de qué iba a pasar**, por ejemplo "Antes de convertir 23 pistas", "Antes de guardar cues de 12 pistas" o "Antes de restaurar". La primera versión va sin número de pistas: al tomar la copia, la mayoría de caminos aún no lo saben.
- **Antes de restaurar se guarda una copia del estado actual** ("Antes de restaurar"), así restaurar también se puede deshacer. Esa copia **no cuenta entre las cinco**: solo se guarda una, la del último restaurar, que sustituye a la anterior. Así restaurar varias veces seguidas no puede echar del historial las copias de verdad, ni borrar la copia que se acaba de restaurar.
- **Las cinco copias son de la colección actual de cada programa** (la ruta que Surco usa hoy; en Traktor, `settings.traktorNmlPath`). Si el DJ cambia de colección (Traktor 4.4 → 4.5, otra carpeta), la sección muestra las copias de la nueva. Las de la anterior se quedan en disco sin borrar, se ven desde "Mostrar en Finder" y no se pueden restaurar sobre la nueva desde la pantalla. Restaurar comprueba que la copia es de la misma colección que va a sobrescribir.
- **Una copia de rekordbox incluye `master.db` y `masterPlaylists6.xml`**, porque Surco escribe los dos en la misma operación (`applyRekordboxBatch`). Se copian y se restauran juntos.
- **Restaurar se comporta como una escritura más**: mismas comprobaciones de programa cerrado, mismo diálogo para ofrecer cerrarlo (`main/index.ts:518-610`) y cambio de archivo atómico (temporal + rename con `renameRetry`).
  - rekordbox: no se restaura si `master.db-wal` tiene datos, igual que hoy `restoreCollection`.
  - Engine: no se restaura si `m.db-wal` o `m.db-journal` no están vacíos.
- **Si hay cambios en la cola de ese programa, restaurar los descarta**, y el diálogo lo dice ("También se descartarán 3 cambios que esperaban a que cerraras Traktor"). Si no se descartan, se aplicarían encima de la copia restaurada y el DJ no volvería al estado que eligió.
- **Texto de confirmación**: "¿Volver a como estaba rekordbox hoy a las 21:40? Se perderá lo que hayas cambiado en rekordbox después de esa hora, también lo que hiciste desde rekordbox. Antes guardamos una copia de cómo está ahora, por si cambias de idea."
- **Estado de cada sección de programa**, de más a menos grave:
  - Rojo: Surco ha parado (cola detenida por una escritura en estado desconocido, o la última copia falló).
  - Ámbar: hay cambios esperando en la cola.
  - Neutro: "Surco no lo toca", si ese programa está en "No tocar".
  - Verde: "Al día".
- **Icono de la barra**: escudo con la etiqueta "Copias". Sin punto si todo va bien, punto ámbar si alguna sección está en ámbar y punto rojo si alguna está en rojo.
- **"Restaurar…" está disponible siempre que haya copias**, aunque el programa esté en "No tocar". En el boceto v3 aparecía desactivado para Engine; es un error del boceto.
- **Las entradas que hoy abren "Copias de seguridad"** (`openBackups` en `App.tsx:2773` y la marca de copia de una pista en `App.tsx:2001`) abrirán la pantalla nueva con la sección de archivos de música desplegada y la búsqueda ya puesta. La ventana `TrashPanel` como ventana aparte desaparece, y su contenido (filtros, búsqueda, eliminar, vaciar) pasa a esa sección.
- **El icono de la sección de música no es ♪**, porque se confunde con Apple Music en la barra. El icono concreto lo elige quien lo construya.

## Choque con una decisión anterior

`main/rekordboxSessionBackup.ts:28-30` explica que la copia de sesión se sobrescribe en vez de fecharse porque la colección del usuario pesa 56 MB y no se quería acumular copias. Con cinco copias son unos 280 MB por colección de rekordbox en el peor caso, más Traktor y Engine. Se eligen cinco sabiéndolo. Ese comentario hay que actualizarlo.

## Restricciones

- Las copias siguen en la carpeta de Surco (`libraryBackupRoot()`, una carpeta por colección según `backupOf`), nunca junto a la colección.
- Si la copia del momento falla, no se escribe, igual que hoy.
- La limpieza de la sexta copia nunca puede borrar la única copia buena. Se borra solo después de que la nueva haya quedado escrita.
- Funciona en macOS y Windows, como el resto de escrituras.
- Hoy la barra lateral (`SourceRail`) solo aparece si hay alguna biblioteca de DJ en el equipo (`App.tsx:3104`). El icono "Copias" tiene que verse aunque no haya ninguna, porque siempre está la sección de archivos de música.

## Lo que queda para quien lo construya

- Formato y nombre de las copias fechadas y dónde se guarda la frase y la fecha (archivo al lado, índice JSON, etc.). Las colecciones `.surco-session` que ya existan pueden migrarse o ignorarse.
- Cómo se avisa de que empieza o termina un "momento" en cada camino de escritura: hoy solo las tandas tienen `process:batch-begin`.
- Diseño visual fino a partir del boceto v3, con los tokens de `index.css`.
- Si la pantalla Copias es una "fuente" más de `SourceRail` o una vista aparte en `App.tsx`.
