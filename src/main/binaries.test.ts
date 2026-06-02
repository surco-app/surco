import { vi, describe, it, expect } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { unpacked } from './binaries'

describe('unpacked', () => {
  it('remaps the binary into app.asar.unpacked when packaged, because native binaries cannot be spawned from inside the asar archive', () => {
    const inside = '/Applications/Surco.app/Contents/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg'
    expect(unpacked(inside, true)).toBe(
      '/Applications/Surco.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'
    )
  })

  it('leaves the path untouched in development, where the binary is run straight from node_modules', () => {
    const dev = '/Users/vicent/code/vinilo/node_modules/ffmpeg-static/ffmpeg'
    expect(unpacked(dev, false)).toBe(dev)
  })
})
