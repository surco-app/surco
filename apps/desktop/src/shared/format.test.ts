import { describe, expect, it } from 'vitest'
import {
  batchKeepMp3,
  editsInPlace,
  formatExtension,
  formatMatchesInput,
  reencodesLossyInPlace,
  resolveJobFormat,
} from './format'

describe('formatExtension', () => {
  // ALAC is the one format whose name is not its extension: it lives in an MPEG-4
  // container, so every filename the app builds or previews must say .m4a.
  it('maps ALAC to its m4a container and every other format to itself', () => {
    expect(formatExtension('alac')).toBe('m4a')
    expect(formatExtension('aiff')).toBe('aiff')
    expect(formatExtension('mp3')).toBe('mp3')
    expect(formatExtension('wav')).toBe('wav')
    expect(formatExtension('flac')).toBe('flac')
  })
})

describe('formatMatchesInput', () => {
  // ALAC is the output that shares the .m4a container, so an .m4a source is "already in
  // it" the way an .mp3 is already MP3 — whether it holds AAC or ALAC. Not matching sent
  // every m4a through a lossless decode: an 11 MB AAC came back as a 44 MB AIFF.
  it('treats an .m4a source as already in the ALAC container', () => {
    expect(formatMatchesInput('alac', '/music/song.m4a')).toBe(true)
    expect(formatMatchesInput('alac', '/music/song.M4A')).toBe(true)
    expect(formatMatchesInput('alac', '/music/song.alac')).toBe(false)
  })

  it('still matches the formats that own their extension', () => {
    expect(formatMatchesInput('mp3', '/music/song.MP3')).toBe(true)
    expect(formatMatchesInput('aiff', '/music/song.aif')).toBe(true)
  })
})

describe('editsInPlace', () => {
  it('edits in place when the target format is the one the file is already in', () => {
    expect(editsInPlace('wav', '/music/song.wav')).toBe(true)
    expect(editsInPlace('mp3', '/music/song.wav')).toBe(false)
  })

  it('overwrite mode forces in place across formats', () => {
    expect(editsInPlace('aiff', '/music/song.wav', true)).toBe(true)
  })

  // An .m4a kept in its own container is a tag update, edited where it lives like any
  // same-format export. Overwrite still never forces ALAC over another format's file.
  it('edits an .m4a in place and never lets overwrite force ALAC over another format', () => {
    expect(editsInPlace('alac', '/music/song.m4a')).toBe(true)
    expect(editsInPlace('alac', '/music/song.wav', true)).toBe(false)
  })
})

describe('resolveJobFormat', () => {
  // "Same as source" is a rule for picking a format, not a format: the job that
  // reaches the main process must always name a real one, or ffmpeg's format chain
  // falls through to AIFF and silently rewrites the user's file as something else.
  it('resolves each supported extension to its own format', () => {
    expect(resolveJobFormat('source', '/music/song.mp3', 'aiff')).toBe('mp3')
    expect(resolveJobFormat('source', '/music/song.wav', 'aiff')).toBe('wav')
    expect(resolveJobFormat('source', '/music/song.flac', 'aiff')).toBe('flac')
    expect(resolveJobFormat('source', '/music/song.aiff', 'aiff')).toBe('aiff')
  })

  // .aif rips are as common as .aiff and must keep their own format rather than
  // falling back — the existing exportedFormat in Editor.tsx gets this wrong.
  it('resolves .aif to aiff', () => {
    expect(resolveJobFormat('source', '/music/song.aif', 'mp3')).toBe('aiff')
  })

  // "Same as source" keeps an .m4a in its container: the ALAC target is the one that
  // stream-copies it, AAC included, instead of decoding it to a fallback lossless file.
  it('resolves .m4a to its own container', () => {
    expect(resolveJobFormat('source', '/music/song.m4a', 'aiff')).toBe('alac')
  })

  // Surco imports more extensions than it can export; these always transcoded and
  // still do, rather than blocking the file.
  it('falls back for inputs with no matching output format', () => {
    expect(resolveJobFormat('source', '/music/song.opus', 'aiff')).toBe('aiff')
    expect(resolveJobFormat('source', '/music/song.ogg', 'wav')).toBe('wav')
    expect(resolveJobFormat('source', '/music/song.aac', 'aiff')).toBe('aiff')
    expect(resolveJobFormat('source', '/music/no-extension', 'aiff')).toBe('aiff')
  })

  // A pinned format is the user overriding the rule; the source file has no say.
  it('returns a concrete setting untouched', () => {
    expect(resolveJobFormat('mp3', '/music/song.flac', 'aiff')).toBe('mp3')
    expect(resolveJobFormat('alac', '/music/song.m4a', 'aiff')).toBe('alac')
  })

  // Transcodificar un mp3 a lossless no recupera nada de lo que el encoder descartó:
  // con keepMp3 el fichero conserva su formato y el motor entra en el stream copy.
  it('keeps an mp3 source as mp3 under any lossless setting when keepMp3 is on', () => {
    expect(resolveJobFormat('aiff', '/music/song.mp3', 'aiff', true)).toBe('mp3')
    expect(resolveJobFormat('wav', '/music/song.mp3', 'aiff', true)).toBe('mp3')
    expect(resolveJobFormat('flac', '/music/song.mp3', 'aiff', true)).toBe('mp3')
    expect(resolveJobFormat('alac', '/music/song.mp3', 'aiff', true)).toBe('mp3')
    expect(resolveJobFormat('source', '/music/song.mp3', 'aiff', true)).toBe('mp3')
  })

  // Sin el flag, el comportamiento de siempre: el setting manda.
  it('converts an mp3 normally when keepMp3 is off', () => {
    expect(resolveJobFormat('aiff', '/music/song.mp3', 'aiff')).toBe('aiff')
    expect(resolveJobFormat('aiff', '/music/song.mp3', 'aiff', false)).toBe('aiff')
  })

  // Un .m4a suele ser AAC: pasarlo a lossless tampoco recupera nada y el fichero crece
  // cuatro veces (djotas, 30/09: de 11 a 44 MB). El ajuste lo conserva como al mp3.
  it('keeps an m4a source in its container under a lossless setting when keepMp3 is on', () => {
    expect(resolveJobFormat('aiff', '/music/song.m4a', 'aiff', true)).toBe('alac')
    expect(resolveJobFormat('flac', '/music/song.m4a', 'aiff', true)).toBe('alac')
    expect(resolveJobFormat('aiff', '/music/song.m4a', 'aiff', false)).toBe('aiff')
  })

  it('leaves the lossless sources untouched when keepMp3 is on', () => {
    expect(resolveJobFormat('aiff', '/music/song.flac', 'aiff', true)).toBe('aiff')
    expect(resolveJobFormat('aiff', '/music/song.wav', 'aiff', true)).toBe('aiff')
    expect(resolveJobFormat('aiff', '/music/song.ogg', 'aiff', true)).toBe('aiff')
  })
})

