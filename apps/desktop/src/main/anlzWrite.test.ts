import { describe, expect, it } from 'vitest'
import { anlzSections, beatGrid } from './anlz'
import { anlzFile, pqtzSection, pwavSection } from './anlzFixture'
import { encodePqtz, replaceSection } from './anlzWrite'

const numbered = (ms: number[]) => ms.map((m, i) => ({ ms: m, beat: (i % 4) + 1 }))

describe('encodePqtz', () => {
  it('writes a grid rekordbox reads back beat for beat, because that is the grid the DJ will see', () => {
    const beats = [
      { ms: 846, beat: 3 },
      { ms: 1246, beat: 4 },
      { ms: 1646, beat: 1 },
    ]
    const file = anlzFile(encodePqtz(beats, 149.92))
    expect(beatGrid(file)).toEqual(beats.map((b) => ({ ...b, bpm: 149.92 })))
  })

  it('matches byte for byte the PQTZ fixture validated against real rekordbox files', () => {
    const ms = [112, 512, 912, 1312, 1712]
    expect(encodePqtz(numbered(ms), 149.92).equals(pqtzSection(ms, 149.92))).toBe(true)
  })

  it('rounds fractional beat positions to the whole milliseconds rekordbox stores', () => {
    const file = anlzFile(encodePqtz([{ ms: 112.6, beat: 1 }], 150))
    expect(beatGrid(file)[0].ms).toBe(113)
  })
})

describe('replaceSection', () => {
  it('swaps one section and leaves its neighbours byte for byte, so the waveform and the rest survive', () => {
    const before = pwavSection([1, 2, 3])
    const after = pwavSection([4, 5])
    const file = anlzFile(before, pqtzSection([100, 500]), after)
    const longer = encodePqtz(numbered([100, 500, 900, 1300]), 150)
    const out = replaceSection(file, 'PQTZ', longer)
    const sections = anlzSections(out)
    expect(sections.map((s) => s.tag)).toEqual(['PWAV', 'PQTZ', 'PWAV'])
    const bytes = (i: number) =>
      out.subarray(sections[i].start, sections[i].start + sections[i].length)
    expect(bytes(0).equals(before)).toBe(true)
    expect(bytes(1).equals(longer)).toBe(true)
    expect(bytes(2).equals(after)).toBe(true)
  })

  it('updates the total length in the PMAI header, which rekordbox uses to read the file', () => {
    const file = anlzFile(pqtzSection([100, 500]))
    const out = replaceSection(file, 'PQTZ', encodePqtz(numbered([100, 500, 900]), 150))
    expect(out.readUInt32BE(8)).toBe(out.length)
    expect(out.length).toBe(file.length + 8)
  })

  it('refuses a file without that section instead of writing a grid nobody reads', () => {
    expect(() => replaceSection(anlzFile(pwavSection([1])), 'PQTZ', pqtzSection([1]))).toThrow()
  })
})
