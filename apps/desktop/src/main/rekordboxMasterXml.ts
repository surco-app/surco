import { dirname, join } from 'node:path'

// rekordbox 6 and 7 keep every playlist and folder twice: as a row in master.db and as a
// NODE in masterPlaylists6.xml beside it, where the row ID is written in hex.
// Creating a playlist or folder means adding both, as pyrekordbox does; moving tracks
// never touches this file (measured: link edits do not even change the playlist row). The
// file is edited as text, not reparsed and reserialised, so everything rekordbox wrote
// (its CRLF line ends, the iTunes nodes, nodes the database no longer has) stays byte for
// byte.

// The decimal row ID in uppercase hex without leading zeros, and the root as "0" (measured
// on the real file: 30D40 is 200000).
export function hexId(id: string): string {
  return id === 'root' ? '0' : BigInt(id).toString(16).toUpperCase()
}

export function playlistXmlPath(collectionPath: string): string {
  return join(dirname(collectionPath), 'masterPlaylists6.xml')
}

export function withPlaylistNode(
  xml: string,
  node: { id: string; parentId: string; attribute: 0 | 1; timestamp: number },
): string {
  const eol = xml.includes('\r\n') ? '\r\n' : '\n'
  const line = `    <NODE Id="${hexId(node.id)}" ParentId="${hexId(node.parentId)}" Attribute="${node.attribute}" Timestamp="${node.timestamp}" Lib_Type="0" CheckType="0"/>`
  const close = xml.lastIndexOf('</PLAYLISTS>')
  if (close !== -1) {
    const lineStart = xml.lastIndexOf('\n', close) + 1
    return `${xml.slice(0, lineStart)}${line}${eol}${xml.slice(lineStart)}`
  }
  const empty = xml.indexOf('<PLAYLISTS/>')
  if (empty === -1) throw new Error('masterPlaylists6.xml has no PLAYLISTS element')
  return `${xml.slice(0, empty)}<PLAYLISTS>${eol}${line}${eol}  </PLAYLISTS>${xml.slice(empty + '<PLAYLISTS/>'.length)}`
}

export function xmlNodeIds(xml: string): Set<string> {
  return new Set([...xml.matchAll(/<NODE [^>]*\bId="([^"]+)"/g)].map((m) => m[1]))
}
