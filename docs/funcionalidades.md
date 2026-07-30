# Funcionalidades de Surco

Inventario levantado leyendo el código y los tests el 2026-07-30. Cada afirmación
tiene su evidencia en `fichero:línea`. Lo que aquí no está, no se puede prometer
en la web.

Documento de referencia: sirve para redactar la home, llenar `/funciones` y
saber qué NO decir.

---

## 1. Formatos

**Entrada (11):** `.wav .flac .aif .aiff .mp3 .m4a .mp4 .aac .ogg .oga .opus`
(`main/expand.ts:7-19`)

**Salida (5):** AIFF, WAV, FLAC, ALAC (.m4a), MP3 — de cualquiera a cualquiera,
más el modo «igual que el origen», que resuelve el formato por fichero y no por
lote (`shared/outputFormats.ts:6-12`, `shared/format.ts:66-79`).

AAC, ALAC, Ogg Vorbis y Opus **siempre se transcodifican**: no tienen formato de
salida equivalente (`ffmpeg.test.ts:678-713`).

### Copia sin recodificar

Si el fichero ya está en el formato de destino y no hay filtros activos, el audio
no se toca: se copian los bytes y solo se reescriben las etiquetas
(`ffmpeg.ts:769-860`). En APFS es un clon copy-on-write, instantáneo a cualquier
tamaño (`ffmpeg.ts:1164-1168`).

Consecuencia deliberada: **los ajustes de calidad no se aplican en ese caso**.
Recodificar un fichero que ya está en el formato solo puede degradarlo
(`ffmpeg.ts:755-762`, test `ffmpeg.test.ts:484-500`).

Fuerzan recodificación: normalizar, declick, recorte, el botón de re-encode, y
cualquier salida ALAC.

### ALAC nunca sobrescribe el original

Un `.m4a` puede contener AAC con pérdida en vez de ALAC, y distinguirlos exige
sondear el códec. Llamarlo «ya es ALAC» reescribiría el original del usuario
presentando una codificación con pérdida como lossless. Por eso ALAC siempre
renderiza un fichero nuevo, incluso en modo sobrescribir
(`shared/format.ts:11-14`, `:32-40`; test `inplace.test.ts:102`).

---

## 2. Calidad de conversión

| Ajuste | Opciones | Por defecto |
|---|---|---|
| Bitrate MP3 | 320/256/192/160/128 CBR, V0, V2 | 320 |
| Profundidad | origen / 16 / 24 | origen |
| Frecuencia | origen / 44100 / 48000 | origen |
| Compresión FLAC | 0 / 5 / 8 | 5 |

Todo por defecto a máxima fidelidad (`ffmpeg.ts:654-661`).

**El ensanchamiento silencioso 16→24.** Sin fijar `-sample_fmt`, los encoders
FLAC/ALAC eligen su formato más ancho en cuanto el decode o un filtro les entrega
float: un rip 44.1/16 salía a 24 bits. Surco fija la profundidad resuelta
(`ffmpeg.ts:759-762`, test de bytes `convertDepth.test.ts:81-102`).

**Float genuino vs float de decodificación.** Un WAV f32 de grabadora conserva su
precisión; un MP3 decodificado también entrega float, pero eso es un artefacto
del decode, no precisión del origen, así que mapea a 24 bits enteros — el más
ancho que reproduce el equipo de DJ real (los CDJ rechazan WAV de 32 bits float)
(`ffmpeg.ts:582-595`).

**Dither TPDF** solo cuando el resultado baja a 16 bits desde una cadena más
ancha (`ffmpeg.ts:816-819`). Un 16→16 sin filtros pasa tal cual: el dither solo
añadiría ruido.

**Sin sellos del muxer:** `-fflags +bitexact` evita que cada muxer estampe su
anuncio (ENCODER en FLAC, TSSE en MP3, ISFT en RIFF) que el usuario lee como
basura que nunca escribió. La cabecera LAME de gapless sobrevive
(`ffmpeg.ts:719-723`).

---

## 3. Normalización de volumen

