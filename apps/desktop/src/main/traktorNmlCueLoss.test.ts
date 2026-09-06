import { describe, expect, it } from 'vitest'
import { buildTraktorTree, traktorCue } from './traktor4Fixture'
import { applyPatches } from './traktorNml'

// replaceCues borra TODOS los CUE_V2 de la ENTRY con un replace global y luego
// inserta cuesToXml(tree). El único elemento que rescata es la rejilla, y sólo
// cuando cuesToXml la ha tirado por falta de bpm (droppedGrid). Cualquier otro
// CUE_V2 que la ENTRY tuviera y que el árbol binario NO traiga desaparece.
//
// Los tests que ya existen no lo ven porque siempre construyen el árbol con los
// mismos marcadores que el fixture del NML ya tiene: el borrado global y la
// reinserción producen el mismo texto. En cuanto el fichero y el NML difieren
// (el caso real: el DJ puso cues en Traktor y Surco lee el árbol que había en el
// fichero cuando lo convirtió), el NML pierde los que sólo estaban en el NML.
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
  // CONFLICTO DE CONTRATO, no un bug suelto. Los dos tests vecinos de
  // traktorNml.test.ts ('replaces every CUE_V2 even when they are not one contiguous
  // run' y 'removes an old self-closing CUE_V2 instead of leaving a duplicate')
  // fijan a propósito lo contrario: el fichero es la verdad y el juego de CUE_V2 se
  // sustituye entero, para no dejar duplicados en Traktor.
  //
  // Ese contrato sólo es correcto si el fichero SIEMPRE contiene lo que el DJ ve en
  // Traktor, y djotas ya confirmó que no: el .nml manda y hay cues que sólo viven
  // allí. El árbol que llega aquí es readCueTree(output) (ffmpeg.ts:1235), o sea el
  // del fichero convertido. Cuando el .nml tiene hotcues que el fichero no lleva,
  // este módulo los borra de su colección y syncCollection reporta written: true.
  //
  // Marcado it.fails a propósito: afirma que HOY se pierden, así que la suite queda
  // verde documentando la pérdida en vez de esconderla, y se pondrá roja en cuanto
  // alguien la arregle, obligando a releer esta nota en lugar de dejarla obsoleta.
  //
  // La decisión no es de una línea y no es técnica: o el borrado global deja de ser
  // incondicional (fusionar por HOTCUE, lo que pone en rojo los dos tests citados y
  // arriesga duplicados en Traktor), o "el fichero manda" se asume como pérdida
  // aceptada y se dice en la interfaz antes de tocar la colección de nadie.
  it.fails('no borra los hotcues del NML que el árbol del fichero no trae', () => {
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
})
