import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  hexId,
  nodeTimestamp,
  nodeTimestamps,
  playlistXmlPath,
  readNodeStamps,
  withNodeTimestamp,
  withoutNodes,
  withPlaylistNode,
  xmlNodeIds,
} from './rekordboxMasterXml'

describe('masterPlaylists6.xml ids', () => {
  // Measured: Id is the decimal ID in uppercase hex without leading zeros (30D40 is
  // 200000), and the root is ParentId "0". A node spelt otherwise names no playlist.
  it('spells IDs in uppercase hex and the root as 0', () => {
    expect(hexId('200000')).toBe('30D40')
    expect(hexId('4097321833')).toBe('F4382B69')
    expect(hexId('root')).toBe('0')
  })
})

const XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '',
  '<MASTER_PLAYLIST Version="3.0.0" AutomaticSync="0">',
  '  <PRODUCT Name="rekordbox" Version="7.2.19" Company="Pioneer DJ"/>',
  '  <PLAYLISTS>',
  '    <NODE Id="3E8" ParentId="0" Attribute="1" Timestamp="1767225600000" Lib_Type="0" CheckType="0"/>',
  '  </PLAYLISTS>',
  '</MASTER_PLAYLIST>',
  '',
].join('\r\n')

describe('masterPlaylists6.xml', () => {
  it('lives beside master.db', () => {
    expect(playlistXmlPath('/Users/dj/Library/Pioneer/rekordbox/master.db')).toBe(
      '/Users/dj/Library/Pioneer/rekordbox/masterPlaylists6.xml',
    )
  })

  // rekordbox appends new nodes at the end whatever their folder, with CRLF line ends;
  // everything already in the file stays byte for byte.
  it('appends the node as the last playlist entry, keeping the file as it was', () => {
    const next = withPlaylistNode(XML, {
      id: '777',
      parentId: '1000',
      attribute: 0,
      timestamp: 1792087200000,
    })
    expect(next).toBe(
      XML.replace(
        '  </PLAYLISTS>',
        '    <NODE Id="309" ParentId="3E8" Attribute="0" Timestamp="1792087200000" Lib_Type="0" CheckType="0"/>\r\n  </PLAYLISTS>',
      ),
    )
  })

  // A collection with no playlist yet may write the element self-closed.
  it('opens an empty playlist list to add the first node', () => {
    const empty = XML.replace(/ {2}<PLAYLISTS>\r\n.*\r\n {2}<\/PLAYLISTS>/, '  <PLAYLISTS/>')
    expect(
      withPlaylistNode(empty, { id: '777', parentId: 'root', attribute: 1, timestamp: 1 }),
    ).toContain(
      '  <PLAYLISTS>\r\n    <NODE Id="309" ParentId="0" Attribute="1" Timestamp="1" Lib_Type="0" CheckType="0"/>\r\n  </PLAYLISTS>',
    )
  })

  it('refuses a file without a playlist list rather than guessing where to write', () => {
    expect(() =>
      withPlaylistNode('<MASTER_PLAYLIST/>', {
        id: '1',
        parentId: 'root',
        attribute: 0,
        timestamp: 1,
      }),
    ).toThrow('masterPlaylists6.xml has no PLAYLISTS element')
  })

  // Writing the node before an inline close tag would put it outside the element, and the
  // write would still look like it worked; failing lets the caller restore the backups.
  it('refuses a close tag that does not start its own line', () => {
    const inline = XML.replace(
      / {2}<PLAYLISTS>\r\n.*\r\n {2}<\/PLAYLISTS>/,
      '  <PLAYLISTS></PLAYLISTS>',
    )
    expect(() =>
      withPlaylistNode(inline, { id: '777', parentId: 'root', attribute: 0, timestamp: 1 }),
    ).toThrow('masterPlaylists6.xml PLAYLISTS is not laid out one node per line')
  })

  // The real file keeps nodes the database no longer has; a new ID must avoid those too.
  it('lists the node IDs the file already holds', () => {
    expect(xmlNodeIds(XML)).toEqual(new Set(['3E8']))
  })
})

const THREE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '',
  '<MASTER_PLAYLIST Version="3.0.0" AutomaticSync="0">',
  '  <PRODUCT Name="rekordbox" Version="7.2.19" Company="Pioneer DJ"/>',
  '  <PLAYLISTS>',
  '    <NODE Id="3E8" ParentId="0" Attribute="1" Timestamp="1767225600000" Lib_Type="0" CheckType="0"/>',
  '    <NODE Id="7D0" ParentId="3E8" Attribute="0" Timestamp="1767225600001" Lib_Type="0" CheckType="0"/>',
  '    <NODE Id="BB8" ParentId="0" Attribute="0" Timestamp="1767225600002" Lib_Type="0" CheckType="0"/>',
  '    <NODE Id="ITUNES" ParentId="0" Attribute="0" Timestamp="5" Lib_Type="1" CheckType="0"/>',
  '  </PLAYLISTS>',
  '</MASTER_PLAYLIST>',
  '',
].join('\r\n')

describe('masterPlaylists6.xml node timestamps', () => {
  it('reads the Timestamp of the node for a decimal row ID', () => {
    expect(nodeTimestamp(THREE, '2000')).toBe(1767225600001)
    expect(nodeTimestamp(THREE, '3000')).toBe(1767225600002)
  })

  it('says null for a playlist the XML has no node for', () => {
    expect(nodeTimestamp(THREE, '4000')).toBeNull()
  })

  it('never reads a ParentId as the node it points at', () => {
    const onlyChild = THREE.replace(/.*Id="3E8".*\r\n/, '')
    expect(nodeTimestamp(onlyChild, '1000')).toBeNull()
  })

  it('moves only the one node Timestamp, since rekordbox sync compares it and any other byte moved would be a change Surco invented', () => {
    const next = withNodeTimestamp(THREE, '2000', 1797000000000)
    expect(next).toBe(THREE.replace('Timestamp="1767225600001"', 'Timestamp="1797000000000"'))
  })

  it('leaves the text alone when the node is missing', () => {
    expect(withNodeTimestamp(THREE, '4000', 1797000000000)).toBe(THREE)
  })
})

describe('masterPlaylists6.xml node removal', () => {
  it('drops the named nodes whole with their line ending, so no node outlives its playlist and no blank line is left', () => {
    const next = withoutNodes(THREE, ['1000', '2000'])
    expect(next).toBe(THREE.replace(/.*Id="3E8".*\r\n/, '').replace(/.*Id="7D0".*\r\n/, ''))
    expect(next).toContain('Id="BB8"')
    expect(next).toContain('Id="ITUNES"')
    expect(next.includes('\r\n\r\n    <NODE')).toBe(false)
  })

  it('ignores IDs the XML never had', () => {
    expect(withoutNodes(THREE, ['4000'])).toBe(THREE)
  })

  it('keeps a node whose ParentId names a removed one, for the caller to name too', () => {
    expect(withoutNodes(THREE, ['1000'])).toContain('Id="7D0"')
  })
})

describe('node timestamps', () => {
  it('reads every node by its decimal playlist id and skips ids that are not rekordbox rows', () => {
    expect(nodeTimestamps(THREE)).toEqual({
      '1000': 1767225600000,
      '2000': 1767225600001,
      '3000': 1767225600002,
    })
  })

  it('reads them from the file beside the collection and answers none without one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-rbstamps-'))
    expect(readNodeStamps(join(dir, 'master.db'))).toEqual({})
    await writeFile(join(dir, 'masterPlaylists6.xml'), THREE)
    expect(readNodeStamps(join(dir, 'master.db'))).toEqual(nodeTimestamps(THREE))
  })
})
