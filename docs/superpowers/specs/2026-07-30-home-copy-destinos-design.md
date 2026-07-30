# Home: copy más claro y los destinos como argumento

Fecha: 2026-07-30

## Problema

El usuario pidió «mejorar el diseño de la página principal y el wording, que los
textos sean entendibles y expliquen claramente las funcionalidades». Los cuatro
síntomas que confirmó: no se entiende qué es Surco, resulta densa, visualmente no
convence, y no convierte.

Al explorar el código, dos de esos cuatro resultaron estar ya resueltos:

- **La densidad ya se atacó.** `App.tsx:12-15` documenta que las listas de
  funciones, la comparativa de cinco apps, la tabla de atajos y la FAQ se
  movieron a `/funciones`. La home son tres bloques: hero, walkthrough de 6 pasos
  y cierre.
- **El hero visual no se toca.** El usuario fue explícito: la app se explica sola
  visualmente, y el vídeo es de dos commits atrás.

Queda un problema real de wording, y uno de jerarquía: **los destinos —lo que el
visitante viene a comprobar— son la última línea del scroll.**

## Alcance

Solo copy, sobre la estructura actual. No se toca el hero visual, ni la
estructura de 6 pasos, ni se crean páginas.

Ficheros: `apps/web/src/i18n/locales/es.json` y `en.json`. El español es
canónico (`fallbackLng: 'es'`); el inglés se traduce después.

Fuera de alcance: `/funciones`, `/guia`, FAQ y changelog.

## Base de evidencia

Se levantó un inventario completo de funcionalidades leyendo el código con cinco
agentes en paralelo. Está en `docs/funcionalidades.md`, con evidencia en
`fichero:línea` y una sección final de doce afirmaciones que la web no puede
hacer. Todo el copy de este spec se apoya en él.

## Decisiones

1. **Eje del mensaje:** «tu música está peor de lo que crees». Es lo único que
   ninguna otra app cuenta.
2. **Público:** núcleo DJ, puerta abierta. El hero deja de asumir cabina; el
   marco DJ reaparece más abajo, donde ya no excluye.
3. **Lo destacado del inventario que sube a la home:** solo los destinos. El WAV
   con metadatos, los tres detectores de calidad y la matriz de cues se quedan
   para `/funciones`.
4. **Los límites se dicen.** La nota actual promete cue points intactos sin
   matizar, y es falso en WAV y ALAC. Se dice dónde se conservan y dónde no.

## Copy

### Hero

| Clave | Ahora | Propuesta |
|---|---|---|
| `hero.h1a` | Deja de preparar. | Tu música, |
| `hero.h1b` | Ponte a pinchar. | como debería estar. |
| `home.heroLede` | Convertir, etiquetar, comprobar la calidad y dejar cada pista en rekordbox, Engine DJ o Apple Music. Todo lo que hoy haces en cinco programas. | Surco abre cada archivo y te dice qué tienes de verdad: si el lossless es auténtico, qué etiquetas faltan, dónde hay clics y silencio de sobra. Lo arregla y lo deja listo en tu reproductor o en tu equipo de DJ. |

Inglés:

- `hero.h1a`: "Your music,"
- `hero.h1b`: "the way it should be."
- `home.heroLede`: "Surco opens every file and tells you what you actually have:
  whether the lossless is genuine, which tags are missing, where the clicks and
  the dead air are. Then it fixes all of it and files it into your player or your
  DJ gear."

Razón: «Ponte a pinchar» excluye a quien no es DJ de cabina en el primer segundo,
y «Deja de preparar» solo significa algo si ya sufres el flujo. El lede pasa de
enumerar los cinco programas que sustituye a decir qué hace la app.

### Entradilla del walkthrough

| Clave | Ahora | Propuesta |
|---|---|---|
| `home.walkthrough.kicker` | De la carpeta a la cabina | Paso a paso |
| `home.walkthrough.title` | Una pista, de principio a fin | *(sin cambio)* |
| `home.walkthrough.lede` | Esto es todo lo que le pasa a un archivo desde que lo sueltas hasta que está en tu equipo. | Todo lo que Surco le hace a un archivo desde que lo sueltas hasta que está donde lo escuchas. Seis pasos, una sola ventana. |

Inglés: kicker "Step by step"; lede "Everything Surco does to a file between
dropping it in and having it where you listen. Six steps, one window."

Razón: el kicker vuelve a cerrar la puerta. «Seis pasos, una sola ventana» avisa
de la longitud del scroll y cuela el argumento de «no necesitas cinco apps» sin
dedicarle sección.

### Paso 02 — se comprueba

| Clave | Ahora | Propuesta |
|---|---|---|
| `home.quality.title` | El espectro no miente. | Ese FLAC era un MP3. |
| `home.quality.lede` | Un lossless de verdad llega hasta arriba. Un MP3 disfrazado se corta en seco y deja el hueco a la vista, antes de que la pista llegue a cabina. | Comprar lossless no garantiza que lo sea. Si alguien convirtió un MP3 a FLAC, el archivo pesa lo mismo que un lossless pero le falta la mitad de los agudos — y en el espectro se ve como un muro plano. Surco te lo marca antes de que la pista salga de casa. |
| `home.quality.note` | Dos pistas compradas de la misma carpeta. La segunda dice ser FLAC, pero su audio pasó por un MP3 antes. | La misma pista, dos veces: el FLAC original y ese mismo audio pasado por MP3 y devuelto a FLAC. Solo cambia el códec, así que el muro no tiene otra explicación. |

