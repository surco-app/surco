# Funcionalidades de Surco

Inventario levantado leyendo el código y los tests. Cada afirmación tiene su
evidencia en `fichero:línea`. Lo que aquí no está, no se puede prometer en la web.

Documento de referencia: sirve para redactar la home, llenar `/funciones` y
saber qué NO decir.

**Última revisión: 2026-09-04** (v0.93.0). Levantado por primera vez el
2026-07-30 y revisado contra el código el 2026-09-02, cuando cinco releases lo
habían dejado atrás: daba por perdidos cues que hoy se conservan y publicaba
umbrales del espectro que el código había recalibrado.

**Este documento se revisa en cada release minor**, como paso del flujo de
`/release`. Un doc congelado no solo envejece: hace que la web calle
funcionalidades que sí existen, que es la forma más cara de equivocarse aquí.

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
| Frecuencia | origen / 44100 / 48000 / corregido | origen |
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

**«Origen» es la anchura real, no la declarada.** Si la sonda de bits (§4.7)
prueba que un 24 bits es relleno de 16, la profundidad «origen» escribe 16 bits
de verdad, y sin dither: los bits que se tiran son ceros, la truncación es sin
pérdidas (`ffmpeg.ts:913-926`). Un pipeline float, una normalización o un
resample siguen ganándose su dither.

**Frecuencia «corregido»: una política por fichero, no un valor fijo.** Solo las
pistas que Surco mide como upsampleadas desde 44.1 kHz (mismo detector que el
veredicto, §4.3) se reescriben a 44.1; hi-res confirmado, no verificable y 44.1
nativo salen intactos. Se resuelve una sola vez por conversión
(`ffmpeg.ts:1303-1319`) con una sonda ligera (`measureResolution`,
`ffmpeg.ts:1932`), y la tarjeta «Al convertir» del análisis de calidad avisa en
la propia pista antes de tocar nada. Solo aplica a recodificaciones, como la
profundidad.

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

**Lo que se puede prometer del limitador tiene un límite.** Por debajo de 3 dB de
overshoot solo rebaja las puntas de los transitorios más afilados y no se oye; por
encima, la pérdida de pegada es real y la app lo dice en vez de prometer una
transparencia que no puede sostener (`NormalizePlan.tsx:42-46`). No escribir «solo
limita los picos, transparente» a secas.

**Modo pico avanzado** (estilo Audacity): ganancia independiente por canal, que
**cambia la imagen estéreo** y por eso no es el comportamiento por defecto
(`normalize.ts:173-247`).

**Quitar el offset de DC es ortogonal al modo.** Vivía solo dentro del modo pico,
así que quien elegía loudness lo perdía en silencio — mismo fichero, misma casilla,
DC intacto en loudness y limpio en pico. Hoy es un filtro que se antepone a
cualquiera de las dos rutas (`normalize.ts:238-257`), y el umbral es el mínimo que
la `aeval` de seis decimales puede expresar, 0,0000005 (`normalize.ts:236`), no el
0,2 % de la nota de calidad, que era una decisión que este código nunca toma.

Si la medición falla, la conversión sigue sin normalizar y avisa, en vez de
fallar (`normalize.ts:57-59`).

### El plan por pista, antes de convertir

Una tarjeta dice qué le va a pasar a **esta** pista antes de tocarla, con tres
formas según el caso: solo ganancia, ganancia con limitador, o modo pico
(`NormalizePlan.tsx:31`). Cuando el limitador va a actuar, dice **por cuánto** se
pasarían los picos del techo: «Sus picos pasarían del techo en X dB, así que el
limitador los frenará en Y dBTP» (`NormalizePlan.tsx:38`).

**La segunda línea no promete transparencia que no puede cumplir.** Por debajo de
3 dB de exceso el limitador solo lima las puntas de los transitorios más afilados
y la tarjeta dice que un toque así no se oye; por encima, avisa de que hay algo
menos de pegada en los golpes más fuertes, que es el trato real de un objetivo
alto (`NormalizePlan.tsx:45-46`, claves `limitedSubLight` y `limitedSub`).

La predicción es un espejo deliberado del cálculo real del proceso principal —
mismos clamps, misma prueba de alcanzabilidad (`lib/quality.ts:195-228`).

**Explicaciones en línea** (`showEditorHints`, activado por defecto):
`shared/types.ts:231`, `main/settings.ts:78`. Se apagan desde Ajustes → Editor
(`EditorTab.tsx:83-86`) o desde la X de la propia tarjeta, que persiste el mismo
ajuste (`NormalizePlan.tsx:59-70`).

