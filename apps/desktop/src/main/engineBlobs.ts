import { inflateSync } from 'node:zlib'

export function inflateEngineBlob(blob: Uint8Array): Buffer {
  return inflateSync(Buffer.from(blob).subarray(4))
}

export interface EngineTrackData {
  sampleRate: number
  sampleCount: number
}

export function decodeTrackData(raw: Buffer): EngineTrackData | null {
  if (raw.length < 16) return null
  return { sampleRate: raw.readDoubleBE(0), sampleCount: Number(raw.readBigInt64BE(8)) }
}

export interface EngineBeatMarker {
  sample: number
  beat: number
}

const MARKER_BYTES = 24

function readGrid(raw: Buffer, at: number): { markers: EngineBeatMarker[]; end: number } | null {
  if (raw.length < at + 8) return null
  const count = Number(raw.readBigInt64BE(at))
  const end = at + 8 + count * MARKER_BYTES
  if (count < 0 || raw.length < end) return null
  const markers = Array.from({ length: count }, (_, i) => {
    const m = at + 8 + i * MARKER_BYTES
    return { sample: raw.readDoubleLE(m), beat: Number(raw.readBigInt64LE(m + 8)) }
  })
  return { markers, end }
}

export function decodeBeatGrid(
  raw: Buffer,
): { sampleRate: number; markers: EngineBeatMarker[] } | null {
  if (raw.length < 17) return null
  const base = readGrid(raw, 17)
  const adjusted = base ? readGrid(raw, base.end) : null
  if (!adjusted) return null
  return { sampleRate: raw.readDoubleBE(0), markers: adjusted.markers }
}

export interface EngineQuickCue {
  label: string
  sample: number
  argb: number
}

export interface EngineQuickCueSlot {
  bytes: Buffer
  cue: EngineQuickCue | null
}

export interface EngineQuickCues {
  slots: EngineQuickCueSlot[]
  tail: Buffer
}

export const EMPTY_CUE_SAMPLE = -1

export function decodeQuickCues(raw: Buffer): EngineQuickCues | null {
  if (raw.length < 8) return null
  const count = Number(raw.readBigInt64BE(0))
  const slots: EngineQuickCueSlot[] = []
  let at = 8
  for (let i = 0; i < count; i++) {
    if (raw.length < at + 1) return null
    const labelEnd = at + 1 + raw[at]
    const end = labelEnd + 12
    if (raw.length < end) return null
    const sample = raw.readDoubleBE(labelEnd)
    slots.push({
      bytes: raw.subarray(at, end),
      cue:
        sample === EMPTY_CUE_SAMPLE
          ? null
          : {
              label: raw.toString('utf8', at + 1, labelEnd),
              sample,
              argb: raw.readUInt32BE(labelEnd + 8),
            },
    })
    at = end
  }
  return { slots, tail: raw.subarray(at) }
}

export type EngineBands = [number, number, number]

export function decodeOverview(raw: Buffer): { entries: EngineBands[]; max: EngineBands } | null {
  if (raw.length < 24) return null
  const count = Number(raw.readBigInt64BE(0))
  if (count < 0 || raw.length < 24 + (count + 1) * 3) return null
  const band = (i: number): EngineBands => {
    const at = 24 + i * 3
    return [raw[at], raw[at + 1], raw[at + 2]]
  }
  return { entries: Array.from({ length: count }, (_, i) => band(i)), max: band(count) }
}
