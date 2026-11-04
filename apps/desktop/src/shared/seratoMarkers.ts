export interface SeratoCue {
  index: number
  ms: number
  color: number
  name: string
}

export interface SeratoLoop {
  index: number
  startMs: number
  endMs: number
  name: string
}

export interface SeratoMarkers {
  cues: SeratoCue[]
  loops: SeratoLoop[]
}

const ARMOR_HEADER = 'application/octet-stream\0\0Serato Markers2\0'

function latin1(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(byte)
  return out
}

function decodeBase64(text: string): Uint8Array | null {
  const clean = text.split('\0')[0].replace(/[^A-Za-z0-9+/]/g, '')
  const whole = clean.length % 4 === 1 ? clean.slice(0, -1) : clean
  try {
    return Uint8Array.from(atob(whole + '='.repeat((4 - (whole.length % 4)) % 4)), (c) =>
      c.charCodeAt(0),
    )
  } catch {
    return null
  }
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

function textFrom(bytes: Uint8Array, at: number): string {
  const end = bytes.indexOf(0, at)
  return new TextDecoder().decode(bytes.subarray(at, end === -1 ? bytes.length : end))
}

function readEntries(payload: Uint8Array): SeratoMarkers {
  const markers: SeratoMarkers = { cues: [], loops: [] }
  let at = 2
  while (at < payload.length) {
    const nameEnd = payload.indexOf(0, at)
    if (nameEnd === -1 || nameEnd === at || nameEnd + 5 > payload.length) break
    const name = latin1(payload.subarray(at, nameEnd))
    const length = u32(payload, nameEnd + 1)
    const start = nameEnd + 5
    if (start + length > payload.length) break
    const body = payload.subarray(start, start + length)
    if (name === 'CUE' && body.length >= 12)
      markers.cues.push({
        index: body[1],
        ms: u32(body, 2),
        color: (body[7] << 16) | (body[8] << 8) | body[9],
        name: textFrom(body, 12),
      })
    if (name === 'LOOP' && body.length >= 20)
      markers.loops.push({
        index: body[1],
        startMs: u32(body, 2),
        endMs: u32(body, 6),
        name: textFrom(body, 20),
      })
    at = start + length
  }
  return markers
}

export function markersFromGeob(data: Uint8Array): SeratoMarkers | null {
  if (data.length < 2 || data[0] !== 1 || data[1] !== 1) return null
  const payload = decodeBase64(latin1(data.subarray(2)))
  if (!payload || payload.length < 2 || payload[0] !== 1 || payload[1] !== 1) return null
  return readEntries(payload)
}

export function markersFromArmored(value: string): SeratoMarkers | null {
  const geob = decodeBase64(value.replace(/\s/g, ''))
  if (!geob || !latin1(geob.subarray(0, ARMOR_HEADER.length)).startsWith(ARMOR_HEADER)) return null
  return markersFromGeob(geob.subarray(ARMOR_HEADER.length))
}

const TEMPO_ARMOR_HEADER = 'application/octet-stream\0\0Serato Tempo Map\0'
const GEOB_MIN_LENGTH = 470
const LINE_LENGTH = 72

function f64(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(at)
}

function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0))
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function encodeBase64Wrapped(bytes: Uint8Array): string {
  const text = btoa(latin1(bytes))
  const lines: string[] = []
  for (let at = 0; at < text.length; at += LINE_LENGTH) lines.push(text.slice(at, at + LINE_LENGTH))
  return lines.join('\n')
}

function entryBytes(name: string, body: Uint8Array): Uint8Array {
  const head = new Uint8Array(name.length + 5)
  head.set(bytesOf(name), 0)
  new DataView(head.buffer).setUint32(name.length + 1, body.length)
  return concat([head, body])
}

function cueBody(cue: SeratoCue): Uint8Array {
  const name = new TextEncoder().encode(cue.name)
  const body = new Uint8Array(12 + name.length + 1)
  body[1] = cue.index
  new DataView(body.buffer).setUint32(2, cue.ms)
  body[7] = (cue.color >> 16) & 0xff
  body[8] = (cue.color >> 8) & 0xff
  body[9] = cue.color & 0xff
  body.set(name, 12)
  return body
}