---

## 4. Análisis de calidad

Tres detectores independientes que se combinan (`ffmpeg.ts:1878-1918`).

### 4.1 Transcodificación (fake lossless)

Mide bandas de 1 kHz de 9 a 22 kHz y busca una caída de la que el espectro
**nunca se recupera** (`cutoff.ts:29-58`). Todas las bandas se miden **por FFT**,
no con un banco de filtros (`fftBands.ts:1-15`).

| Umbral | Valor | Calibración |
|---|---|---|
| Caída de rodilla | 7 dB en un paso (`cutoff.ts:45`) | El viejo 6 dB venía de lecturas bandpass, que achatan la rodilla: el mismo encode lee 6.7 dB por bandpass y 33.6 por FFT |
| Rodilla por encima de 20 kHz | 12 dB (`cutoff.ts:53-54`) | Un taper natural se empina contra Nyquist, y ahí es donde las dos poblaciones se solapan |
| Acantilado de banda fina | **28 dB** dentro de un kilohercio (`cutoff.ts:76`) | 35,7 dB en el más flojo de 40 encodes reales, contra 19,5 en el máster limpio más empinado |
| Recuperación | 2 dB | Un lowpass de códec nunca rebota; un notch resonante sí |

**Una rodilla gruesa no basta.** Solo se cree si las bandas de 500 Hz confirman el
muro (`cutoff.ts:215-217`, `:266-269`). Las de 1 kHz son demasiado gruesas para
distinguir un muro de códec del siseo: promediar un agudo dithery en cubos de
1 kHz fabrica escalones de 8 a 14 dB, y tres rips de CD del mismo disco se
marcaron por eso.

Dos lecturas anteriores **sumaban todo el descenso** (45 dB, luego 38). Un barrido
de 6000 ficheros lossless reales enseñó por qué un total no puede funcionar: las
producciones digitales caen de 2 a 7 dB por banda desde 15 kHz y suman de 40 a
55 dB sin un solo paso empinado, así que 38 marcaba 161 de ellas como lossy y 45
todavía 64 (`cutoff.ts:59-75`). La banda de Nyquist se deja fuera a propósito.

**Lo importante: sin rodilla, no hay veredicto de corte.** Si no hay caída
sostenida, Surco reporta hasta dónde llega la energía y marca `hasKnee: false` —
el veredicto es bueno aunque la extensión sea de 18 kHz. El comentario del código
lo explica: *«ni la pendiente del taper ni dónde cruza un nivel dicen "corte" —
fijarse en cualquiera de los dos es lo que marcaba 320 sanos como falsos»*
(`cutoff.ts:1-8`). Verificado con dos FLAC reales que un usuario reportó mal
calificados (`cutoff.test.ts:153-184`).

Una pasada aparte de `hfShelf` caza el muro que el resto difumina: un muro de
16 kHz (un MP3 de 128–160 re-empaquetado como FLAC) se leía como un taper suave
de 5 dB y pasaba como bueno (`hfShelf.ts:105-112`). **Solo corre en ficheros
nativos a 44.1 kHz** (`ffmpeg.ts:2100`), y su rodilla también queda condicionada a
la confirmación de banda fina (`ffmpeg.ts:2167-2168`). Reporta el borde donde
ACABA el contenido (`hfShelf.ts:155`): devolver el borde inferior de la última
banda sonora leía una banda de menos, y como este pase solo corre a 44.1, la
misma canción salía «Fuente con pérdidas» en su copia 44.1 y «Good quality» en
la de 48 (dos copias gemelas reales, corregido el 2026-09-04).

Por qué se mide por FFT y no con un banco de filtros: el probe viejo leía 11,2 dB
de caída a 21 kHz sobre ruido blanco plano — su propio rolloff IIR —, erraba
2,9 kHz de media y **siempre hacia «más limpia»**, y una pista amurallada en
14 kHz la leía cortada en 20 (`fftBands.ts:1-15`). El FFT lee ruido plano plano,
±0,06 dB.

### 4.2 Altos regenerados (enhancer)

Tres firmas distintas: joroba sintética, sierra de banda fina (SBR/HE-AAC) y
estante plano. Esta última es el umbral más ajustado de todo el sistema: 1.3 dB
de rango, con ~0.5 dB de margen a cada lado (`hfShelf.ts:30`).

