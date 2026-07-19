# Inspector de metadatos foráneos + arreglo del borrado (Fase 1)

Fecha: 2026-07-19

## Problema

Los usuarios se quejan de que "borrar todo" (el borrador 🧹 de la cabecera del editor,
`clear-meta-btn`, tooltip "Empty every metadata field") no borra realmente todos los
metadatos. En ficheros exportados sobreviven tags de aplicaciones de terceros:
`SERATO_MARKERS_V2`, `TRAKTOR4`, `BEATGRID`, `CUEPOINTS`, `MUSICBRAINZ_*`,
`ACOUSTID_*`, `REPLAYGAIN_*`, etc.

### Causa raíz (confirmada)

Dos fallos entrelazados:

1. **La app no lee los tags foráneos.** `tagsFromProbe` (`apps/desktop/src/main/ffmpeg.ts:170`)
   solo itera `TAG_FIELDS` y descarta cualquier tag que no esté en esa whitelist de ~24
   campos gestionados. Los foráneos se leen con ffprobe pero se tiran; la app nunca los
   tiene en memoria.

2. **Rellenar un campo cancela la intención de borrado.** "Borrar todo" no escribe en disco:
   solo marca `metaCleared: true` en el track. Ese flag viaja al export como
   `clearExtras: true`, que es lo que activa el borrado total. Pero `Editor.tsx:500` pone
   `metaCleared: false` en cuanto el usuario edita **cualquier** campo. Flujo real del usuario:
   pulsa borrar todo → rellena título → `metaCleared` se apaga → exporta con
   `clearExtras: false` → ffmpeg usa `-map_metadata 0` (default) → **re-copia todos los
   foráneos del original.** Ese es el bug de las capturas.

### Verificación empírica

Con ffmpeg real, un FLAC sembrado con SERATO_MARKERS_V2, TRAKTOR4, BEATGRID, CUEPOINTS,
MUSICBRAINZ, ACOUSTID, REPLAYGAIN, ENERGYLEVEL, al pasar por `-map_metadata -1` (lo que
`convertArgs` produce con `clearExtras`) queda **completamente limpio** (solo sobrevive
`encoder=Lavf`, que la app ya silencia con `+bitexact`). El mecanismo de borrado total
funciona; el fallo está en que la intención no llega al export.

## Modelo de comportamiento deseado

| Acción del usuario | Fichero exportado |
|---|---|
| No toca borrar, edita campos | Campos editados + **todos los foráneos intactos** (ya funciona: `-map_metadata 0`) |
| No toca borrar, borra tags sueltos en el inspector | Campos + foráneos **menos los que quitó** |
| Pulsa "borrar todo", luego rellena | **Solo lo que rellenó.** Cero foráneos, cero cues DJ (`-map_metadata -1`) |

El borrado actúa **al exportar** (intención en memoria), no de forma destructiva inmediata
sobre el original. Reversible con deshacer.

## Decisiones de alcance

- **Fase 1 = ver + borrar.** Editar valores y añadir tags nuevos quedan para fase 2. Motivo:
  editar es seguro en FLAC (Vorbis comments = texto) pero arriesgado en ID3 (blobs binarios
  GEOB/PRIV de Serato/Traktor mostrados como base64 truncado, fáciles de corromper). Hoy la
  app deliberadamente no parsea esos blobs (`tags.ts:112`).
- **"Borrar todo" = todo, cues DJ incluidos.** Coincide con la expectativa de las capturas
  ("fichero limpio de verdad"). Elimina la lógica de preservación de cues en la ruta de
  borrado. La conversión normal (sin borrar) **sigue** preservando cues de Traktor.
- **Inspector solo en pista única.** En bulk, solo el botón global "borrar todo" (ya funciona
  sobre todas las seleccionadas).

## Diseño

### 1. Leer todos los metadatos al cargar

