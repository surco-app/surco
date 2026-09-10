// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readTraktorMarkers } from './traktor4'
import { buildTraktorTree, traktorCue } from './traktor4Fixture'
import {
  applyPatches,
  cuesToXml,
  findEntries,
  matchedPatchCount,
  refreshedCoverIds,
} from './traktorNml'

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

// Reported 07/09/2026, found by diffing the user's own backup against the collection
// Surco had written: the ONLY substantive change in the whole file was the grid tempo,
// 141.999619 -> 142.000000. Traktor had analysed the track to six decimals; meta.bpm is
// the rounded text of the BPM tag, and writing it over the analysed figure retunes the
// beatgrid. At 142 BPM that 0.000381 drifts about 7 ms across a five-minute track, which
// is the far end of the grid walking off the beat.
describe('grid tempo already in the collection', () => {
  const WITH_GRID = `<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Uno"><LOCATION DIR="/:M/:" FILE="uno.mp3" VOLUME="HD"></LOCATION>
<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="10.187472" LEN="0.000000" REPEATS="-1" HOTCUE="-1"><GRID BPM="141.999619"></GRID></CUE_V2>
</ENTRY>
</COLLECTION></NML>`

  const tree = buildTraktorTree([traktorCue('AutoGrid', 4, 10.187472, -1)])

  it('keeps the analysed tempo instead of the rounded tag value', () => {
    const out = applyPatches(WITH_GRID, [
      { volume: 'HD', dir: '/:M/:', file: 'uno.mp3', cueTree: tree, bpm: 142 },
    ])

    expect(out).toContain('BPM="141.999619"')
    expect(out).not.toContain('BPM="142.000000"')
  })

  // An entry Traktor never analysed has no tempo of its own, so the tag is the only
  // figure available and still has to be written — otherwise the grid marker is dropped
  // for lack of a BPM and the DJ loses the anchor entirely.
  it('falls back to the tag when the entry carries no grid tempo', () => {
    const noGrid = WITH_GRID.replace('<GRID BPM="141.999619"></GRID>', '')

    const out = applyPatches(noGrid, [
      { volume: 'HD', dir: '/:M/:', file: 'uno.mp3', cueTree: tree, bpm: 142 },
    ])

    expect(out).toContain('BPM="142.000000"')
  })

  // The DJ retyping the BPM field is the one case where the tag SHOULD win: they are
  // telling Surco the analysed figure is wrong. Only a value that differs beyond the
  // rounding counts, or every track whose tag reads 142 would overwrite its own 141.9996.
  it('takes the tag when the DJ typed a genuinely different tempo', () => {
    const out = applyPatches(WITH_GRID, [
      { volume: 'HD', dir: '/:M/:', file: 'uno.mp3', cueTree: tree, bpm: 128 },
    ])

    expect(out).toContain('BPM="128.000000"')
  })
})