**La sierra exige tres dientes seguidos** por encima de 16,5 kHz, sumando 3 dB o
más, con cada banda por encima de −80 dB (`cutoff.ts:121`, `:242`). El veredicto
no puede depender del nivel al que se reproduce el espectro: un remaster de 2010
llevaba los mismos dos armónicos que su reedición de 2008, y solo el remaster
salía acusado porque estar 8 dB más alto subía ambos bultos por encima del suelo
(`cutoff.ts:113-120`).

### 4.3 Frecuencia de muestreo (hi-res, upsample)

Compara dos bandas a 21.5 y 23.5 kHz: un máster genuino cae ~8 dB, un upsample
colapsa 15–20 (`cutoff.ts:140-149`).

**El veredicto tiene cuatro salidas, no una** (`detectResolution`,
`cutoff.ts:367-385`), porque un booleano solo sabía decir «upsampled o nada» y un
hi-res auténtico quedaba en silencio, indistinguible desde fuera de un fichero
que nadie había analizado:

| Salida | Qué significa |
|---|---|
| `native` | 44.1 kHz: no hay hueco sobre el muro de 22.05 kHz, así que no hay nada que comprobar. No es un defecto. |
| `hires` | El contenido cruza el muro: la frecuencia alta hace trabajo real. |
| `upsampled` | La energía se derrumba sobre el muro: contenido de 44.1 kHz en un envase hi-res. |
| `unknown` | Una sonda no se pudo leer, o no hay nada que leer arriba. Se dice en voz alta en vez de disfrazarlo de aprobado. |

La UI enseña las tres primeras respuestas relevantes (`QualitySection.tsx:347-366`,
claves `qualityUpsampled`, `qualityHiRes`, `qualityResolutionUnknown`); un fichero
`native` sigue en silencio, porque no afirma nada que verificar.

**Guarda de suelo.** El test de muro compara las dos sondas ENTRE SÍ, lo que asume
que hay algo arriba que comparar: en un 192 kHz cuyo contenido muere a 20 kHz las
dos caen en el dither y su parecido se leía como caída suave, o sea, como hi-res
genuino. Se exige además que la sonda de arriba no esté más de 55 dB por debajo
del plateau de 9–11 kHz (`HIRES_FLOOR_BELOW_PLATEAU_DB`, `cutoff.ts:349`).
Relativa al plateau, nunca absoluta, porque el mismo máster mezclado más bajo es
el mismo disco. Medido: diez másters 96/24 reales llevan sus ultrasonidos a −16,5
a −34,8 dB bajo plateau; un hi-res falso real está a −75,5 y un upsample 44.1→48 a
−79,9. El orden importa: el muro se comprueba ANTES de la guarda, para que un
upsample de verdad se llame `upsampled` y no se ablande a `unknown`.

**Encuadre del espectro.** La imagen se dibuja hasta 24 kHz, no hasta el Nyquist
del fichero (`SPECTRUM_TOP_HZ`, `ffmpeg.ts:1690`; `spectrogramTopHz`,
`ffmpeg.ts:1696-1699`). A 192 kHz el panel dedicaba el 79% a octavas vacías y
aplastaba la música en la quinta parte de abajo. El tope es 24 kHz y no 22.05 para
que un fichero de 48 kHz no necesite remuestreo y la zona de ~22 kHz que mira el
análisis quede visible con algo de aire. Por debajo del tope manda el Nyquist, así
que 44.1 y 48 kHz se dibujan exactamente como antes. Todos los lectores del eje
(marcas de kHz, línea de corte, cruceta del ratón) leen el mismo tope
(`spectrumTopHz`, `lib/spectrumAxis.ts`); un análisis cacheado de antes del tope no
trae `imageTopHz` y se sigue leyendo contra Nyquist, que es como se dibujó.

**Limitación:** solo detecta el muro de 22.05 kHz. Un 48→96 kHz upsampleado **no
se detecta**.

### 4.4 Veredicto

Bandas absolutas, no relativas a Nyquist: ~20.5 kHz es lossless, ~18.5–19 la
clase 192 kbps, ~16 el clásico 128 re-empaquetado. Calificar contra Nyquist
penalizaba a los ficheros de 48 kHz por el mismo audio (`lib/quality.ts:1-8`).

El badge «Fuente con pérdidas» (`qualityTranscode`) exige cuatro cosas a la vez:
contenedor lossless, rodilla confirmada, no procesado, y corte por debajo de
19,5 kHz (`lib/quality.ts:70-79`). `.m4a` está excluido a propósito porque puede
llevar ALAC o AAC — no aparece ni en la lista lossless ni en la lossy
(`lib/quality.ts:47`, `:57`).