Tres modos: ninguno (por defecto), loudness (EBU R128) y pico.

**Loudness:** dos pasadas, ganancia lineal constante — la dinámica queda intacta,
no «bombea» (`normalize.ts:37-110`).

Tres problemas resueltos que no son evidentes:

1. `loudnorm` sobremuestrea a 192 kHz para limitar true-peak y emite su salida a
   ese rate. Sin corregirlo, cada fichero normalizado saldría a 192 kHz
   (`normalize.ts:82-84`).
2. `linear=true` se cae en silencio a modo dinámico si el LRA medido supera el
   objetivo, y además falla el objetivo integrado (verificado: una petición de
   −14 sobre material de 14 LU salía a −11) (`normalize.ts:90-96`).
3. Objetivos fuera de rango rompían toda la conversión — un usuario escribió el
   techo como +2.6 pensando en headroom. Ahora se acotan (`normalize.ts:8-13`).

**Limitador con oversampling 4×** cuando el objetivo es inalcanzable linealmente:
en vez de quedarse corto, aplica la ganancia completa y limita solo los picos.
`alimiter` limita picos de muestra, así que va rodeado de un oversampling a 4× —
el factor true-peak de la ITU-R BS.1770 — para cazar los picos inter-muestra
(`normalize.ts:118-142`).

**Modo pico avanzado** (estilo Audacity): quitar offset de DC y ganancia
independiente por canal. Esta última **cambia la imagen estéreo**, y por eso no
es el comportamiento por defecto (`normalize.ts:173-247`).

Si la medición falla, la conversión sigue sin normalizar y avisa, en vez de
fallar (`normalize.ts:57-59`).

---

## 4. Análisis de calidad

Tres detectores independientes que se combinan (`ffmpeg.ts:1878-1918`).

### 4.1 Transcodificación (fake lossless)

Mide bandas de 1 kHz de 9 a 22 kHz y busca una caída de la que el espectro
**nunca se recupera** (`cutoff.ts:29-58`).

| Umbral | Valor | Calibración |
|---|---|---|
| Caída de rodilla | 6 dB en un paso | Re-encodes reales caen 6.9–7.8 dB; el taper natural más pronunciado, menos de 5 |
| Recuperación | 2 dB | Un lowpass de códec nunca rebota; un notch resonante sí |

**Lo importante: sin rodilla, no hay veredicto de corte.** Si no hay caída
sostenida, Surco reporta hasta dónde llega la energía y marca `hasKnee: false` —
el veredicto es bueno aunque la extensión sea de 18 kHz. El comentario del código
lo explica: *«ni la pendiente del taper ni dónde cruza un nivel dicen "corte" —
fijarse en cualquiera de los dos es lo que marcaba 320 sanos como falsos»*
(`cutoff.ts:1-8`). Verificado con dos FLAC reales que un usuario reportó mal
calificados (`cutoff.test.ts:153-184`).

Una segunda pasada por FFT caza los muros que el filtro biquad difumina: un muro
de 16 kHz (un MP3 de 128–160 re-empaquetado como FLAC) se leía como un taper
suave de 5 dB y pasaba como bueno (`hfShelf.ts:105-112`). **Solo corre en
ficheros nativos a 44.1 kHz.**

### 4.2 Altos regenerados (enhancer)

Tres firmas distintas: joroba sintética, sierra de banda fina (SBR/HE-AAC) y
estante plano. Esta última es el umbral más ajustado de todo el sistema: 1.3 dB
de rango, con ~0.5 dB de margen a cada lado (`hfShelf.ts:31-36`).

Detalle técnico que obliga a usar FFT y no el biquad: *«ese biquad se deforma
cerca de Nyquist — fabrica ~11.6 dB de falso roll-off sobre ruido blanco plano —
lo que disfraza exactamente este estante plano como una caída»*
(`hfShelf.ts:11-15`).

### 4.3 Hi-res falso (upsample)

Compara dos bandas a 21.5 y 23.5 kHz: un máster genuino cae ~8 dB, un upsample
colapsa 15–20 (`cutoff.ts:87-99`).

