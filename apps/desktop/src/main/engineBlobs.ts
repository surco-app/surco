import { deflateSync, inflateSync } from 'node:zlib'

export function inflateEngineBlob(blob: Uint8Array): Buffer {
  return inflateSync(Buffer.from(blob).subarray(4))
}

export function deflateEngineBlob(raw: Uint8Array): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(raw.length)
  return Buffer.concat([length, deflateSync(raw)])
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

export function decodeBeatGrid(raw: Buffer): {
  sampleRate: number
  markers: EngineBeatMarker[]
  defaultMarkers: EngineBeatMarker[]
} | null {
  if (raw.length < 17) return null
  const base = readGrid(raw, 17)
  const adjusted = base ? readGrid(raw, base.end) : null
  if (!base || !adjusted) return null
  return {
    sampleRate: raw.readDoubleBE(0),
    markers: adjusted.markers,
    defaultMarkers: base.markers,
  }
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

export function quickCueSlotBytes(cue: EngineQuickCue | null): Buffer {
  const label = Buffer.from(cue?.label ?? '', 'utf8').subarray(0, 255)
  const rest = Buffer.alloc(12)
  rest.writeDoubleBE(cue?.sample ?? EMPTY_CUE_SAMPLE, 0)
  rest.writeUInt32BE(cue?.argb ?? 0, 8)
  return Buffer.concat([Buffer.from([label.length]), label, rest])
}

export function encodeQuickCues(slots: Buffer[], tail: Buffer): Buffer {
  const count = Buffer.alloc(8)
  count.writeBigInt64BE(BigInt(slots.length))
  return Buffer.concat([count, ...slots, tail])
}

export interface EngineLoop {
  label: string
  start: number
  end: number
  startSet: boolean
  endSet: boolean
  argb: number
  // The slot as Engine stored it, written back with only its positions replaced.
  bytes?: Buffer
}

export interface EngineLoops {
  loops: EngineLoop[]
  tail: Buffer
}

export function decodeLoops(raw: Buffer): EngineLoops | null {
  if (raw.length < 8) return null
  const count = Number(raw.readBigInt64LE(0))
  if (count < 0 || count > raw.length) return null
  const loops: EngineLoop[] = []
  let at = 8
  for (let i = 0; i < count; i++) {
    if (raw.length < at + 1) return null
    const labelEnd = at + 1 + raw[at]
    if (raw.length < labelEnd + 22) return null
    loops.push({
      label: raw.toString('utf8', at + 1, labelEnd),
      start: raw.readDoubleLE(labelEnd),
      end: raw.readDoubleLE(labelEnd + 8),
      startSet: raw[labelEnd + 16] !== 0,
      endSet: raw[labelEnd + 17] !== 0,
      argb: raw.readUInt32BE(labelEnd + 18),
      bytes: raw.subarray(at, labelEnd + 22),
    })
    at = labelEnd + 22
  }
  return { loops, tail: raw.subarray(at) }
}

function loopSlotBytes(loop: EngineLoop): Buffer {
  if (loop.bytes) {
    const slot = Buffer.from(loop.bytes)
    slot.writeDoubleLE(loop.start, 1 + slot[0])
    slot.writeDoubleLE(loop.end, 9 + slot[0])
    return slot
  }
  const label = Buffer.from(loop.label, 'utf8').subarray(0, 255)
  const rest = Buffer.alloc(22)
  rest.writeDoubleLE(loop.start, 0)
  rest.writeDoubleLE(loop.end, 8)
  rest[16] = loop.startSet ? 1 : 0
  rest[17] = loop.endSet ? 1 : 0
  rest.writeUInt32BE(loop.argb, 18)
  return Buffer.concat([Buffer.from([label.length]), label, rest])
}

export function encodeLoops(loops: EngineLoop[], tail: Buffer = Buffer.alloc(0)): Buffer {
  const count = Buffer.alloc(8)
  count.writeBigInt64LE(BigInt(loops.length))
  return Buffer.concat([count, ...loops.map(loopSlotBytes), tail])
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