describe('reencodesLossyInPlace', () => {
  // 'source' on an .mp3 resolves to mp3, which formatMatchesInput always treats as
  // in-place — with a filter active that in-place write is a re-encode over the only
  // copy, permanently losing a generation of quality.
  it('flags source mode rewriting an mp3 with an active filter', () => {
    expect(reencodesLossyInPlace('source', '/music/song.mp3', false, true, 'aiff')).toBe(true)
  })

  // Overwrite mode reaches the same in-place mp3 rewrite through the other branch of
  // editsInPlace; the risk to the original is identical either way.
  it('flags overwrite mode rewriting an mp3 with an active filter', () => {
    expect(reencodesLossyInPlace('mp3', '/music/song.mp3', true, true, 'aiff')).toBe(true)
  })

  // No filter means planConversion's copyOk stays true: a plain byte copy with a tag
  // rewrite, nothing is re-encoded, so there is nothing to warn about.
  it('does not flag an in-place mp3 rewrite with no active filter', () => {
    expect(reencodesLossyInPlace('source', '/music/song.mp3', false, false, 'aiff')).toBe(false)
  })

  // A fresh copy elsewhere (not in place) never touches the only existing copy, so a
  // degraded re-encode there is not a data-loss event.
  it('does not flag an mp3 re-encode that is not in place', () => {
    expect(reencodesLossyInPlace('mp3', '/music/other.wav', false, true, 'aiff')).toBe(false)
  })

  // Every other OutputFormat is lossless; re-encoding one over itself loses no
  // generation, so only mp3 is worth warning about.
  it('does not flag lossless formats even in place with a filter', () => {
    expect(reencodesLossyInPlace('wav', '/music/song.wav', false, true, 'aiff')).toBe(false)
    expect(reencodesLossyInPlace('flac', '/music/song.flac', true, true, 'aiff')).toBe(false)
    expect(reencodesLossyInPlace('aiff', '/music/song.aiff', false, true, 'aiff')).toBe(false)
  })

  // keepMp3 convierte un export "a AIFF" en un mp3→mp3 in-place; con un filtro activo
  // eso es el mismo re-encode generacional que ya cubren 'source' y overwrite, y el
  // aviso tiene que verlo con el mismo formato que verá el job.
  it('flags a keepMp3 rewrite of an mp3 with an active filter', () => {
    expect(reencodesLossyInPlace('aiff', '/music/song.mp3', false, true, 'aiff', true)).toBe(true)
    expect(reencodesLossyInPlace('aiff', '/music/song.mp3', false, false, 'aiff', true)).toBe(false)
    expect(reencodesLossyInPlace('aiff', '/music/song.mp3', false, true, 'aiff', false)).toBe(false)
  })

  // An iTunes purchase is AAC inside an .m4a, as lossy as an MP3: a filter re-encodes it
  // over the only copy just the same. The extension cannot tell AAC from ALAC, so the
  // caller says which one the file holds.
  it('flags an AAC .m4a rewritten in place with an active filter', () => {
    expect(
      reencodesLossyInPlace('source', '/music/song.m4a', false, true, 'aiff', false, {
        lossyM4a: true,
      }),
    ).toBe(true)
    expect(reencodesLossyInPlace('source', '/music/song.m4a', false, true, 'aiff')).toBe(false)
    expect(
      reencodesLossyInPlace('source', '/music/song.m4a', false, false, 'aiff', false, {
        lossyM4a: true,
      }),
    ).toBe(false)
  })

  // The conversion keeps a track imported from Apple Music in its own format unless a
  // format was picked by hand. The warning has to resolve it the same way, or a Music MP3
  // under an AIFF setting is re-encoded in place without being asked.
  it('resolves an Apple Music track to its own format, as the conversion does', () => {
    expect(
      reencodesLossyInPlace('aiff', '/music/song.mp3', false, true, 'aiff', false, {
        fromAppleMusic: true,
      }),
    ).toBe(true)
    expect(
      reencodesLossyInPlace('aiff', '/music/song.mp3', false, true, 'aiff', false, {
        fromAppleMusic: true,
        formatChosen: true,
      }),
    ).toBe(false)
  })
})