**Limitación:** solo detecta el muro de 22.05 kHz. Un 48→96 kHz upsampleado **no
se detecta**.

### 4.4 Veredicto

Bandas absolutas, no relativas a Nyquist: ~20.5 kHz es lossless, ~18.5–19 la
clase 192 kbps, ~16 el clásico 128 re-empaquetado. Calificar contra Nyquist
penalizaba a los ficheros de 48 kHz por el mismo audio (`lib/quality.ts:1-8`).

El badge «fake lossless» exige cuatro condiciones a la vez, y `.m4a` está
excluido a propósito porque puede llevar ALAC o AAC (`lib/quality.ts:35-57`).

### 4.5 Métricas de loudness

Loudness integrada, true peak, LRA, dinámica, balance L/R, offset de DC y suelo
de ruido, medidas en una sola pasada sobre el fichero completo
(`ffmpeg.ts:1659-1690`). Los umbrales de color están afinados para biblioteca de
DJ, no para masterización (`lib/quality.ts:81-84`).

### 4.6 Clipping

Usa la constante de Audacity (32767/32768) para que las marcas rojas coincidan
con las suyas (`waveform.ts:50-53`). Se mide a **rate y canales nativos**: el
decode de 4 kHz mono no puede verlo, y por eso los másters cerca del techo
pintaban de rojo entero mientras Audacity mostraba marcas dispersas
(`waveform.ts:55-62`).

### 4.7 Lo que NO detecta

- **Estéreo falso.** No existe detector de correlación. Lo que hay es balance
  L/R, que mide desequilibrio de nivel: dos canales idénticos medirían 0 dB =
  bueno.
- Un fake cuya única deficiencia esté por debajo de 8 kHz.
- Los umbrales están calibrados sobre decenas de ficheros reales, no miles.

---

## 5. Reparación de clics

Cuatro niveles: off, suave, estándar, fuerte (`shared/declick.ts:23-46`).

Los parámetros no son un deslizador abierto: dos zonas están vetadas porque
**colgaban la conversión**, con dos reportes reales de «conversión colgada»
(`declick.ts:37-42`).

**Contador propio, no el de ffmpeg.** El detector de `adeclick` marca el 6–10% de
cualquier mezcla densa; Surco usa su propia detección por segunda diferencia, con
un candidato válido solo si su vecindario está en calma — un clic mide 1–9
muestras, un transitorio musical eleva todo el entorno (`clickDetect.ts:2-13`).

Calibración honesta, citada del código: los clics sintéticos de 2 y 9 muestras se
cuentan exactos, dos tracks comerciales limpios cuentan cero, y **los clics
enterrados bajo pasajes densos se pierden parcialmente** (≈enmascarados también
al oído) — por eso la UI lo llama *estimación de clics audibles*.

Escaneo limitado a 8 minutos; más allá el renderer sabe dónde paró el análisis,
porque *«las marcas dibujadas sobre la onda no deben insinuar una cola limpia que
nunca miraron»* (`ffmpeg.ts:1794-1798`).

**La comparación A/B** reemplazó deliberadamente al viejo «escucha lo que se
quita». Ese modo respondía a la pregunta de un ingeniero, no del usuario:
demuestra que el filtro hizo algo, mientras que su fallo real —una reparación que
se come el ataque de una caja— suena como un clic más entre lo eliminado y pasa
desapercibido (`declick.ts:9-14`).

---

## 6. Recorte de silencios

La detección **solo sugiere**; el usuario confirma los segundos exactos y la
conversión corta de forma determinista, nunca re-detectando en tiempo de
conversión (`shared/trim.ts:33-36`).

Umbral de sugerencia a −60 dB, no −90: la entrada de un vinilo es ruido de
superficie, no ceros (`renderer/lib/trim.ts:3-5`).

Micro-fade de 20 ms en cada borde cortado: un corte a través de ruido de
superficie no es silencio digital, y un escalón ahí hace clic
(`shared/trim.ts:36-39`).