**Un contenedor con pérdidas no se gradúa nunca como defecto.** Un MP3 sale
siempre `good` (`lib/quality.ts:38`): su corte es el formato, no una tara.
Medirlo contra la línea lossless ponía «Revisar» sobre 320 sanos y enseñaba al
usuario a desconfiar de ficheros que eran exactamente lo que decían ser
(`lib/quality.ts:22-28`). Lo que recibe es una leyenda, no un veredicto: «Corte de
códec en ~X, normal en este formato. Por debajo de ~19 kHz apunta a un bitrate
más bajo» (`qualityCaptionLossy`, `QualitySection.tsx:134-139`).

Cuidado al redactar la web: **«Fuente con pérdidas» es el badge del fake lossless,
no el del MP3 sano.** El MP3 sano sale verde.

**El veredicto enseña la medida que lo sostiene.** Bajo la etiqueta va una frase
con los números medidos y otra que explica por qué esa forma delata al culpable:
hasta dónde llega la energía, cuánto cae en un kilohercio, cuántos dientes de
sierra suben donde un espectro natural solo baja, o dónde está el valle que un
upscaler tapó con una joroba (`QualitySection.tsx:164-222`, claves
`qualityEvidence*`). Cada detector trae la suya, incluido el caso sano, que
argumenta que es un fundido y no un acantilado de códec.

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

### 4.7 Profundidad de bits declarada

Un contenedor sin pérdidas que declara 24 bits se comprueba contra sus propias
muestras (`analyzeBitsUsage`, `ffmpeg.ts:1978`): se decodifica un minuto a
`s24le` crudo — sin downmix ni resample, que fabricarían bytes bajos falsos — y
se cuenta cuántas muestras con contenido usan el byte bajo. La separación medida
es total: el relleno 16→24 da exactamente 0% y cualquier cadena real de 24 bits
(interpolación, dither, ruido analógico) da más del 99%; la franja intermedia,
nunca observada, devuelve un null honesto (`ffmpeg.ts:1962-1970`). Solo aplica a
declaraciones enteras de 24 bits: MP3 y float no tienen anchura fija que
verificar.

En la UI: etiqueta «Padded depth» junto al badge de calidad, nota con la prueba
aritmética (las líneas didácticas obedecen el toggle de explicaciones) y la
línea positiva «los 24 bits declarados son reales: N%» solo con las
explicaciones activas (claves `qualityBits*`). El resultado viaja en el análisis
cacheado (namespace v23) y alimenta la profundidad «origen» del convert (§2).

### 4.8 Lo que NO detecta

- **Estéreo falso.** No existe detector de correlación. Lo que hay es balance
  L/R, que mide desequilibrio de nivel: dos canales idénticos medirían 0 dB =
  bueno.
- Un fake cuya única deficiencia esté por debajo de 8 kHz.
- El muro poco profundo sobre un suelo ruidoso: un máster dance de los 90 con los
  agudos a −79 dB cortados contra un suelo de −104 mide 24 dB y se queda en corte
  reportado, sin acusación (`cutoff.ts:73-75`).
- **16 bits con dither subido a 24.** La sonda de bits solo prueba el relleno
  exacto (bytes bajos a cero); el caso con dither posterior llenaría el byte
  bajo y necesitaría el suelo estadístico por banda. Fase 2.

**Calibración.** Un corpus de regresión de 55 ficheros reales medidos —40 encodes,
9 lossless, 6 limpios— corre como test en cada cambio
(`spectrumCorpus.test.ts:13-17`). Y `npm run sweep` pasa una biblioteca entera por
el veredicto real (`spectrumSweep.test.ts:11-28`); el barrido que fijó los
umbrales actuales fueron 6000 ficheros lossless.

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

**El umbral se adapta al suelo de ruido de cada pista**, no es fijo
(`trimThresholdDb`, `renderer/lib/trim.ts:22-27`): percentil 1 de la envolvente no
nula, más 12 dB de margen, acotado entre −60 y −40 dB. El suelo de −60 dB sigue
siendo el mínimo, generoso frente a un gate de silencio digital (−90) porque la
entrada de un vinilo es ruido de superficie, no ceros. Lo que cambia es el caso
ruidoso: un hiss o zumbido de entrada a ~−50 dB superaba el −60 fijo, contaba como
música y dejaba el corte ancho. El techo de −40 existe porque las intros suaves
reales miden −35 a −26 dB y el gate no debe meterse nunca en ellas. Medido sobre
ficheros reales: los suelos limpios están a −73…−87 dB, así que en ellos el gate se
queda en −60 y la sugerencia sale idéntica a la de siempre; el estimador falla hacia
abajo en material raro, lo que falla en seguro. `refineOnset` exige que le pasen el
gate de la pista y no lo mide sobre su ventana, porque una ventana de refinado es
casi toda el ruido que el paso grueso ya cortó (`renderer/lib/trim.ts:63-72`).