export function seratoPayloadOf(source: Uint8Array | string): Uint8Array | null {
  let geob: Uint8Array
  if (typeof source === 'string') {
    const armored = decodeBase64(source.replace(/\s/g, ''))
    if (!armored || !latin1(armored.subarray(0, ARMOR_HEADER.length)).startsWith(ARMOR_HEADER))
      return null
    geob = armored.subarray(ARMOR_HEADER.length)
  } else geob = source
  if (geob.length < 2 || geob[0] !== 1 || geob[1] !== 1) return null
  const payload = decodeBase64(latin1(geob.subarray(2)))
  if (!payload || payload.length < 2 || payload[0] !== 1 || payload[1] !== 1) return null
  return payload
}

export function withSeratoCues(payload: Uint8Array | null, cues: SeratoCue[]): Uint8Array {
  const fresh = cues.map((cue) => entryBytes('CUE', cueBody(cue)))
  if (!payload)
    return concat([
      Uint8Array.from([1, 1]),
      entryBytes('COLOR', Uint8Array.from([0, 255, 255, 255])),
      ...fresh,
      entryBytes('BPMLOCK', Uint8Array.from([0])),
    ])
  const kept: { name: string; raw: Uint8Array }[] = []
  let insertAt = -1
  let at = 2
  while (at < payload.length) {
    const nameEnd = payload.indexOf(0, at)
    if (nameEnd === -1 || nameEnd === at || nameEnd + 5 > payload.length) break
    const end = nameEnd + 5 + u32(payload, nameEnd + 1)
    if (end > payload.length) break
    const name = latin1(payload.subarray(at, nameEnd))
    if (name === 'CUE') {
      if (insertAt === -1) insertAt = kept.length
    } else kept.push({ name, raw: payload.subarray(at, end) })
    at = end
  }
  if (insertAt === -1) {
    insertAt = kept.findIndex((entry) => entry.name !== 'COLOR')
    if (insertAt === -1) insertAt = kept.length
  }
  const raws = kept.map((entry) => entry.raw)
  return concat([
    payload.subarray(0, 2),
    ...raws.slice(0, insertAt),
    ...fresh,
    ...raws.slice(insertAt),
    payload.subarray(at),
  ])
}

const TIMED_FIELDS: Record<string, number[]> = { CUE: [2], LOOP: [2, 6] }

export function retimedSeratoPayload(payload: Uint8Array, shiftMs: number, fromMs = 0): Uint8Array {
  const parts: Uint8Array[] = [payload.subarray(0, 2)]
  let at = 2
  while (at < payload.length) {
    const nameEnd = payload.indexOf(0, at)
    if (nameEnd === -1 || nameEnd === at || nameEnd + 5 > payload.length) break
    const end = nameEnd + 5 + u32(payload, nameEnd + 1)
    if (end > payload.length) break
    const entry = payload.slice(at, end)
    const view = new DataView(entry.buffer)
    const fields = (TIMED_FIELDS[latin1(payload.subarray(at, nameEnd))] ?? [])
      .map((field) => nameEnd + 5 - at + field)
      .filter((offset) => offset + 4 <= entry.length)
    if (fields.every((offset) => view.getUint32(offset) >= fromMs)) {
      for (const offset of fields)
        view.setUint32(offset, Math.max(0, Math.round(view.getUint32(offset) + shiftMs)))
      parts.push(entry)
    }
    at = end
  }
  parts.push(payload.subarray(at))
  return concat(parts)
}

export function seratoGeobBody(payload: Uint8Array): Uint8Array {
  const text = bytesOf(encodeBase64Wrapped(payload))
  const body = new Uint8Array(Math.max(GEOB_MIN_LENGTH, 2 + text.length))
  body[0] = 1
  body[1] = 1
  body.set(text, 2)
  return body
}

export function seratoArmored(payload: Uint8Array): string {
  return `${encodeBase64Wrapped(concat([bytesOf(ARMOR_HEADER), seratoGeobBody(payload)]))}\n`
}

