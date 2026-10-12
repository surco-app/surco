import type { SearchResult } from '../../../shared/types'

// Where the editor was left, kept for the session: the editor remounts per track, and
// reviewing a crate means the same section at the same zoom track after track.
export const editorPlace: {
  scrollTop: number
  trimContext: Record<'start' | 'end', number> | null
  lastAlbum: SearchResult | null
} = { scrollTop: 0, trimContext: null, lastAlbum: null }

// Test seam, like resetEditorSections: the place outlives renders by design.
export function resetEditorPlace(): void {
  editorPlace.scrollTop = 0
  editorPlace.trimContext = null
  editorPlace.lastAlbum = null
}