// Reported 07/09/2026 from a controlled A/B against AudioFinder on a real 8,321-entry
// collection: after one FLAC->MP3 conversion Surco left 8,320 unique paths for 8,321
// entries — one duplicate — while AudioFinder left none. Traktor indexes by path, so
// every conversion added another clone, and the DJ's own broken collection had the same
// track three times over. The cause is repointing: the FLAC's entry gets its FILE
// rewritten to .mp3, and if the collection already holds an entry for that .mp3 there
// are now two, the repointed one still carrying the FLAC's BITRATE and FILESIZE.
// Reported 10/09/2026: a converted AIFF showed 2 stars in Traktor where the DJ had set
// 5. The file's own POPM byte was correct — Traktor was reading the stars from the
// collection, which Surco never updated, so the ENTRY kept whatever RANKING it had from
// the last analysis. The collection wins over the file for a track already in the
// library, which is the whole reason this NML sync exists.
//
// Traktor stores stars in INFO@RANKING on the same 0-255 scale as its POPM frame, 51 per
// star (see shared/rating.ts, where that scale is already relied on for the file side).
describe('star rating in the collection', () => {
  const RATED = `<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Scratch"><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION><INFO RANKING="102" BITRATE="1411000"></INFO></ENTRY>
</COLLECTION></NML>`

  const at = { volume: 'HD', dir: '/:M/:', file: 'uno.aiff' }

  it('writes the stars the DJ chose over the stale ranking', () => {
    const out = applyPatches(RATED, [{ ...at, ranking: 255 }])

    expect(out).toContain('RANKING="255"')
    expect(out).not.toContain('RANKING="102"')
  })

  // An ENTRY that never carried a rating still has to receive one, or setting stars on a
  // freshly imported track would silently do nothing.
  it('adds the ranking to an entry that has none', () => {
    const unrated = `<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Scratch"><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION><INFO BITRATE="1411000"></INFO></ENTRY>
</COLLECTION></NML>`

    const out = applyPatches(unrated, [{ ...at, ranking: 153 }])

    expect(out).toContain('RANKING="153"')
    expect(out).toContain('BITRATE="1411000"')
  })

  // Undefined is not zero: most patches carry no rating at all, and those must leave the
  // DJ's existing stars exactly where they are rather than clearing them to unrated.
  it('leaves the ranking alone when the patch carries none', () => {
    const out = applyPatches(RATED, [at])

    expect(out).toContain('RANKING="102"')
  })
})

