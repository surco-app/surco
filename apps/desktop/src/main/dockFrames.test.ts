import { describe, expect, it } from 'vitest'
import { parseDockFrames } from './dockFrames'

describe('parseDockFrames', () => {
  it('accepts the shape the renderer rasterizes', () => {
    const payload = { resting: 'data:image/png;base64,a', frames: ['data:image/png;base64,b'] }
    expect(parseDockFrames(payload)).toEqual(payload)
  })

  // dock:frames is an ipcMain.on listener: before the crash guards a malformed
  // payload's throw killed the whole app, and even with them it must degrade to a
  // no-op (keep the shipped icon) rather than log an error on every play.
  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['missing frames', { resting: 'data:' }],
    ['frames not an array', { resting: 'data:', frames: 'data:' }],
    ['a non-string frame', { resting: 'data:', frames: ['data:', 7] }],
    ['non-string resting', { resting: 7, frames: [] }],
  ])('rejects %s', (_name, payload) => {
    expect(parseDockFrames(payload)).toBeNull()
  })
})
