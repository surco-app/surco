import { describe, expect, it } from 'vitest'
import { createMediaAccess } from './mediaAccess'

describe('mediaAccess', () => {
  // The core guarantee: a path the app never handed to the renderer can't be
  // streamed, so surco:// stops being an arbitrary-file-read primitive.
  it('denies a path that was never registered', () => {
    const access = createMediaAccess()
    expect(access.isAllowed('/etc/passwd')).toBe(false)
  })

  it('allows a registered path but no neighbour', () => {
    const access = createMediaAccess()
    access.allow('/music/a.wav')
    expect(access.isAllowed('/music/a.wav')).toBe(true)
    expect(access.isAllowed('/music/b.wav')).toBe(false)
  })

  it('allows every path in a batch', () => {
    const access = createMediaAccess()
    access.allowAll(['/m/a.wav', '/m/b.flac'])
    expect(access.isAllowed('/m/a.wav')).toBe(true)
    expect(access.isAllowed('/m/b.flac')).toBe(true)
  })

  it('never registers an empty path', () => {
    const access = createMediaAccess()
    access.allow('')
    access.allowAll(['', '/m/c.wav'])
    expect(access.isAllowed('')).toBe(false)
    expect(access.isAllowed('/m/c.wav')).toBe(true)
  })
})
