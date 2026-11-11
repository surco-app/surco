import { describe, expect, it } from 'vitest'
import { type DestinationLineState, destinationLine } from './destinationLine'

const base: DestinationLineState = {
  destination: 'folder',
  withAppleMusic: false,
  djTargets: [],
  djHolds: [],
  openSource: null,
  inPlace: false,
  inMusic: false,
  replaces: false,
  libraryBetter: false,
  replacedFormat: '',
  outputFolder: '',
}

const line = (s: Partial<DestinationLineState>) => destinationLine({ ...base, ...s })
const keys = (s: Partial<DestinationLineState>) => line(s).parts.map((p) => p.key)

describe('destinationLine', () => {
  it('says what is updated, named in one place, when the track is already in Music and the source', () => {
    const result = line({
      destination: 'appleMusic',
      withAppleMusic: true,
      inMusic: true,
      inPlace: true,
      djTargets: ['rekordbox'],
      openSource: 'rekordbox',
    })
    expect(result.parts).toEqual([
      { key: 'editor.lineUpdates', options: { places: 'Apple Music · rekordbox' } },
    ])
  })

  it('says a new track is added to Music', () => {
    const result = line({ destination: 'appleMusic', withAppleMusic: true })
    expect(result.parts).toEqual([{ key: 'editor.lineAdds', options: { places: 'Apple Music' } }])
  })

  it('names the format a replacement supersedes in Music', () => {
    const result = line({
      destination: 'appleMusic',
      withAppleMusic: true,
      replaces: true,
      replacedFormat: 'MP3',
    })
    expect(result.parts).toEqual([{ key: 'editor.lineReplaces', options: { format: 'MP3' } }])
  })

  it('falls back to the bare replacement when the old format is unknown', () => {
    expect(
      keys({ destination: 'appleMusic', withAppleMusic: true, replaces: true, replacedFormat: '' }),
    ).toEqual(['editor.lineReplacesBare'])
  })

  it('warns on the better-copy statement alone, never on the places beside it', () => {
    const result = line({
      destination: 'appleMusic',
      withAppleMusic: true,
      replaces: true,
      replacedFormat: 'MP3',
      libraryBetter: true,
      djTargets: ['rekordbox'],
    })
    expect(result.parts).toEqual([
      { key: 'editor.lineBetter', warn: true },
      { key: 'editor.lineSyncs', options: { places: 'rekordbox' } },
    ])
  })

  it('says where the file is saved before the programs that receive it', () => {
    const result = line({
      destination: 'folder',
      outputFolder: 'Converted',
      djTargets: ['rekordbox'],
    })
    expect(result.parts).toEqual([
      { key: 'editor.lineFolder', options: { folder: 'Converted' } },
      { key: 'editor.lineSyncs', options: { places: 'rekordbox' } },
    ])
  })

  it('does not name the folder when the file is edited where it already is', () => {
    expect(keys({ destination: 'folder', outputFolder: 'Converted', inPlace: true })).toEqual([])
  })

  it('says a copy is written next to the original', () => {
    expect(keys({ destination: 'beside' })).toEqual(['editor.lineBeside'])
  })

  it('says the original itself is edited on overwrite', () => {
    expect(keys({ destination: 'overwrite', inPlace: true })).toEqual(['editor.lineOverwrite'])
  })

  it('never says it adds to Apple Music a track that was opened from it, since the source is updated in place', () => {
    const result = line({
      destination: 'folder',
      withAppleMusic: false,
      openSource: 'appleMusic',
      inPlace: true,
    })
    expect(result.parts).toEqual([
      { key: 'editor.lineUpdates', options: { places: 'Apple Music' } },
    ])
  })

  it('never names Music for a track opened from it that the conversion leaves out of Music', () => {
    expect(
      line({
        destination: 'folder',
        withAppleMusic: false,
        openSource: 'appleMusic',
        outputFolder: 'Converted',
      }).parts,
    ).toEqual([{ key: 'editor.lineFolder', options: { folder: 'Converted' } }])
  })

  it('never names Music for a format it cannot hold', () => {
    expect(
      line({ destination: 'folder', withAppleMusic: false, outputFolder: 'Converted' }).parts,
    ).toEqual([{ key: 'editor.lineFolder', options: { folder: 'Converted' } }])
  })

  it('puts updated places before added and synced ones', () => {
    const result = line({
      destination: 'appleMusic',
      withAppleMusic: true,
      djTargets: ['traktor', 'engine'],
      openSource: 'engine',
    })
    expect(result.parts).toEqual([
      { key: 'editor.lineUpdates', options: { places: 'Engine DJ' } },
      { key: 'editor.lineAdds', options: { places: 'Apple Music' } },
      { key: 'editor.lineSyncs', options: { places: 'Traktor' } },
    ])
  })

  it('says a DJ program is updated when the track is known to be in it', () => {
    expect(
      line({
        destination: 'folder',
        inPlace: true,
        djTargets: ['rekordbox'],
        djHolds: ['rekordbox'],
      }).parts,
    ).toEqual([{ key: 'editor.lineUpdates', options: { places: 'rekordbox' } }])
  })

  it('never claims an update or an add for a DJ program whose collection may not hold the file, even in place', () => {
    expect(line({ destination: 'folder', inPlace: true, djTargets: ['engine'] }).parts).toEqual([
      { key: 'editor.lineSyncs', options: { places: 'Engine DJ' } },
    ])
  })

  it.each([
    ['rekordbox', 'rekordbox'],
    ['engine', 'Engine DJ'],
    ['traktor', 'Traktor'],
    ['serato', 'Serato'],
  ] as const)('names %s on the line', (id, name) => {
    expect(line({ destination: 'appleMusic', djTargets: [id] }).parts).toEqual([
      { key: 'editor.lineSyncs', options: { places: name } },
    ])
  })
})
