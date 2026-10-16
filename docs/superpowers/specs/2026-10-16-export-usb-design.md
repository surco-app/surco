# Exportar playlists de rekordbox a un USB, rápido

Estado: **diseño decidido en conversación con Vicent (16/10)**, pendiente de revisar esta spec.
Viene del spike de las fases 1 y 2 (`usb-spike/findings.md` en el scratchpad de la sesión,
resumido en `docs/export-usb-medidas.md` en la tarea 1 del plan). El USB que escribió el spike
con baken se probó en sus reproductores y "funciona perfectamente".

## El caso

Vicent pincha con CDJ-2000, CDJ-3000, CDJ-3000X y XDJ-AZ. Preparar un USB con rekordbox es
lento (en foros, 225 pistas pasan de una hora) y le obliga a abrir rekordbox para algo que no
cambia nada de su colección. Quiere:

1. Elegir en Surco qué playlists (o carpetas enteras) de rekordbox van al USB.
2. Pulsar Exportar y que salga un USB que lean todos sus equipos, con onda, rejilla, hot cues,
   memory cues, carátula, clave y BPM, como uno de rekordbox.
3. Que la segunda vez sea casi instantánea: solo copia lo que cambió.
4. Ver cómo avanza sin quedarse mirando una barra muda, y poder seguir trabajando.

## Medido en el spike (16/10)

- 7 pistas, 459 MB de WAV y AIFF del NAS al USB de pruebas (exFAT) en 1,95 s con el NAS en
  caché, 4,9 s leyendo de verdad del NAS. Repetir sin cambios, 0,27 s.
- baken escribe `export.pdb`, `exportLibrary.db` (OneLibrary) y los ANLZ en el mismo sitio y
  con el mismo esquema de rutas que rekordbox 7.2.19 (`Contents/<Artista>/<Álbum>/<fichero>`).
  Tablas que leen los reproductores iguales fila a fila salvo IDs internos; ondas y rejilla
  byte a byte; audio idéntico por md5.
- Tres diferencias con rekordbox que esta spec corrige.
  - **Carátula**: 2 de 7. baken solo extrae la incrustada de AIFF, MP3, FLAC y M4A, no WAV.
  - **PVDI** (voces, rekordbox 7) en `.2EX`: rekordbox lo enmascara al exportar y baken lo copia
    en claro. Medido sobre las 5 pistas con datos, coincidencia exacta con rekordbox con esta
    regla: byte 12 de la sección a `0x80` y desde el byte 24 XOR con el patrón fijo de 19 bytes
    `1e dd 1e 19 02 19 1b 11 19 23 18 19 24 11 fb 11 1e 2a 15` (no depende de la longitud, a
    diferencia del de PSSI). En las 2 pistas sin datos, rekordbox añade al final un PVDI vacío
    de 24 bytes `50564449 00000018 00000018 00000400 56220001 00000000`.
  - **Color de hot cue por defecto**: rekordbox escribe código 0 con el RGB de cada letra
    (A 255/0/23, B 0/196/255, C 51/255/0, D 77/0/255, E 0/255/48, F 255/94/0). baken solo sabe
    escribir código 0 con verde, o aproximar un RGB a su paleta de 16 (código distinto de 0).
    G y H no se midieron (ninguna pista del spike los tenía).
- La salida de baken para humanos es una barra de `indicatif` que desaparece cuando la salida no
  es una terminal. No hay nada que Surco pueda leer para enseñar el progreso.

## Decisiones

1. **Enfoque A, baken como binario auxiliar**, igual que ffmpeg. Surco lee `master.db` en solo
   lectura (como las fases 1 y 2a), genera la entrada de baken (el XML de rekordbox, portado de
   `gen_xml2.py` a TS con tests) y prepara una carpeta de trabajo con los análisis, las
   carátulas y, si se pide, los My Settings. baken escribe Device Library (`export.pdb` + ANLZ)
   y OneLibrary (`exportLibrary.db`). El port a TS (B) queda fuera; solo si baken da problemas.
