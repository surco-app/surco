// The XML escaping both DJ exports need — rekordbox's DJ_PLAYLISTS and Traktor's .nml are
// both XML, and either will drop a track (or refuse the file) over an unescaped & or < in a
// tag. Shared rather than copy-pasted per exporter so a fix here can't leave the other one
// carrying the bug. The ampersand must be replaced first: doing it after < would rewrite
// the &lt; it just produced into &amp;lt;.
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