const MIN_TEMPO_BPM = 20
const MAX_TEMPO_BPM = 400

export interface SeratoTempoMap {
  firstBeatMs: number
  bpm: number
}

export function readSeratoTempoMap(data: Uint8Array): SeratoTempoMap | null {
  if (data.length < 32 || data[0] !== 2 || data[1] !== 0) return null
  if (((data[2] << 8) | data[3]) !== 1) return null
  const firstBeatMs = f64(data, 4) * 1000
  const bpm = f64(data, 24)
  if (
    !Number.isFinite(firstBeatMs) ||
    !Number.isFinite(bpm) ||
    bpm < MIN_TEMPO_BPM ||
    bpm > MAX_TEMPO_BPM
  )
    return null
  return { firstBeatMs, bpm }
}

export function readSeratoTempoMapArmored(value: string): SeratoTempoMap | null {
  const armored = decodeBase64(value.replace(/\s/g, ''))
  if (
    !armored ||
    !latin1(armored.subarray(0, TEMPO_ARMOR_HEADER.length)).startsWith(TEMPO_ARMOR_HEADER)
  )
    return null
  return readSeratoTempoMap(armored.subarray(TEMPO_ARMOR_HEADER.length))
}

const V1_ARMOR_HEADER = 'application/octet-stream\0\0Serato Markers_\0'
const V1_ENTRY_BYTES = 22
const V1_M4A_ENTRY_BYTES = 19
const V1_M4A_UNSET = 0xffffffff
const V1_CUE_SLOTS = 5
const V1_SET = 0x00
const V1_UNSET = 0x7f
const V1_SAME_MS = 1

function sevenBit(bytes: Uint8Array, at: number): number | null {
  const groups = bytes.subarray(at, at + 4)
  if (groups.some((b) => b > 0x7f)) return null
  return ((groups[0] << 21) | (groups[1] << 14) | (groups[2] << 7) | groups[3]) >>> 0
}

export function seratoV1CueTimes(block: Uint8Array): (number | null)[] | null {
  if (block.length < 6 || block[0] !== 2 || block[1] !== 5) return null
  const count = u32(block, 2)
  if (block.length < 6 + count * V1_ENTRY_BYTES) return null
  const times: (number | null)[] = []
  for (let slot = 0; slot < Math.min(count, V1_CUE_SLOTS); slot++) {
    const at = 6 + slot * V1_ENTRY_BYTES
    if (block[at] === V1_UNSET) times.push(null)
    else if (block[at] !== V1_SET) return null
    else {
      const ms = sevenBit(block, at + 1)
      if (ms === null) return null
      times.push(ms)
    }
  }
  return times
}

export function seratoV1CueTimesArmored(value: string): (number | null)[] | null {
  const armored = decodeBase64(value.replace(/\s/g, ''))
  if (!armored || !latin1(armored.subarray(0, V1_ARMOR_HEADER.length)).startsWith(V1_ARMOR_HEADER))
    return null
  return m4aV1CueTimes(armored.subarray(V1_ARMOR_HEADER.length))
}

function m4aV1CueTimes(block: Uint8Array): (number | null)[] | null {
  if (block.length < 6 || block[0] !== 2 || block[1] !== 5) return null
  const count = u32(block, 2)
  if (block.length < 6 + count * V1_M4A_ENTRY_BYTES) return null
  const times: (number | null)[] = []
  for (let slot = 0; slot < Math.min(count, V1_CUE_SLOTS); slot++) {
    const at = 6 + slot * V1_M4A_ENTRY_BYTES
    if (block[at + 8] !== 0) return null
    const ms = u32(block, at)
    times.push(ms === V1_M4A_UNSET ? null : ms)
  }
  return times
}

export function seratoV1Agrees(
  times: (number | null)[] | null,
  markers: SeratoMarkers | null,
): boolean {
  if (!times || !markers) return false
  return times.every((ms, slot) => {
    const cue = markers.cues.find((c) => c.index === slot)
    return ms === null
      ? cue === undefined
      : cue !== undefined && Math.abs(cue.ms - ms) <= V1_SAME_MS
  })
}
