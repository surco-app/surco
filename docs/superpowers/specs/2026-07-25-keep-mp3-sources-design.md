# Keep MP3: no convertir MP3 a lossless

## Problema

Con el formato de export por defecto en AIFF, WAV o FLAC, un MP3 de origen se
transcodifica a lossless. El fichero resultante ocupa varias veces más y no gana ninguna
calidad: lo que el encoder lossy descartó no se recupera. Para quien trabaja con
descargas de Bandcamp o Deezer en MP3, cada export infla la biblioteca sin beneficio.

Hoy la única forma de evitarlo es "Same as source", pero ese modo cambia el formato de
*todos* los ficheros del lote. No hay manera de decir: "convierte lo lossless a mi
formato, pero los MP3 déjalos como están".

## Qué se construye

Un booleano nuevo en Settings → Conversion, debajo del selector de formato:
**Keep MP3 files as MP3** (`keepMp3Sources`, default `false`, sincronizado entre
máquinas — no entra en `LOCAL_KEYS`).

Con él activo, cuando el formato de export efectivo es lossless (`aiff`, `wav`, `flac`,
`alac`) y la fuente es `.mp3`, el job sale con `format: 'mp3'`. El motor entra solo en el
stream-copy que ya existe (mp3→mp3: clon byte a byte + tags frescos), y el resto del
pipeline — rename, retag, Apple Music, Engine DJ — funciona sin cambios.

Como todo export cuyo formato coincide con el del fichero, esto es una **edición
in-place** (`resolveOutputTarget`): Surco reescribe los tags sobre el original, allí
donde vive, y no deja copia en la carpeta de salida — la misma semántica que hoy tiene
exportar MP3→MP3 o "Same as source" sobre un mp3. La UI existente ya lo comunica: el
botón muestra las etiquetas in-place ("Update" / "Update + Apple Music") y el editor su
aviso de edición in-place. No se añaden claves i18n de botón.

El checkbox solo es visible cuando el formato elegido es lossless: con `mp3` o `source`
la regla no aplica y mostrarlo sería ruido. Mismo patrón de visibilidad condicional que
ya usan los bloques de calidad MP3 / compresión FLAC en `ConversionTab`.

No se añade al wizard de onboarding.

## Alcance: solo MP3

La regla conceptual es "no upconvertir lossy", pero MP3 es el único formato lossy con
equivalente en `OutputFormat`:

- **AAC/M4A, OGG, Opus** — no hay formato de salida que los represente; se siguen
  convirtiendo al formato de export, como hoy. No pierden calidad (destino lossless),
  solo ocupan más.
- **`.m4a`** — además es ambiguo: puede contener AAC lossy o ALAC lossless, y
  distinguirlo requiere probe de códec. Se respeta la invariante existente
  (`INPUT_EXT.alac = /(?!)/`): nunca se decide por extensión.

Saltarse esas pistas (como hace "Same as source" con ellas) dejaría el trabajo a medias:
sin retag, sin rename, sin Apple Music. Descartado.

## Principio de diseño

**`keepMp3Sources` es una segunda regla sobre el mismo punto de traducción que
"Same as source"** (spec `2026-07-22-conservar-formato-original-design.md`). El valor
persiste como booleano en Settings, y se aplica en el renderer, donde el setting se
convierte en formato concreto por track. `'source'` estableció la disciplina: el motor
nunca ve reglas, solo `OutputFormat` resueltos. Esta feature la hereda.

```
Settings                       outputFormat: FormatSetting, keepMp3Sources: boolean
        ↓
Renderer, al crear cada job    resolveJobFormat(setting, path, fallback, keep) → 'mp3' | picked
        ↓
IPC / ProcessJob               job.format: OutputFormat   ← siempre concreto
        ↓
Main (processTrack, ffmpeg)    sin cambios de comportamiento
```

## Arquitectura

### Función de resolución

La regla vive dentro de `resolveJobFormat`, que gana un cuarto parámetro opcional:

```ts
resolveJobFormat(setting, inputPath, fallback, keepMp3 = false): OutputFormat
```

Con `keepMp3` y `formatMatchesInput('mp3', inputPath)`, devuelve `'mp3'`; si no, resuelve
como hoy. `reencodesLossyInPlace` gana el mismo parámetro y lo reenvía, de modo que el
aviso de re-encode lossy ve el mismo formato que el job. Cada call site decide el flag
según si su formato viene del setting o de una elección explícita.

Para los lotes, donde la procedencia se pierde al fijar el formato, un segundo helper
puro concentra la decisión:

```ts
batchKeepMp3(format: FormatSetting | undefined, outputFormat: FormatSetting,
             keepMp3Sources: boolean): boolean
```

`true` cuando el setting está activo y el formato del lote es settings-derived:
`undefined` o igual al `outputFormat` del setting.

### Puntos de aplicación

Los cinco call sites de `resolveJobFormat`, con el flag según su procedencia:

- **`Editor.tsx` (seeds de `format`)** — settings-derived: pasa `keepMp3Sources` (nuevo
  campo del settings context). Con la regla activa un mp3 siembra `format: 'mp3'`, y de
  ahí cuelgan la etiqueta del botón, el aviso in-place y lo que envía `onProcess`.
- **`useTrackProcessing.processOne`** — `keepMp3 ?? (formatOverride === undefined &&
  keepMp3Sources)`: un formato recibido por parámetro es explícito (el Editor ya sembró
  la regla); solo la rama que lee el setting la aplica. `processAll` fija
  `batchKeepMp3(...)` junto al `pinnedFormat` y lo pasa a cada `processOne`.