// Reported 10/09/2026, with the collection in hand: converting Scratch.flac to
// Scratch.mp3 while keeping both left TWO ENTRY blocks carrying the same AUDIO_ID and
// COVERARTID. That coupled their artwork — changing the FLAC's cover changed the MP3's —
// and Traktor stopped opening until those two attributes were stripped from the MP3
// entry. Traktor identifies a track by AUDIO_ID and hangs its artwork off COVERARTID, so
// two files sharing them are one track as far as it is concerned.
//
// The rule, in the reporter's own words: a converted file that will COEXIST with its
// source inherits the musical metadata, cues, GRID and loops, but never the internal
// identity or the Traktor artwork. Only a real substitution keeps the identity and
// repoints LOCATION.
describe('identity of a converted file that coexists with its source', () => {
  const SHARED = `<NML VERSION="20"><COLLECTION ENTRIES="2">
<ENTRY MODIFIED_DATE="2026/9/10" TITLE="Scratch" AUDIO_ID="AYgFVndld3Vndmia"><LOCATION DIR="/:M/:" FILE="uno.flac" VOLUME="HD"></LOCATION><INFO COVERARTID="121/ZHCAA3BM" BITRATE="1042000"></INFO><CUE_V2 NAME="A" DISPL_ORDER="0" TYPE="0" START="1000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2></ENTRY>
<ENTRY MODIFIED_DATE="2026/9/10" TITLE="Scratch" AUDIO_ID="AYgFVndld3Vndmia"><LOCATION DIR="/:M/:" FILE="uno.mp3" VOLUME="HD"></LOCATION><INFO COVERARTID="121/ZHCAA3BM" BITRATE="320000"></INFO></ENTRY>
</COLLECTION></NML>`

  const patch = {
    volume: 'HD',
    dir: '/:M/:',
    file: 'uno.flac',
    outputVolume: 'HD',
    outputDir: '/:M/:',
    outputFile: 'uno.mp3',
    outputPath: '/M/uno.mp3',
  }

  // Slicing from FILE= would cut after the ENTRY tag that carries AUDIO_ID and measure
  // nothing; the whole block is what has to be inspected.
  function entryFor(nml: string, file: string): string {
    const at = nml.indexOf(`FILE="${file}"`)
    return nml.slice(nml.lastIndexOf('<ENTRY', at), nml.indexOf('</ENTRY>', at))
  }

  it('strips the inherited identity from the converted entry', () => {
    const out = applyPatches(SHARED, [patch])

    const mp3 = entryFor(out, 'uno.mp3')
    expect(mp3).not.toContain('AUDIO_ID')
    expect(mp3).not.toContain('COVERARTID')
  })

  // The source is still a real track with a valid cache entry: stripping ITS identity
  // would cost the DJ the artwork and analysis of a file nobody converted away.
  it('leaves the source entry untouched', () => {
    const out = applyPatches(SHARED, [patch])

    const flac = entryFor(out, 'uno.flac')
    expect(flac).toContain('AUDIO_ID="AYgFVndld3Vndmia"')
    expect(flac).toContain('COVERARTID="121/ZHCAA3BM"')
  })

  // Only the identity goes. Everything that makes the converted file playable the way
  // the DJ left it — cues, grid, loops, tags — is exactly what it was there to inherit.
  it('keeps the cues and tags it was meant to carry over', () => {
    const out = applyPatches(SHARED, [patch])

    expect(out).toContain('START="1000.000000"')
    expect(out).toContain('TITLE="Scratch"')
    expect(out).toContain('BITRATE="320000"')
  })

  // A substitution is the other operation entirely: one logical track that changed
  // format, so it keeps its identity and its LOCATION follows the file. Detaching there
  // would throw away the play counts and playlist membership of a track that still
  // exists — which is why this is decided by whether the two coexist, not by the
  // conversion having happened.
  it('keeps the identity when the source is not in the collection', () => {
    const onlyOne = `<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Scratch" AUDIO_ID="AYgFVndld3Vndmia"><LOCATION DIR="/:M/:" FILE="uno.flac" VOLUME="HD"></LOCATION><INFO COVERARTID="121/ZHCAA3BM"></INFO></ENTRY>
</COLLECTION></NML>`

    const out = applyPatches(onlyOne, [{ ...patch, newFile: 'uno.mp3' }])

    expect(out).toContain('AUDIO_ID="AYgFVndld3Vndmia"')
    expect(out).toContain('COVERARTID="121/ZHCAA3BM"')
    expect(out).toContain('FILE="uno.mp3"')
  })

  // The substitution already consumed: the collection holds the OUTPUT and no longer the
  // source, so this is one track that changed format and its identity is its own. A
  // guard that only asked "is the output present?" would strip it here — the source has
  // to be present too for the two to be coexisting files.
  // The source keeps a COVERARTID that is still correct for it, and the cache files
  // under that id are the source's own artwork. Rendering the CONVERTED file's cover
  // into the source's id would replace the artwork of a track nobody converted away —
  // the same coupling in the cache that stripping the attribute fixes in the collection.
  // The converted file has no id of its own yet; Traktor mints one when it re-reads it.
  it('does not repaint the source thumbnails with the converted cover', () => {
    const refreshes = refreshedCoverIds(SHARED, [{ ...patch, refreshCoverArt: true }])

    expect(refreshes).toEqual([])
  })

  // A substitution is still one track, so its cache entry is exactly the one that has to
  // be redrawn: the file behind that id really did change.
  it('still refreshes the thumbnails of a substituted track', () => {
    const onlyOne = `<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Scratch" AUDIO_ID="AYgFVndld3Vndmia"><LOCATION DIR="/:M/:" FILE="uno.flac" VOLUME="HD"></LOCATION><INFO COVERARTID="121/ZHCAA3BM"></INFO></ENTRY>
</COLLECTION></NML>`

    const refreshes = refreshedCoverIds(onlyOne, [
      { ...patch, newFile: 'uno.mp3', refreshCoverArt: true },
    ])

    expect(refreshes).toEqual([{ coverId: '121/ZHCAA3BM', file: '/M/uno.mp3' }])
  })

  it('keeps the identity when only the output is in the collection', () => {
    const onlyOutput = `<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Scratch" AUDIO_ID="AYgFVndld3Vndmia"><LOCATION DIR="/:M/:" FILE="uno.mp3" VOLUME="HD"></LOCATION><INFO COVERARTID="121/ZHCAA3BM"></INFO></ENTRY>
</COLLECTION></NML>`

    const out = applyPatches(onlyOutput, [patch])

    expect(out).toContain('AUDIO_ID="AYgFVndld3Vndmia"')
    expect(out).toContain('COVERARTID="121/ZHCAA3BM"')
  })
})

