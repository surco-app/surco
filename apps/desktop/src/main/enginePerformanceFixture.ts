import {
  deflateEngineBlob,
  type EngineQuickCue,
  encodeQuickCues,
  quickCueSlotBytes,
} from './engineBlobs'

export const MAIN_CUE_TAIL = Buffer.from('41627e3a800000000140d2750000000000', 'hex')

export function trackDataBlob(sampleRate: number, sampleCount: number): Buffer {
  const raw = Buffer.alloc(68)
  raw.writeDoubleBE(sampleRate, 0)
  raw.writeBigInt64BE(BigInt(sampleCount), 8)
  return deflateEngineBlob(raw)
}

export function beatDataBlob(
  sampleRate: number,
  sampleCount: number,
  markers: [number, number][],
): Buffer {
  const head = Buffer.alloc(17)
  head.writeDoubleBE(sampleRate, 0)
  head.writeDoubleBE(sampleCount, 8)
  head[16] = 1
  const grid = (): Buffer[] => {
    const count = Buffer.alloc(8)
    count.writeBigInt64BE(BigInt(markers.length))
    return [
      count,
      ...markers.map(([sample, beat], i) => {
        const m = Buffer.alloc(24)
        m.writeDoubleLE(sample, 0)
        m.writeBigInt64LE(BigInt(beat), 8)
        m.writeInt32LE(i + 1 < markers.length ? markers[i + 1][1] - beat : 0, 16)
        return m
      }),
    ]
  }
  return deflateEngineBlob(Buffer.concat([head, ...grid(), ...grid(), Buffer.alloc(9)]))
}

export function quickCuesRaw(slots: (EngineQuickCue | null)[], tail = MAIN_CUE_TAIL): Buffer {
  const all = Array.from({ length: 8 }, (_, i) => slots[i] ?? null)
  return encodeQuickCues(all.map(quickCueSlotBytes), tail)
}

export function quickCuesBlob(slots: (EngineQuickCue | null)[], tail = MAIN_CUE_TAIL): Buffer {
  return deflateEngineBlob(quickCuesRaw(slots, tail))
}

export function overviewBlob(entries: [number, number, number][]): Buffer {
  const head = Buffer.alloc(24)
  head.writeBigInt64BE(BigInt(entries.length), 0)
  head.writeBigInt64BE(BigInt(entries.length), 8)
  head.writeDoubleBE(1000, 16)
  const max = [0, 1, 2].map((b) => Math.max(0, ...entries.map((e) => e[b])))
  return deflateEngineBlob(Buffer.concat([head, Buffer.from(entries.flat()), Buffer.from(max)]))
}

export interface EnginePerformanceRow {
  trackId: number
  trackData?: Buffer
  beatData?: Buffer
  quickCues?: Buffer
  overviewWaveFormData?: Buffer
}

export function analysedTrack(
  trackId: number,
  cues: (EngineQuickCue | null)[] = [],
): EnginePerformanceRow {
  return {
    trackId,
    trackData: trackDataBlob(44100, 44100 * 60),
    beatData: beatDataBlob(44100, 44100 * 60, [
      [-22050, -1],
      [44100 * 60 - 22050, 119],
    ]),
    quickCues: quickCuesBlob(cues),
    overviewWaveFormData: overviewBlob([
      [10, 20, 30],
      [60, 40, 20],
    ]),
  }
}
