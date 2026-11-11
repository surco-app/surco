# Medidas de VirtualDJ

VirtualDJ 8.5.9307 (build 850.9729), macOS, 11/11. Carpeta `~/Library/Application Support/VirtualDJ`.
Copia de cada estado en `.claude/worktrees/dj-interfaz/.superpowers/vdj-medidas/` (fuera del repo).
Fixtures con rutas reescritas a `/Music/...` en `apps/desktop/src/main/virtualdjFixtures/`.

## Escribir por fuera

- **Finales de línea.** `database.xml` y cada `.vdjfolder` usan CRLF. Los ficheros `order` usan solo LF.
  Una primera prueba que reescribió `database.xml` con LF hizo que VirtualDJ, al abrirse, guardara el
  fichero como `Backup/<fecha> broken database.xml`, avisara de que "The database on drive Root: is
  corrupted" y empezara una base de datos nueva que perdía cues. El escritor tiene que conservar los bytes
  que no cambia, incluidos los CRLF, y escribir CRLF en lo nuevo.
- **Con los CRLF conservados, VirtualDJ respeta lo escrito con él cerrado.** Un `Poi` añadido a mano
  (`Name="Surco medida" Pos="60.0" Num="9" Type="cue"`) y una lista nueva (`MyLists/Surco escrita.vdjfolder`
  más su línea en `order`) aparecen al abrirlo y siguen en disco después de cerrarlo.
- Al abrirse puede reescribir la cabecera rellenando la línea `<VirtualDJ_Database>` con espacios (visto
  tras la base de datos rota). No afecta a la lectura.

## Cues, loops y color

- Hot cue: `<Poi Type="cue" Num="n" Pos="segundos" [Name] [Color]>`. `Num` empieza en 1 y pasa de 8
  (se vio `Num="9"`).
- Loop guardado: `<Poi Name="loop" Pos="278.306667" Num="-1" Color="4278190335" Type="loop" Size="4.0"
  Slot="1" />`. `Pos` es el inicio en segundos, `Size` la longitud en pulsos, `Slot` el hueco del loop y
  `Num="-1"`.
- Color: `0xFF000000 | rgb`. El azul que eligió el usuario es `4278190335` (`0xFF0000FF`). Los cues que
  VirtualDJ lee de las etiquetas de Serato llevan el RGB de Serato con alfa `FF` (Serato `0xCC0000` sale
  como `4291559424`).
- Cues sin nombre ni color: ni `Name` ni `Color`.
- `Poi` que Surco no edita: `Type="automix"` (con `Point`) y `Type="remix"` (con `Name`).

## Reloj

**VirtualDJ usa el mismo reloj que Surco en todos los formatos.** Lo que VirtualDJ calcula él mismo sobre
el audio coincide entre los cinco ficheros de Pray (MP3, FLAC, WAV, AIFF y M4A AAC): `Scan Phase` dentro
de 0,11 ms y los `Poi` `automix` `realStart` (0,248163 s) y `cutStart` idénticos. Y su rejilla cae sobre
la de Surco (`measureBeatGrid`, 133,9974 BPM, primer golpe a 240,210 ms) a +4,7 ms en los cinco, sin
corregir nada. Una posición de VirtualDJ en segundos es la misma posición en el reloj de Surco.

Los cues que VirtualDJ importa de las etiquetas de Serato la primera vez que ve un fichero no siguen esa
regla: en el MP3 los coloca 26,12 ms (1152 muestras) antes que el ms que dice Serato, y en FLAC, WAV, AIFF
y M4A en el mismo ms. Es su forma de convertir los cues de Serato al importarlos, no su reloj. Surco no
depende de esa importación: lee y escribe `Pos` directamente.

| Fichero | Cue de Serato (ms) | `Pos` importado por VirtualDJ (s) | Diferencia | `seratoLeadOfFile` (ms) |
|---|---|---|---|---|
| Pray.mp3 (LAME, 44,1 kHz) | 30000 | 29.973878 | -26,12 ms | 51,18 |
| Pray.flac | 30000 | 30.0 | 0 | 0 |
| Pray.wav | 3834 / 9192 / 16367 | 3.8340 / 9.1920 / 16.3670 | 0 | 0 |
| Pray.aiff | 30000 | 30.0 | 0 | 0 |
| Pray.m4a (AAC) | 7444 / 12756 / 19019 | 7.4440 / 12.7560 / 19.0190 | 0 | -23,22 |

Sin medir con un cue puesto a mano en VirtualDJ en el mismo golpe de dos formatos; las dos pruebas de
arriba (análisis propio idéntico entre formatos y rejilla sobre la de Surco) lo hacen innecesario para la
lectura. Se vuelve a comprobar en el bloque de escritura, abriendo en VirtualDJ un cue que escriba Surco.

## Rejilla

`Scan Bpm` está en segundos por pulso (`0.447778`, 134 BPM). `Scan Phase` es `57.559456` en Pray, y
57.559456 − 128 × 0.447778 = 0,244 s, junto al `realStart` de 0,248 s. Confirmado en la Tarea 10:
`Phase` es la posición de una negra y la rejilla son `Phase + k × Bpm`, a +4,7 ms de la rejilla de Surco en
los cinco formatos.

## Listas

- `MyLists/<n>.vdjfolder` (CRLF) con `<VirtualFolder noDuplicates="no">` y `<song path size idx ...>`;
  VirtualDJ añade `songlength`, `bpm`, `key`, `artist` y `title` a algunas entradas al reescribirlas.
- Carpeta: `<n>.vdjfolder` con `<VirtualFolder />` más `<n>.subfolders/` con sus listas y su `order`.
- `order` (LF): un nombre por línea, en el orden del panel.

## Sin medir todavía

- Base de datos por disco externo: no se añadió ninguna pista de `/Volumes/Public` y no hay
  `/Volumes/Public/VirtualDJ`.
- Qué hace con una pista cuyo fichero ha desaparecido.
