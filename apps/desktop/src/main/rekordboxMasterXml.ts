import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// rekordbox 6 and 7 keep every playlist and folder twice: as a row in master.db and as a
// NODE in masterPlaylists6.xml beside it, where the row ID is written in hex.
// Creating a playlist or folder means adding both, as pyrekordbox does; moving tracks
// only moves the node's Timestamp (measured: link edits do not even change the playlist row). The
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
    if (xml.slice(lineStart, close).trim() !== '') {
      throw new Error('masterPlaylists6.xml PLAYLISTS is not laid out one node per line')
    }
    return `${xml.slice(0, lineStart)}${line}${eol}${xml.slice(lineStart)}`
  }
  const empty = xml.indexOf('<PLAYLISTS/>')
  if (empty === -1) throw new Error('masterPlaylists6.xml has no PLAYLISTS element')
  return `${xml.slice(0, empty)}<PLAYLISTS>${eol}${line}${eol}  </PLAYLISTS>${xml.slice(empty + '<PLAYLISTS/>'.length)}`
}

export function xmlNodeIds(xml: string): Set<string> {
  return new Set([...xml.matchAll(/<NODE [^>]*\bId="([^"]+)"/g)].map((m) => m[1]))
}

function nodeTag(xml: string, id: string): RegExpExecArray | null {
  return new RegExp(`<NODE [^>]*\\bId="${hexId(id)}"[^>]*>`).exec(xml)
}

export function nodeTimestamp(xml: string, id: string): number | null {
  const tag = nodeTag(xml, id)
  const value = tag && /\bTimestamp="(\d+)"/.exec(tag[0])
  return value ? Number(value[1]) : null
}

export function withNodeTimestamp(xml: string, id: string, timestamp: number): string {
  const tag = nodeTag(xml, id)
  if (!tag) return xml
  const next = tag[0].replace(/\bTimestamp="\d+"/, `Timestamp="${timestamp}"`)
  return `${xml.slice(0, tag.index)}${next}${xml.slice(tag.index + tag[0].length)}`
}

export function withoutNodes(xml: string, ids: string[]): string {
  const doomed = new Set(ids.map(hexId))
  return xml
    .split(/(?<=\n)/)
    .filter((line) => {
      const id = /<NODE [^>]*\bId="([^"]+)"/.exec(line)
      return !(id && doomed.has(id[1]))
    })
    .join('')
}

export function nodeTimestamps(xml: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const tag of xml.matchAll(/<NODE [^>]*>/g)) {
    const id = /\bId="([0-9A-F]+)"/.exec(tag[0])
    const stamp = /\bTimestamp="(\d+)"/.exec(tag[0])
    if (id && stamp) out[BigInt(`0x${id[1]}`).toString()] = Number(stamp[1])
  }
  return out
}

export function readNodeStamps(collectionPath: string): Record<string, number> {
  const path = playlistXmlPath(collectionPath)
  return existsSync(path) ? nodeTimestamps(readFileSync(path, 'utf8')) : {}
}
