import { resolve } from 'node:path'
import log from 'electron-log/main'
import type { DropInput } from '../shared/dropDetect'
import { engineTrackId } from '../shared/engineContent'
import { readEngineTrackCues } from './engineCues'
import { withEngineLibrary } from './enginePlaylistsIpc'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readCueWaveDetail, readTrackCues } from './rekordboxCues'
import { findTrackByPath, isAmbiguous } from './rekordboxDb'
import { withCollection } from './rekordboxPlaylistsIpc'

export interface EngineDropSources {
  libraryDir: string
  collection: string
  key?: string
  realPath?: (path: string) => string
  words: (file: string) => Promise<Uint16Array | null>
}

export function rekordboxInput(
  file: string,
  sources: Pick<EngineDropSources, 'collection' | 'key' | 'realPath'>,
): DropInput | null {
  try {
    return withCollection(
      sources.collection,
      (db) => {
        const match = findTrackByPath(db, file, { realPath: sources.realPath, quiet: true })
        if (match === null || isAmbiguous(match)) return null
        const share = rekordboxShareDir(sources.collection)
        const read = readTrackCues(db, share, match.id, { wave: false })
        const words = read?.analysed ? readCueWaveDetail(db, share, match.id) : null
        return read && words ? { grid: read.grid, phrases: read.phrases, words } : null
      },
      null,
      sources.key,
    )
  } catch (err) {
    log.warn(`Auto marcar could not read the rekordbox collection: ${String(err)}`)
    return null
  }
}

export async function engineDropInput(
  contentId: string,
  sources: EngineDropSources,
): Promise<DropInput | null> {
  const trackId = engineTrackId(contentId)
  if (trackId === null) return null
  const track = withEngineLibrary(
    sources.libraryDir,
    (db) => {
      const row = db.prepare('SELECT path FROM Track WHERE id = ?').get(trackId) as
        | { path: string | null }
        | undefined
      const read = readEngineTrackCues(db, contentId, { wave: false })
      return row?.path && read?.analysed
        ? { file: resolve(sources.libraryDir, row.path), grid: read.grid }
        : null
    },
    null,
  )
  if (!track) return null
  const fromRekordbox = rekordboxInput(track.file, sources)
  if (fromRekordbox) return fromRekordbox
  const words = await sources.words(track.file)
  return words ? { grid: track.grid, phrases: [], words } : null
}