Inglés: title "That FLAC was an MP3."; note "The same track, twice: the original
FLAC, and that same audio pushed through MP3 and back. Only the codec differs, so
the wall has no other explanation."

Razón: «El espectro no miente» presupone que sabes qué es un espectro. Y la nota
actual **es inexacta**: `SpectrumPair.tsx:6-8` documenta que son la misma pista
procesada dos veces, no dos pistas distintas. Eso elimina cualquier otra
explicación del muro y es un argumento más fuerte.

### Paso 04 — se limpia

| Clave | Ahora | Propuesta |
|---|---|---|
| `home.declick.title` | Los clics del vinilo, fuera. | *(sin cambio)* |
| `home.declick.lede` | Surco los marca uno a uno sobre la onda y te deja alternar entre la original y la reparada mientras suena, sin cortar el audio. | Si tus pistas vienen de un disco, traen chasquidos. Surco los encuentra, los marca sobre la onda y los quita — y puedes cambiar entre el audio original y el reparado mientras suena, sin cortes, para comprobar que no se ha llevado nada de la música por delante. |

Inglés: "If your tracks came off a record, they carry clicks. Surco finds them,
marks them on the wave and takes them out — and you can switch between the
original and the repaired audio while it plays, with no gap, to check the repair
didn't take any of the music with it."

Razón: el lede no explicaba por qué importa comparar en caliente. `declick.ts:9-14`
documenta que el fallo real de una reparación es comerse el ataque de una caja, y
que solo se oye alternando al instante.

### Paso 06 — sale (el cambio de fondo)

| Clave | Ahora | Propuesta |
|---|---|---|
| `home.batch.title` | Toda la carpeta, de una vez. | Y acaba donde tú la escuchas. |
| `home.batch.lede` | Y va a donde tú pinchas. Con tus cue points de Traktor intactos. | Elige formato y destino, y Surco convierte la selección entera. No exporta un fichero para que tú lo importes: escribe en la biblioteca — con su carátula, su rating y su playlist. |
| `home.batch.cues` | con tus cue points de Traktor intactos | tus cue points de Traktor siguen donde estaban en MP3, AIFF y FLAC |

Inglés: title "And it ends up where you listen."; lede "Pick a format and a
destination, and Surco converts the whole selection. It doesn't export a file for
you to import: it writes into the library — artwork, rating and playlist
included."; cues "your Traktor cue points stay put in MP3, AIFF and FLAC".

Razón: «va a donde tú pinchas» no responde a «¿sirve para mi equipo?». Y lo que
distingue a Surco no es exportar, es **escribir en la biblioteca**: en Engine DJ
la carátula va como blob propio porque Engine nunca lee el arte de los tags
(`engineLibrary.ts:220-221`), más rating y playlist.

La clave `cues` cambia porque la promesa actual es falsa en WAV y ALAC
(`docs/funcionalidades.md` §10). Se acota a los formatos donde se cumple.

### Cierre

| Clave | Ahora | Propuesta |
|---|---|---|
| `home.closeTitle` | De la carpeta a la cabina sin salir de una ventana. | Todo esto, en una ventana. |
| `home.closeNote` | Gratis, para siempre. Sin cuenta, sin nube, sin límites. | *(sin cambio)* |

Nueva clave `home.closeSafety`: «Tus archivos originales no se tocan: lo
convertido va a una carpeta aparte. Notarizado por Apple; en Windows, SmartScreen
avisa por ser una app nueva.»

Inglés: closeTitle "All of it, in one window."; closeSafety "Your original files
are left alone — converted tracks go to a separate folder. Notarized by Apple; on
Windows, SmartScreen warns because the app is new."

Razón: son las dos objeciones que frenan el clic, y hoy solo viven en la FAQ de
`/funciones`, otra página. `settings.ts` confirma `overwriteOriginal: false` por
defecto.

## Jerga

| Término | Decisión |
|---|---|
| fake lossless | «un MP3 disfrazado de FLAC» la primera vez |
| muro de códec | «un muro plano donde deberían estar los agudos» |
| cue points | se mantiene, pero acotado a los formatos donde se conservan |
| lossless | **se queda** — es lo que la gente busca |
| AIFF, WAV, FLAC, ALAC | **se quedan** — quien tiene el problema los conoce |
| rekordbox, Engine DJ, Traktor, Serato | **se quedan** — son la respuesta a «¿vale para mi equipo?» |

LUFS y grouping no aparecen en la home (viven en `/funciones`).

## Cambios en componentes

`App.tsx`: añadir `home.closeSafety` bajo el `DownloadButton` del cierre, con el
estilo de nota ya existente (`font-mono text-xs text-faint`).

No hay más cambios de componente. `Walkthrough.tsx` y `HeroApp.tsx` quedan
intactos.

## Código muerto detectado (no se toca)

- `hero.ledeShort` en ambos locales: la home usa `home.heroLede`. Resto del
  rediseño anterior. Se señala, no se borra.

## Verificación

1. `npm run check` en la raíz.
2. Tests de i18n: `keys.test.ts` valida la paridad es/en.
3. Captura contra `vite preview`, no `dev` (ver memoria del proyecto).
4. Revisar que ninguna afirmación nueva contradiga
   `docs/funcionalidades.md` §12.

## Criterios de éxito

- Ni «pinchar» ni «cabina» aparecen por encima del walkthrough.
- Los seis destinos se nombran en el paso 06.
- Ninguna promesa sobre cue points sin acotar el formato.
- La nota del espectro dice que es la misma pista, no dos.
- Los dos quitamiedos aparecen junto al botón de descarga.
- Paridad exacta de claves entre `es.json` y `en.json`.
