// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readTraktorMarkers } from './traktor4'
import { buildTraktorTree, traktorCue } from './traktor4Fixture'
import { applyPatches, cuesToXml, findEntries } from './traktorNml'

const NML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<NML VERSION="19">
<COLLECTION ENTRIES="2">
<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A">
<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>
</ENTRY>
<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Dos" ARTIST="B">
<LOCATION DIR="/:Musica/:" FILE="dos.flac" VOLUME="Macintosh HD"></LOCATION>
</ENTRY>
</COLLECTION>
</NML>`

describe('findEntries', () => {
  // El emparejado por ruta necesita VOLUME+DIR+FILE de cada ENTRY, y los índices
  // exactos del bloque para poder sustituirlo sin tocar el resto del documento.
  it('reads each entry location and its span in the text', () => {
    const entries = findEntries(NML)

    expect(entries).toHaveLength(2)
    expect(entries[0].file).toBe('uno.aiff')
    expect(entries[0].dir).toBe('/:Musica/:')
    expect(entries[0].volume).toBe('Macintosh HD')
    expect(NML.slice(entries[0].start, entries[0].end)).toContain('TITLE="Uno"')
    expect(NML.slice(entries[0].start, entries[0].end)).not.toContain('TITLE="Dos"')
  })

  // Un NML sin colección (o con una vacía) es válido: no hay nada que emparejar.
  it('returns nothing for a collection with no entries', () => {
    expect(findEntries('<NML VERSION="19"><COLLECTION ENTRIES="0"></COLLECTION></NML>')).toEqual([])
  })
})

describe('cuesToXml', () => {
  // La traducción binario→XML es la pieza nueva: el fichero guarda un árbol y el NML
  // elementos <CUE_V2>. START va en milisegundos con 6 decimales, como escribe Traktor.
  it('emits one CUE_V2 element per marker, with millisecond positions', () => {
    const tree = buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)])

    const xml = cuesToXml(tree)

    expect(xml).toContain('<CUE_V2')
    expect(xml).toContain('NAME="Drop"')
    expect(xml).toContain('HOTCUE="1"')
    expect(xml).toContain('START="79672.640000"')
  })

  // Un árbol sin marcadores no debe producir un CUE_V2 vacío que Traktor luego lea
  // como un cue en el segundo 0.
  it('emits nothing for a tree with no markers', () => {
    expect(cuesToXml(buildTraktorTree([]))).toBe('')
  })

  // Varios marcadores, incluido el grid (TYPE=4): salen todos, en orden, y el grid
  // conserva su valor tal cual — es fase, no una posición que haya que corregir.
  it('emits every marker including the grid anchor', () => {
    const xml = cuesToXml(
      buildTraktorTree([traktorCue('AutoGrid', 4, 143.38, 0), traktorCue('Drop', 0, 79672.64, 1)]),
    )

    expect(xml.match(/<CUE_V2/g)).toHaveLength(2)
    expect(xml).toContain('TYPE="4"')
    expect(xml).toContain('START="143.380000"')
  })
})

describe('readTraktorMarkers', () => {
  // La lectura comparte recorrido con shiftTraktorCues: un árbol que no es TRMD (o
  // viene corrupto) no debe lanzar, sino declarar que no hay marcadores que copiar.
  it('returns nothing for a tree that is not a valid TRMD', () => {
    expect(readTraktorMarkers(new Uint8Array([1, 2, 3, 4]))).toEqual([])
  })

  it('reads each marker back out of the tree', () => {
    const markers = readTraktorMarkers(buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)]))

    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ name: 'Drop', type: 0, hotcue: 1 })
    expect(markers[0].startMs).toBeCloseTo(79672.64)
  })
})

describe('applyPatches', () => {
  // El caso AIFF→FLAC: la ENTRY existe pero apunta al fichero viejo. Se reapunta
  // LOCATION para que la pista siga siendo UNA en Traktor, con sus playlists.
  it('repoints LOCATION when the conversion changed the extension', () => {
    const out = applyPatches(NML, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', newFile: 'uno.flac' },
    ])

    expect(out).toContain('FILE="uno.flac"')
    expect(out).not.toContain('FILE="uno.aiff"')
    expect(out).toContain('FILE="dos.flac"')
  })

  // COVERARTID es una referencia a la caché de carátulas de Traktor: mientras esté,
  // Traktor sigue mostrando la vieja aunque el fichero lleve otra imagen.
  it('drops COVERARTID so Traktor re-reads the artwork', () => {
    const withCover = NML.replace(
      '<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A">',
      '<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A"><INFO COVERARTID="042/ABC" BITRATE="1411"></INFO>',
    )

    const out = applyPatches(withCover, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', clearCoverArt: true },
    ])

    expect(out).not.toContain('COVERARTID')
    expect(out).toContain('BITRATE="1411"')
  })

  // Lo esencial del enfoque por texto: una pista que no está en la colección no
  // produce ningún cambio. Ni una coma del documento del usuario se mueve.
  it('leaves the document byte-for-byte identical when nothing matches', () => {
    expect(applyPatches(NML, [{ volume: 'Otro', dir: '/:X/:', file: 'nope.mp3' }])).toBe(NML)
  })
})