describe('repointing onto a path the collection already has', () => {
  const BOTH = `<NML VERSION="20"><COLLECTION ENTRIES="2">
<ENTRY TITLE="Open Eyes"><LOCATION DIR="/:M/:" FILE="uno.flac" VOLUME="HD"></LOCATION><INFO BITRATE="1042000" PLAYTIME="369"></INFO></ENTRY>
<ENTRY TITLE="Open Eyes"><LOCATION DIR="/:M/:" FILE="uno.mp3" VOLUME="HD"></LOCATION><INFO BITRATE="320000" PLAYTIME="368"></INFO></ENTRY>
</COLLECTION></NML>`

  it('does not repoint when the target path is already in the collection', () => {
    const out = applyPatches(BOTH, [
      { volume: 'HD', dir: '/:M/:', file: 'uno.flac', newFile: 'uno.mp3' },
    ])

    const mp3s = out.match(/FILE="uno\.mp3"/g) ?? []
    expect(mp3s).toHaveLength(1)
    // The entry Traktor already had for the MP3 is the one that describes it correctly,
    // so that is the one that must survive intact.
    expect(out).toContain('BITRATE="320000"')
  })

  // The shape of the reporter's own collection, transcribed from the file he sent rather
  // than invented: LOCATION carries VOLUMEID next to VOLUME, and INFO the technical
  // fields repointing never updates. VOLUMEID is why the attribute reads are \b-anchored
  // — a VOLUME lookup that also matched VOLUMEID would compare the wrong strings and let
  // the duplicate through on exactly the collections this guard exists for.
  it('leaves both entries alone on a real-shaped collection', () => {
    const real = `<NML VERSION="20"><COLLECTION ENTRIES="2">
<ENTRY MODIFIED_DATE="2026/9/7" TITLE="Open Eyes" ARTIST="Sola Brothers"><LOCATION DIR="/:Users/:dj/:Music/:Surco/:" FILE="Open Eyes.flac" VOLUME="Mac_Os_Tahoe" VOLUMEID="Mac_Os_Tahoe"></LOCATION><INFO BITRATE="1042000" FILESIZE="47184" PLAYTIME="369" IMPORT_DATE="2026/9/7"></INFO></ENTRY>
<ENTRY MODIFIED_DATE="2026/9/7" TITLE="Open Eyes" ARTIST="Sola Brothers"><LOCATION DIR="/:Users/:dj/:Music/:Surco/:" FILE="Open Eyes.mp3" VOLUME="Mac_Os_Tahoe" VOLUMEID="Mac_Os_Tahoe"></LOCATION><INFO BITRATE="320000" FILESIZE="14598" PLAYTIME="368" PLAYCOUNT="1"></INFO></ENTRY>
</COLLECTION></NML>`

    const out = applyPatches(real, [
      {
        volume: 'Mac_Os_Tahoe',
        dir: '/:Users/:dj/:Music/:Surco/:',
        file: 'Open Eyes.flac',
        newFile: 'Open Eyes.mp3',
      },
    ])

    expect(out.match(/FILE="Open Eyes\.mp3"/g)).toHaveLength(1)
    expect(out).toContain('FILE="Open Eyes.flac"')
    // The MP3's own entry keeps describing the MP3: repointing never refreshed BITRATE or
    // FILESIZE, so a clone would have claimed 1042 kbps and 47 MB for a 320 kbps file.
    expect(out).toContain('BITRATE="320000"')
    expect(out).toContain('PLAYCOUNT="1"')
  })

  // The case repointing exists for: the source entry is the only one, so following the
  // file to its new extension keeps the track — with its playlists and play count — as
  // one track in Traktor instead of orphaning it.
  it('still repoints when nothing else claims that path', () => {
    const onlyFlac = `<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Open Eyes"><LOCATION DIR="/:M/:" FILE="uno.flac" VOLUME="HD"></LOCATION></ENTRY>
</COLLECTION></NML>`

    const out = applyPatches(onlyFlac, [
      { volume: 'HD', dir: '/:M/:', file: 'uno.flac', newFile: 'uno.mp3' },
    ])

    expect(out).toContain('FILE="uno.mp3"')
    expect(out).not.toContain('FILE="uno.flac"')
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

  // El COVERARTID se CONSERVA. Borrarlo sólo pide a Traktor que relea, y lo que relee
  // es la miniatura que ya tiene cacheada: la imagen vieja sobrevive igual. El usuario
  // recorrió ese camino y lo abandonó. Lo que retira de verdad la portada antigua es
  // reescribir los ficheros bajo el id que Traktor ya tiene (ver traktorCoverCache.ts),
  // y para eso el id tiene que seguir ahí.
  it('keeps COVERARTID so the ENTRY still points at the cache being refreshed', () => {
    const withCover = NML.replace(
      '<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A">',
      '<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A"><INFO COVERARTID="042/ABC" BITRATE="1411"></INFO>',
    )

    const out = applyPatches(withCover, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', refreshCoverArt: true },
    ])

    expect(out).toContain('COVERARTID="042/ABC"')
    expect(out).toContain('BITRATE="1411"')
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

  // String.replace expande $&, $`, $' y $n dentro del texto de reemplazo, así que un
  // nombre de fichero con un dólar empalmaría texto del propio documento dentro del
  // atributo y escribiría XML inválido en la colección del DJ. El '$' es legal en los
  // tres sistemas y sanitizeOutputName no lo filtra, así que llega hasta aquí intacto.
  // Ojo: el fixture se monta con una función, porque montarlo con un replace de string
  // expandiría los mismos dólares al construir el caso y taparía el fallo.
  it('writes a file name containing a dollar sign literally', () => {
    const cases: [string, string][] = [
      ['a $& b.flac', 'a $&amp; b.flac'],
      ['a $` b.flac', 'a $` b.flac'],
      ["a $' b.flac", "a $' b.flac"],
      ['a $1 b.flac', 'a $1 b.flac'],
    ]

    for (const [newFile, expected] of cases) {
      const out = applyPatches(NML, [
        { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', newFile },
      ])

      expect(out).toContain(`FILE="${expected}"`)
    }
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
      refreshCoverArt: true,
    })

    const out = applyPatches(three, [
      grow('uno.aiff', 'uno-nombre-mucho-mas-largo-tras-convertir.flac'),
      grow('dos.aiff', 'dos-nombre-mucho-mas-largo-tras-convertir.flac'),
      grow('tres.aiff', 'tres-nombre-mucho-mas-largo-tras-convertir.flac'),
    ])

    expect(out).toContain('FILE="uno-nombre-mucho-mas-largo-tras-convertir.flac"')
    expect(out).toContain('FILE="dos-nombre-mucho-mas-largo-tras-convertir.flac"')
    expect(out).toContain('FILE="tres-nombre-mucho-mas-largo-tras-convertir.flac"')
    expect(out).toContain('COVERARTID="3/C"')
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

    // Sin bpm en el patch, el tempo sale del propio ENTRY (ver gridBpmFor), así que la
    // rejilla se reescribe con su nombre normalizado en vez de rescatarse tal cual. Lo
    // que sigue importando es que ni un nombre lleno de patrones de reemplazo ni el
    // tempo analizado se pierdan por el camino.
    const out = applyPatches(withGrid, [
      { volume: 'HD', dir: '/:M/:', file: 'uno.aiff', cueTree: tree },
    ])

    expect(out).not.toContain('NAME="$&amp; Beat <')
    expect(out).toContain('<GRID BPM="128.000000">')
    expect(out).toContain('START="79672.640000"')
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

  // Hallazgo crítico 2: readTraktorMarkers nunca lanza — devuelve [] ante CUALQUIER
  // fallo de parseo (checksum malo, variante desconocida, árbol truncado). Antes,
  // replaceCues borraba TODOS los CUE_V2 incondicionalmente y no insertaba nada en
  // su lugar, así que un árbol que Surco no sabe leer BORRABA los hotcues que ya
  // tenía la ENTRY — y syncCollection lo reportaba como written: true. Un árbol sin
  // marcadores no aporta ninguna información que merezca la pena escribir; se deja
  // el bloque tal cual, igual que ya hace el rescate de droppedGrid con el mismo
  // árbol vacío.
  it('leaves existing hotcues untouched when the cue tree cannot be parsed', () => {
    const withHotcues = NML.replace(
      '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>',
      '<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>' +
        '<CUE_V2 NAME="Intro" DISPL_ORDER="0" TYPE="0" START="1000.000000" LEN="0.000000" ' +
        'REPEATS="-1" HOTCUE="0"></CUE_V2>' +
        '<CUE_V2 NAME="Drop" DISPL_ORDER="0" TYPE="0" START="79672.640000" LEN="0.000000" ' +
        'REPEATS="-1" HOTCUE="1"></CUE_V2>',
    )
    const garbage = new Uint8Array(20).fill(0)
    garbage.set([0x54, 0x52, 0x4d, 0x44], 0) // "TRMD" tag, garbage body

    const out = applyPatches(withHotcues, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', cueTree: garbage },
    ])

    expect(out).toContain('NAME="Intro"')
    expect(out).toContain('NAME="Drop"')
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
      { volume: 'HD', dir: '/:M/:', file: 'x&y.mp3', refreshCoverArt: true },
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
      { volume: 'HD', dir: '/:M/:', file: 'x&y.mp3', refreshCoverArt: true },
      { volume: 'HD', dir: '/:M/:', file: 'x&y.aiff', newFile: 'FROM_A.flac' },
    ])

    expect(out).not.toContain('FILE="FROM_A.flac"')
    expect(out).toContain('FILE="x&amp;y.mp3"')
  })
})

// Los ids que hay que refrescar se leen de la colección, que es lo único que sabe qué
// portada tiene cada pista. Sin ellos no se puede localizar la caché que Traktor sirve.
describe('refreshedCoverIds', () => {
  const withCovers = NML.replace(
    '<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A">',
    '<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A"><INFO COVERARTID="042/ABC"></INFO>',
  ).replace(
    '<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Dos" ARTIST="B">',
    '<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Dos" ARTIST="B"><INFO COVERARTID="099/XYZ"></INFO>',
  )

  it('pairs each refreshed cover id with the converted file it came from', () => {
    const ids = refreshedCoverIds(withCovers, [
      {
        volume: 'Macintosh HD',
        dir: '/:Musica/:',
        file: 'uno.aiff',
        refreshCoverArt: true,
        outputPath: '/Music/uno.flac',
      },
    ])

    expect(ids).toEqual([{ coverId: '042/ABC', file: '/Music/uno.flac' }])
  })

  // Una pista que el patch no toca no puede perder su miniatura por el camino.
  it('ignores entries whose patch does not refresh the art', () => {
    const ids = refreshedCoverIds(withCovers, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', newFile: 'uno.flac' },
    ])

    expect(ids).toEqual([])
  })

  // Una ENTRY sin COVERARTID no tiene caché que refrescar: Traktor nunca le dibujó una.
  it('skips an entry that carries no COVERARTID', () => {
    const ids = refreshedCoverIds(NML, [
      {
        volume: 'Macintosh HD',
        dir: '/:Musica/:',
        file: 'uno.aiff',
        refreshCoverArt: true,
        outputPath: '/Music/uno.flac',
      },
    ])

    expect(ids).toEqual([])
  })

  // Sin la ruta del fichero convertido no hay imagen de la que sacar las miniaturas:
  // refrescar tendría que inventarse una portada.
  it('skips a patch that does not say where the converted file is', () => {
    const ids = refreshedCoverIds(withCovers, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', refreshCoverArt: true },
    ])

    expect(ids).toEqual([])
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
      { volume: 'HD', dir: '/:M/:', file: 'x&y.mp3', refreshCoverArt: true },
    ])

    expect(count).toBe(1)
  })
})
