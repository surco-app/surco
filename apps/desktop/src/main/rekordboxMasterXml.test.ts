import { describe, expect, it } from 'vitest'
import { hexId } from './rekordboxMasterXml'

describe('masterPlaylists6.xml ids', () => {
  // Measured: Id is the decimal ID in uppercase hex without leading zeros (30D40 is
  // 200000), and the root is ParentId "0". A node spelt otherwise names no playlist.
  it('spells IDs in uppercase hex and the root as 0', () => {
    expect(hexId('200000')).toBe('30D40')
    expect(hexId('4097321833')).toBe('F4382B69')
    expect(hexId('root')).toBe('0')
  })
})
