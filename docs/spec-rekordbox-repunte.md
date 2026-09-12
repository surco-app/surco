# Reapuntar pistas en rekordbox al sustituir el fichero

Estado: propuesta, sin implementar. Requiere aprobación antes de tocar código.

## El problema

Vicent tiene un MP3 en Apple Music y en rekordbox. Lo convierte a WAV. Apple Music no
deja cambiar el fichero de una pista, así que borra el MP3 y sube el WAV a mano.

rekordbox sigue apuntando al MP3 que ya no existe y marca la pista con `!`. La pista NO
se cae de sus playlists, pero hay que reapuntarla a mano una por una.

Hoy Surco resuelve esto para Traktor (`traktorNml.ts:324` reescribe el atributo `FILE`)
y para Engine DJ. Para rekordbox solo hay exportación de XML, que crea pistas nuevas en
vez de reapuntar las existentes, así que no sirve.

## El dato que lo hace viable

En rekordbox las playlists enlazan la pista por identificador, no por ruta:
`DjmdSongPlaylist` guarda `PlaylistID` + `ContentID`. Cambiar la ruta de una pista no la
saca de ninguna playlist, ni le quita cues ni historial.

Esto lo confirman dos proyectos que ya escriben en la base de datos cifrada:

- [pyrekordbox](https://github.com/dylanljones/pyrekordbox) documenta el esquema y
  extrae la clave SQLCipher de la propia máquina. Probado en 5.8.6, 6.7.7 y 7.0.9.
- [rbMigrate](https://github.com/FruityLemonade/rbMigrate) reescribe `FolderPath` en
  producción, en v5.8, v6.x y v7.x. Es la prueba de campo.

Ambos son Python, no reutilizables desde Electron. Su valor es la documentación del
esquema.

## Decisiones tomadas (Vicent, 12/09)

1. **Reapuntar en sitio**, no solo reportar. La entrada conserva su identificador.
2. **Actuar solo si la pista está en la colección.** Si no está, no hacer nada.
3. **Reapuntar también cuando la conversión va a otra carpeta.** En rekordbox la ruta es
   un campo completo, así que mover de carpeta cuesta lo mismo que cambiar de extensión.
   Esto levanta, solo para rekordbox, la restricción de `ffmpeg.ts:1385` (`sameDir`), que
   existe por cómo Traktor parte la ruta en VOLUME/DIR/FILE.
4. **Biblioteca local, sin rekordbox cloud.** Ver "Riesgo asumido" abajo.

## Qué hay que escribir en la base de datos

Cuatro campos de `djmdContent`, verificados contra la colección real de Vicent (paso 0
ejecutado el 12/09). Escribir solo la ruta deja la entrada incoherente, y es el error que
cometerían los dos proyectos de referencia porque ellos solo mueven ficheros, no cambian
de formato:

| Campo | Qué es | Por qué cambia |
|---|---|---|
| `FolderPath` | Ruta completa del fichero | Cambia la extensión, y puede cambiar la carpeta |
| `FileNameL` | Nombre del fichero | Cambia la extensión |
| `FileType` | Código numérico de formato | Ver tabla abajo |
| `FileSize` | Tamaño en bytes | Un WAV pesa mucho más que el MP3 que sustituye |

Códigos de formato medidos en su colección, no tomados de documentación de terceros:

| Formato | Código | Pistas suyas |
|---|---|---|
| wav | 11 | 1252 |
| aiff | 12 | 467 |
| mp3 | 1 | 211 |
| m4a | 4 | 31 |
| Spotify | 25 | 1 |

La documentación de terceros daba `mp3 = 0 o 1`. En su base de datos es 1.

**Las pistas de streaming hay que excluirlas explícitamente.** La de Spotify no tiene
ruta sino un identificador (`spotify:track:...`) y tamaño cero. No es un fichero y no se
puede reapuntar.

Tres campos más que existen y **no** hay que tocar, comprobados uno a uno:

- `OrgFolderPath` guarda la ruta histórica original. En su colección hay 846 entradas
  donde no coincide con la actual, rastro de cuando movió la música al disco de red, y
  rekordbox lleva funcionando así desde entonces. Es el registro de dónde vino la pista,
  no una ruta viva.
- `rb_LocalFolderPath` está vacío en las 1962 pistas.
- `FileNameS` está vacío en las 1962 pistas.

## Stack

`sql.js`, que el repo ya usa para Engine DJ, **no sirve**: no soporta SQLCipher.

La opción viable, ya probada contra su base de datos, es
`better-sqlite3-multiple-ciphers`, con binarios precompilados para Electron. Es una
dependencia nativa nueva, con lo que implica para el empaquetado en las tres plataformas.

Receta exacta que funciona, y el detalle que cuesta encontrar:

```js
db.pragma(`cipher='sqlcipher'`)
db.pragma(`legacy=4`)
db.pragma(`key='402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497'`)
```

**La clave va como texto plano.** Pasarla como bytes hexadecimales (`x'402fd...'`) falla
con "file is not a database", que es un error indistinguible de una clave equivocada. Es
pública, la misma para todas las instalaciones, y no depende de máquina ni licencia.

## Convenciones que se heredan del módulo de Traktor

El molde existe y hay que seguirlo, no inventar otro:

- **Copia de seguridad antes de escribir, o no se escribe.** Sufijo `.surco-backup`, una
  sola, sobrescrita en cada escritura (`traktorNmlLibrary.ts:25`).
- **Guarda de programa abierto, comprobada dos veces**, antes de leer y justo antes de
  escribir (`traktorNmlLibrary.ts:39` y `:68`). rbMigrate también exige rekordbox cerrado.
- **La guarda falla CERRADA.** Si no se puede averiguar si rekordbox corre, se asume que
  sí. Esto ya nos mordió dos veces con Traktor, con la guarda fallando abierta.
- **Límite de palabra en el nombre del proceso.** El caso real fue
  `TraktorCueGridInspector` recibiendo un quit destinado a Traktor.
- **Mejor esfuerzo, nunca lanza.** La conversión de audio ya terminó en disco cuando esto
  corre. Cada fallo devuelve un motivo, no una excepción.
- **Validar que el fichero destino existe antes de escribir la ruta.** Lo hace rbMigrate.

## Riesgo asumido

`usn`, `rb_local_usn` y `rb_local_synced` son contadores de sincronización con la nube.
Ni pyrekordbox ni rbMigrate los mantienen.

Vicent confirmó que su biblioteca es local, así que quedan fuera del alcance. **Si en
algún momento se activa rekordbox cloud, esto hay que rediseñarlo.** Conviene que el
código lo diga en un comentario donde se escriba.

Aviso adicional: pyrekordbox tiene el issue #81 abierto, donde su función de renombrar se
come un directorio de la ruta. Sus métodos de alto nivel no son de fiar a ciegas; el
esquema sí.

## Plan por pasos

Cada paso es verificable por separado y el orden importa: el paso 0 puede matar la
propuesta entera, así que va primero.

**Paso 0. Probar que se puede abrir la base de datos. HECHO 12/09.**
Script desechable en el scratchpad, contra una COPIA en solo lectura. Abrió su rekordbox
7: 1962 pistas, 82 playlists, 6839 enlaces. La dependencia nativa funciona y la receta de
pragmas está arriba. La propuesta es viable.

**Paso 1. Verificar los códigos de formato. HECHO 12/09.**
Tabla medida contra su colección, arriba. Apareció un caso que la documentación no
recoge: una pista de Spotify sin fichero, que hay que excluir.

**Paso 2. Lectura, con tests. HECHO 12/09 (f6bb2e08).**
Localiza una pista por ruta en la colección cifrada. 8 tests, 4 mutaciones verificadas.

**Paso 2b. Enlaces simbólicos y duplicados. HECHO 12/09 (06a12d65). NO PREVISTO.**
Su `~/Music/Music` es un enlace a `/Volumes/Public/Music`, así que la misma música está
guardada bajo dos prefijos: 1513 pistas por el enlace, 413 por el destino. Comparar
cadenas no vale, hay que resolver.

Y lo que destapó: **35 ficheros suyos tienen DOS entradas, y 67 de esas entradas están
en playlists**, con tamaños distintos. Reapuntar una dejaría a la gemela señalando el
fichero sustituido, arreglando media colección y rompiendo la otra media. La búsqueda
devuelve un veredicto de ambigüedad y no elige nunca.

Trampa dentro de la trampa: 11 de sus pistas ya no existen en disco, la resolución falla
y la reserva a comparar cadenas volvía a esconder la ambigüedad justo donde la colección
ya está rota. Resuelto normalizando el prefijo del enlace, sin tocar disco.

**Paso 3. La guarda de rekordbox abierto. HECHO 12/09 (cefdd3db).**
9 tests en macOS y Windows, 2 mutaciones verificadas. Falla CERRADA: si no se puede
averiguar si corre, se asume que sí.
El bundle trae `rekordboxAgent` y `Upmgr rekordbox`, que empiezan igual que el proceso
principal, así que la coincidencia es por nombre completo. Es el mismo fallo que hizo que
un quit destinado a Traktor cayera sobre una herramienta ajena.

**Paso 4. Escritura, con copia de seguridad. HECHO 12/09 (d3a2c3df).**
12 tests, mutaciones verificadas. Escribe los 4 campos, respeta `OrgFolderPath`, hace
copia antes de tocar nada, comprueba la guarda dos veces y restaura desde la copia si la
escritura falla a medias.

Un test era falso y lo delató la mutación: el punto de fallo simulado estaba ANTES del
UPDATE, así que el fichero no cambiaba y quitar la restauración no rompía nada. Movido
después del UPDATE, la mutación muere.

**Validado contra una COPIA de su colección real**: la pista cambió de ruta, formato y
tamaño, y conservó sus 5 playlists y sus 15 cues. Las 1962 pistas y los 6839 enlaces de
playlist siguen ahí.

## Lo que queda

**Paso 5. Cableado a la conversión. HECHO 12/09 (ab77d74e, 349f97ea).**
Cuatro módulos: detección de la colección, acumulador del lote, orquestación del volcado
y la regla de cuándo reapuntar. 23 tests más.

Decisiones tomadas: la colección se detecta sola, con un ajuste que solo hace falta si la
guardas en otro sitio, y la escritura ocurre al acabar el lote entero, no pista a pista.

Verificado en la aplicación real: un MP3 con 5 playlists y 15 cues, convertido a AIFF
desde el botón de procesar, dejó la entrada apuntando al nuevo fichero con su formato y
tamaño corregidos, las 5 playlists y los 15 cues intactos y una copia de seguridad al
lado. Sobre una copia; la colección real no se abrió.

**Paso 6. Ajuste de la restricción de carpeta. HECHO 12/09.**
rekordbox reapunta también cuando la conversión va a otra carpeta, porque su ruta es una
columna entera. La regla de misma carpeta sigue aplicándose solo a Traktor.

## Lo único que falta: la UI

El volcado devuelve cuántas pistas se reapuntaron, cuáles se saltaron y si el lote entero
se bloqueó. Hoy eso **solo se escribe en el log**.

Falta decidir qué ve el usuario en tres situaciones:

- **Rekordbox abierto.** El lote no escribe nada. Traktor, en el mismo caso, ofrece
  cerrarlo y avisa si el usuario se niega.
- **Una pista ambigua.** Hay dos entradas para el mismo fichero y hace falta que el
  usuario elija cuál conservar.
- **Todo bien.** Decidir si merece una línea en el panel de actividad o pasa en silencio.

También queda decidir si la función sale apagada por defecto, como la sincronización con
Traktor, y dónde vive el ajuste de la ruta en la pantalla de ajustes.

## Verificación, no negociable

**Nunca contra la colección real de Vicent.** Siempre sobre una copia, con rekordbox
cerrado, y abriéndola después para comprobar a ojo que las playlists y los cues siguen.

Esta es la misma cautela que la función de sincronización con Traktor sigue mereciendo:
está publicada desde la v0.76.0, apagada por defecto, y nunca se ha validado sobre una
copia de la colección de djotas.

## Lo que esto NO resuelve

Apple Music sigue igual. No hay forma de escribir la ubicación de una pista en Music.app,
solo leerla. Sustituir el fichero ahí seguirá siendo borrar y volver a añadir a mano.
Esta propuesta arregla el dolor de rekordbox, que es donde Vicent dijo que está.
