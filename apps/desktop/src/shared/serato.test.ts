import { describe, expect, it } from 'vitest'
import { buildSeratoCrate } from './serato'

const track = (over: { inputPath?: string; outputPath?: string } = {}): {
  inputPath: string
  outputPath?: string
} => ({ inputPath: over.inputPath ?? '/music/x.wav', outputPath: over.outputPath })

// Walks the crate's top-level frames (tag + big-endian uint32 length + body), so the tests
// assert against the real parsed structure rather than opaque byte offsets — the same shape
// Serato reads back.
interface Frame {
  tag: string
  body: Uint8Array
}
function parseFrames(buf: Uint8Array): Frame[] {
  const frames: Frame[] = []
  let i = 0
  while (i + 8 <= buf.length) {
    const tag = String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3])
    const len = (buf[i + 4] << 24) | (buf[i + 5] << 16) | (buf[i + 6] << 8) | buf[i + 7]
    const body = buf.subarray(i + 8, i + 8 + len)
    frames.push({ tag, body })
    i += 8 + len
  }
  return frames
}
function decodeUtf16be(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i + 1 < bytes.length; i += 2)
    out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
  return out
}

describe('buildSeratoCrate', () => {
  const crate = buildSeratoCrate([
    track({ inputPath: '/music/Run To Me.wav' }),
    track({ inputPath: '/music/b.aiff' }),
  ])
  const frames = parseFrames(crate)

  it('starts with the Serato crate version frame', () => {
    expect(frames[0].tag).toBe('vrsn')
    expect(decodeUtf16be(frames[0].body)).toBe('1.0/Serato ScratchLive Crate')
  })

  it('declares a sort frame and the display columns', () => {
    expect(frames.some((f) => f.tag === 'osrt')).toBe(true)
    // "song" is both the sort column and the first display column Serato shows.
    const columns = frames.filter((f) => f.tag === 'ovct')
    expect(columns.length).toBeGreaterThan(0)
    const firstColumnName = decodeUtf16be(parseFrames(columns[0].body)[0].body)
    expect(firstColumnName).toBe('song')
  })

  it('writes one track frame per file, each carrying its path', () => {
    const tracks = frames.filter((f) => f.tag === 'otrk')
    expect(tracks).toHaveLength(2)
    const path = parseFrames(tracks[0].body).find((c) => c.tag === 'ptrk')
    expect(path && decodeUtf16be(path.body)).toBe('music/Run To Me.wav')
  })

  // Serato resolves paths against the volume root, so the leading slash must be stripped —
  // an absolute "/music/…" path fails to load on import. Spaces are kept verbatim (no URL
  // encoding, unlike rekordbox).
  it('stores the path relative to the volume root with the leading slash removed', () => {
    const tracks = parseFrames(buildSeratoCrate([track({ inputPath: '/Users/me/a.mp3' })])).filter(
      (f) => f.tag === 'otrk',
    )
    const path = parseFrames(tracks[0].body).find((c) => c.tag === 'ptrk')
    expect(path && decodeUtf16be(path.body)).toBe('Users/me/a.mp3')
  })

  it('strips a Windows drive letter and normalises backslashes', () => {
    const tracks = parseFrames(
      buildSeratoCrate([track({ inputPath: 'C:\\Users\\me\\a.mp3' })]),
    ).filter((f) => f.tag === 'otrk')
    const path = parseFrames(tracks[0].body).find((c) => c.tag === 'ptrk')
    expect(path && decodeUtf16be(path.body)).toBe('Users/me/a.mp3')
  })

  it('points the path at the converted output when present', () => {
    const tracks = parseFrames(
      buildSeratoCrate([track({ inputPath: '/in/a.wav', outputPath: '/out/a.aiff' })]),
    ).filter((f) => f.tag === 'otrk')
    const path = parseFrames(tracks[0].body).find((c) => c.tag === 'ptrk')
    expect(path && decodeUtf16be(path.body)).toBe('out/a.aiff')
  })

  // The crate's paths resolve against the volume the CRATE lives on. Saved into an
  // external drive's own _Serato_/Subcrates (the standard USB workflow), a track on
  // that drive must lose the whole /Volumes/USB prefix — the old blanket stripping left
  // 'Volumes/USB/…', which Serato resolved to /Volumes/USB/Volumes/USB/… and every
  // track imported as missing.
  it('makes paths relative to the crate’s own volume when saved on an external drive', () => {
    const tracks = parseFrames(
      buildSeratoCrate(
        [track({ inputPath: '/Volumes/USB/Music/a.aiff' })],
        '/Volumes/USB/_Serato_/Subcrates/Surco.crate',
      ),
    ).filter((f) => f.tag === 'otrk')
    const path = parseFrames(tracks[0].body).find((c) => c.tag === 'ptrk')
    expect(path && decodeUtf16be(path.body)).toBe('Music/a.aiff')
  })

  // A boot-volume crate referencing an external file resolves from "/", so the
  // Volumes prefix is exactly what makes it load — it must survive there.
  it('keeps the Volumes prefix for a crate saved on the boot volume', () => {
    const tracks = parseFrames(
      buildSeratoCrate(
        [track({ inputPath: '/Volumes/USB/Music/a.aiff' })],
        '/Users/me/Music/_Serato_/Subcrates/Surco.crate',
      ),
    ).filter((f) => f.tag === 'otrk')
    const path = parseFrames(tracks[0].body).find((c) => c.tag === 'ptrk')
    expect(path && decodeUtf16be(path.body)).toBe('Volumes/USB/Music/a.aiff')
  })

  it('strips the drive only when it matches the crate’s own on Windows', () => {
    const tracks = parseFrames(
      buildSeratoCrate(
        [track({ inputPath: 'D:\\Music\\a.mp3' })],
        'D:\\_Serato_\\Subcrates\\Surco.crate',
      ),
    ).filter((f) => f.tag === 'otrk')
    const path = parseFrames(tracks[0].body).find((c) => c.tag === 'ptrk')
    expect(path && decodeUtf16be(path.body)).toBe('Music/a.mp3')
  })
})
