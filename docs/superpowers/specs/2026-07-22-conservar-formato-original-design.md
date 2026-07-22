# Conservar el formato original

## Problema

Hay usuarios que traen metadatos de Discogs o Bandcamp y quieren inyectarlos en sus
ficheros sin convertir el audio. Hoy no pueden expresarlo con un lote de formatos
mezclados.

El motor ya sabe no recodificar: `planConversion` (`main/ffmpeg.ts:755`) devuelve
`codec: 'copy'` cuando la extensión de entrada coincide con el formato de salida, y para
MP3 y AIFF ni siquiera lanza ffmpeg — clona el fichero y reescribe los tags con TagLib
(`main/ffmpeg.ts:1069`). El modo `Overwrite original` tampoco fuerza recodificación:
`overwriteOriginal` solo decide *dónde* se escribe (`main/inplace.ts:70`).

Lo que falta es que el formato de salida pueda ser **el de cada fichero**. Hoy es un
ajuste global único, así que con un lote de WAV + FLAC + MP3 cualquier elección
recodifica la mayoría. La capacidad existe; no hay forma de pedirla.

## Qué se construye

Un valor nuevo en el selector de formato de salida de Settings: **"Conservar el
original"**, junto a AIFF / ALAC / MP3 / WAV / FLAC. Es un ajuste global y se recuerda
entre sesiones.

Elegirlo significa: cada fichero sale en su propio formato.

- **Con los filtros de audio apagados** — el audio no se toca. Solo se reescriben tags y
  carátula. Es el caso de uso que motiva la feature.
- **Con normalize / declick / trim encendidos** — se recodifica, en el mismo formato de
  cada fichero. Los dos ejes son independientes por decisión de producto: el modo fija el
  formato, no el procesado.
- **Con cualquier destino** — no interactúa con "Where converted tracks go". Combina con
  los cinco, incluido `Overwrite original`, que es la combinación que piden los usuarios.

## Principio de diseño

**"Conservar el original" es una regla para elegir formato, no un formato.**

Meterla en el enum `OutputFormat` sería meter una regla donde el resto del código espera
un valor, y rompe en muchos sitios a la vez (ver Alternativas). Por eso el valor nunca
cruza el IPC: se traduce a un formato concreto en el renderer, que es el único punto con
toda la información necesaria — conoce el track.

```
Settings (persistido)         outputFormat: FormatSetting = OutputFormat | 'source'
        ↓
Renderer, al crear cada job   resolveJobFormat('source', track.path, fallback) → 'flac'
        ↓
IPC / ProcessJob              job.format: OutputFormat   ← siempre concreto
        ↓
Main (processTrack, ffmpeg)   sin cambios
```

`OutputFormat` no se toca. Esa es la decisión que protege el motor: todo lo que la
auditoría marcó como frágil sigue recibiendo valores que ya sabe manejar.

## Arquitectura

### Tipo nuevo

```ts
type FormatSetting = OutputFormat | 'source'
```

`Settings.outputFormat` pasa de `OutputFormat` a `FormatSetting`.
`ProcessJob.format` permanece `OutputFormat`.

El override puntual de formato que ya existe (`formatOverride`, el menú del split-button de
`ExportButton` y el estado del editor) **sigue siendo `OutputFormat`**: "conservar" es un
ajuste global por decisión de producto, no una elección por conversión. Un override puntual
siempre nombra un formato concreto y gana sobre el ajuste, como hoy.

El `fallback` es el formato por defecto de la app, `'aiff'` — el mismo literal que ya usan
los call sites que leen `settings?.outputFormat ?? 'aiff'`.

### Función de resolución

```ts
resolveJobFormat(setting: FormatSetting, inputPath: string, fallback: OutputFormat): OutputFormat
```

Pura y testeable. Si `setting !== 'source'`, lo devuelve tal cual. Si es `'source'`,
deriva el formato de la extensión del input; si no hay formato de salida equivalente,
devuelve `fallback`.

Ya existe lógica casi idéntica en `renderer/src/components/Editor.tsx:584`
(`exportedFormat`, que deriva el formato desde la extensión del outputPath). Sirve de
modelo, corrigiendo que hoy `.aif` devuelve `null` porque el array `FORMATS` solo contiene
`'aiff'`.

**`.m4a` cae al fallback, no a ALAC.** `INPUT_EXT.alac` es `/(?!)/` en
`shared/format.ts:12` — nunca hace match, deliberadamente: un `.m4a` puede contener AAC
lossy y distinguirlo requiere un probe de códec. Llamarlo "ya es ALAC" reescribiría el
original del usuario presentando un encode lossy como lossless. `resolveJobFormat` respeta
esa invariante.

**`.ogg`, `.opus`, `.aac`, `.mp4` caen al fallback.** `main/expand.ts:7` acepta 11
extensiones de entrada frente a 5 formatos de salida; para estas no hay `OutputFormat` que
las represente. Caer al formato por defecto es exactamente lo que ya les ocurre hoy.

### Punto de traducción

Uno solo: `renderer/src/hooks/useTrackProcessing.ts:356`, donde hoy `processAll` calcula
`pinnedFormat` para todo el lote y lo pasa idéntico a cada `processOne`. Pasa a resolverse
por track.

La disciplina de un único punto de traducción es lo que sostiene el diseño: si `'source'`
se colara en un job, `main/ffmpeg.ts:843` produciría un AIFF en silencio (su cadena
`if/else` termina en un `else` implícito que asume AIFF). Los tests cubren ese contrato.

### Cambios de UI

Sitios que leen `settings.outputFormat` para decidir qué mostrar:

