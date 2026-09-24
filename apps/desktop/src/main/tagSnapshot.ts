import { createHash } from 'node:crypto'
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { extname } from 'node:path'
import {
  type ByteVector,
  Id3v2FrameClassType as FrameClassType,
  type Id3v2AttachmentFrame,
  type Id3v2CommentsFrame,
  type Id3v2Frame,
  type Id3v2PopularimeterFrame,
  type Id3v2PrivateFrame,
  type Id3v2Tag,
  type Id3v2TextInformationFrame,
  type Id3v2UniqueFileIdentifierFrame,
  type Id3v2UrlLinkFrame,
  type Id3v2UserTextInformationFrame,
  type Id3v2UserUrlLinkFrame,
  StringType,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'

// Every tag a file carries, spelled the way it sits on disk: one line per field, sorted,
// with binary payloads reduced to a hash and a length. The point is the observer.
// ffprobe and `ffmpeg -i` fold spellings on the way out (a FLAC's DESCRIPTION comes back
// as "comment", ALBUMARTIST as "album_artist"), so a test that reads a converted file
// through them cannot see a field renamed, an alias left behind or a picture whose type
// changed — which is how four such defects reached a user at once (17/09/2026). Lines
// are strings so a diff between two snapshots reads as what changed, not as objects.
export function snapshotTags(file: string): string[] {
  const ext = extname(file).toLowerCase()
  const lines: string[] = []
  const f = TagFile.createFromPath(file)
  try {
    const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
    if (xiph) {
      for (const name of xiph.fieldNames)
        for (const value of xiph.getField(name)) lines.push(`xiph ${name}=${value}`)
    }
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    if (id3) for (const frame of id3.frames) lines.push(`id3 ${describeFrame(frame)}`)
    if (f.getTag(TagTypes.Id3v1, false)) lines.push('id3v1 present')
    if (f.getTag(TagTypes.Ape, false)) lines.push('ape present')
    // Pictures outside ID3 (a FLAC's PICTURE blocks, an M4A's covr) come through the
    // generic tag; ID3's own are already listed as APIC frames above.
    if (ext !== '.mp3' && ext !== '.aiff' && ext !== '.aif')
      for (const p of f.tag.pictures)
        lines.push(`picture type=${p.type} mime=${p.mimeType} ${digest(p.data)}`)
    if (ext === '.m4a') lines.push(...describeApple(f))
  } finally {
    f.dispose()
  }
  if (ext === '.wav') lines.push(...riffInfo(file))
  if (ext === '.flac' && readAt(file, 0, 3).toString('latin1') === 'ID3')
    lines.push('flac id3-prefix present')
  return lines.sort()
}

// The lines in `after` that are not in `before` (added) and the reverse (removed), for a
// failure message that names the exact field.
export function diffSnapshots(
  before: string[],
  after: string[],
): { added: string[]; removed: string[] } {
  const a = new Set(before)
  const b = new Set(after)
  return {
    added: after.filter((l) => !a.has(l)),
    removed: before.filter((l) => !b.has(l)),
  }
}

function digest(data: ByteVector): string {
  return `sha1=${createHash('sha1').update(data.toByteArray()).digest('hex').slice(0, 12)} len=${data.length}`
}

function describeFrame(frame: Id3v2Frame): string {
  const id = frame.frameId.toString()
  switch (frame.frameClassType) {
    case FrameClassType.TextInformationFrame:
      return `${id}=${(frame as Id3v2TextInformationFrame).text.join('|')}`
    case FrameClassType.UserTextInformationFrame: {
      const u = frame as Id3v2UserTextInformationFrame
      return `${id}[${u.description}]=${u.text.join('|')}`
    }
    case FrameClassType.CommentsFrame: {
      const c = frame as Id3v2CommentsFrame
      return `${id}[${c.language},${c.description}]=${c.text}`
    }
    case FrameClassType.AttachmentFrame: {
      const a = frame as Id3v2AttachmentFrame
      return `${id}[type=${a.type},mime=${a.mimeType},desc=${a.description}] ${digest(a.data)}`
    }
    case FrameClassType.PrivateFrame: {
      const p = frame as Id3v2PrivateFrame
      return `${id}[${p.owner}] ${digest(p.privateData)}`
    }
    case FrameClassType.PopularimeterFrame: {
      const p = frame as Id3v2PopularimeterFrame
      return `${id}[${p.user}]=rating ${p.rating} plays ${p.playCount}`
    }
    case FrameClassType.UniqueFileIdentifierFrame: {
      const u = frame as Id3v2UniqueFileIdentifierFrame
      return `${id}[${u.owner}]=${u.identifier?.toString(StringType.Latin1) ?? ''}`
    }
    case FrameClassType.UrlLinkFrame:
      return `${id}=${(frame as Id3v2UrlLinkFrame).text.join('|')}`
    case FrameClassType.UserUrlLinkFrame: {
      const u = frame as Id3v2UserUrlLinkFrame
      return `${id}[${u.description}]=${u.text.join('|')}`
    }
    default:
      return `${id} ${digest(frame.render(4))}`
  }
}

// The iTunes atoms: TagLib exposes them only through named getters, so the list is
// read straight from the file's ilst box. Each child is `name` (four chars, or the
// freeform mean:name) followed by its data payloads.
function describeApple(f: TagFile): string[] {
  const tag = f.tag as unknown as {
    _ilstBox?: { children: { boxType: ByteVector; children: unknown[] }[] }
  }
  const items = tag._ilstBox?.children ?? []
  return items.map((box) => {
    const name = box.boxType.toString(StringType.Latin1)
    // A data box says whether it holds text through its flags; a picture or a BPM
    // integer read as text would put binary into the line.
    const data = (
      box.children as { boxType: ByteVector; flags?: number; data?: ByteVector; text?: string }[]
    )
      .filter((c) => c.boxType.toString(StringType.Latin1) === 'data')
      .map((c) => (c.flags === 1 ? (c.text ?? '') : c.data ? digest(c.data) : ''))
    return `mp4 ${name}=${data.join('|')}`
  })
}

// The bytes at [position, position + length) of a file, read in place: the snapshot runs
// on the main process for every conversion's input and output, so reading whole files to
// look at a few header bytes stalled the app for a full read each time.
function readAt(file: string, position: number, length: number): Buffer {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(length)
    return buf.subarray(0, readSync(fd, buf, 0, length, position))
  } finally {
    closeSync(fd)
  }
}