2. **baken con una serie corta de parches propios, compilado por Surco.** Lo que falta no se
   puede hacer bien desde fuera.
   - Color de hot cue por defecto como rekordbox: si el XML no trae color, código 0 con el RGB
     de su letra.
   - `--artwork-dir`: una imagen por `TrackID` que manda sobre la incrustada. Así entran las
     carátulas que rekordbox tiene en su caché (`djmdContent.ImagePath`), también de WAV.
     Arreglarlo después de baken no es posible: la carátula va en tablas de `export.pdb`.
   - Progreso legible (`--json`): una línea JSON por evento (plan, empieza pista, pista escrita,
     escribiendo base de datos, informe, error), el plan dice si el destino es la raíz de un
     volumen, y **cancelar entre pistas**: una línea `cancel` por la entrada estándar (y
     también SIGINT/SIGTERM en macOS) marca la cancelación, baken termina la pista que copia y
     para sin escribir `export.pdb`. La entrada estándar sirve igual en Windows, donde un
     proceso hijo no recibe SIGINT.
   Mientras baken no los publique, Surco compila baken desde la etiqueta `v4.6.1` más sus
   parches, dentro del propio build de cada plataforma (CI y local, con el mismo script y una
   versión de Rust fijada). No se publican binarios sueltos en `surco-releases`: una release
   más allí la verían la web y el actualizador. **Ofrecerlos a baken es decisión de Vicent**: el
   plan deja los parches y un borrador de PR en `docs/baken-upstream-prs.md` y no abre nada
   público. Cuando baken publique un cambio, se borra su parche.
3. **PVDI se arregla sin tocar baken**: baken copia el `.2EX` tal cual (solo le cambia la ruta),
   así que Surco enmascara PVDI en la copia de trabajo de los análisis antes de pasársela. Es
   código de Surco, con tests, y no frena las exportaciones siguientes. Retocar los ANLZ ya
   escritos en el USB sí las frenaría: baken compara byte a byte y los reescribiría cada vez.
4. **Lo que queda en el USB y lo que se sustituye.** Surco solo escribe dentro de `PIONEER/` y
   `Contents/` en la raíz del volumen, y solo lo hace baken.
   - Se sustituyen siempre, al final y por escritura atómica (fichero `.tmp` al lado y rename
     encima), `PIONEER/rekordbox/export.pdb` y `exportLibrary.db`. Se borran
     `exportLibrary.db-wal`, `-shm` y `exportExt.pdb` de una exportación anterior de rekordbox,
     porque si quedan los equipos OneLibrary enseñan la biblioteca vieja.
   - **My Settings solo si se pide**: casilla "Copiar My Settings" (apagada, se recuerda por
     USB). Encendida, se copian los de rekordbox del ordenador (`MYSETTING*.DAT`,
     `DJMMYSETTING.DAT`, `djprofile.nxs`), salvo los que un reproductor guardó en el USB, que
     baken respeta. Apagada, `--no-settings` y el reproductor usa los suyos.
   - El audio que ya está en `Contents/` con el mismo tamaño y los mismos trozos de principio,
     medio y final se deja (por eso un USB de rekordbox se sustituye casi sin copiar nada).
   - **Por defecto no se borra música.** Lo que ya no está en ninguna playlist exportada sale de
     la base de datos del USB pero su fichero se queda. Razón: deseleccionar una playlist por
     error y volver a marcarla debe costar cero. Una casilla "Borrar del USB la música que ya no
     se exporta" (apagada, se recuerda por USB) pasa `--prune`, que borra solo dentro de
     `Contents/`, `PIONEER/USBANLZ/` y `PIONEER/Artwork/`, y baken no lo hace si alguna pista
     falló. **Nunca con "Otro destino"**: en una carpeta elegida a mano no se poda nunca.
   - Nunca se toca nada fuera de esas dos carpetas: las carpetas del usuario en el USB
     (`Mis cosas/`, fotos, otros DJ software) quedan como estaban. `PIONEER.rekordbox` y
     similares también, porque no se llaman `PIONEER`.
