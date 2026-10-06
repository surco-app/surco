import type { LibraryTagUpdate } from '../shared/types'
import type { NmlPatch } from './traktorNml'

const NML_FIELDS = ['title', 'artist', 'album', 'genre'] as const

export function nmlTagPatches(
  updates: LibraryTagUpdate[],
  locate: (path: string) => { volume: string; dir: string; file: string },
): NmlPatch[] {
  const patches: NmlPatch[] = []
  for (const update of updates) {
    const tags: NonNullable<NmlPatch['tags']> = {}
    for (const field of NML_FIELDS) {
      const change = update.fields[field]
      if (change) tags[field] = change
    }
    if (Object.keys(tags).length === 0) continue
    patches.push({ ...locate(update.path), tags })
  }
  return patches
}
