// rekordbox 6 and 7 keep every playlist and folder twice: as a row in master.db and as a
// NODE in masterPlaylists6.xml beside it, where the row ID is written in hex.

// The decimal row ID in uppercase hex without leading zeros, and the root as "0" (measured
// on the real file: 30D40 is 200000).
export function hexId(id: string): string {
  return id === 'root' ? '0' : BigInt(id).toString(16).toUpperCase()
}
