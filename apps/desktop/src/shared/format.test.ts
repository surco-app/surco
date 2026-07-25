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
  // An .m4a source may hold lossy AAC, not ALAC; calling it "already ALAC" would
  // rewrite the user's original in place with a re-encode. ALAC therefore never
  // matches its input, so the export always renders a fresh file.
  it('never treats an .m4a source as already being ALAC', () => {
    expect(formatMatchesInput('alac', '/music/song.m4a')).toBe(false)
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

  // ALAC keeps its never-in-place invariant even under overwrite: the .m4a source may
  // hold lossy AAC, and replacing it would destroy the only true copy while presenting
  // a lossy re-encode as lossless. An ALAC export always renders a fresh file.
  it('never lets overwrite mode force ALAC in place', () => {
    expect(editsInPlace('alac', '/music/song.m4a', true)).toBe(false)
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

  // An .m4a may hold lossy AAC, not ALAC. Calling it "already ALAC" would let an
  // overwrite re-encode the user's only copy and present it as lossless.
  it('never resolves .m4a to alac', () => {
    expect(resolveJobFormat('source', '/music/song.m4a', 'aiff')).toBe('aiff')
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

  // La regla es solo para mp3: el resto de fuentes (incluido el .m4a ambiguo) no
  // cambia — un AAC dentro de .m4a seguiría sin poder "conservarse" con seguridad.
  it('leaves non-mp3 sources untouched when keepMp3 is on', () => {
    expect(resolveJobFormat('aiff', '/music/song.flac', 'aiff', true)).toBe('aiff')
    expect(resolveJobFormat('aiff', '/music/song.wav', 'aiff', true)).toBe('aiff')
    expect(resolveJobFormat('aiff', '/music/song.m4a', 'aiff', true)).toBe('aiff')
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