- **`useConfirmFlows.askConvertAll`** — mismo `batchKeepMp3(...)` hacia
  `risksLossyReencode`/`reencodesLossyInPlace`.
- **`commands.ts` (add-apple-music)** — settings-derived: pasa `keepMp3Sources`.
- **`main/processTrack`** (guardia `job.format ?? …`) — settings-derived: pasa
  `settings.keepMp3Sources`.

### Override explícito gana

En single-select la mecánica del seed lo resuelve sola: la regla siembra `format: 'mp3'`,
y un pick del menú lo sustituye por un formato concreto que viaja tal cual — un MP3 con
pick AIFF se convierte a AIFF aunque el setting esté activo. En multi-selección la
procedencia es por valor (`batchKeepMp3`): un pick distinto del setting es explícito y
desactiva la regla para el lote; un pick igual al setting es indistinguible del seed y la
mantiene — corner inocuo, porque ese pick tampoco cambia nada hoy. Elección explícita >
regla global, igual que con "Same as source".

### Botón

Sin cambios en `exportButtonLabel` ni claves i18n nuevas: al sembrar `format: 'mp3'`, la
precedencia existente de la etiqueta (in-place gana a convert) muestra **"Update"** /
**"Update + Apple Music"**, que es exactamente lo que va a pasar — tags reescritos sobre
el original. El botón sigue siendo el contrato visible; la regla nunca cambia nada en
secreto.

- En multi-selección la etiqueta genérica ("Convert All…") no cambia; la regla se aplica
  por track al procesar.
- El check verde del menú de formatos marca el formato realmente exportado, que con la
  regla activa será MP3 — ya funciona así porque lee el output real.

### Settings UI

- `Settings.keepMp3Sources: boolean` en `shared/types.ts`, default `false` en
  `main/settings.ts`. Sin normalizador en `mergeSettings`: los booleanos se fusionan por
  spread, mismo tratamiento que el resto.
- `ResolvedSettings` + `DEFAULTS` en `renderer/src/lib/settingsContext.tsx` (el Editor
  lee Settings del context, no de props).
- `SyncedDraft` + `pickSynced` en `renderer/src/lib/settingsDraft.ts`.
- `SettingsCheckboxField` en `ConversionTab`, visible solo con formato lossless.
- i18n: `settings.keepMp3Sources` ("Keep MP3 files as MP3") y
  `settings.keepMp3SourcesHint` (convertir MP3 a lossless no recupera calidad y solo
  ocupa más; con esto activo los tags se actualizan sobre el original, sin conversión)
  en los 5 locales.

## Interacciones con lo existente

- **Filtros de audio (normalize / trim / declick)** — fuerzan re-encode, así que con la
  regla activa un MP3 se recodifica MP3→MP3, que sí pierde calidad. Es el mismo caso que
  ya cubre el aviso `risksLossyReencode` de `useConfirmFlows`. En single-select se
  dispara sin cambios (le llega el `'mp3'` sembrado); en lote se dispara vía el
  parámetro `keepMp3` de `reencodesLossyInPlace`. Verificado con test en ambas capas.
- **Destinos** — sin interacción. `format: 'mp3'` pasa todos los gates (Apple Music
  acepta MP3). `editsInPlace` y la confirmación de overwrite funcionan igual que cuando
  el usuario exporta MP3→MP3 hoy.
- **"Same as source"** — con `outputFormat: 'source'` el checkbox no se muestra y la
  regla no actúa (un `.mp3` ya sale como `'mp3'`). Los dos ajustes no entran en
  conflicto.

## Tests

Sobre `resolveJobFormat` y compañía (`shared/format.test.ts`):

- `.mp3` + keep → `'mp3'` para cada setting lossless (`aiff`, `wav`, `flac`, `alac`) y
  para `'source'`
- `.mp3` + keep apagado → formato intacto
- fuente no-mp3 (`.flac`, `.wav`, `.m4a`, `.ogg`) + keep → formato intacto
- `reencodesLossyInPlace` con setting lossless + `.mp3` + filtro activo + keep → `true`
- `batchKeepMp3`: `undefined` y valor igual al setting → `true`; valor distinto →
  `false`; setting apagado → siempre `false`

Integración (`useTrackProcessing.test.tsx`) — encierran el porqué:

- lote mixto MP3 + FLAC con export AIFF y keep activo → job del MP3 sale `'mp3'`, job
  del FLAC sale `'aiff'`: conversión selectiva, que es lo que "Same as source" no puede
  expresar
- lote con pick explícito distinto del setting (`'wav'`) y keep activo → el MP3 también
  sale `'wav'`: el override del lote gana
- `processOne` con formato explícito `'aiff'` sobre un MP3 y keep activo → job `'aiff'`

Aviso lossy en lote (`useConfirmFlows.test.tsx`): setting `aiff` + keep + mp3 + filtro
activo → `askConvertAll` abre el diálogo de re-encode lossy.

Etiqueta (`Editor.test.tsx`): fuente mp3 + keep + setting `aiff` → el botón dice
"Update" (mismo modelo que el test existente de formato coincidente).

UI (`ConversionTab.test.tsx`): checkbox visible con `aiff`, oculto con `mp3` y `source`.

## Alternativas descartadas

**Skip siempre, sin setting.** Convertir lossy→lossless nunca aporta, pero hay usuarios
que quieren todo en un único formato (equipos que no leen MP3, bibliotecas homogéneas).
Cambiarles el comportamiento en silencio rompe expectativas; opt-in explícito.

**Override por track en el dropdown, sin setting global.** Más control puntual, pero hay
que acordarse en cada export; la molestia que motiva la feature es precisamente el caso
por defecto.

**Aplicar también a AAC/OGG/Opus.** Ver "Alcance: solo MP3".
