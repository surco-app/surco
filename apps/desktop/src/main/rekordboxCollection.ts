import { statSync } from 'node:fs'
import log from 'electron-log/main'
import { openRekordboxDb } from './rekordboxDb'

type RekordboxDb = NonNullable<ReturnType<typeof openRekordboxDb>>

// Opens the collection read-only for one read and always closes it: rekordbox may be
// running, and a handle left open is a lock it never asked for. No collection on this
// machine answers with the fallback, the empty answer. A collection that is there but
// does not read (not decryptable, rekordbox mid-write, a column a future rekordbox
// renamed) throws instead: the renderer's query turns it into "could not read", which
// is not "no playlists", and must not close an open playlist as if it had been deleted.
export function withCollection<T>(
  path: string,
  read: (db: RekordboxDb) => T,
  fallback: T,
  key?: string,
): T {
  if (!path) return fallback
  const db = openRekordboxDb(path, key ? { readonly: true, key } : { readonly: true })
  if (!db) throw new Error('rekordbox collection could not be opened')
  try {
    return read(db)
  } catch (err) {
    log.warn(`rekordbox playlist read failed: ${String(err)}`)
    throw err
  } finally {
    db.close()
  }
}

const stampOf = (path: string): string =>
  [path, `${path}-wal`]
    .map((file) => {
      try {
        const { mtimeMs, size } = statSync(file)
        return `${mtimeMs}:${size}`
      } catch {
        return ''
      }
    })
    .join('|')

export function collectionMemo<T>(
  build: (db: RekordboxDb) => T,
): (path: string, key?: string) => T | null {
  let held: { path: string; stamp: string; value: T } | null = null
  return (path, key) => {
    if (!path) return null
    const stamp = stampOf(path)
    if (held?.path === path && held.stamp === stamp) return held.value
    held = null
    const value = withCollection<T | null>(path, build, null, key)
    if (value !== null) held = { path, stamp, value }
    return value
  }
}
