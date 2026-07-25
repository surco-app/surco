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
Renderer, al crear cada job    resolveJobFormat(...) → aplicar keep-mp3 → 'mp3' | picked
        ↓
IPC / ProcessJob               job.format: OutputFormat   ← siempre concreto
        ↓
Main (processTrack, ffmpeg)    sin cambios de comportamiento
```

## Arquitectura

### Función de resolución

Función pura en `shared/format.ts`, junto a `resolveJobFormat`:

```ts
applyKeepMp3(format: OutputFormat, inputPath: string, keep: boolean): OutputFormat
```

Devuelve `'mp3'` si `keep` y `format` es lossless (`format !== 'mp3'`) y `inputPath`
es `.mp3` (via `formatMatchesInput('mp3', inputPath)`); si no, devuelve `format` intacto.

### Puntos de aplicación

- **Renderer** — `useTrackProcessing`, inmediatamente después de `resolveJobFormat`, en
  el único sitio donde se calcula el formato del job. Con `pickedFormat === 'source'` la
  regla es inocua: un `.mp3` ya resuelve a `'mp3'`.
- **Main** — la guardia de `processTrack` (`job.format ?? resolveJobFormat(...)`) aplica
  el mismo helper en su rama de fallback, para que main y renderer decidan igual si un
  job llegara sin formato.

### Override explícito gana

La regla solo actúa cuando el formato viene del setting global. Si el usuario eligió un
formato en el menú del split-button (`formatOverride`), ese formato se respeta tal cual:
un MP3 con override AIFF se convierte a AIFF aunque el setting esté activo. En el call
site (`formatOverride ?? settings.outputFormat`) el helper se aplica únicamente a la rama
del setting. Elección explícita > regla global, igual que con "Same as source".

### Botón

`exportButtonLabel` gana una variante "keep": cuando el formato efectivo del track
seleccionado sale de la regla (fuente `.mp3` + setting activo + export lossless), el
split-button muestra **"Keep MP3 + Apple Music"** / **"Keep MP3 + Engine DJ"** /
**"Keep MP3"** en vez de "Convert to AIFF…". El botón es el contrato visible: la regla
nunca cambia nada en secreto.

- Claves i18n nuevas `editor.keep`, `editor.keepEngine`, `editor.keepNoMusic`, espejo de
  las `editor.convert*`, en los 5 locales.
- En multi-selección la etiqueta genérica ("Convert All…") no cambia; la regla se aplica
  por track al procesar.
- El check verde del menú de formatos marca el formato realmente exportado, que con la
  regla activa será MP3 — ya funciona así porque lee el output real.

### Settings UI

- `Settings.keepMp3Sources: boolean` en `shared/types.ts`, default en
  `main/settings.ts`, saneado implícito de `mergeSettings` (un valor corrupto no rompe:
  se normaliza a booleano o cae al default, mismo tratamiento que otros booleanos).
- `SyncedDraft` + `pickSynced` en `renderer/src/lib/settingsDraft.ts`.
- `SettingsCheckboxField` en `ConversionTab`, visible solo con formato lossless.
- i18n: `settings.keepMp3Sources` ("Keep MP3 files as MP3") y
  `settings.keepMp3SourcesHint` (convertir MP3 a lossless no mejora la calidad y ocupa
  más; con esto activo los MP3 se copian tal cual) en los 5 locales.

## Interacciones con lo existente

- **Filtros de audio (normalize / trim / declick)** — fuerzan re-encode, así que con la
  regla activa un MP3 se recodifica MP3→MP3, que sí pierde calidad. Es el mismo caso que
  ya cubre el aviso `risksLossyReencode` de `useConfirmFlows`; al llegarle
  `format: 'mp3'` con fuente `.mp3`, el aviso existente debe dispararse por esta vía sin
  cambios. Verificarlo con test.
- **Destinos** — sin interacción. `format: 'mp3'` pasa todos los gates (Apple Music
  acepta MP3). `editsInPlace` y la confirmación de overwrite funcionan igual que cuando
  el usuario exporta MP3→MP3 hoy.
- **"Same as source"** — con `outputFormat: 'source'` el checkbox no se muestra y la
  regla no actúa (un `.mp3` ya sale como `'mp3'`). Los dos ajustes no entran en
  conflicto.

## Tests

Sobre `applyKeepMp3` (`shared/format.test.ts`):

- `.mp3` + formato lossless + keep → `'mp3'`, para cada lossless (`aiff`, `wav`,
  `flac`, `alac`)
- `.mp3` + keep apagado → formato intacto
- fuente no-mp3 (`.flac`, `.wav`, `.m4a`, `.ogg`) + keep → formato intacto
- formato `'mp3'` + keep → `'mp3'` (no-op)

Integración (`useTrackProcessing.test.tsx`) — encierran el porqué:

- lote mixto MP3 + FLAC con export AIFF y keep activo → job del MP3 sale `'mp3'`, job
  del FLAC sale `'aiff'`: conversión selectiva, que es lo que "Same as source" no puede
  expresar
- `formatOverride: 'aiff'` sobre un MP3 con keep activo → job `'aiff'`: el override gana

Etiqueta (`exportLabel.test.ts` / `ExportButton.test.tsx`): fuente mp3 + keep + export
lossless → "Keep MP3 …"; fuente flac → "Convert to AIFF …".

Settings (`settings.test.ts`): default `false`; valor corrupto cae al default.
UI (`ConversionTab.test.tsx`): checkbox visible con `aiff`, oculto con `mp3` y `source`.

## Alternativas descartadas

**Skip siempre, sin setting.** Convertir lossy→lossless nunca aporta, pero hay usuarios
que quieren todo en un único formato (equipos que no leen MP3, bibliotecas homogéneas).
Cambiarles el comportamiento en silencio rompe expectativas; opt-in explícito.

**Override por track en el dropdown, sin setting global.** Más control puntual, pero hay
que acordarse en cada export; la molestia que motiva la feature es precisamente el caso
por defecto.

**Aplicar también a AAC/OGG/Opus.** Ver "Alcance: solo MP3".
