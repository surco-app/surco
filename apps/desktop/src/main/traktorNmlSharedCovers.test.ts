import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyPatches, detachedOutputPaths, type NmlPatch, refreshedCoverIds } from './traktorNml'

const SHARED_COVERS = readFileSync(
  join(import.meta.dirname, 'fixtures', 'traktor-shared-cover-ids.nml'),
  'utf8',
)

const SUPDUB = '021/VE1D35AAGBO3ZDBQRVUGBEPXFZHD'
const SAME_IMAGE = '076/MGSGETAJFV4FDDHATPYNATX4RB5D'

const substitute = (volume: string, dir: string, file: string): NmlPatch => {
  const newFile = file.replace(/\.mp3$/, '.flac')
  return {
    volume,
    dir,
    file,
    newFile,
    outputVolume: volume,
    outputDir: dir,
    outputFile: newFile,
    outputPath: `/converted/${newFile}`,
    refreshCoverArt: true,
  }
}

const occurrences = (nml: string, id: string) => nml.split(`COVERARTID="${id}"`).length - 1

describe('cover ids a real Traktor collection shares', () => {
  it('keeps the rest of an album on its cover when one of its tracks is converted', () => {
    const wish = substitute('MTB3', '/:Set 1/:', 'Wish.mp3')

    expect(refreshedCoverIds(SHARED_COVERS, [wish])).toEqual([])
    expect(occurrences(applyPatches(SHARED_COVERS, [wish]), SUPDUB)).toBe(3)
    expect(detachedOutputPaths(SHARED_COVERS, [wish])).toEqual(['/converted/Wish.flac'])
  })

  it('keeps a track from another release on its cover when both carry the same image', () => {
    const purpleNoise = substitute(
      'osx',
      '/:Users/:johndoe/:Music/:pechundschwefel/:',
      '37 - Boris Brejcha - Purple Noise.mp3',
    )

    expect(refreshedCoverIds(SHARED_COVERS, [purpleNoise])).toEqual([])
    expect(occurrences(applyPatches(SHARED_COVERS, [purpleNoise]), SAME_IMAGE)).toBe(1)
  })

  it('still redraws the cover of a track whose id no other track uses', () => {
    const laLuna = substitute(
      'osx',
      '/:Users/:johndoe/:Music/:pechundschwefel/:',
      '8065021_La_Luna_feat__Toto_La_Momposina_Original_Mix.mp3',
    )

    expect(refreshedCoverIds(SHARED_COVERS, [laLuna])).toEqual([
      {
        coverId: '063/5ZRF4NCRFJOF2CUXCWY4BEN22MKA',
        file: '/converted/8065021_La_Luna_feat__Toto_La_Momposina_Original_Mix.flac',
      },
    ])
  })
})
