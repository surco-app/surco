// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readTraktorMarkers } from './traktor4'
import { buildTraktorTree, traktorCue } from './traktor4Fixture'
import { applyPatches, cuesToXml, findEntries, matchedPatchCount } from './traktorNml'

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
  it('emits every marker including the grid anchor, with its GRID child', () => {
    const xml = cuesToXml(
      buildTraktorTree([traktorCue('AutoGrid', 4, 143.38, 0), traktorCue('Drop', 0, 79672.64, 1)]),
      134.87,
    )

    expect(xml.match(/<CUE_V2/g)).toHaveLength(2)
    expect(xml).toContain('TYPE="4"')
    expect(xml).toContain('START="143.380000"')
    expect(xml).toContain('<GRID BPM="134.870000">')
  })

  // El BPM se formatea igual que START: 6 decimales, como escribe Traktor.
  it('formats the GRID BPM with six decimals', () => {
    const xml = cuesToXml(buildTraktorTree([traktorCue('AutoGrid', 4, 143.38, 0)]), 128)

    expect(xml).toContain('<GRID BPM="128.000000">')
  })

  // Un marcador que no es grid nunca lleva hijo GRID, tenga o no bpm disponible.
  it('does not add a GRID child to a non-grid marker', () => {
    const xml = cuesToXml(buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)]), 128)

    expect(xml).not.toContain('<GRID')
  })

  // Sin bpm utilizable, un TYPE=4 sin GRID es una ancla muerta que Traktor
  // descarta en silencio (ground truth: _grid_anchors salta TYPE=4 sin GRID o
  // con BPM<=0). Escribirlo igual daría la falsa impresión de que la rejilla
  // quedó guardada. Mejor no emitir el marcador que emitir uno que parece
  // válido y no lo es.
  it('omits the grid marker entirely when no usable bpm is available', () => {
    const xml = cuesToXml(
      buildTraktorTree([traktorCue('AutoGrid', 4, 143.38, 0), traktorCue('Drop', 0, 79672.64, 1)]),
    )

    expect(xml.match(/<CUE_V2/g)).toHaveLength(1)
    expect(xml).not.toContain('TYPE="4"')
    expect(xml).toContain('NAME="Drop"')
  })

  // bpm no finito o <= 0 cuenta como "no utilizable", igual que ausente.
  it('omits the grid marker when bpm is zero, negative, or non-finite', () => {
    const tree = buildTraktorTree([traktorCue('AutoGrid', 4, 143.38, 0)])

    expect(cuesToXml(tree, 0)).not.toContain('TYPE="4"')
    expect(cuesToXml(tree, -5)).not.toContain('TYPE="4"')
    expect(cuesToXml(tree, Number.NaN)).not.toContain('TYPE="4"')
    expect(cuesToXml(tree, Number.POSITIVE_INFINITY)).not.toContain('TYPE="4"')
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

  // El borrado debe estar anclado a <INFO>, el único elemento en el que Traktor
  // escribe COVERARTID. Un comentario ANTES de INFO que contenga literalmente
  // `COVERARTID="..."` no es el atributo real y no debe tocarse: una sustitución
  // sin anclar (primera ocurrencia en cualquier parte del bloque, en vez de
  // "el COVERARTID que cuelga de INFO") se comería esto en vez del de INFO.
  it('only strips COVERARTID from the INFO element, not an earlier lookalike string', () => {
    const withDecoy = NML.replace(
      '<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A">',
      '<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A">' +
        '<!-- decoy COVERARTID="999/ZZZ" --><INFO COVERARTID="042/ABC" BITRATE="1411"></INFO>',
    )

    const out = applyPatches(withDecoy, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', clearCoverArt: true },
    ])

    expect(out).toContain('COVERARTID="999/ZZZ"')
    expect(out).not.toContain('COVERARTID="042/ABC"')
  })

  // Lo esencial del enfoque por texto: una pista que no está en la colección no
  // produce ningún cambio. Ni una coma del documento del usuario se mueve. El
  // volume y el dir difieren cada uno por separado para que un guard que sólo
  // comprobara uno de los dos (una regresión real) no lo dejara pasar sin más.
  it('leaves the document byte-for-byte identical when nothing matches', () => {
    expect(applyPatches(NML, [{ volume: 'Otro', dir: '/:Musica/:', file: 'uno.aiff' }])).toBe(NML)
    expect(applyPatches(NML, [{ volume: 'Macintosh HD', dir: '/:X/:', file: 'uno.aiff' }])).toBe(
      NML,
    )
  })

  // El caso central de la feature: una pista que hasta ahora no tenía cues en
  // Traktor recibe las suyas. Si el reemplazo depende de que ya exista un
  // CUE_V2 previo que sustituir, esta ENTRY se queda muda para siempre.
  it('writes cues into an entry that had none before', () => {
    const tree = buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)])

    const out = applyPatches(NML, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', cueTree: tree },
    ])

    expect(out).toContain('<CUE_V2')
    expect(out).toContain('NAME="Drop"')
  })

  // Los CUE_V2 existentes pueden no ser un único tramo contiguo (otro elemento del
  // esquema, aquí simulado con un comentario, se cuela entre dos de ellos). Una
  // sustitución no-global sólo se lleva la primera tanda: la segunda sobrevive
  // duplicada junto a las nuevas. Deben desaparecer todas.
  it('replaces every CUE_V2 even when they are not one contiguous run', () => {
    const withSplitCues = NML.replace(
      '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>',
      '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>' +
        '<CUE_V2 NAME="Old1" DISPL_ORDER="0" TYPE="0" START="1000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="0"></CUE_V2>' +
        '<!-- gap --><CUE_V2 NAME="Old2" DISPL_ORDER="0" TYPE="0" START="2000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2>',
    )
    const tree = buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)])

    const out = applyPatches(withSplitCues, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', cueTree: tree },
    ])

    expect(out).not.toContain('Old1')
    expect(out).not.toContain('Old2')
    expect(out.match(/<CUE_V2/g)).toHaveLength(1)
    expect(out).toContain('NAME="Drop"')
  })

  // Hallazgo crítico 2: traktor_nml_cleaner.py (herramienta propia del usuario)
  // serializa con ElementTree, que auto-cierra los elementos vacíos —
  // `<LOCATION ... />` en vez de `<LOCATION ...></LOCATION>`. El ancla de cues
  // buscaba literalmente `</LOCATION>`, que no existe en ese caso: applyPatches
  // devolvía el documento sin tocar y el caller reportaba "no-matches" (lee como
  // "Traktor no tiene esta pista") en vez de escribir los cues.
  it('inserts cues after a self-closing LOCATION element', () => {
    const selfClosing = NML.replace(
      '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>',
      '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD" />',
    )
    const tree = buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)])

    const out = applyPatches(selfClosing, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', cueTree: tree },
    ])

    expect(out).toContain('<CUE_V2')
    expect(out).toContain('NAME="Drop"')
  })

  // Mismo hallazgo, la otra mitad: un CUE_V2 viejo auto-cerrado (`<CUE_V2 ... />`)
  // no lo alcanza la regex de borrado (que exige `</CUE_V2>`), así que sobrevive
  // junto a los recién escritos — cues duplicados en Traktor.
  it('removes an old self-closing CUE_V2 instead of leaving a duplicate', () => {
    const selfClosingCue = NML.replace(
      '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>',
      '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>' +
        '<CUE_V2 NAME="Old" DISPL_ORDER="0" TYPE="0" START="1000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="0" />',
    )
    const tree = buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)])

    const out = applyPatches(selfClosingCue, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', cueTree: tree },
    ])

    expect(out).not.toContain('Old')
    expect(out.match(/<CUE_V2/g)).toHaveLength(1)
    expect(out).toContain('NAME="Drop"')
  })

  // El caso ya cubierto arriba ('writes cues into an entry that had none before',
  // etc.) usa siempre el par abierto/cerrado — se deja constancia aquí de que el
  // fix de las dos pruebas anteriores no puede depender de asumir SIEMPRE
  // auto-cierre: el documento con pares `></LOCATION>`/`></CUE_V2>` sigue
  // funcionando igual (ver 'replaces every CUE_V2 even when they are not one
  // contiguous run' y 'writes cues into an entry that had none before').

  // El fichero que Surco tiene en disco tras la conversión es el .flac; la ENTRY
  // de Traktor todavía apunta al .aiff viejo. El emparejado exacto (file === file)
  // no casa aquí — sólo lo hace el fallback por nombre base. Si alguien quitara
  // el fallback, este patch dejaría de encontrar la ENTRY y el test debe notarlo.
  it('matches via the base-name fallback when the patch already holds the converted file', () => {
    const out = applyPatches(NML, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.flac', newFile: 'uno.flac' },
    ])

    expect(out).toContain('FILE="uno.flac"')
    expect(out).not.toContain('FILE="uno.aiff"')
  })

  // El nombre real en disco lleva un '&' literal, pero el XML lo guarda escapado
  // como &amp;. La lectura debe decodificarlo para que el emparejado con la ruta
  // del filesystem siga funcionando en vez de fallar en silencio.
  it('matches a file name containing an ampersand written as an XML entity', () => {
    const withAmpersand = NML.replace('FILE="uno.aiff"', 'FILE="uno&amp;dos.aiff"')

    const out = applyPatches(withAmpersand, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno&dos.aiff', newFile: 'uno&dos.flac' },
    ])

    expect(out).toContain('FILE="uno&amp;dos.flac"')
  })

  // Sustitución de atrás hacia adelante: si dos ENTRY se parchean y la primera
  // cambia de longitud (nombre de fichero más largo), un bucle de-adelante-hacia-
  // atrás desplazaría los índices ya calculados para la segunda y corrompería su
  // FILE. Aquí "uno.aiff" (8) pasa a "uno-largo-convertido.flac" (25), y luego
  // "dos.flac" debe seguir intacto.
  it('patches multiple entries whose block lengths change without corrupting later spans', () => {
    // Cada ENTRY lleva su propio INFO y crece al parchearse: si un patch posterior
    // no cambiara bytes, escribir su bloque sobre un rango ya desplazado devolvería
    // el mismo texto y el test no distinguiría un bucle correcto de uno roto.
    const three = `<NML VERSION="19"><COLLECTION ENTRIES="3">
<ENTRY TITLE="Uno"><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION><INFO COVERARTID="1/A" BITRATE="1411"></INFO></ENTRY>
<ENTRY TITLE="Dos"><LOCATION DIR="/:M/:" FILE="dos.aiff" VOLUME="HD"></LOCATION><INFO COVERARTID="2/B" BITRATE="1411"></INFO></ENTRY>
<ENTRY TITLE="Tres"><LOCATION DIR="/:M/:" FILE="tres.aiff" VOLUME="HD"></LOCATION><INFO COVERARTID="3/C" BITRATE="1411"></INFO></ENTRY>
</COLLECTION></NML>`
    const grow = (file: string, newFile: string) => ({
      volume: 'HD',
      dir: '/:M/:',
      file,
      newFile,
      clearCoverArt: true,
    })

    const out = applyPatches(three, [
      grow('uno.aiff', 'uno-nombre-mucho-mas-largo-tras-convertir.flac'),
      grow('dos.aiff', 'dos-nombre-mucho-mas-largo-tras-convertir.flac'),
      grow('tres.aiff', 'tres-nombre-mucho-mas-largo-tras-convertir.flac'),
    ])

    expect(out).toContain('FILE="uno-nombre-mucho-mas-largo-tras-convertir.flac"')
    expect(out).toContain('FILE="dos-nombre-mucho-mas-largo-tras-convertir.flac"')
    expect(out).toContain('FILE="tres-nombre-mucho-mas-largo-tras-convertir.flac"')
    expect(out).not.toContain('COVERARTID')
    expect(out).toContain('TITLE="Tres"')
    expect(out).toContain('BITRATE="1411"')
  })

  // Guardarraíl del hallazgo crítico 1: una ENTRY con una rejilla guardada
  // (TYPE=4 con GRID real) no puede perderla sólo porque el patch que le toca
  // llega sin bpm. cuesToXml omite el TYPE=4 sin bpm, y replaceCues borraba TODOS
  // los CUE_V2 antes de insertar — la rejilla existente desaparecía sin que nada
  // lo señalara. La rejilla vieja debe seguir presente después del patch.
  it('does not delete an existing beatgrid when the patch cue tree has no usable bpm', () => {
    const withGrid = NML.replace(
      '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>',
      '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>' +
        '<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="143.380000" LEN="0.000000" ' +
        'REPEATS="-1" HOTCUE="0"><GRID BPM="128.000000"></GRID></CUE_V2>',
    )
    const tree = buildTraktorTree([
      traktorCue('AutoGrid', 4, 143.38, 0),
      traktorCue('Drop', 0, 79672.64, 1),
    ])

    const out = applyPatches(withGrid, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', cueTree: tree },
    ])

    expect(out).toContain('<GRID BPM="128.000000">')
  })

  // La rejilla rescatada se saca del propio documento y se reinserta. Pasarla como
  // string de reemplazo hacía que String.replace expandiera $&, $` y $' dentro de
  // ella, empalmando texto del documento en el elemento: un cue con un dólar en el
  // nombre acababa escribiendo XML inválido en la colección. Ese nombre lo teclea el
  // DJ, así que es dato del usuario, no un caso de laboratorio.
  it('keeps a rescued grid intact when its cue name contains replacement patterns', () => {
    const named = "$&amp; Beat $` $' $1"
    // El fixture se construye por concatenación, nunca con NML.replace(): el
    // reemplazo por string expandiría estos mismos $& y $` al montarlo, y el test
    // acabaría midiendo la corrupción de su propio andamiaje en vez de la del
    // código bajo prueba.
    const withGrid =
      '<NML><COLLECTION>' +
      '<ENTRY TITLE="Uno"><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION>' +
      `<CUE_V2 NAME="${named}" DISPL_ORDER="0" TYPE="4" START="143.380000" LEN="0.000000" ` +
      'REPEATS="-1" HOTCUE="0"><GRID BPM="128.000000"></GRID></CUE_V2>' +
      '</ENTRY></COLLECTION></NML>'
    // Con un cue normal además del grid, el bloque sí cambia y el rescate se
    // reinserta de verdad; un árbol sólo-grid sin bpm no toca nada (ver el test
    // anterior) y no ejercitaría la reinserción.
    const tree = buildTraktorTree([
      traktorCue('AutoGrid', 4, 143.38, 0),
      traktorCue('Drop', 0, 79672.64, 1),
    ])

    const out = applyPatches(withGrid, [
      { volume: 'HD', dir: '/:M/:', file: 'uno.aiff', cueTree: tree },
    ])

    expect(out).toContain(`NAME="${named}"`)
    expect(out).not.toContain('NAME="$&amp; Beat <')
    expect(out).toContain('<GRID BPM="128.000000">')
  })

  // El mismo caso desde matchedPatchCount/syncCollection: si la rejilla se
  // conserva no tocando el patch, éste no puede seguir contando como aplicado —
  // el caller reportaría éxito sin haber escrito nada de lo que el patch pedía.
  it('does not count a cue patch as matched when its grid could not be written safely', () => {
    const withGrid = NML.replace(
      '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>',
      '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>' +
        '<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="143.380000" LEN="0.000000" ' +
        'REPEATS="-1" HOTCUE="0"><GRID BPM="128.000000"></GRID></CUE_V2>',
    )
    const tree = buildTraktorTree([traktorCue('AutoGrid', 4, 143.38, 0)])

    const count = matchedPatchCount(withGrid, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', cueTree: tree },
    ])

    expect(count).toBe(0)
  })

  // Caso minimizado del re-review: dos patches pueden casar la misma ENTRY, uno por
  // nombre base y otro exacto. La regla siempre fue "gana el primero del array", no
  // "gana el tipo de match más fuerte" — el índice por mapas tiene que preservar eso
  // o el orden en que el caller construyó el batch deja de importar en silencio.
  it('prefers the first patch in array order over a stronger match kind later in the array', () => {
    const nml =
      '<NML VERSION="19"><COLLECTION ENTRIES="1">' +
      '<ENTRY TITLE="X"><LOCATION DIR="/:M/:" FILE="x&amp;y.mp3" VOLUME="HD"></LOCATION></ENTRY>' +
      '</COLLECTION></NML>'

    const out = applyPatches(nml, [
      { volume: 'HD', dir: '/:M/:', file: 'x&y.aiff', newFile: 'FROM_A.flac' },
      { volume: 'HD', dir: '/:M/:', file: 'x&y.mp3', clearCoverArt: true },
    ])

    expect(out).toContain('FILE="FROM_A.flac"')
  })

  // Mismo par de patches, orden invertido: ahora el match exacto va primero en el
  // array y debe ganar — confirma que el resultado depende del orden del array, no
  // de qué mapa (byFile vs byBaseName) resolvió el match.
  it('prefers the exact match when it is first in array order', () => {
    const nml =
      '<NML VERSION="19"><COLLECTION ENTRIES="1">' +
      '<ENTRY TITLE="X"><LOCATION DIR="/:M/:" FILE="x&amp;y.mp3" VOLUME="HD"></LOCATION></ENTRY>' +
      '</COLLECTION></NML>'

    const out = applyPatches(nml, [
      { volume: 'HD', dir: '/:M/:', file: 'x&y.mp3', clearCoverArt: true },
      { volume: 'HD', dir: '/:M/:', file: 'x&y.aiff', newFile: 'FROM_A.flac' },
    ])

    expect(out).not.toContain('FILE="FROM_A.flac"')
    expect(out).toContain('FILE="x&amp;y.mp3"')
  })
})

describe('matchedPatchCount', () => {
  // Dos patches contendiendo por la misma ENTRY sólo aplican uno (el primero en el
  // array): el conteo tiene que reflejar eso, no "cuántos patches podrían casar".
  it('counts one match when two patches contend for the same entry', () => {
    const nml =
      '<NML VERSION="19"><COLLECTION ENTRIES="1">' +
      '<ENTRY TITLE="X"><LOCATION DIR="/:M/:" FILE="x&amp;y.mp3" VOLUME="HD"></LOCATION></ENTRY>' +
      '</COLLECTION></NML>'

    const count = matchedPatchCount(nml, [
      { volume: 'HD', dir: '/:M/:', file: 'x&y.aiff', newFile: 'FROM_A.flac' },
      { volume: 'HD', dir: '/:M/:', file: 'x&y.mp3', clearCoverArt: true },
    ])

    expect(count).toBe(1)
  })
})
