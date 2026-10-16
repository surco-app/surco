import { describe, expect, it, vi } from 'vitest'
import { MAX_ALIAS_PATHS, pathAliasesOf } from './libraryPathKey'

// The user's layout: ~/Music/Music is a symlink to the NAS volume their collection also
// names directly, so one file has two spellings and the OS may hand back either.
const HOME = '/Users/v/Music/Music'
const VOLUME = '/Volumes/Public/Music'
const realPath = vi.fn(async (p: string): Promise<string> => {
  if (p.startsWith('/gone')) throw new Error('ENOENT')
  return p.startsWith(HOME) ? VOLUME + p.slice(HOME.length) : p
})
const options = { realPath, homeMusicDir: HOME }

describe('pathAliasesOf', () => {
  it('names the volume spelling of a row read through the symlinked music folder', async () => {
    expect(await pathAliasesOf([`${HOME}/a.wav`], options)).toEqual(
      expect.arrayContaining([`${HOME}/a.wav`, `${VOLUME}/a.wav`]),
    )
  })

  it('names the link spelling of a row stored by its volume path', async () => {
    expect(await pathAliasesOf([`${VOLUME}/a.wav`], options)).toEqual(
      expect.arrayContaining([`${VOLUME}/a.wav`, `${HOME}/a.wav`]),
    )
  })

  it('keeps the literal path of a file that does not resolve', async () => {
    expect(await pathAliasesOf(['/gone/a.wav'], options)).toEqual(['/gone/a.wav'])
  })

  // A drag of a few hundred rows on the NAS pays an lstat per path component for every
  // resolve: each path once, and the music folder once per call, not once per path.
  it('resolves each path once and the music folder once per call', async () => {
    realPath.mockClear()
    await pathAliasesOf([`${HOME}/a.wav`, `${HOME}/b.wav`, `${VOLUME}/c.wav`], options)
    expect(realPath).toHaveBeenCalledTimes(4)
    expect(realPath.mock.calls.filter(([p]) => p === HOME)).toHaveLength(1)
  })

  // It is an IPC surface: anything but a list of strings answers nothing, and a list is
  // capped so one call cannot keep the main process resolving for minutes.
  it('takes only a list of strings, and only up to the cap', async () => {
    expect(await pathAliasesOf('/m/a.wav', options)).toEqual([])
    expect(await pathAliasesOf([42, '/m/a.wav', null], options)).toEqual(['/m/a.wav'])
    const many = Array.from({ length: MAX_ALIAS_PATHS + 5 }, (_, i) => `/m/${i}.wav`)
    expect(await pathAliasesOf(many, options)).toHaveLength(MAX_ALIAS_PATHS)
  })
})
