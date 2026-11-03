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