---

## 7. BPM y tonalidad

Ambos son **sugerencias que el usuario confirma**, nunca se escriben solos.

**BPM** (`tempo.ts`): rango 80–180, los tempos fuera se pliegan a su octava.
Confianza mínima 0.25; por debajo devuelve nada, porque *«devolver null es mejor
que sugerir un número aleatorio con pinta de seguro»*.

Dos problemas duros resueltos, ambos con el mismo síntoma: un track de trance a
138 BPM se leía como 92. Uno por el pico partido entre dos lags; otro por el
patrón fuerte-débil (bombo más bajo a contratiempo) que correlaciona a 1.5× el
periodo (`tempo.ts:86-89`, `:127-131`).

**Tonalidad** (`musicalKey.ts`): cromagrama contra perfiles Krumhansl-Kessler,
notación Mixed In Key y rueda Camelot. Honestidad del propio código: *«la
precisión es inherentemente menor que la de un analizador dedicado (sin
compensación de afinación, los sintetizadores y las voces pueden despistarlo),
que es exactamente por qué el resultado solo se ofrece como sugerencia»*
(`musicalKey.ts:6-9`).

---

## 8. Metadatos

25 campos, con una única definición por campo que declara de dónde se lee y con
qué nombre se escribe en cada contenedor (`tagFields.ts:8-113`). Un test impide
que un campo nuevo quede ilegible o inescribible.

### 8.1 ID3v2.3, nunca v2.4

Todo contenedor ID3 se escribe en v2.3 para seguir siendo legible en los equipos
CDJ/rekordbox/Serato que manejan mal v2.4 (`tags.ts:31-34`, `:462-463`).

Consecuencias de esa decisión:
- El año original va en `TORY` (predecesor v2.3 de TDOR).
- El mood se escribe en TXXX `MOOD`, porque `TMOO` es exclusivo de v2.4 y
  TagLib lo tiraría en silencio al guardar.

### 8.2 WAV con carátula y metadatos

**Este es el caso técnicamente más singular.**

Un WAV es un contenedor RIFF de un solo stream: ffmpeg se niega a muxear una
imagen adjunta («WAVE files have exactly one stream»). Y su demuxer lee los tags
del chunk RIFF INFO, que **no tiene campo para grouping**. La ruta ffmpeg pura
produce un WAV sin carátula y sin grouping.

Surco escribe un tag ID3v2 completo dentro de un chunk RIFF `id3 `, que sí puede
llevar carátula y todos los campos (`ffmpeg.ts:1188-1203`).

Dos detalles que hacen que funcione de verdad:

1. **Hay que borrar el chunk INFO.** Un WAV puede llevar los dos, pero ffmpeg lee
   INFO e ignora los frames de texto ID3 — dejando ambos, gana el peor de los
   dos (`tags.ts:544-550`).
2. **Tiene que ser v2.3.** mp3tag solo lee un chunk `id3 ` cuando contiene v2.3;
   el v2.4 que se dejaba antes hacía que los WAV etiquetados por Surco
   *parecieran vacíos*, y los usuarios creían que la conversión había fallado
   (`tags.ts:33-34`, test `tags.test.ts:300-302`).

Verificado extremo a extremo: se convierte un FLAC a WAV con carátula y se
comprueba que la carátula y el campo grouping se recuperan al releer
(`wavEmbed.test.ts:69-79`).

### 8.3 Rating

Se escribe en **dos** frames POPM distintos para que dé la vuelta en dos mundos:
Traktor (pasos lineales de 51) y Windows Media Player/foobar (rampa no lineal)
(`tags.ts:377-385`).

Asimetría deliberada al borrar: en MP3/AIFF/WAV un rating vacío **se conserva**,
porque ffprobe no expone POPM y la app no puede saber si el fichero tenía uno. En
FLAC sí se borra, porque ahí sí da la vuelta (`tagFields.ts:75-77`).

### 8.4 Otros casos peculiares

