import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-peakdc-'))
const biased = join(dir, 'biased.wav')

const meta: TrackMetadata = {
  title: 'Biased',
  artist: 'Test',
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
  discogsReleaseId: '',
  rating: '',
  composer: '',
  isrc: '',
  mixName: '',
  originalYear: '',
  compilation: '',
  mood: '',
  energy: '',
}

function maxVolumeDb(path: string): number {
  const { stderr } = spawnSync(
    FF,
    ['-hide_banner', '-nostats', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' },
  )
  const m = stderr.match(/max_volume:\s*(-?[\d.]+) dB/)
  if (!m) throw new Error('volumedetect reported no max_volume')
  return Number(m[1])
}

beforeAll(() => {
  // El mismo fixture que convertDcOffset.test.ts. Medido con astats: DC 0.200000,
  // Min 0.150024, Max 0.250000 — o sea un seno de ±0.05 montado sobre un sesgo de 0.2.
  //
  // Extent SIN centrar: max(|0.25|, |0.15|) = 0.25.
  // Extent centrado:    0.05.
  //
  // Factor 5 entre uno y otro = 13.98 dB. Ese es exactamente el déficit que sale
  // medido abajo, así que el número no es una estimación: es la aritmética del extent.
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-af',
    'volume=0.4,aeval=val(0)+0.2',
    '-c:a',
    'pcm_s16le',
    biased,
  ])
})

// convertDcOffset.test.ts ya prueba que el DC DESAPARECE en cada combinación. Lo que
// nadie mide es el PICO que queda después, y ahí está el fallo: la casilla promete
// normalizar a un techo concreto, no "algo por debajo".
describe('el pico que queda tras centrar en modo peak', () => {
  // Baseline: sin quitar DC, la normalización a pico sí clava el techo pedido. Si esto
  // no fuera cierto el test de abajo no probaría nada sobre el DC.
  it('clava el techo pedido cuando no hay que centrar nada', async () => {
    const out = join(dir, 'peak-nodc.wav')
    await convertAudio(biased, out, 'wav', meta, undefined, {
      mode: 'peak',
      targetLufs: -14,
      peakDb: -1,
      truePeakDb: -1,
      peakPerChannel: true,
    })
    expect(maxVolumeDb(out)).toBeCloseTo(-1, 1)
  })

  // EL FALLO. Con removeDcOffset activo y peakPerChannel (sin peakRemoveDc):
  //
  //   - peakOwnsDc es false (ffmpeg.ts:1018), así que se construye dcAf y el audio
  //     SÍ se centra en la cadena de encode.
  //   - pero se entra en la rama per-canal (ffmpeg.ts:1042), que mide astats con
  //     `prefilter`, NO con `measurePrefilter` — o sea sobre la señal SIN centrar.
  //   - peakChannelFilter recibe removeDc=false (porque peakRemoveDc no está puesto),
  //     así que dimensiona la ganancia con max/min crudos, sesgo incluido.
  //   - withDc antepone el centrado.
  //
  // Resultado: la ganancia se calculó contra un extent de 0.6 que el audio ya no tiene
  // cuando se aplica; el pico real queda por debajo del techo pedido.
  //
  // Lo que ve el DJ: normaliza a -1 dB con "quitar DC" marcado y le sale una pista
  // varios dB más floja que el resto del lote. El comentario de la propia línea 1030
  // dice "Every measurement below reads through this, so the gains are sized on centred
  // audio" — esta rama es la que no lo cumple.
  //
  // La caché lo fija además para siempre: astats se guarda bajo ns('astats-channels-v1')
  // sin el sufijo -dc que sí lleva volumedetect-v1 justo debajo, así que la medida sin
  // centrar y la centrada comparten clave.
  it('clava el techo pedido cuando además se centra la señal', async () => {
    const out = join(dir, 'peak-perchannel-dc.wav')
    await convertAudio(biased, out, 'wav', meta, undefined, {
      mode: 'peak',
      targetLufs: -14,
      peakDb: -1,
      truePeakDb: -1,
      peakPerChannel: true,
      removeDcOffset: true,
    })
    expect(maxVolumeDb(out), 'la pista sale por debajo del techo pedido').toBeCloseTo(-1, 1)
  })
})