5. **Se identifica el USB por un identificador estable, nunca por nombre ni por letra**: Vicent
   tiene dos USB que se llaman "Vicent". En macOS el Volume UUID de `diskutil`; en Windows el
   GUID del volumen (`\\?\Volume{…}\`). Justo antes de lanzar baken se vuelve a preguntar qué
   volumen hay en ese punto de montaje o esa letra, y se apunta su número de dispositivo
   (`stat(raíz).dev`, que en Windows es el número de serie del volumen). Durante la
   exportación Surco lo mira cada segundo y cancela si cambia o desaparece; baken además
   comprueba en macOS dispositivo e inodo de la raíz.
6. **Una sola exportación a la vez, sin carrera.** La exportación se reserva en cuanto se pide,
   antes de cualquier espera, y el botón Exportar queda deshabilitado mientras arranca.
7. **Antes de escribir, el espacio.** Cada exportación hace primero la pasada en seco de baken y
   no empieza si lo que va a escribir no cabe: "Hace falta 3,1 GB y hay 1,7 GB libres". El
   resumen ya lo avisa antes y deshabilita Exportar.
8. **"Otro destino" solo en un volumen extraíble.** La carpeta elegida tiene que estar en uno de
   los volúmenes que lista el selector (tarjeta SD, USB); una carpeta del disco del sistema se
   rechaza. Si no es la raíz, aviso "Los reproductores solo leen la raíz de un USB".
9. **Memoria por USB** en un fichero propio de Surco, `usb-exports.json` en los datos de la
   app, local a la máquina: playlists marcadas, pistas exportadas, fecha, tamaño y fecha de
   `export.pdb` tras escribirlo, y las casillas de borrar y de My Settings. Por clave
   `volume:<id>` o `folder:<ruta real>`. No va en `settings.json` porque no tiene sentido en
   otra máquina y puede crecer a miles de IDs.
10. **Quién escribió el USB.** `exportExt.pdb` presente = rekordbox (baken lo borra siempre).
    Si no, y `export.pdb` tiene el tamaño y la fecha que guardó la memoria = Surco. Si no hay
    `export.pdb` = vacío. Cualquier otro caso = "tiene una exportación" con su fecha.
11. **Siempre OneLibrary, siempre análisis.** `--onelibrary` siempre (CDJ-3000X y XDJ-AZ solo
    leen eso). `--generate-analysis` siempre: una pista sin analizar en rekordbox sale con onda
    calculada por baken en vez de quedarse sin onda.
12. **Separadores sí, streaming no.** El MP3 separador (fase 1) se exporta como cualquier pista,
    porque en el CDJ también separa. Ningún recuento de la UI cuenta separadores (resumen,
    "7 / 12", píldora, aviso de terminado), como el árbol.
13. **Lo que no se puede exportar se dice, pista a pista, con su motivo**: fichero que no se
    encuentra, fila de streaming, pista que baken descarta. Los motivos son códigos que se
    traducen; el texto en inglés de baken solo va al registro.
14. **Plataformas: macOS y Windows**, Linux fuera. En Windows la función aparece igual que en
    macOS cuando hay colección de rekordbox (`%APPDATA%\Pioneer\rekordbox\master.db`).

## Qué se ve

### Abrir

- Botón en la cabecera del árbol de rekordbox (icono de USB, junto a "nueva playlist" y "nueva
  carpeta"), tooltip "Exportar a USB".
- ⌘K / Ctrl+K, "Exportar a USB…" (grupo biblioteca), solo si hay colección de rekordbox, en
  macOS y en Windows.
- Aviso discreto al conectar un USB que ya lleva una exportación (de Surco o de rekordbox):
  "USB Vicent conectado · Exportar". La acción abre el modal con ese USB elegido. No sale si
  el modal está abierto o si ya hay una exportación en marcha.
- Abrir el modal después de una exportación terminada en segundo plano empieza de nuevo en la
  elección (el resultado ya se avisó).

### El modal, al elegir (boceto "USB C")

Dos columnas.

- **Izquierda**, el árbol de rekordbox con casillas. Marcar una carpeta marca todo lo que hay
  dentro y queda a medias si solo parte; las carpetas que contienen algo marcado se abren
  solas. Cada playlist enseña su número de pistas. Buscador como el del árbol de siempre.
- **Derecha**, arriba, los USB.
  - Solo volúmenes extraíbles montados (ni el disco del sistema, ni discos internos, ni red ni
    NAS, ni imágenes de disco). La lista se actualiza sola al conectar y desconectar.
  - Cada fila, nombre, capacidad y libre ("29,3 GB · 21,4 GB libres"), sistema de ficheros
    (FAT32, exFAT, HFS+, NTFS) y qué lleva ("exportado por rekordbox el 16/10 08:27",
    "exportado por Surco hoy 09:12", "vacío").
  - Se preselecciona el único, o el último usado. Al elegir un USB que Surco ya exportó, el
    árbol y las casillas quedan como la última vez, de forma que basta con pulsar Exportar.
  - Sin USB, "Conecta un USB" en su lugar. "Otro destino…" abre un selector de carpeta
    (decisión 8).
- **Derecha**, abajo, el resumen, que se recalcula al marcar (sin escribir nada).
  - "N pistas" y "X nuevas · 1,2 GB" y "Y ya están" y "Z quitadas desde la última vez".
  - Avisos, uno por línea, solo si aplican.
    - "Este USB lo exportó rekordbox. Su biblioteca se sustituye por esta; la música que ya
      está se aprovecha."
    - "exFAT. El CDJ-2000 no lo lee." y "GPT. El CDJ-2000 y los NXS2 no lo leen." y "NTFS. Los
      reproductores no lo leen."
    - "3 pistas puede que no suenen en un CDJ-2000" (32 bits, más de 48 kHz, FLAC), con un
      desplegable que las nombra.
    - "4 pistas no se pueden exportar", con un desplegable de cada una y su motivo ("no se
      encuentra el fichero", "es de streaming", "baken no la acepta").
    - "No cabe. Hace falta 3,1 GB y hay 1,7 GB libres." (Exportar se deshabilita.)
  - Casillas "Copiar My Settings" y "Borrar del USB la música que ya no se exporta", apagadas
    y recordadas por USB (la segunda no aparece con "Otro destino").
  - Exportar (deshabilitado mientras arranca) y Cancelar.

### El modal, exportando

Una sola columna, la lista de las pistas de la exportación en orden. Sin disco ni adornos.

- **Arriba**, una línea fina de progreso general y "7 / 12", MB/s y tiempo restante.
- **Cada fila**, carátula pequeña, título, artista y estado: "en cola", "copiando", el tamaño
  cuando termina ("72,8 MB"), "ya estaba" o el motivo traducido si falla.
- **La animación vive en las filas**, si es barata. Cada pista lleva una onda pequeña sacada del
  análisis de rekordbox (la vista previa `PWAV` del `.DAT`, 400 columnas, reducida a 100
  barras).
  - En cola, una línea discontinua tenue, sin onda.
  - Copiando, la onda se revela de izquierda a derecha según los bytes copiados (clip-path).
  - Hecha, la onda entera en el color de acento. "Ya estaba", la onda entera, más tenue.
  - Sin análisis, una barra plana en lugar de la onda.
  - Con `prefers-reduced-motion`, sin transición: el relleno salta al porcentaje.
  - Se mide con 500 pistas o más (CPU y fotogramas). Si cuesta, cada fila lleva en su lugar una
    línea fina de progreso (decisión de Vicent: antes minimalista que un modal pesado).
- La fila que se copia se mantiene a la vista (scroll al más cercano).
- **Pie**, nombre del USB, espacio libre, sistema de ficheros y "Seguir en segundo plano".
- Cancelar: "Cancelando…" mientras baken termina la pista que copia; luego para. Ningún audio
  queda a medias encima de uno que la biblioteca anterior usa, y la base de datos del USB no
  cambia. En la fase final (escribiendo la base de datos) Cancelar no se ofrece,
  "Terminando…", porque cortar entre `export.pdb` y `exportLibrary.db` dejaría dos
  bibliotecas distintas.
- Cerrar el modal o "Seguir en segundo plano" no para nada. El progreso pasa a la barra fina de
  arriba (la de las conversiones) y a una píldora en la barra de herramientas, "USB 7/12", que
  reabre el modal.
- **Hecho**: las filas quietas y "Listo · 12 pistas en 1 min 4 s. Ya puedes expulsar el USB."
  Si el modal está cerrado, la misma frase sale como aviso. Las pistas que fallaron se listan
  con su motivo y no entran en la base de datos del USB.

Rendimiento: una sola SVG por fila, la revelación es `clip-path` con una transición de CSS, y
el estado de la exportación vive en un almacén aparte al que solo se suscriben la fila que
cambia, el modal, la píldora y la línea de arriba. App no se vuelve a pintar con cada tick de
bytes (cada 250 ms para la fila que se copia).

## Arquitectura

### baken, empaquetado

- `apps/desktop/vendor/baken/`: `UPSTREAM` (URL, etiqueta y commit de baken), `RUST_TOOLCHAIN`
  (la versión de Rust con la que se compila), `patches/*.patch`, `LICENSE` y
  `THIRD_PARTY_LICENSES.md` (el de la release v4.6.1 de baken, que no está en su código fuente).
- `scripts/build-baken.mjs`: clona la etiqueta (comprobando el commit, deshaciendo un `git am`
  a medias de una vez anterior), fija la versión de Rust, aplica los parches, pasa los tests de
  baken si se le pide, compila `baken` (`baken.exe` en Windows, x64) para la máquina y deja el
  binario y las dos licencias en `apps/desktop/resources/baken/`. En Linux solo deja las
  licencias. Lo llaman `release.yml` y `build-test.yml` antes de `electron-builder` (con caché
  de cargo), y quien desarrolla una vez.
- `electron-builder.yml`: `extraResources` de `resources/baken` a `baken`. En macOS
  electron-builder firma con el Developer ID todo Mach-O del bundle. `build-test.yml` gana un
  trabajo macOS firmado y notarizado sin publicar, y la firma y notarización de baken se
  comprueban en ese build antes de cualquier etiqueta. En Windows la app va hoy sin firmar
  (`packaging/windows-signing.md`), y `baken.exe` igual; cuando llegue la firma de SignPath,
  `baken.exe` entra en ella.
- Windows arm64 no: baken no lo publica y Surco solo empaqueta Windows x64.
- La licencia MIT de baken y la de sus dependencias viajan junto al binario; el README de
  Surco nombra baken en una sección de terceros.
- Variable `BAKEN_NO_UPDATE_CHECK=1`: baken nunca sale a internet (`expressport` no consulta
  actualizaciones; la variable cubre cualquier versión que lo haga).

### Main

| Módulo | Qué hace |
|---|---|
| `anlz.ts` | lee secciones ANLZ; rejilla `PQTZ`; vista previa `PWAV`; enmascara `PVDI` y añade el vacío |
| `usbExportSource.ts` | lee de `master.db` (solo lectura) las playlists elegidas, sus pistas, cues y rutas de análisis y carátula |
| `bakenXml.ts` | el XML de entrada de baken, port de `gen_xml2.py`, con rutas de macOS y de Windows |
| `usbExportStage.ts` | la carpeta de trabajo: XML, análisis (PVDI enmascarado), carátulas por TrackID, My Settings |
| `bakenRun.ts` | argumentos con guardas, lanzar baken, leer sus líneas JSON, pedir cancelar por la entrada estándar |
| `usbVolumes.ts` + `windowsVolumes.ps1` | volúmenes extraíbles (`diskutil` en macOS, PowerShell en Windows), vigilancia, qué lleva cada uno |
| `usbExportMemory.ts` | `usb-exports.json` |
| `usbExport.ts` + `usbExportIpc.ts` | resumen (baken `--dry-run --json`), comprobaciones, exportar, progreso, memoria |

IPC: `usb:volumes`, `usb:volumesChanged` (evento), `usb:pickFolder`, `usb:plan`, `usb:export`,
`usb:cancel`, `usb:event` (evento de progreso a todas las ventanas). La vigilancia de
volúmenes empieza con la primera petición de la lista, no al arrancar Surco.

**Volúmenes en Windows.** Un script de PowerShell (`Win32_Volume` más
`Get-Partition | Get-Disk`) da por volumen la letra, el GUID, el número de serie, la etiqueta,
el sistema de ficheros, capacidad y libre, el tipo de unidad, el bus y el esquema de
particiones. Extraíble = con letra, ni de sistema ni de arranque, y `DriveType` 2 o bus USB.
Las unidades de red (`DriveType` 4) no entran. La lista se vigila mirando cada 2 s qué letras
existen (barato) y relanzando el script cuando cambian.

**Lo que lee y dónde.** `master.db` en solo lectura (puede estar rekordbox abierto). Los ANLZ y
carátulas en `<carpeta de master.db>/share/` + `AnalysisDataPath` / `ImagePath`, solo lectura,
copiados a la carpeta de trabajo en los datos temporales de Surco. My Settings, si se piden,
desde `~/Library/Application Support/Pioneer/rekordbox6/` (macOS) o
`%APPDATA%\Pioneer\rekordbox6\` (Windows), copiados igual. baken recibe siempre `--anlz-dir` y
`--settings-dir` o `--no-settings`, así que nunca busca por su cuenta en la carpeta de Pioneer.
Nada se escribe nunca en `~/Library/Pioneer` ni en `%APPDATA%\Pioneer`, y el destino nunca es
la raíz del sistema (`/`, `%SystemDrive%\`) ni la carpeta del usuario.

**El XML** (decisiones del spike, medidas contra rekordbox 7.2.19).
- Hot cues A..H desde `djmdCue.Kind` 1, 2, 3, 5, 6, 7, 8, 9 (el 4 no se usa): `Num` = Kind - 1
  hasta 3, Kind - 2 desde 5. Memory cue Kind 0 = `Num -1`. Bucle si `OutMsec > 0`.
- Sin color en los hot cues: el parche de baken pone el de rekordbox para su letra.
- Rejilla `TEMPO` desde `PQTZ` del `.DAT`, una por cada cambio de BPM.
- `Size` el real del fichero (`stat`), no `djmdContent.FileSize`, que Surco deja desfasado al
  reescribir etiquetas (5 de 7 en el spike).
- `Location` como la escribe rekordbox, `file://localhost/` más la ruta codificada
  (`file://localhost/E:/Musica/…` en Windows).
- Sello, número de pista, disco, fecha de alta, veces reproducida, comentario, remixer,
  compositor, mix y año. Valoración 0..5 × 51.
- Carpetas de rekordbox como `NODE Type="0"`, playlists como `Type="1" KeyType="0"`, en el
  orden de rekordbox, solo las elegidas y las carpetas que las contienen.

**La exportación.**
1. Reservar la exportación (una a la vez).
2. Leer de `master.db` y preparar la carpeta de trabajo.
3. Comprobar que el punto de montaje o la letra siguen siendo el volumen elegido, apuntar su
   `dev`, y con "Otro destino" que la carpeta está en un volumen extraíble.
4. Pasada en seco de baken: que el destino de un volumen sea su raíz y que quepa.
5. Lanzar baken con `--json`. Mientras copia una pista, Surco mira cada 250 ms el tamaño del
   fichero de destino (baken lo escribe en su sitio a trozos de 4 MB) para la fila y los MB/s,
   y cada segundo el `dev` del destino.
6. Al evento "escribiendo base de datos", Cancelar desaparece.
7. Informe: guardar la memoria del USB (con tamaño y fecha del `export.pdb` nuevo) y avisar.

### Renderer

- `usbExportStore` (estado de la exportación en curso fuera de React, alimentado por
  `usb:event`), `useUsbVolumes` (lista viva), `useUsbPlan` (resumen con espera de 300 ms tras
  marcar).
- `UsbExportModal` (elegir), `UsbExportProgress` (exportando y hecho), `ExportTrackRow` +
  `TrackWave` (la onda que se revela), `CheckTree` (árbol con casillas), `UsbExportPill` y
  `UsbTopProgress` (suscritos al almacén).
- Botón en `SourceTree`, comando `export-usb`, aviso al conectar en App.

## Datos

```ts
interface UsbVolume {
  uuid: string                  // VolumeUUID (macOS) o GUID del volumen (Windows)
  name: string
  mountPoint: string            // /Volumes/Vicent o E:\
  filesystem: 'fat32' | 'exfat' | 'hfs' | 'apfs' | 'ntfs' | 'other'
  partitionScheme: 'mbr' | 'gpt' | 'other'
  totalBytes: number
  freeBytes: number
  holder: { by: 'rekordbox' | 'surco' | 'other' | 'empty'; at: number | null }
  remembered: { playlistIds: string[]; prune: boolean; settings: boolean; at: number } | null
}

type UsbTarget = { kind: 'volume'; uuid: string } | { kind: 'folder'; path: string }

interface UsbExportRequest { playlistIds: string[]; target: UsbTarget; prune: boolean; settings: boolean }

interface UsbPlan {
  tracks: UsbPlanTrack[]          // en el orden en que se escribirán
  trackCount: number              // sin separadores, como el árbol
  newCount: number; newBytes: number; keptCount: number
  removedSinceLast: number | null // null si el USB no lo escribió Surco la última vez
  warnings: UsbWarning[]          // incluye la lista de pistas que no se pueden exportar y por qué
}
```

## Errores

| Qué pasa | Qué ve el usuario | Qué queda en el USB |
|---|---|---|
| El USB se desconecta a mitad | "El USB se desconectó. Lo que había sigue igual; conéctalo y exporta otra vez." | la biblioteca anterior; algún audio nuevo suelto, que la siguiente vez se aprovecha o se rehace |
| Otro volumen en ese punto de montaje o esa letra antes de empezar | "Ese USB ya no está montado ahí." Nada se lanza | nada cambia |
| El destino de un volumen no es su raíz | "Los reproductores solo leen la raíz de un USB." Nada se lanza | nada |
| "Otro destino" fuera de un volumen extraíble | "Elige una carpeta de un USB o una tarjeta." | nada |
| No cabe | Exportar deshabilitado, "No cabe. Hace falta X y hay Y libres." Si cambia entre el resumen y Exportar, la pasada en seco lo para | nada |
| USB de solo lectura o lleno a mitad | "No se pudo escribir en el USB" | la biblioteca anterior |
| Una pista falla (fichero perdido, NAS dormido) | la fila en rojo con el motivo traducido; el resto sigue | sin esa pista en la base de datos; no se poda nada |
| baken no está o no arranca | "Falta una pieza de Surco para exportar. Reinstala Surco." | nada |
| La colección no se lee | el modal dice por qué, como el árbol | nada |
| Cancelar | "Cancelando…" y luego "Cancelado. El USB tiene su biblioteca anterior." | la biblioteca anterior, sin audio a medias |
| Doble clic en Exportar | una sola exportación | lo de una exportación |

Los errores viajan del main como códigos (`reason`), no como texto, y se traducen en el renderer.

## Pruebas

- **Unidad**: `anlz` (secciones, PQTZ, PWAV, máscara PVDI con los bytes medidos, PVDI vacío,
  longitud de PMAI), `bakenXml` (letras de hot cue con Kind 4 ausente, rejilla, carpetas,
  tamaño real, escapes, rating, `Location` de macOS y de Windows), `usbExportSource` sobre una
  fixture cifrada ampliada, `usbVolumes` (filtro de extraíbles sobre salidas reales de
  `diskutil` guardadas y sobre salidas del script de PowerShell, quién lo escribió, sin tocar
  ningún volumen real), `bakenRun` (argumentos: nunca sin `--anlz-dir`, nunca una ruta de la
  carpeta de Pioneer ni la raíz del sistema ni la carpeta del usuario como destino, en macOS y
  en Windows; nunca `--prune` con "Otro destino"; cancelar por la entrada estándar con un
  baken falso), `usbExport` (UUID que no coincide no lanza nada; dos exportaciones a la vez;
  carpeta fuera de un extraíble; no cabe; cancelar espera a la pista; cancelar en fase de base
  de datos no hace nada; `dev` que cambia), memoria.
- **Windows en CI**: un trabajo en `windows-latest` pasa las pruebas de la exportación y lanza
  el script de PowerShell de verdad para ver que corre y devuelve JSON.
- **Renderer**: modal (casillas de carpeta a medias y abiertas, preselección, memoria, avisos,
  Exportar deshabilitado al arrancar y si no cabe), progreso (estados en cola, copiando,
  hecha, ya estaba, error, cancelando; movimiento reducido sin transición), almacén, píldora y
  aviso al conectar. Selectores `data-testid`.
- **Parches de baken**: `cargo test` de baken con los tests nuevos de cada parche, también en
  CI al compilarlo (incluido cancelar entre pistas sin dejar audio a medias).
- **Verificación en el USB de pruebas** (UUID `B10C96EF-51C2-344E-B78D-DAFC319D973E`, el único
  volumen extraíble conectado) desde la app empaquetada en macOS: exportar BASES/Makina,
  repetir sin cambios, añadir y quitar una playlist, cancelar a mitad, desenchufar a mitad.
  Validar con rbsync, rekordcrate y pyrekordbox como en el spike, y comparar PVDI, colores y
  carátulas con `rekordbox-baseline`.
- **Checklist para alguien con Windows** (aquí no hay ninguno): instalar el build de prueba,
  que la lista de USB salga y cambie al conectar y desconectar, exportar una playlist a un USB
  FAT32, cancelar, desenchufar a mitad, y llevar el USB a un reproductor o abrirlo en un Mac
  para validarlo.
- **Checklist de Vicent en hardware**, en CDJ-3000X y XDJ-AZ primero (OneLibrary), luego
  CDJ-3000 y CDJ-2000 (este con un USB FAT32 y MBR).
  1. El USB aparece y se navega sin cuelgues ni mensajes.
  2. Carpetas y playlists en su orden, pistas en su orden, separadores donde tocan.
  3. Onda en color y vista de 3 bandas (3000, 3000X, XDJ-AZ).
  4. Rejilla en los golpes (Hands Of Fate, cambio de tempo a los 50 s).
  5. Hot cues en su letra y **con el mismo color que en el USB de rekordbox**.
  6. Memory cues en la onda (Poem Without Words, 9).
  7. Clave y BPM como rekordbox.
  8. **Carátula en las 7 pistas** de Makina.
  9. **Zonas de voz** en la onda (3000X y XDJ-AZ) iguales que con el USB de rekordbox.
  10. Búsqueda por título y artista ("K-Style").
  11. Suena de principio a fin y el salto a hot cue cae en su sitio.
  12. Segunda exportación con una playlist más: tarda segundos y el reproductor ve las dos.
  13. Si algo falla, modelo, firmware y foto de la pantalla.

## Fuera de alcance

Linux; Windows arm64; el port de baken a TS; formatear el USB; `--cdjsafe` (convertir a MP3
al exportar); proteger un USB de rekordbox (descartado por Vicent); My Tag y `exportExt.pdb`;
historial del reproductor de vuelta a rekordbox; colores de hot cue asignados a mano en
rekordbox (se exportan con el color por defecto de su letra; la tarea 1 cuenta cuántos hay);
exportar desde Engine DJ, Traktor o la lista de trabajo; varias exportaciones a la vez; abrir
PRs en baken (lo decide Vicent).
