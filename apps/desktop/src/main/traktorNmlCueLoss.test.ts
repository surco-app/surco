import { describe, expect, it } from 'vitest'
import { buildTraktorTree, traktorCue } from './traktor4Fixture'
import { applyPatches } from './traktorNml'

// replaceCues borraba TODOS los CUE_V2 de la ENTRY con un replace global y luego
// insertaba cuesToXml(tree), así que cualquier CUE_V2 que la ENTRY tuviera y que el
// árbol binario NO trajera desaparecía. Los tests vecinos no lo veían porque siempre
// construyen el árbol con los mismos marcadores que el fixture del NML ya tiene. En
// cuanto el fichero y el NML difieren (el caso real: el DJ puso cues en Traktor y
// Surco lee el árbol que había en el fichero cuando lo convirtió), el NML perdía los
// que sólo estaban en el NML.
const ENTRY_WITH_EXTRA_CUES = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<NML VERSION="19">
<COLLECTION ENTRIES="1">
<ENTRY MODIFIED_DATE="2026/9/6" TITLE="Uno" ARTIST="A">
<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>
<INFO BITRATE="1411000" COVERARTID="053/XYZ" PLAYCOUNT="7"></INFO>
<TEMPO BPM="128.000000" BPM_QUALITY="100.000000"></TEMPO>
<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="143.380000" LEN="0.000000" REPEATS="-1" HOTCUE="0"><GRID BPM="128.000000"></GRID></CUE_V2>
<CUE_V2 NAME="Intro" DISPL_ORDER="0" TYPE="0" START="1000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2>
<CUE_V2 NAME="Break" DISPL_ORDER="0" TYPE="0" START="45000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="2"></CUE_V2>
<CUE_V2 NAME="Outro" DISPL_ORDER="0" TYPE="0" START="200000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="3"></CUE_V2>
</ENTRY>
</COLLECTION>
</NML>`

describe('el parche de cues del NML frente a la colección real', () => {
  // El árbol que llega aquí es readCueTree(output), el del fichero convertido, y djotas
  // confirmó que el .nml manda: hay hotcues que sólo viven allí. Sustituir el juego de
  // CUE_V2 entero los borraba de su colección con syncCollection reportando written:
  // true. Se fusionan: el fichero gana en el mismo slot, lo que sólo está en el NML se
  // conserva.
  it('no borra los hotcues del NML que el árbol del fichero no trae', () => {
    const tree = buildTraktorTree([
      traktorCue('AutoGrid', 4, 143.38, 0),
      traktorCue('Intro', 0, 1000, 1),
    ])

    const out = applyPatches(ENTRY_WITH_EXTRA_CUES, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', cueTree: tree, bpm: 128 },
    ])

    expect(out, 'el hotcue 2 "Break" del NML se ha perdido').toContain('NAME="Break"')
    expect(out, 'el hotcue 3 "Outro" del NML se ha perdido').toContain('NAME="Outro"')
  })

  // Mismo slot en los dos lados: gana el fichero, que es el que la conversión acaba de
  // escribir. Quedarse con los dos daría dos hotcues en un mismo botón de Traktor.
  it('deja que el fichero gane en un slot que también tiene el NML', () => {
    const tree = buildTraktorTree([
      traktorCue('AutoGrid', 4, 143.38, 0),
      traktorCue('Intro', 0, 1000, 1),
      traktorCue('Drop', 0, 60000, 2),
    ])

    const out = applyPatches(ENTRY_WITH_EXTRA_CUES, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', cueTree: tree, bpm: 128 },
    ])

    expect(out).toContain('NAME="Drop"')
    expect(out).not.toContain('NAME="Break"')
    expect(out).toContain('NAME="Outro"')
    expect(out.match(/HOTCUE="2"/g)).toHaveLength(1)
    expect(out.match(/<CUE_V2/g)).toHaveLength(4)
  })

  // Los del NML describen el mismo audio que los del fichero antes de convertir, así que
  // un recorte o la calibración los mueve lo mismo. Dejarlos donde estaban los pondría a
  // destiempo de sus vecinos, que sí se movieron.
  it('mueve los que sólo están en el NML lo mismo que se movieron los del fichero', () => {
    const tree = buildTraktorTree([
      traktorCue('AutoGrid', 4, 143.38 + 51, 0),
      traktorCue('Intro', 0, 1000 + 51, 1),
    ])

    const out = applyPatches(ENTRY_WITH_EXTRA_CUES, [
      {
        volume: 'Macintosh HD',
        dir: '/:Musica/:',
        file: 'uno.aiff',
        cueTree: tree,
        bpm: 128,
        cueShift: { shiftMs: -51 },
      },
    ])

    expect(out).toContain('NAME="Break" DISPL_ORDER="0" TYPE="0" START="45051.000000"')
    expect(out).toContain('NAME="Outro" DISPL_ORDER="0" TYPE="0" START="200051.000000"')
  })

  // Un recorte de cabeza deja fuera lo que caía antes del corte; el fichero los pega al
  // nuevo inicio (shiftTraktorCues), y el NML tiene que hacer lo mismo en vez de escribir
  // una posición negativa que Traktor no sabe pintar.
  it('pega al inicio los del NML que caían dentro del recorte', () => {
    const tree = buildTraktorTree([traktorCue('Intro', 0, 0, 1)])

    const out = applyPatches(ENTRY_WITH_EXTRA_CUES, [
      {
        volume: 'Macintosh HD',
        dir: '/:Musica/:',
        file: 'uno.aiff',
        cueTree: tree,
        bpm: 128,
        cueShift: { shiftMs: 50000, maxMs: 120000 },
      },
    ])

    expect(out).toContain('NAME="Break" DISPL_ORDER="0" TYPE="0" START="0.000000"')
    expect(out).toContain('NAME="Outro" DISPL_ORDER="0" TYPE="0" START="120000.000000"')
  })

  // Los cues de memoria (HOTCUE -1) no tienen slot que comparar. Si el fichero ya trae
  // uno en la misma posición, es el mismo cue: conservar el del NML lo duplicaría.
  it('no duplica un cue de memoria que ya trae el fichero en la misma posición', () => {
    const memory =
      '<CUE_V2 NAME="Mem" DISPL_ORDER="0" TYPE="0" START="30000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>'
    const nml = ENTRY_WITH_EXTRA_CUES.replace('</ENTRY>', `${memory}</ENTRY>`)
    const tree = buildTraktorTree([
      traktorCue('Intro', 0, 1051, 1),
      traktorCue('Mem', 0, 30051, -1),
    ])

    const out = applyPatches(nml, [
      {
        volume: 'Macintosh HD',
        dir: '/:Musica/:',
        file: 'uno.aiff',
        cueTree: tree,
        bpm: 128,
        cueShift: { shiftMs: -51 },
      },
    ])

    expect(out.match(/NAME="Mem"/g)).toHaveLength(1)
  })

  // Lo que ve el DJ: aunque los cues sobrevivan, el bloque se reordena. El anchor
  // de reinserción es siempre justo detrás de </LOCATION>, así que los CUE_V2 se
  // cuelan por delante de INFO y TEMPO. El diff de la colección deja de ser "tres
  // atributos" y pasa a ser todo el bloque, que es exactamente lo que el comentario
  // de cabecera de traktorNml.ts dice que este módulo existe para evitar.
  it('no reordena el bloque metiendo los cues por delante de INFO y TEMPO', () => {
    const tree = buildTraktorTree([
      traktorCue('AutoGrid', 4, 143.38, 0),
      traktorCue('Intro', 0, 1000, 1),
      traktorCue('Break', 0, 45000, 2),
      traktorCue('Outro', 0, 200000, 3),
    ])

    const out = applyPatches(ENTRY_WITH_EXTRA_CUES, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', cueTree: tree, bpm: 128 },
    ])

    expect(out.indexOf('<INFO'), 'INFO ha quedado detrás de los CUE_V2').toBeLessThan(
      out.indexOf('<CUE_V2'),
    )
    expect(out.indexOf('<TEMPO'), 'TEMPO ha quedado detrás de los CUE_V2').toBeLessThan(
      out.indexOf('<CUE_V2'),
    )
  })

  // Sin árbol en el fichero el desplazamiento sólo puede llegar a la colección, pero sólo a
  // la ENTRY que describe el fichero convertido: la del origen que se quedó donde estaba
  // sigue describiendo un audio que nadie recortó.
  it('no desplaza los cues de la ENTRY del origen cuando la conversión fue a otra parte', () => {
    const out = applyPatches(ENTRY_WITH_EXTRA_CUES, [
      {
        volume: 'Macintosh HD',
        dir: '/:Musica/:',
        file: 'uno.aiff',
        cueShift: { shiftMs: 2000 },
        outputVolume: 'Macintosh HD',
        outputDir: '/:Salida/:',
        outputFile: 'uno.aiff',
      },
    ])

    expect(out).toContain('NAME="Intro" DISPL_ORDER="0" TYPE="0" START="1000.000000"')
  })

  it('desplaza todos los cues de la colección, rejilla incluida, cuando el fichero no trae árbol', () => {
    const out = applyPatches(ENTRY_WITH_EXTRA_CUES, [
      { volume: 'Macintosh HD', dir: '/:Musica/:', file: 'uno.aiff', cueShift: { shiftMs: 2000 } },
    ])

    expect(out).toContain('NAME="Break" DISPL_ORDER="0" TYPE="0" START="43000.000000"')
    expect(out).toContain('NAME="Intro" DISPL_ORDER="0" TYPE="0" START="0.000000"')
    expect(out).toMatch(/NAME="AutoGrid"[^>]*TYPE="4"/)
    expect(out).not.toContain('START="143.380000"')
  })
})
