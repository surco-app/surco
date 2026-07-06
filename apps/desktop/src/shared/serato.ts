
// Builds a Serato DJ ".crate" file from the loaded tracks. Unlike rekordbox/Traktor (plain
// text), a crate is a binary tree of frames: a 4-byte ASCII tag, a 4-byte big-endian length,
// then the payload. Text payloads are UTF-16 big-endian; container frames ('o…') hold child
// frames. Serato imports each track by its `ptrk` path, so the path is the one part that must
// be exactly right; the columns are just which fields Serato shows. Pure so it can be
// unit-tested without the filesystem — the caller writes the returned bytes to disk.

// The canonical version string Serato writes at the head of every ScratchLive/Serato DJ crate.
const VERSION = '1.0/Serato ScratchLive Crate'

// The columns a crate declares, in display order. "song" leads (and is the sort column), then
// the fields a DJ actually scans; widths are left at "0" so Serato uses its own defaults.
const COLUMNS = ['song', 'playCount', 'artist', 'bpm', 'key', 'album', 'length', 'comment', 'added']

function utf16be(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    bytes[i * 2] = code >> 8
    bytes[i * 2 + 1] = code & 0xff
  }
  return bytes
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

// One frame: tag + big-endian uint32 body length + body.
function frame(tag: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length)
  for (let i = 0; i < 4; i++) out[i] = tag.charCodeAt(i)
  const len = body.length
  out[4] = (len >>> 24) & 0xff
  out[5] = (len >>> 16) & 0xff
  out[6] = (len >>> 8) & 0xff
  out[7] = len & 0xff
  out.set(body, 8)
  return out
}

function textFrame(tag: string, value: string): Uint8Array {
  return frame(tag, utf16be(value))
}

function columnFrame(name: string): Uint8Array {
  return frame('ovct', concat([textFrame('tvcn', name), textFrame('tvcw', '0')]))
}

// The root of the volume a file lives on: an external volume on macOS (/Volumes/Name),
// a drive letter on Windows, '' for the boot volume.
function volumeRoot(path: string): string {
  const mac = path.match(/^\/Volumes\/[^/]+/)
  if (mac) return mac[0]
  const win = path.replace(/\\/g, '/').match(/^[A-Za-z]:/)
  return win ? win[0] : ''
}

// Serato stores track paths relative to the root of the volume the CRATE lives on:
// forward slashes, no leading slash (macOS) and no drive letter (Windows). A crate
// saved into an external drive's own _Serato_ folder (the standard USB workflow) must
// therefore lose the whole /Volumes/Name prefix its tracks share with it — while a
// boot-volume crate keeps that prefix, which is what resolves from "/". Tracks on a
// different volume than the crate can't be represented and keep the boot-relative form.
function seratoPath(path: string, crateRoot: string): string {
  const slashed = path.replace(/\\/g, '/')
  if (crateRoot && slashed.toLowerCase().startsWith(`${crateRoot.toLowerCase()}/`))
    return slashed.slice(crateRoot.length + 1)
  return slashed.replace(/^[A-Za-z]:/, '').replace(/^\/+/, '')
}

// `crateFilePath` is where the caller will save the crate — known only after the save
// dialog, which is why main builds the bytes rather than the renderer.
export function buildSeratoCrate(
  tracks: { inputPath: string; outputPath?: string }[],
  crateFilePath = '',
): Uint8Array {
  const crateRoot = crateFilePath ? volumeRoot(crateFilePath) : ''
  const frames: Uint8Array[] = [
    textFrame('vrsn', VERSION),
    // Sort by the song column, ascending (brev = 0).
    frame('osrt', concat([textFrame('tvcn', 'song'), frame('brev', new Uint8Array([0]))])),
    ...COLUMNS.map(columnFrame),
  ]
  for (const t of tracks) {
    // Point at the converted output when there is one; Serato should reference the file the
    // DJ will actually play, not the pre-conversion source.
    const path = t.outputPath ?? t.inputPath
    frames.push(frame('otrk', textFrame('ptrk', seratoPath(path, crateRoot))))
  }
  return concat(frames)
}
