// Characters XML 1.0 cannot carry at all, not even as a character reference: C0 controls
// other than tab, LF and CR, the U+FFFE/U+FFFF noncharacters, and an unpaired surrogate
// (with the u flag a well-formed pair is one code point, so \p{Cs} only sees lone halves).
// They can reach a tag from any file, and one of them makes the whole document ill-formed.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const XML_ILLEGAL = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|\p{Cs}/gu

export function stripXmlIllegal(s: string): string {
  return s.replace(XML_ILLEGAL, '')
}

// The XML escaping both DJ exports need — rekordbox's DJ_PLAYLISTS and Traktor's .nml are
// both XML, and either will drop a track (or refuse the file) over an unescaped & or < in a
// tag. Shared rather than copy-pasted per exporter so a fix here can't leave the other one
// carrying the bug. The ampersand must be replaced first: doing it after < would rewrite
// the &lt; it just produced into &amp;lt;.
export function escapeXml(s: string): string {
  return stripXmlIllegal(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
