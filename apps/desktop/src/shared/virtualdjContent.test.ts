import { describe, expect, it } from 'vitest'
import { isVirtualdjContent, virtualdjFileOf } from './virtualdjContent'

describe('virtualdjContent', () => {
  it('gives back the exact song path an id was made from, since VirtualDJ knows a song only by its path', () => {
    expect(virtualdjFileOf('virtualdj:/Music/a & b/Pray.mp3')).toBe('/Music/a & b/Pray.mp3')
  })

  it('never takes another program id for a VirtualDJ one', () => {
    expect(isVirtualdjContent('virtualdj:/Music/x.mp3')).toBe(true)
    expect(isVirtualdjContent('serato:/Music/x.mp3')).toBe(false)
    expect(isVirtualdjContent('/Music/virtualdj:x.mp3')).toBe(false)
  })
})
