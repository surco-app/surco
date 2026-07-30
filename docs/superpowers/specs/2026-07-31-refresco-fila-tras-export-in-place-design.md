# Refresco de la fila tras un export in-place

## Problema

Un usuario informa de que, al aplicar metadatos, la fila del panel izquierdo no
refleja los cambios: ni el título ni la carátula. Pide que la lista "se refresque".

El reporte mezcla dos comportamientos distintos, y solo uno es un fallo.

### Lo que hace hoy el código

Aplicar un match de Discogs **no escribe en disco**. `selectTrack`
(`Editor.tsx:519`) construye un parche y lo pasa a `updateTrack`, que actualiza
el estado de React. El único IPC es un contador de telemetría. La escritura real
ocurre en un paso posterior y separado: convertir (`process:track`).

De ahí que la fila cambie solo a medias al aplicar:

| Campo de la fila | Origen | ¿Cambia al aplicar? |
|---|---|---|
| Artista | `t.meta.artist` | Sí — meta viva |
| Título | `t.listLabel` | No — congelado a propósito |
| Carátula | `t.embeddedCover` | No — solo se escribe `coverUrl` |

`listLabel` está congelado por contrato explícito (`types.ts:35`): la fila es una
referencia estable, y editar el formulario de la derecha nunca renombra la fila.
`embeddedCover` es, también por contrato (`CoverPicker.tsx:110`), el arte propio
del fichero: los matches solo tocan `coverUrl`.

### El fallo real

Ambos contratos son correctos mientras el fichero de disco no cambie. Dejan de
serlo tras un export **in-place**, que reescribe el fichero original con los
metadatos nuevos y puede renombrarlo. A partir de ese instante la fila describe
un fichero que ya no existe con ese nombre ni con esa carátula.

`exportedPatch` (`export.ts:44-52`) ya repunta `inputPath` y `fileName` en ese
caso, pero no toca `listLabel`, `embeddedCover`, `embeddedCoverDims` ni
`duration`.

## Alcance

Tras un export in-place, releer el fichero y actualizar cuatro campos de la fila:

- `listLabel`
- `embeddedCover`
- `embeddedCoverDims`
- `duration`

### Fuera de alcance

- **Destinos distintos del original** (`folder`, `beside`, Apple Music, Engine
  DJ). La original no se modificó; refrescar su fila sería mentir.
- **Refrescar al aplicar el match.** No hay nada escrito en disco que reflejar.
- **El panel derecho.** Ni `meta`, ni `coverUrl`, ni `diskSignature`, ni el
  indicador de cambios sin guardar.
- **El contrato de `listLabel` durante la edición.** Sigue congelado mientras se
  edita; se descongela solo en el instante en que el fichero de disco pasa a
  llamarse así.

## Diseño

### Señal

`result.inPlace`, devuelto por `processTrack` y documentado en
`shared/types.ts:610-638` como "el export coincidió con el formato de origen y
reescribió el fichero original en lugar de escribir una copia". Es la traducción
exacta de "el destino es la misma pista, fue un update".

### Punto de enganche

`useTrackProcessing.ts`, tras las líneas 274-275, donde ya se ramifica sobre
`result.inPlace` para desalojar las queries de análisis. Es el único lugar donde
el código sabe con certeza que el fichero original cambió.

El refresco va **después** de `updateTrack(id, exportedPatch(...))`, para que el
repunte de `inputPath`/`fileName` esté aplicado y el refresco no lo pise.

### Ruta a leer

`result.outputPath`, nunca `track.inputPath`: un export in-place con renombrado
deja el fichero en una ruta distinta de la que tenía la fila.

### Mecanismo

Una función nueva en `useTrackLibrary`, expuesta junto a `startOverTrack`:

1. `await window.api.readMeta(path)`
2. Derivar `listLabel` con la misma lógica que `loadTrackMeta`
   (`searchFromTags` → `s.title || fileName`), para que la fila quede etiquetada
   igual que si el fichero se acabara de importar
3. Aplicar el parche de cuatro campos vía `enqueueMetaPatch`, que agrupa los
   parches de un lote en un solo rewrite del array
4. `catch {}` vacío

No se reutiliza `loadTrackMeta`: arrastra `mergeReadMeta`, el overlay de
`restoredEdits` y `diskSignature`, que tocan el panel derecho.

No se reutiliza `startOverTrack`: crea un id nuevo, llama a `onForget` y remonta
el editor, con lo que el usuario perdería el match de Discogs justo después de
convertir.

### Fallo de lectura: silencioso

Si `readMeta` falla, la fila conserva sus valores y no se avisa. La conversión
fue correcta —el fichero se escribió— y el refresco es cosmético; un toast de
error tras una operación exitosa confunde más de lo que informa. En particular
**no** se marca `metaReadFailed`: el fichero está bien. "Empezar de nuevo" sigue
disponible como salida manual.

### Lotes: una lectura por pista

El refresco va detrás de cada conversión, no al final del lote. Las filas se
actualizan según avanza el trabajo. `readMeta` cachea en el proceso principal por
ruta+mtime (`analysisCache.ts:26`), y `enqueueMetaPatch` agrupa los parches, así
que el coste es una lectura por fichero ya convertido.

## Tests

En `apps/desktop` (ejecutados desde ahí, no filtrando por ruta desde la raíz).

1. **In-place refresca la fila** — `readMeta` devuelve título y carátula nuevos;
   la fila expone `listLabel` y `embeddedCover` nuevos.
2. **Destino distinto no refresca la fila** — con `inPlace === false`, los campos
   quedan intactos y no se lee el fichero para la fila. Protege la decisión de
   diseño frente a una reversión accidental.
3. **In-place con renombrado lee la ruta nueva** — `readMeta` recibe
   `result.outputPath`, no `track.inputPath`.
4. **Fallo de lectura es silencioso** — `readMeta` rechaza; la fila conserva sus
   valores, la conversión sigue reportada como correcta y la fila no queda
   marcada como ilegible.
5. **El panel derecho no se toca** — tras el refresco, `meta` y `diskSignature`
   siguen como los dejó `exportedPatch`.

## Verificación en la app

Con el skill `run-desktop`: convertir in-place una pista sin carátula con un
match de Discogs aplicado y comprobar que el thumbnail aparece en la fila. Es el
caso exacto del reporte.
