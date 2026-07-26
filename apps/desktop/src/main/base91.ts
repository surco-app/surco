// basE91 (Joachim Henke), the armoring Traktor wraps its cue/beatgrid blob in to
// put it inside a FLAC Vorbis comment: comments are UTF-8 text, so the binary
// tree that rides an ID3 PRIV frame on MP3/AIFF has to reach FLAC as printable
// characters. The alphabet is every printable ASCII from '!' to '~' except the
// quote, backslash and apostrophe — 91 symbols, packing 13 or 14 bits per pair
// instead of base64's 6 per character, which is why a 54 KB tree lands in ~65 KB
// of text rather than ~72 KB. Confirmed against a real Traktor-written FLAC.
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~"'

const VALUES = new Map([...ALPHABET].map((c, i) => [c, i]))

// Characters outside the alphabet are skipped rather than decoded: the field is
// one long line in the file, but anything that reads it back through a tagger or
// a copy-paste can wrap it, and a newline is not data.
export function decodeBase91(text: string): Buffer {
  const out: number[] = []
  let queue = 0
  let bits = 0
  let value = -1
  for (const ch of text) {
    const digit = VALUES.get(ch)
    if (digit === undefined) continue
    if (value < 0) {
      value = digit
      continue
    }
    value += digit * 91
    queue |= value << bits
    // 13 bits when the low 13 can't hold the pair, 14 when they can — the
    // variable width is what makes the scheme denser than a fixed base85.
    bits += (value & 8191) > 88 ? 13 : 14
    while (bits > 7) {
      out.push(queue & 255)
      queue >>= 8
      bits -= 8
    }
    value = -1
  }
  if (value >= 0) out.push((queue | (value << bits)) & 255)
  return Buffer.from(out)
}

export function encodeBase91(bytes: Uint8Array): string {
  let out = ''
  let queue = 0
  let bits = 0
  for (const byte of bytes) {
    queue |= byte << bits
    bits += 8
    if (bits > 13) {
      let value = queue & 8191
      if (value > 88) {
        queue >>= 13
        bits -= 13
      } else {
        value = queue & 16383
        queue >>= 14
        bits -= 14
      }
      out += ALPHABET[value % 91] + ALPHABET[(value / 91) | 0]
    }
  }
  if (bits) {
    out += ALPHABET[queue % 91]
    if (bits > 7 || queue > 90) out += ALPHABET[(queue / 91) | 0]
  }
  return out
}