- **Grouping de iTunes:** Apple Music guarda el grouping en su propio frame
  `GRP1`. Ni ffprobe ni ffmpeg lo exponen y TagLib lo devuelve como frame
  desconocido, así que Surco lo lee byte a byte (`tags.ts:65-98`).
- **Posición de vinilo:** un `"A2"` se escribe literal reescribiendo el frame
  TRCK. En M4A no sobrevive: el átomo `trkn` solo admite enteros
  (`tags.ts:507-516`).
- **Carátulas en el Finder para FLAC** (opcional, solo macOS): Finder y QuickLook
  nunca leen el bloque PICTURE de FLAC. Anteponer un tag ID3 con la carátula es
  la única forma de conseguir miniatura sin romper la reproducción. Es
  técnicamente off-spec, y por eso es opt-in (`flacFinderCover.ts:6-13`).
- **APIC y GEOB son el mismo tipo para TagLib**, así que reemplazar la carátula
  con el setter genérico borraría los cues de Traktor. Se quita solo APIC
  (`tags.ts:519-524`).

### 8.5 Matriz de pérdidas

| Campo | MP3 | AIFF | WAV | FLAC | M4A/ALAC |
|---|---|---|---|---|---|
| 20 campos base | Sí | Sí | Sí (chunk `id3 `) | Sí | Sí |
| Carátula | Sí | Sí | Sí (vía `id3 `) | Sí | Sí |
| Rating | Sí | Sí | Sí | Sí | **No** |
| Nº de catálogo | Sí | Sí | Sí | Sí | **No** |
| Año original | Sí | Sí | Sí | Sí | **No** |
| Posición vinilo «A2» | Sí | Sí | Sí | Sí | **No** (solo dígitos) |
| Cues de Traktor | Sí | Sí | **No** | Sí | **No** |

---

## 9. Proveedores externos

| | Discogs | Bandcamp | Deezer |
|---|---|---|---|
| Sello y nº de catálogo | Sí | No | No |
| Formato del lanzamiento | Sí | No | No |
| Duraciones de pista | Sí | Sí | Sí |
| Créditos de composición | Sí | No | No |
| Búsqueda por ISRC | No | No | **Sí** |
| Requiere token | Opcional | No | No |

**Discogs** funciona sin configurar nada con una clave compartida (60 req/min
entre todos los usuarios); un token propio da su propio cupo. Las credenciales
compartidas van en el binario y son extraíbles: el código las trata como públicas
(`discogs.ts:12-14`).

**Bandcamp no tiene API pública.** Se usa el mismo endpoint de autocompletado que
su buscador y se parsea el JSON incrustado en la página. Ambos son no oficiales y
pueden cambiar sin aviso; el parseo es defensivo (`bandcamp.ts:8-11`).

**Deezer** señala errores dentro de respuestas 200, y distingue cuota agotada de
un ISRC que simplemente no tiene (`deezer.ts:10-13`).

### La escalera de búsqueda

Los nombres de ficheros descargados traen ruido que hunde la búsqueda. Surco
construye una lista ordenada de consultas y se queda con la primera que devuelve
algo: campos estructurados, luego búsqueda dentro de tracklists, luego recorte de
palabras finales, luego texto libre (`discogs.ts:216-276`).

Diez limpiadores distintos, cada uno con su razón (`shared/searchClean.ts`). El
detalle del cuidado: el patrón de código de catálogo es deliberadamente estrecho
para no comerse nombres de artista numéricos — U2, M83, 808 State, Blink-182,
Apollo 440 y Sum 41 quedan todos fuera.

### Emparejado por duración

Dos escenarios con pesos distintos:

| Señal | Una pista | Álbum entero |
|---|---|---|
| Título | 0.45 | 0.25 |
| **Duración** | 0.40 | **0.65** |
| Posición | 0.10 | 0.05 |
| Artista | 0.05 | 0.05 |

Al emparejar un álbum entero el título suele ser el nombre del disco repetido en
cada fichero, así que no distingue los cortes; la duración medida sí
(`assign.ts:11-14`).

