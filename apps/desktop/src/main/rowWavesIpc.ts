import { readFile } from 'node:fs/promises'
import { ipcMain } from 'electron'
import type { RowWaveRequest, WaveformResult } from '../shared/types'
import { peekAnalysis, WAVEFORM_NAMESPACE } from './analysisCache'
import { wavePreview } from './anlz'
import { insideShare, rekordboxShareDir } from './rekordboxArtwork'

export const ROW_WAVE_BARS = 100

export interface RowWaveSources {
  share: string
  readDat: (file: string) => Promise<Buffer | null>
  peekWave: (path: string) => Promise<WaveformResult | null>
}

export function barsOf(
  wave: Pick<WaveformResult, 'peaks' | 'rms'>,
  bars = ROW_WAVE_BARS,
): number[] | null {
  const { rms } = wave
  if (rms.length === 0) return null
  const body = Array.from({ length: bars }, (_, i) => {
    const from = Math.floor((i * rms.length) / bars)
    const to = Math.min(rms.length, Math.max(from + 1, Math.floor(((i + 1) * rms.length) / bars)))
    let sq = 0
    for (let p = from; p < to; p++) sq += rms[p] * rms[p]
    return Math.sqrt(sq / (to - from))
  })
  const top = Math.max(...body) || 1
  return body.map((v) => Math.round((v / top) * 100) / 100)
}

async function fromRekordbox(
  request: RowWaveRequest,
  sources: RowWaveSources,
): Promise<number[] | null> {
  const file = request.analysisPath
  if (!file || !sources.share || !insideShare(sources.share, file)) return null
  const dat = await sources.readDat(file)
  if (!dat) return null
  try {
    return wavePreview(dat, ROW_WAVE_BARS)
  } catch {
    return null
  }
}

async function fromSurco(
  request: RowWaveRequest,
  sources: RowWaveSources,
): Promise<number[] | null> {
  const wave = await sources.peekWave(request.path)
  return wave ? barsOf(wave) : null
}

export async function rowWaves(
  requests: RowWaveRequest[],
  sources: RowWaveSources,
): Promise<Record<string, number[]>> {
  const found: Record<string, number[]> = {}
  await Promise.all(
    requests.map(async (request) => {
      const bars = (await fromRekordbox(request, sources)) ?? (await fromSurco(request, sources))
      if (bars) found[request.analysisPath ?? request.path] = bars
    }),
  )
  return found
}

export function registerRowWavesIpc(collection: () => string): void {
  ipcMain.handle('list:rowWaves', (_e, requests: RowWaveRequest[]) => {
    const path = collection()
    return rowWaves(requests, {
      share: path ? rekordboxShareDir(path) : '',
      readDat: (file) => readFile(file).catch(() => null),
      peekWave: (track) =>
        peekAnalysis<WaveformResult>(WAVEFORM_NAMESPACE, track).catch(() => null),
    })
  })
}
