export const utf16be = (value: string) =>
  Uint8Array.from([...value].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff]))

export const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export const frame = (tag: string, body: Uint8Array) => {
  const head = new Uint8Array(8)
  for (let i = 0; i < 4; i++) head[i] = tag.charCodeAt(i)
  new DataView(head.buffer).setUint32(4, body.length)
  return concat([head, body])
}

export const track = (fields: Record<string, string>, extra: Uint8Array[] = []) =>
  frame(
    'otrk',
    concat([...Object.entries(fields).map(([tag, value]) => frame(tag, utf16be(value))), ...extra]),
  )