**Ventana proporcional:** ≤2 s es coincidencia perfecta, y la ventana de fallo
crece con la pista (4%, topado a 20 s) porque los rips de vinilo derivan
proporcionalmente. Caso real: un rip de 6:48 de un corte listado como 7:02 se
puntuaba a cero con ventana fija (`release.ts:117-124`).

**Guarda de corroboración:** una coincidencia solo se aplica sin supervisión si
hay evidencia independiente del título — duraciones en ambos lados, el artista
coincidiendo, o el número de catálogo. Sin eso baja a «revisar», porque un
release sin duraciones puntúa 1.0 solo por el título y los títulos de una palabra
existen en decenas de discos no relacionados (`release.ts:290-298`).

**Contradicción de título:** tres rips distintos colapsando sobre una misma
entrada de «Rocket Man» fue el bug que motivó esta guarda (`assign.ts:44-48`).

---

## 10. Destinos

### Apple Music (solo macOS)

Se escriben explícitamente las propiedades de la pista en vez de confiar en que
Music lea los tags, porque ignora varios (año, grouping) (`applemusic.ts:62-67`).

**Qué llega:** título, artista, artista del álbum, álbum, género, grouping,
comentario, año, nº de pista, nº de disco, BPM y carátula.

**Qué NO llega:** clave, sello, número de catálogo y remixer — solo existen en el
tag del fichero (`applemusic.ts:51-52`). Tampoco rating ni playlists.

**FLAC nunca se envía**, en ninguna plataforma: Music no puede ingerirlo.

**Bug de macOS 26 (Tahoe):** el `add` de Music puede ejecutarse sin error,
importar nada y no devolver nada. Surco lo detecta sondeando la biblioteca
acotado a entradas añadidas después de arrancar, para no adoptar una copia
antigua (`applemusic.ts:97-108`).

### Engine DJ / Denon

Escribe en la base SQLite real del usuario. El esquema es el de libdjinterop, que
las versiones nuevas de Engine migran solas al abrir (`engine.ts:6-13`). Las
faltas de ortografía del DDL (`currentPlayedIndiciator`, `Heirarchy`) están en el
esquema real de Engine y hay que conservarlas exactas.

**Qué llega:** ruta, título, artista, álbum, género, comentario, BPM, año,
**rating** (escala 0–100) y **carátula** como blob propio — Engine nunca lee el
arte de los tags (`engineLibrary.ts:220-221`). Más una fila en la playlist
configurable.

**Qué NO llega:** cue points, beatgrid y waveforms se dejan nulos con
`isAnalyzed = 0`, para que Engine analice el audio él mismo al primer load.

**Salvaguardas:** backup antes de cada escritura, escritura atómica, y **se niega
a escribir con Engine DJ abierto** — Engine carga la biblioteca al arrancar y no
la relee, así que una escritura sería invisible en el mejor caso y machacada en
el peor (`engineLibrary.ts:166-169`). Un lote de 300 pistas paga una
lectura/escritura, no 300.

### Cue points de Traktor

Ingeniería inversa del formato: un árbol binario en un frame ID3 PRIV con owner
`TRAKTOR4` en MP3/AIFF, el mismo árbol armado en basE91 dentro de un comentario
Vorbis en FLAC (`traktor4.ts:1-11`).

El checksum se dedujo contra ficheros reales: con el valor a cero, es la suma
llana de bytes del árbol saltando la raíz y los últimos cuatro bytes, *confirmado
en cinco ficheros de biblioteca independientes*. Sin un checksum válido, Traktor
ignora el blob entero.

**El marcador de rejilla es una fase, no una posición.** Traktor dibuja toda la
regla de beats extrapolando desde él, así que lo que debe sobrevivir a un recorte
es su desfase *dentro del beat*. Un recorte de silencio corta al primer
transitorio, casi nunca un número entero de beats, así que restar el corte en
crudo deja la regla entre beats — la deriva que los usuarios corrigen arrastrando
la rejilla a mano (`traktor4.ts:20-27`).