**Sin arreglo honesto:** un fundido de salida largo que muere en −61 dB en el último
cubo. El gate sube, pero el recorte resultante queda por debajo de `MIN_TRIM_SEC` y
se descarta. Cortar por encima del suelo ahí sería cortar música audible.

Micro-fade de 20 ms en cada borde cortado: un corte a través de ruido de
superficie no es silencio digital, y un escalón ahí hace clic
(`shared/trim.ts:36-39`).

**Nota «Tras el corte».** Antes de convertir, una tarjeta dice cuánto se va por
cada lado y con qué duración queda la pista, y añade que el corte recodifica el
audio y que los cues y el beatgrid de Traktor se mueven con él, así que todo
sigue cayendo en el mismo golpe (`TrimSection.tsx:99-116`, claves `trim.plan*`).
El aviso enumera los cuatro formatos que conservan los cues: MP3, AIFF, FLAC y
WAV; solo ALAC los pierde. Nació diciendo «WAV los pierde», la misma celda ya
corregida en el aviso de conversión y reintroducida aquí por una clave nueva; lo
pinado ahora es `trim.planCues` dentro del propio guard
(`cueWarning.test.ts:48-57`), que ya cubría `cueWarning` y no la veía.

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

28 campos, con una única definición por campo que declara de dónde se lee y con
qué nombre se escribe en cada contenedor (`tagFields.ts:31-163`). Un test impide
que un campo nuevo quede ilegible o inescribible.

**Los campos de coleccionista llegan a todos los contenedores.** Ocho pares que
ninguna familia de etiquetas tiene en una caja propia —número de catálogo, ID de
la edición de Discogs, mood, energía, **estilo, país, tipo de medio y URL de la
edición**— viajan como descripciones TXXX en ID3 y como átomos freeform `----` en
MP4, bajo los nombres que escribe mp3tag para que una colección etiquetada con esa
herramienta y otra etiquetada aquí coincidan en vez de duplicarse
(`tags.ts:549-566`, `:700-716`, `:748`). Una sola lista para ambos contenedores:
los cuatro de coleccionista estaban en `TAG_FIELDS` pero en ninguna rama de
`writeTags`, así que desaparecían de todo fichero que termina la pasada de TagLib.

También se borran los espejos TXXX que ffmpeg deja junto a COMM y POPM, que hacían
que mp3tag listara un segundo «COMMENT» y un segundo «RATING WMP»
(`tags.ts:759-765`).

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
(`tags.ts:609-623`).

**Y ahora también se lee.** ffprobe nunca expone el frame POPM, así que una pista
valorada en Traktor volvía sin estrellas en MP3/AIFF. Cuando el probe no encuentra
rating, se lee el POPM con TagLib (`ffmpeg.ts:499-504`, lector en
`tags.ts:170-176`). El lector contempla que WMP escriba dos POPM cuyos bytes
discrepan por diseño (204 contra 196 para cuatro estrellas).

Asimetría deliberada al borrar: en MP3/AIFF/WAV un rating vacío **se conserva**;
en FLAC sí se borra (`tagFields.ts:104-106`).

**En M4A no hay rating, y es a propósito**: el rating vive en un frame POPM, una
estructura ID3 sin equivalente en MP4, y el lector del otro lado solo busca POPM.
Meterlo en un átomo freeform escribiría bytes que no lee nadie, ni el propio Surco
(`tags.ts:711-714`).

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

Actualizada 2026-09-02: dos celdas daban por perdido lo que hoy se escribe.