- **Consolidar los tres arrays `FORMATS` duplicados** —
  `renderer/src/components/ExportButton.tsx:12`,
  `renderer/src/components/OnboardingWizard.tsx:15`,
  `renderer/src/components/settings/ConversionTab.tsx:9`. Hoy están tipados
  `OutputFormat[]`, que acepta subconjuntos y por tanto no falla al añadir un valor.
  Consolidarlos en uno hace visible el hueco.
- **`ConversionTab.tsx:37,51,73`** — los bloques de calidad MP3, bitDepth/sampleRate y
  compresión FLAC son hoy mutuamente excluyentes según el formato. Con `'source'`
  cualquiera puede aplicar según el fichero, así que se muestran los tres.
- **Gates de FLAC → Apple Music** (`renderer/src/lib/destination.ts:35`,
  `renderer/src/components/DestinationPicker.tsx:41`,
  `renderer/src/components/settings/DestinationTab.tsx:36`,
  `renderer/src/components/ExportButton.tsx:234`,
  `renderer/src/components/OnboardingWizard.tsx:84`,
  `renderer/src/lib/librarySource.ts:24`) — con `'source'`, `flacOnly` es `false`: no se
  puede saber a priori si el lote contiene FLAC. Los FLAC se saltan en silencio, que es el
  comportamiento actual (ver Comportamiento heredado).
- **`renderer/src/components/DeclickSection.tsx:410`** — el aviso ámbar de pérdida de cues
  sale cuando el formato no está en `CUES_SURVIVE = ['mp3','aiff']`. Con `'source'` no debe
  salir siempre: MP3→MP3 y AIFF→AIFF conservan los cues.
- **i18n** — clave nueva `settings.formats.source` en los 5 locales
  (`en`, `es`, `de`, `fr`, `pt-BR`).

## Comportamiento heredado que se conserva

**FLAC + Apple Music se salta en silencio.** `shouldAddToAppleMusic`
(`main/applemusic.ts:245`) es `enabled && platform === 'darwin' && format !== 'flac'`, y
`isAppleMusicOnly` (`main/applemusic.ts:261`) devuelve `false` en ese caso precisamente
para que el fichero no se borre. Hoy el usuario no llega a ver el conflicto porque la UI ya
le quita la opción. Con `'source'` y un lote mixto, unos ficheros entrarán en la biblioteca
y otros no, sin aviso — decisión explícita de producto, coherente con lo que ya ocurre.

Como el formato llega resuelto por fichero, ambos gates funcionan correctamente sin
cambios: reciben `'flac'` para los FLAC y `'mp3'` para los MP3.

## Riesgos que este diseño evita

La auditoría del código identificó que propagar `'source'` hasta el motor causaría:

- **Pérdida de datos.** `editsInPlace` (`shared/format.ts:37`) es
  `(overwriteOriginal && format !== 'alac') || formatMatchesInput(format, inputPath)`. Con
  un formato "conservar", `formatMatchesInput` sería true por definición, así que
  `editsInPlace` daría true incluso con destino "carpeta de salida". Eso marca `inPlace` en
  `main/inplace.ts:70`, y `main/processTrack.ts:229` llama `removeRenamedOriginal`, que hace
  `unlink` del fuente — saltándose la confirmación destructiva que hoy solo cubre el modo
  overwrite (`renderer/src/hooks/useConfirmFlows.ts:260`).
- **Fichero perdido en Apple Music.** Un FLAC colándose por el gate con
  `keepOutputCopy: false` haría que `main/processTrack.ts:159` escriba a un `tmpDir` que el
  `finally` borra, con el add fallando: no queda fichero.
- **AIFF silencioso.** `main/ffmpeg.ts:843` cierra su cadena de formatos con un `else`
  implícito que asume AIFF.

Resolver en el renderer elimina los tres: el motor nunca ve un valor que no conozca.

## Tests

Sobre `resolveJobFormat`, donde vive toda la decisión:

- cada extensión soportada devuelve su formato (`.mp3` → `'mp3'`, `.flac` → `'flac'`,
  `.wav` → `'wav'`)
- `.aif` devuelve `'aiff'` — el caso que hoy falla en `exportedFormat`
- `.m4a` cae al fallback, **no** a `'alac'`, porque puede contener AAC lossy
- `.ogg` / `.opus` / `.aac` / `.mp4` caen al fallback
- un ajuste concreto se devuelve intacto, sin mirar la extensión

Integración en `useTrackProcessing`, que encierra el *por qué* de la feature:

- un lote mixto con `'source'` produce un job por track, cada uno con su propio formato —
  lo que hoy es imposible
- ningún job sale nunca con `format: 'source'`

## Alternativas descartadas

**`'source'` como valor de `OutputFormat`, propagado hasta el motor.** Conceptualmente más
honesto, pero exige que cada sitio que compara formatos aprenda a resolverlo:
`formatExtension` (`shared/format.ts:26`) no recibe `inputPath` y tendría que recibirlo en
sus 5 call sites; `toDestination` (`renderer/src/lib/destination.ts:27`) recibe un
`flac: boolean` que es un hecho del lote entero; los dos gates de Apple Music no pueden
decidir si es FLAC. Y arrastra los tres riesgos de arriba.

**Acción separada "Escribir metadatos"** que llame a `writeTags` (`main/tags.ts:270`) sin
pasar por `convertAudio`. Es el camino más corto al caso de uso literal, pero duplica un
pipeline que ya existe y funciona: carátula procesada, cues de Traktor, resolución de
conflictos, registro en Apple Music y Engine DJ.

## Fuera de alcance

**Restringir los formatos de importación.** Surge de la discusión: hoy `main/expand.ts:7`
importa `.ogg`, `.opus`, `.aac` y `.mp4`, que siempre se transcodifican. Dejar de
importarlos rompería a usuarios que hoy los convierten, así que es una decisión de producto
aparte y no se mezcla con esta feature.