Sin BPM utilizable el blob se descarta entero: *«sin tempo no hay fase que
calcular; tirar el blob hace que Traktor reanalice, que es mejor que devolver una
regla silenciosamente desplazada»*.

**Matriz de conservación:**

| Origen → destino | ¿Cues? |
|---|---|
| MP3/AIFF → MP3/AIFF | **Sí** |
| MP3/AIFF → FLAC | **Sí** (re-armado a basE91) |
| FLAC → FLAC | **Sí** |
| Cualquiera → **WAV** | **No** |
| Cualquiera → **ALAC/M4A** | **No** |
| **FLAC → MP3/AIFF** | **No** |
| Con «limpiar metadatos» | **No**, a propósito |

### Sync del `.nml` de Traktor

Apagado por defecto. Cuando se configura la ruta de la colección, actualiza el
`.nml` real: repunta la ruta si cambió la extensión, limpia el `COVERARTID` para
que Traktor relea la carátula, y reemplaza los `CUE_V2`.

Se edita como texto y no con un parser XML, porque un round-trip genérico
normalizaría comillas y espaciado de todo el documento y convertiría un cambio de
tres atributos en un diff de la colección entera (`traktorNml.ts:1-4`).

Salvaguardas notables: un árbol de cues ilegible **no borra** los hotcues
existentes; una rejilla existente se rescata cuando no hay BPM; y un lote de 300
pistas produce **una** escritura, no 300 (`nmlBatch.ts:3-6`). Un backup único,
sobrescrito, porque copias fechadas dejaban basura en la carpeta del usuario.

### Exportación a rekordbox, Serato, Traktor y M3U8

Cuatro ficheros puente. **Ninguno lleva cue points, rating ni carátula.**

- **rekordbox** (`.xml`): metadatos y rutas. La URL debe ir percent-encoded o la
  importación descarta la pista en silencio.
- **Serato** (`.crate`): binario. **Solo rutas** — Serato lee los metadatos del
  fichero. Las rutas son relativas al volumen donde vive el crate, así que un
  crate en un USB pierde el prefijo del volumen.
- **Traktor** (`.nml`): fichero nuevo, distinto del sync anterior.
- **M3U8**: la lingua franca para todo lo que no es software de DJ.

### «Ya está en tu biblioteca»

Volcado completo de la biblioteca en una sola llamada, y emparejado local
puntuado: título 0.45, artista 0.40, duración 0.15, umbral 0.7. El plegado de
nombres cubre casos reales de rips («DJ F.R.A.N.K.» ↔ «DJ. Frank», «A Seven» ↔
«A7»).

El propio código lo califica: **es un indicio, no una garantía**
(`appleMusicLibrary.ts:288`).

---

## 11. La aplicación

### Recuperación de sesión

Se guardan las rutas cargadas y las ediciones no aplicadas, con debounce de 1 s y
escritura atómica.

Dos comportamientos según lo que esté en juego: una sesión de solo rutas caduca a
los 6 segundos porque no se pierde nada; **una sesión con ediciones sin aplicar
no caduca nunca**, porque esas ediciones no existen en ningún otro sitio
(`useSessionPersistence.ts:61-64`).

### Reproductor

Servidor propio con soporte real de rangos HTTP: el elemento `<audio>` busca
re-pidiendo un rango de bytes, y solo respeta el salto si el servidor responde 206
con `Content-Range` (`main/index.ts:1230-1270`).

Chromium no decodifica AIFF —el formato por defecto de Surco—, así que se
transcodifica a un WAV temporal. Y como eso se paga entero en el hueco tras el
clic, Surco precalienta la pista seleccionada tras 400 ms de reposo, para que
play caiga sobre una caché (`usePlayer.ts:142-167`).

**Comparación A/B sincronizada por fotograma.** El original y el reparado suenan a
la vez; el conmutador solo cambia cuál es audible. Los dos elementos arrancaban
con ~450 ms de desfase medido; corrigiendo solo en `timeupdate` quedaban 44 ms.
Se corrige cada fotograma con tolerancia de 20 ms, porque un A/B desincronizado
*«compara dos momentos distintos de la canción aunque siga sonando como una
comparación»* (`useDeclickAb.ts:60-67`).