`readTags` (`ffmpeg.ts:221`) produce, además del `TrackMetadata` gestionado, un
`foreignTags: { name: string; value: string }[]`: todos los pares nombre=valor del probe
cuyo nombre (en minúsculas) no coincide con ningún alias de `TAG_FIELDS`. Se excluyen:

- El `encoder` de ffmpeg.
- La descripción de la carátula (ya filtrada hoy vía el stream de vídeo, `ffmpeg.ts:171-176`).

Los valores pueden venir truncados por ffprobe en blobs enormes; se muestran tal cual
(solo lectura). Se borra por **nombre**, no por valor, así que el truncado no afecta a
fase 1. `foreignTags` viaja al renderer y se guarda en el `TrackItem`.

### 2. Inspector (toggle desplegable)

- Ubicación: bajo los campos visibles del editor.
- Toggle "Metadatos avanzados (N)", con N = número de foráneos. Si N=0, no aparece.
- Solo cuando hay **una** pista seleccionada.
- Al abrir: lista `NOMBRE = valor` en solo lectura, valor truncado con elipsis si es largo.
- Cada fila con una **X** para borrar ese tag individualmente → el nombre entra en
  `foreignRemoved: string[]` del track. La fila se marca borrada. Reversible con deshacer.
- Sin trato especial para cues DJ (coherente con "borrar todo = todo").
- Al pulsar el botón global "borrar todo", el inspector queda vacío (todos marcados borrados).
- `data-testid`: `foreign-tags-toggle`, `foreign-tags-list`, `foreign-tag-remove`.

### 3. Arreglo de la semántica de borrado

- **`metaCleared` deja de apagarse al editar campos.** `Editor.tsx:500` ya no lo pone en
  `false`. La intención "borrar todo" persiste hasta que el usuario la desactive
  explícitamente o deshaga.
- Rellenar campos gestionados es una intención independiente que ya no toca `metaCleared`.
- **M4A: "borrar todo" pasa a eliminar foráneos.** Hoy la rama early-return de `tags.ts:263`
  no tiene bucle de limpieza, así que los atoms foráneos sobreviven. Se añade el borrado
  para que M4A respete `clearExtras`.
- **Borrado individual (`foreignRemoved`)** es la escritura nueva, aplicada siempre (haya o
  no `clearExtras`):
  - FLAC (ffmpeg): por cada nombre, `-metadata NOMBRE=` que lo vacía.
  - ID3 (TagLib): eliminar el frame por nombre.
- **Simplificación:** la lógica de preservar cues (`isTraktorCue`, filtro en `tags.ts:286`,
  re-inyección en la ruta de borrado) se elimina del camino de `clearExtras`. NO se toca la
  preservación de cues en la conversión normal (`copyCueFrames`, cueSource).

### 4. Bulk

- "Borrar todo" en bulk: marca `metaCleared: true` en todas las seleccionadas (ya lo hace
  `onClearExtras`, `App.tsx:1068`).
- El inspector no aparece en bulk (solo pista única).

## Testing (TDD)

Main:
- Lector: probe con foráneos → aparecen en `foreignTags`; gestionados y `encoder` no.
- **Regresión del bug** (clave): "borrar todo → rellenar título" → export con `clearExtras`
  activo. Hoy fallaría (fase roja).
- Borrado individual: `foreignRemoved: ['SERATO_MARKERS_V2']` → FLAC produce
  `-metadata SERATO_MARKERS_V2=`; ID3 elimina el frame.
- M4A: "borrar todo" elimina atoms foráneos.
- E2E con ffmpeg real (FLAC): seed con foráneos → clear → fichero sin foráneos.

Renderer:
- Toggle aparece solo con N>0 y pista única.
- Click en X marca el tag en `foreignRemoved`.
- "Borrar todo" vacía la lista del inspector.

## Fuera de alcance (fase 2)

- Editar valores de tags foráneos.
- Añadir tags nuevos con nombre libre.
- Inspector combinado en bulk con conteos por fichero.
