import { closeSync, openSync, readSync } from 'node:fs'

// A LAME encoder primes its filterbank with 1105 silent samples before the audio
// proper. The Xing/Info frame the encoder writes ahead of the stream records that
// priming so a decoder can drop it again; ffmpeg does exactly that, which is why a
// normal MP3 decodes sample-aligned with whatever it was made from. Strip the header
// — as rips, cuts and some tag editors do — and the delay becomes audio: every sample
// arrives 1105 late, and so does every Traktor cue copied onto the converted file.
// Measured 2026-09-06 against the bundled ffmpeg (see mp3EncoderDelay.test.ts).
const ENCODER_DELAY_SAMPLES = 1105
const MP3_SAMPLE_RATE = 44100
export const MP3_ENCODER_DELAY_MS = (ENCODER_DELAY_SAMPLES / MP3_SAMPLE_RATE) * 1000

// Enough to clear an ID3v2 tag of any realistic size and still hold the first audio
// frame: the tag length is read from its own header, so this only bounds the search.
const SCAN_BYTES = 1024 * 128
const ID3_HEADER_BYTES = 10

// Distance from the frame header to where a Xing/Info tag starts, which depends on
// how much side information the frame carries — itself a function of MPEG version and
// whether the frame is mono. These are the four combinations LAME can emit.
const SIDE_INFO_BYTES = { mpeg1Stereo: 32, mpeg1Mono: 17, mpeg2Stereo: 17, mpeg2Mono: 9 }

// An ID3v2 tag sits in front of the audio and its size is stored as four
// synchsafe bytes (7 bits each) so the length can never imitate a frame sync.
function id3Length(buf: Buffer): number {
  if (buf.length < ID3_HEADER_BYTES) return 0
  if (buf.toString('latin1', 0, 3) !== 'ID3') return 0
  const size =
    ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
  return ID3_HEADER_BYTES + size
}

// Frame sync is eleven set bits; the two bits after them give the MPEG version and
// the two after that the layer. Only MPEG 1/2 Layer III can carry a LAME header.
function isFrameHeader(buf: Buffer, off: number): boolean {
  if (off + 4 > buf.length) return false
  if (buf[off] !== 0xff || (buf[off + 1] & 0xe0) !== 0xe0) return false
  const version = (buf[off + 1] >> 3) & 0x03
  const layer = (buf[off + 1] >> 1) & 0x03
  return version !== 0x01 && layer === 0x01
}

function sideInfoBytes(buf: Buffer, off: number): number {
  const mpeg1 = ((buf[off + 1] >> 3) & 0x03) === 0x03
  const mono = ((buf[off + 3] >> 6) & 0x03) === 0x03
  if (mpeg1) return mono ? SIDE_INFO_BYTES.mpeg1Mono : SIDE_INFO_BYTES.mpeg1Stereo
  return mono ? SIDE_INFO_BYTES.mpeg2Mono : SIDE_INFO_BYTES.mpeg2Stereo
}

function readHead(file: string): Buffer | null {
  let fd: number | undefined
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(SCAN_BYTES)
    const read = readSync(fd, buf, 0, SCAN_BYTES, 0)
    return buf.subarray(0, read)
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

// True when converting this file will push every sample — and so every cue carried
// across — later by MP3_ENCODER_DELAY_MS, because the header that would have told the
// decoder to drop the priming samples is missing. False for anything that is not an
// MP3, for an MP3 whose header is intact, and for a file we cannot read: compensating
// on a guess would move cues the user had placed correctly.
export function mp3DecoderPadsHead(file: string): boolean {
  if (!/\.mp3$/i.test(file)) return false
  const buf = readHead(file)
  if (!buf) return false

  // Past the ID3v2 tag (when present), find the first audio frame. A tag can be
  // followed by padding, so scan rather than trusting the offset to land on 0xff.
  const start = id3Length(buf)
  for (let off = start; off + 4 <= buf.length; off++) {
    if (!isFrameHeader(buf, off)) continue
    const tag = off + 4 + sideInfoBytes(buf, off)
    if (tag + 4 > buf.length) return false
    const marker = buf.toString('latin1', tag, tag + 4)
    // "Xing" for VBR, "Info" for the CBR variant: either one means the delay is
    // recorded and the decoder will subtract it.
    return marker !== 'Xing' && marker !== 'Info'
  }
  // No frame found in the scanned window: not something we can reason about.
  return false
}
