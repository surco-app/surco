// The size of an ID3v2 tag sitting at the start of a file, or 0 when there is none.
// FLAC files Surco writes with "Finder covers" enabled (and files processed by other
// tools with the same trick) carry one before the fLaC marker, so every parser that
// expects a container magic at byte 0 needs this offset first. The four size bytes
// are "syncsafe" — 7 bits each, high bit always clear — and exclude the 10-byte
// header itself and the optional 10-byte footer (flag bit 0x10).
export function leadingId3v2Size(head: Buffer): number {
  if (head.length < 10 || head.toString('latin1', 0, 3) !== 'ID3') return 0
  const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]
  const footer = (head[5] & 0x10) !== 0 ? 10 : 0
  return 10 + size + footer
}
