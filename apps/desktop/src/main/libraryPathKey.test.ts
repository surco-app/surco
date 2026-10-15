import { describe, expect, it } from 'vitest'
import { pathAliases } from './libraryPathKey'

// The user's layout: ~/Music/Music is a symlink to the NAS volume their collection also
// names directly, so one file has two spellings and the OS may hand back either.
const HOME = '/Users/v/Music/Music'
const VOLUME = '/Volumes/Public/Music'
const realPath = (p: string): string => {
  if (p.startsWith('/gone')) throw new Error('ENOENT')
  return p.startsWith(HOME) ? VOLUME + p.slice(HOME.length) : p
}

describe('pathAliases', () => {
  it('names the volume spelling of a row read through the symlinked music folder', () => {
    expect(pathAliases(`${HOME}/a.wav`, { realPath, homeMusicDir: HOME })).toEqual(
      expect.arrayContaining([`${HOME}/a.wav`, `${VOLUME}/a.wav`]),
    )
  })

  it('names the link spelling of a row stored by its volume path', () => {
    expect(pathAliases(`${VOLUME}/a.wav`, { realPath, homeMusicDir: HOME })).toEqual(
      expect.arrayContaining([`${VOLUME}/a.wav`, `${HOME}/a.wav`]),
    )
  })

  it('keeps the literal path of a file that does not resolve', () => {
    expect(pathAliases('/gone/a.wav', { realPath, homeMusicDir: HOME })).toEqual(['/gone/a.wav'])
  })
})
