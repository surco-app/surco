import { describe, expect, it } from 'vitest'
import { nmlTagPatches } from './libraryTagPatches'

const locate = (path: string) => ({ volume: 'V', dir: '/d/', file: path })

describe('nmlTagPatches', () => {
  it('keeps the four fields Traktor stores and drops the album artist', () => {
    const patches = nmlTagPatches(
      [
        {
          path: 'a.mp3',
          fields: {
            artist: { from: 'x', to: 'y' },
            albumArtist: { from: 'p', to: 'q' },
          },
        },
      ],
      locate,
    )
    expect(patches).toEqual([
      { volume: 'V', dir: '/d/', file: 'a.mp3', tags: { artist: { from: 'x', to: 'y' } } },
    ])
  })

  // Traktor keeps no album artist, so a patch carrying nothing else would only make the
  // sync touch and back up the collection for no change.
  it('skips an update whose only field is the album artist', () => {
    const patches = nmlTagPatches(
      [{ path: 'a.mp3', fields: { albumArtist: { from: 'p', to: 'q' } } }],
      locate,
    )
    expect(patches).toEqual([])
  })
})
