import { describe, expect, it } from 'vitest'
import { buildLibraryIndex } from './appleMusicLibrary'
import { selectionReplaceMode } from './replaceSelection'

// What a MULTI-track convert should do when some of the selected tracks already have a
// copy in Apple Music. Asked 15/09: "si se selecciona varias pistas de sustitucion, el
// boton deberia permitir. Si se mezcla, sustitucion y anadir, no deberia permitir."
//
// So the selection is homogeneous or it does not replace at all. A mixed batch is refused
// rather than silently doing one thing for some tracks and another for the rest — the
// failure that already cost a day here was a button whose label promised one action and
// whose click performed a different one.

const index = buildLibraryIndex([
  { title: 'Possession (Dececio Remix)', artist: 'Transfer', persistentId: 'PID1' },
  { title: 'Sunrise', artist: 'Halo', persistentId: 'PID2' },
])

function track(title: string, artist: string) {
  return { meta: { title, artist } }
}

describe('selectionReplaceMode', () => {
  // Every selected track supersedes a library copy, so the batch is a replacement and the
  // button says so.
  it('replaces when every selected track has a copy in the library', () => {
    expect(
      selectionReplaceMode(index, [
        track('Possession (Dececio Remix)', 'Transfer'),
        track('Sunrise', 'Halo'),
      ]),
    ).toBe('replace')
  })

  // The ordinary batch: nothing selected is in the library, so these are plain adds.
  it('adds when no selected track has a copy in the library', () => {
    expect(
      selectionReplaceMode(index, [track('Unknown Song', 'Nobody'), track('Another', 'Nobody')]),
    ).toBe('add')
  })

  // The case the user ruled on: replacing some and adding others in one click is refused,
  // so the button can disable itself and say why.
  it('refuses a selection that mixes replacements and additions', () => {
    expect(
      selectionReplaceMode(index, [
        track('Possession (Dececio Remix)', 'Transfer'),
        track('Unknown Song', 'Nobody'),
      ]),
    ).toBe('mixed')
  })

  // An ambiguous match cannot be replaced on a guess (replacePatch already refuses to
  // stamp one), so a selection containing one is not a clean replacement batch either.
  it('refuses when a selected track matches more than one library copy', () => {
    const twins = buildLibraryIndex([
      { title: 'Possession (Dececio Remix)', artist: 'Transfer', persistentId: 'PID1' },
      { title: 'Possession (Dececio Remix)', artist: 'Transfer', persistentId: 'PID3' },
    ])

    expect(selectionReplaceMode(twins, [track('Possession (Dececio Remix)', 'Transfer')])).toBe(
      'mixed',
    )
  })

  // One track is the single-select case and must keep behaving exactly as it does today.
  it('replaces a lone track that has a copy', () => {
    expect(selectionReplaceMode(index, [track('Possession (Dececio Remix)', 'Transfer')])).toBe(
      'replace',
    )
  })

  // No library snapshot (not on macOS, or it never loaded) means nothing can be known
  // about copies, so the batch is a plain add rather than a refusal the user cannot act on.
  it('adds when there is no library index', () => {
    expect(selectionReplaceMode(null, [track('Possession (Dececio Remix)', 'Transfer')])).toBe(
      'add',
    )
  })

  // An empty selection has nothing to decide and must not read as a refusal.
  it('adds when nothing is selected', () => {
    expect(selectionReplaceMode(index, [])).toBe('add')
  })
})