describe('batchKeepMp3', () => {
  // En un lote la procedencia del formato se pierde al fijarlo, así que se decide por
  // valor: sin formato, o con el mismo valor que el setting, el formato es
  // settings-derived y la regla aplica.
  it('applies to a settings-derived batch format', () => {
    expect(batchKeepMp3(undefined, 'aiff', true)).toBe(true)
    expect(batchKeepMp3('aiff', 'aiff', true)).toBe(true)
  })

  // Un pick distinto del setting solo puede venir del menú: elección explícita, la
  // regla se aparta y el lote entero sale en el formato pedido.
  it('steps aside for an explicit batch pick', () => {
    expect(batchKeepMp3('wav', 'aiff', true)).toBe(false)
  })

  it('never applies with the setting off', () => {
    expect(batchKeepMp3(undefined, 'aiff', false)).toBe(false)
    expect(batchKeepMp3('aiff', 'aiff', false)).toBe(false)
  })
})

// Una pista importada de Apple Music no es un fichero suelto: es parte de una colección
// que el usuario ya tiene ordenada, así que su formato se respeta como lo demás. Solo
// cambia si el usuario elige un formato a mano.
describe('resolveJobFormat con una pista importada de Apple Music', () => {
  it('conserva el formato del origen mientras el ajuste sea el de por defecto', () => {
    expect(resolveJobFormat('source', '/music/song.wav', 'aiff', false, true)).toBe('wav')
    expect(resolveJobFormat('source', '/music/song.flac', 'aiff', false, true)).toBe('flac')
    expect(resolveJobFormat('source', '/music/song.mp3', 'aiff', false, true)).toBe('mp3')
  })

  // La biblioteca de Music es sobre todo .m4a: convertirlos a AIFF al tocar las
  // etiquetas cuadruplicaba cada pista sin ganar nada.
  it('no convierte un m4a importado por el destino por defecto de la app', () => {
    expect(resolveJobFormat('aiff', '/music/song.m4a', 'aiff', false, true)).toBe('alac')
  })

  // El caso que lo motivó: un WAV importado ofrecía "Convertir a AIFF" sin que nadie lo
  // hubiera pedido, reescribiendo un fichero que la biblioteca del usuario ya indexaba.
  it('no convierte un WAV importado por el destino por defecto de la app', () => {
    expect(resolveJobFormat('aiff', '/music/song.wav', 'aiff', false, true)).toBe('wav')
  })

  // Pero la elección del usuario manda sobre el respeto al original: si pide AIFF, es AIFF.
  it('obedece un formato que el usuario eligió a mano', () => {
    expect(resolveJobFormat('aiff', '/music/song.wav', 'aiff', false, true, true)).toBe('aiff')
    expect(resolveJobFormat('flac', '/music/song.wav', 'aiff', false, true, true)).toBe('flac')
  })

  it('no toca las pistas que no vienen de Apple Music', () => {
    expect(resolveJobFormat('aiff', '/music/song.wav', 'aiff', false, false)).toBe('aiff')
  })

  // keepMp3 sigue mandando sobre todo lo demás: un mp3 no se convierte a lossless nunca.
  it('sigue conservando un mp3 cuando keepMp3 está activo', () => {
    expect(resolveJobFormat('aiff', '/music/song.mp3', 'aiff', true, true, true)).toBe('mp3')
  })
})
