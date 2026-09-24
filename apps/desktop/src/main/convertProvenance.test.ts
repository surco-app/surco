import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { OutputFormat, TrackMetadata } from '../shared/types'
import { ffprobePath } from './binaries'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-provenance-'))

// Lo que otra persona dejó escrito en el fichero antes de que llegara al usuario.
const FOREIGN = [
  'encoded_by',
  'engineer',
  'technician',
  'software',
  'originator',
  'product',
  'source',
  'copyright',
]

const meta = {
  title: 'Mia',
  artist: 'Yo',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
} as TrackMetadata

function seed(ext: string): string {
  const path = join(dir, `src.${ext}`)
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1']
  for (const name of FOREIGN) args.push('-metadata', `${name}=DEL_ANTERIOR`)
  args.push(path)
  execFileSync(FF, args)
  return path
}

function tagsOf(file: string): Record<string, string> {
  const out = execFileSync(
    ffprobePath,
    ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', file],
    { encoding: 'utf8' },
  )
  return (JSON.parse(out).format?.tags ?? {}) as Record<string, string>
}

// djotas, 21/09/2026: "yo lo convierto a FLAC y parece que no tiene metadatos pero sí
// los tiene porque regresa a WAV y resulta que los sigues viendo, sigues viendo ese
// campo que nunca se eliminó". El fichero convertido llevaba su título y su artista y,
// debajo, el estudio y la herramienta del dueño anterior. Se comprueba sobre el fichero
// REAL y no sobre los argumentos: un -metadata vacío que el muxer ignorase dejaría el
// test de argumentos verde y el campo dentro del fichero.
describe('conversión y procedencia del origen', () => {
  it.each([
    ['wav', 'flac'],
    ['mp3', 'flac'],
    ['flac', 'mp3'],
    ['mp3', 'wav'],
    ['flac', 'flac'],
  ] as Array<[string, OutputFormat]>)(
    'carries nothing of the previous owner: %s -> %s',
    async (from, to) => {
      const src = seed(from)
      // La guarda: si la semilla no lleva los campos, el test pasaría por no haber nada.
      expect(Object.values(tagsOf(src)), 'la semilla no lleva los campos ajenos').toContain(
        'DEL_ANTERIOR',
      )

      const dst = join(dir, `${from}-to-${to}.${to}`)
      await convertAudio(src, dst, to, meta)

      const after = tagsOf(dst)
      const leftovers = Object.entries(after)
        .filter(([, v]) => String(v) === 'DEL_ANTERIOR')
        .map(([k]) => k)
      expect(leftovers, `sobrevivieron: ${leftovers.join(', ')}`).toEqual([])
      // Y lo que el usuario sí puso sigue ahí: la limpieza no puede llevarse su edición.
      expect(Object.values(after)).toContain('Mia')
    },
    120000,
  )

  // El recorrido literal que describió djotas, y comprobado sobre los BYTES: ffprobe no
  // enseña todos los chunks del RIFF, así que un ITCH superviviente (el "Technician" que
  // llevaba su nombre de estudio) no aparecía en el probe pero sí en MP3tag, que es donde
  // él lo veía. El FLAC intermedio es lo que los transportaba de vuelta al WAV.
  it('WAV de otro -> FLAC -> WAV no conserva su estudio', async () => {
    const src = join(dir, 'ajeno.wav')
    execFileSync(FF, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-metadata',
      'encoded_by=Cubase 12',
      '-metadata',
      'technician=Estudio Ajeno',
      src,
    ])

    const flac = join(dir, 'ida.flac')
    await convertAudio(src, flac, 'flac', meta)
    const back = join(dir, 'vuelta.wav')
    await convertAudio(flac, back, 'wav', meta)

    const bytes = readFileSync(back).toString('latin1')
    expect(bytes).not.toContain('Cubase')
    expect(bytes).not.toContain('Estudio Ajeno')
    expect(bytes, 'la edición del usuario tiene que seguir ahí').toContain('Mia')
  }, 120000)
})