// The RIFF INFO sub-chunks, read off the chunk tree: TagLib's RiffListTag hands values
// back by id but never lists the ids it holds. Walks the chunk headers in place and
// reads only the INFO list's body, never the audio.
function riffInfo(file: string): string[] {
  const fd = openSync(file, 'r')
  try {
    const fileSize = fstatSync(fd).size
    const header = Buffer.alloc(12)
    const lines: string[] = []
    let i = 12
    while (i + 8 <= fileSize) {
      readSync(fd, header, 0, 12, i)
      const id = header.toString('latin1', 0, 4)
      const size = header.readUInt32LE(4)
      if (id === 'LIST' && header.toString('latin1', 8, 12) === 'INFO') {
        const body = Buffer.alloc(Math.max(0, Math.min(size, fileSize - i - 8) - 4))
        readSync(fd, body, 0, body.length, i + 12)
        let j = 0
        while (j + 8 <= body.length) {
          const sub = body.toString('latin1', j, j + 4)
          const subSize = body.readUInt32LE(j + 4)
          const text = body.toString('utf8', j + 8, j + 8 + subSize).replace(/\0+$/, '')
          lines.push(`riff ${sub}=${text}`)
          j += 8 + subSize + (subSize % 2)
        }
      }
      i += 8 + size + (size % 2)
    }
    return lines
  } finally {
    closeSync(fd)
  }
}