### Rendimiento

- **Importación en red:** 560 carpetas en un SMB cuestan ~20 s de round trips
  aunque esté caliente, pero el primer fichero se conoce en ~1 s. Las filas se
  publican según se identifican (`expand.ts:47-79`).
- **Ventana negra al arrancar:** `ready-to-show` disparaba a los 232 ms mientras
  el primer frame llegaba a los ~4000. Con `paintWhenInitiallyHidden` la ventana
  aparece justo después del primer frame (`main/index.ts:424-436`).
- **Limitador de análisis** con tres prioridades: seleccionar una pista y darle a
  play ponía cinco pasadas de ffmpeg a la vez, y la onda que el DJ estaba
  esperando era la que más sufría (`analysisLimiter.ts:4-9`).
- **Caché de análisis** por ruta+mtime, con una garantía: cualquier fallo recae en
  cálculo en vivo, así que la caché solo puede acelerar, nunca cambiar un
  resultado (`analysisCache.ts:30-37`).

### Otros

- **37 comandos con atajo rebindable**, con detección de conflictos que bloquea
  el guardado (`shared/shortcutDefaults.ts:16`).
- **Cinco idiomas** en la app: español, inglés, alemán, francés y portugués de
  Brasil. Por defecto sigue el idioma del sistema.
- **Plataformas:** macOS (Apple Silicon e Intel, notarizado), Windows (NSIS) y
  Linux (AppImage — el único target que electron-updater puede actualizar en
  sitio).
- **Firma:** macOS va notarizado por Apple (`electron-builder.yml`, `notarize:
  true`). Windows no lleva firma de código, así que SmartScreen avisa la primera
  vez por tratarse de una app nueva.
- **Actualizaciones automáticas** con re-comprobación cada 2 horas y backoff de
  60 s → 5 min → 15 min. Nunca avisa por estar sin conexión: *«no tener wifi es
  vida normal, no una incidencia»*.
- **Sin telemetría por diseño**, sin cuenta y sin nube. El renderer va en sandbox
  con lista blanca de ficheros: sin ella, un renderer comprometido podría leer
  cualquier fichero del disco a través de un `<audio src>` (`mediaAccess.ts:1-8`).
- **Papelera, nunca borrado duro** (`shellIpc.ts:24`).
- **Deshacer** de hasta 20 pasos para ediciones de tags. No cubre operaciones de
  fichero ni conversiones.

---

## 12. Lo que NO se puede afirmar

Recopilado de los cinco informes. Cada punto está verificado.

1. **Cue points:** solo MP3, AIFF y FLAC. No en WAV ni ALAC, ni de FLAC hacia
   MP3/AIFF.
2. **Apple Music:** solo macOS, nunca FLAC. Clave, sello, catálogo y remixer no
   llegan a la biblioteca. No se transfiere rating ni se crean playlists.
3. **Engine DJ:** no lleva cue points ni beatgrid. Exige Engine cerrado.
4. **rekordbox/Serato/Traktor/M3U8:** ninguno lleva cues, rating ni carátula.
5. **No hay detección de estéreo falso.**
6. **El hi-res falso** solo se detecta en el muro de 22.05 kHz, no en 48→96.
7. **«Ya está en tu biblioteca»** es un indicio puntuado, no una garantía.
8. **BPM y tonalidad** son sugerencias; nunca se escriben sin confirmar.
9. **Los clics enterrados** bajo pasajes densos se pierden parcialmente.
10. **Exportar una biblioteca Engine nueva a una carpeta no está expuesto**:
    `buildEngineDatabase` existe y está probado, pero solo lo llaman los tests.
11. **El beatgrid fue eliminado** de la app y se descarta activamente al leer
    sesiones antiguas.
12. **Los ajustes de calidad no se aplican** cuando el fichero ya está en el
    formato de destino.