| Campo | MP3 | AIFF | WAV | FLAC | M4A/ALAC |
|---|---|---|---|---|---|
| 28 campos base | Sí | Sí | Sí (chunk `id3 `) | Sí | Sí |
| Carátula | Sí | Sí | Sí (vía `id3 `) | Sí | Sí |
| Rating | Sí | Sí | Sí | Sí | **No** (`tags.ts:711-714`) |
| Nº de catálogo | Sí | Sí | Sí | Sí | **Sí** (freeform) |
| Estilo, país, tipo de medio, URL Discogs | Sí | Sí | Sí | Sí | **Sí** (freeform) |
| Año original | Sí | Sí | Sí | Sí | **No** |
| Posición vinilo «A2» | Sí | Sí | Sí | Sí | **No** (solo dígitos) |
| Cues de Traktor | Sí | Sí | **Sí** | Sí | **No** |

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

**Matriz de conservación** (actualizada 2026-09-02; la tabla anterior daba tres
celdas por perdidas que hoy se conservan):

| Origen → destino | ¿Cues? |
|---|---|
| MP3/AIFF → MP3/AIFF | **Sí** |
| MP3/AIFF → FLAC | **Sí** (re-armado a basE91) |
| FLAC → FLAC | **Sí** |
| **FLAC → MP3/AIFF** | **Sí** (`ffmpeg.ts:1436-1443`) |
| **Cualquiera → WAV** | **Sí** (`ffmpeg.ts:1400-1409`, `:1487-1490`) |
| Cualquiera → **ALAC/M4A** | **No**, a propósito |
| Con «limpiar metadatos» | **No**, a propósito |

Los cuatro formatos cruzados están enumerados en un test que recorre la matriz
entera y comprueba que la posición del cue sobrevive
(`cueMatrix.test.ts:161-193`). El comentario dice por qué se enumeró toda:
*«el bug que reportó djotas era una sola celda vacía; enumerar la matriz entera es
lo que convierte "arreglamos el que reportaron" en "los comprobamos todos"»*.

M4A queda fuera porque no tiene ID3 donde escribir, la misma razón por la que la
ruta ALAC no lleva cues (`ffmpeg.ts:1401-1402`, test `convertCues.test.ts:713-720`).

**Cues de Mixed In Key.** MIK guarda su JSON en base64 dentro de un GEOB
llamado `CuePoints`; Surco lo traduce al árbol binario de Traktor
(`mixedInKey.ts`, enganchado en `tags.ts:387`, `:438-443`). Si no hay cues devuelve
`null` en vez de escribir un CUEP vacío, que Traktor leería como «analizada, sin
cues».

**Lectura tolerante al padding.** La longitud declarada en la cabecera manda: los
ficheros reales rellenan más allá (basE91 redondea al bloque, y los PRIV de
Traktor arrastran una cola de 512 ceros — en los ocho MP3 de djotas). Exigir que
el recorrido consumiera el buffer exacto hacía que todos leyeran «sin cues»
(`traktor4.ts:62-70`, `:167-176`).

### Sync del `.nml` de Traktor

Apagado por defecto. Cuando se configura la ruta de la colección, actualiza el
`.nml` real: repunta la ruta si cambió la extensión, limpia el `COVERARTID` para
que Traktor relea la carátula, y reemplaza los `CUE_V2`.

Se edita como texto y no con un parser XML, porque un round-trip genérico
normalizaría comillas y espaciado de todo el documento y convertiría un cambio de
tres atributos en un diff de la colección entera (`traktorNml.ts:1-4`).

**Exige Traktor cerrado**, igual que Engine DJ: Traktor carga el `.nml` al
arrancar y lo reescribe entero al salir, así que escribir con él abierto sería
invisible en el mejor caso y revertido en el peor. Surco se ofrece a cerrarlo, y
si el usuario declina no escribe y avisa (`traktorNmlLibrary.ts:28`, `:57`;
`index.ts:213` `ensureTraktorClosed`).

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

1. **Cue points:** en MP3, AIFF, FLAC y WAV, en cualquier cruce entre esos cuatro.
   **No en ALAC/M4A**, que no tiene ID3 donde escribirlos.
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
13. **El limitador no es transparente por encima de 3 dB de overshoot.** Por
    debajo no se oye; por encima la pérdida de pegada es real y la app lo dice.
14. **El muro poco profundo sobre un suelo ruidoso no se acusa**: se reporta el
    corte, sin veredicto de fuente con pérdidas.
15. **Un MP3 nunca se califica como defectuoso.** Su corte es el formato.
16. **«Los 24 bits son reales» no afirma procedencia**: dice que el byte bajo
    lleva señal, no que la captura fuera de 24 bits — un resampleo de un origen
    de 16 también lo llena.
17. **«Corregido» no recupera calidad**: solo quita el relleno probado de un
    upsample; nunca toca lo genuino ni lo dudoso, y solo actúa al recodificar.
