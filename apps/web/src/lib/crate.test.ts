import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CRATE } from './crate'

const publicDir = fileURLToPath(new URL('../../public', import.meta.url))

// The scenes load these covers by path at runtime, so a missing file shows up as a broken
// image on the page and nowhere else.
describe('CRATE', () => {
  for (const [key, track] of Object.entries(CRATE)) {
    it(`ships the cover for ${key}`, () => {
      expect(existsSync(`${publicDir}${track.cover}`)).toBe(true)
    })
  }

  it('shows a length on every track, the way the app reads it off the file', () => {
    for (const track of Object.values(CRATE)) expect(track.duration).toMatch(/^\d+:\d{2}$/)
  })
})
